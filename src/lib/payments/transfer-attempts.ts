import type { createServiceClient } from "@/lib/supabase/server";
import { classifyStripeError, StripeProvider } from "@/lib/payments/stripe";
import { submitPayoutReversal } from "@/lib/payments/reversals";

type Svc = ReturnType<typeof createServiceClient>;

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`db: ${result.error.message}`);
  return result.data;
}

interface TransferAttemptRow {
  attempt_id: string;
  payout_id: string;
  amount: number;
  currency: string;
  destination_account: string | null;
  source_charge_id: string | null;
  idempotency_key: string;
  stripe_transfer_id: string | null;
  status: "prepared" | "submitting" | "submitted" | "finalized" | "ambiguous" | "failed" | "reconciliation_required";
  attempts: number;
}

/**
 * Transfer-attempt rekonsziliáció (cron).
 *
 * A legsúlyosabb megmaradt eset kezelése: a Stripe Transfer MÁR SIKERÜLT, de a
 * helyi finalize hibázott. Ilyenkor a payout 'transfer_submitted' marad, az
 * attempt TARTÓSAN megőrzi az eredeti összeget + idempotencia-kulcsot, és ez a
 * feldolgozó fejezi be – SOHA nem új összeggel, sosem 'scheduled'-re vissza.
 *
 * Bizonytalan (timeout/kapcsolat) Transfer: ugyanazzal az idempotencia-kulccsal
 * újrapróbáljuk – a Stripe az eredeti Transfert adja vissza, dupla kifizetés
 * nem keletkezhet. Csak az egyértelmű Stripe-elutasítás lesz végleges failed.
 */
export async function processDueTransferAttempts(
  sb: Svc, worker: string, limit = 10,
): Promise<{ claimed: number; finalized: number; failed: number; errors: string[] }> {
  const stripe = new StripeProvider();
  const rows = must(await sb.rpc("claim_due_transfer_attempts", {
    p_limit: limit, p_worker: worker,
  })) as TransferAttemptRow[];

  let finalized = 0, failed = 0;
  const errors: string[] = [];

  for (const at of rows) {
    try {
      // ── 1) Transfer beküldése/egyeztetése ────────────────────────────────
      let transferId = at.stripe_transfer_id;
      if (!transferId) {
        if (!stripe.isConfigured()) {
          errors.push(`attempt ${at.attempt_id}: stripe_not_configured`);
          continue;
        }
        // a cél a 'prepared' állapotból hiányozhat – a providerből pótoljuk
        let destination = at.destination_account;
        let sourceCharge = at.source_charge_id;
        if (!destination) {
          const payout = must(await sb.from("payouts")
            .select("provider_id, booking_id").eq("id", at.payout_id).single()) as
            { provider_id: string; booking_id: string | null };
          const provider = must(await sb.from("providers")
            .select("stripe_account_id").eq("id", payout.provider_id).single()) as
            { stripe_account_id: string | null };
          destination = provider.stripe_account_id;
          if (!destination) {
            // Connect nélkül nincs hová utalni – véglegesen megszakítjuk
            const { error } = await sb.rpc("abort_payout_release", {
              p_payout: at.payout_id, p_reason: "connect_missing",
            });
            if (error) errors.push(`attempt ${at.attempt_id}: abort failed: ${error.message}`);
            failed++;
            continue;
          }
        }
        must(await sb.rpc("update_transfer_attempt_target", {
          p_attempt: at.attempt_id, p_destination: destination, p_source_charge: sourceCharge,
        }));
        try {
          // AZONOS összeg + AZONOS idempotencia-kulcs: ha a Transfer a Stripe-on
          // már létrejött (korábbi timeout), az eredetit kapjuk vissza.
          const t = await stripe.transferToProvider({
            accountId: destination,
            amountCents: at.amount, // a befagyasztott attempt-összeg – NEM változhat
            currency: at.currency,
            idempotencyKey: at.idempotency_key,
            sourceChargeId: sourceCharge,
          });
          transferId = t.transferId;
          must(await sb.rpc("mark_transfer_submitted", {
            p_attempt: at.attempt_id, p_stripe_transfer_id: t.transferId,
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "transfer_failed";
          if (classifyStripeError(e) === "ambiguous") {
            // bizonytalan: NEM failed – 'ambiguous' marad, következő cron egyeztet
            const { error } = await sb.rpc("mark_transfer_ambiguous", {
              p_attempt: at.attempt_id, p_error: msg,
            });
            if (error) errors.push(`attempt ${at.attempt_id}: mark_ambiguous failed: ${error.message}`);
            continue;
          }
          // egyértelmű Stripe-elutasítás → végleges megszakítás
          const { error } = await sb.rpc("abort_payout_release", {
            p_payout: at.payout_id, p_reason: `stripe_final_rejection: ${msg}`,
          });
          if (error) errors.push(`attempt ${at.attempt_id}: abort failed: ${error.message}`);
          failed++;
          continue;
        }
      }

      // ── 2) finalize ugyanazzal az eredeti összeggel ───────────────────────
      // Hiba esetén NEM abortálunk 'scheduled'-re: a payout 'transfer_submitted'
      // marad, a következő cron újrapróbálja (a finalize idempotens).
      const { data: fin, error: finErr } = await sb.rpc("finalize_payout_release", {
        p_payout: at.payout_id, p_actor: null,
        p_transfer_id: transferId, p_manual_reference: null, p_manual_note: null,
        p_transferred_amount: at.amount,
      });
      const result = fin as {
        ok: boolean; obligations?: { reversal_row_id: string }[];
      } | null;
      if (finErr || !result?.ok) {
        console.error(`[transfer-attempts] finalize pending for payout ${at.payout_id}:`, finErr?.message);
        errors.push(`attempt ${at.attempt_id}: finalize_pending_retry: ${finErr?.message ?? "not_ok"}`);
        failed++;
        continue;
      }
      finalized++;

      // ── 3) közben keletkezett kötelezettségek automatikus reversala ───────
      if (stripe.isConfigured() && result.obligations) {
        for (const ob of result.obligations) {
          try {
            await submitPayoutReversal(sb, stripe, ob.reversal_row_id);
          } catch (e) {
            // a sor 'requested' marad, a reversal-cron újrapróbálja
            const msg = e instanceof Error ? e.message : "reversal_submit_failed";
            console.error(`[transfer-attempts] reversal ${ob.reversal_row_id}:`, msg);
            errors.push(`reversal ${ob.reversal_row_id}: ${msg}`);
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "attempt_processing_failed";
      console.error(`[transfer-attempts] attempt ${at.attempt_id}:`, msg);
      errors.push(`attempt ${at.attempt_id}: ${msg}`);
      failed++;
    }
  }

  return { claimed: rows.length, finalized, failed, errors };
}
