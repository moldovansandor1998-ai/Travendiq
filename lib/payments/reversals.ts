import type { createServiceClient } from "@/lib/supabase/server";
import { classifyStripeError, type StripeProvider } from "@/lib/payments/stripe";

type Svc = ReturnType<typeof createServiceClient>;

/** Dob, ha a Supabase-művelet hibát adott. */
function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`db: ${result.error.message}`);
  return result.data;
}

export interface ReversalSubmitResult {
  submitted: boolean;
  stripeReversalId?: string;
  skippedReason?: "row_not_found" | "already_submitted" | "not_submittable_state";
  /** végleges Stripe-elutasítás történt (a sor stripe_failed lett) */
  stripeRejected?: boolean;
  /** bizonytalan eredmény (timeout/kapcsolat) – a sor újraegyeztethető marad */
  ambiguous?: boolean;
}

/**
 * Egy payout_reversals sor beküldése a Stripe-nak (transfers.createReversal).
 *
 * Szabályok:
 *  - az idempotencia-kulcs MINDIG a sorban tárolt kulcs → a Stripe-hívás
 *    biztonságosan újrafuttatható (crash a DB-kérés után / mentési hiba esetén
 *    sem jöhet létre dupla reversal),
 *  - a Stripe API elutasítása → stripe_failed (fail_payout_reversal_row,
 *    p_stripe_rejected=true) – ez NEM ugyanaz, mint a helyi DB-hiba,
 *  - ha a Stripe-hívás SIKERES, de a record_reversal_sent DB-mentés hibázik,
 *    a sor NEM lesz failed: a hívó (webhook) kivételt kap → az esemény failed →
 *    a Stripe újraküldi → a replay ugyanazzal a kulccsal egyezteti az eredményt.
 */
export async function submitPayoutReversal(
  sb: Svc, stripe: StripeProvider, reversalRowId: string,
): Promise<ReversalSubmitResult> {
  const row = must(await sb.from("payout_reversals")
    .select("id, payout_id, refund_id, dispute_id, requested_amount, currency, status, stripe_reversal_id, idempotency_key")
    .eq("id", reversalRowId).maybeSingle()) as {
      id: string; payout_id: string; refund_id: string | null; dispute_id: string | null;
      requested_amount: number; currency: string;
      status: string; stripe_reversal_id: string | null; idempotency_key: string;
    } | null;
  if (!row) return { submitted: false, skippedReason: "row_not_found" };
  if (row.stripe_reversal_id) {
    return { submitted: true, stripeReversalId: row.stripe_reversal_id, skippedReason: "already_submitted" };
  }
  if (row.status !== "requested" && row.status !== "submitting") {
    return { submitted: false, skippedReason: "not_submittable_state" };
  }

  const payout = must(await sb.from("payouts")
    .select("provider_payout_id").eq("id", row.payout_id).single()) as { provider_payout_id: string | null };
  if (!payout?.provider_payout_id) return { submitted: false, skippedReason: "row_not_found" };

  // 1) Stripe-hívás METADATA-val (a webhook ezzel párosít) – a hiba
  //    osztályozva: végleges elutasítás vs bizonytalan (timeout/kapcsolat)
  let reversalId: string;
  try {
    const r = await stripe.reverseTransfer(
      payout.provider_payout_id, row.requested_amount, row.idempotency_key,
      {
        reversal_row_id: row.id,
        idempotency_key: row.idempotency_key,
        payout_id: row.payout_id,
        ...(row.refund_id ? { refund_id: row.refund_id } : {}),
        ...(row.dispute_id ? { dispute_id: row.dispute_id } : {}),
      });
    reversalId = r.reversalId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "stripe_reversal_error";
    if (classifyStripeError(e) === "final") {
      // egyértelmű Stripe-elutasítás → stripe_failed (emberi/ütemezett rendezés)
      const { error: failErr } = await sb.rpc("fail_payout_reversal_row", {
        p_reversal_row: row.id, p_reason: msg, p_stripe_rejected: true,
      });
      if (failErr) throw new Error(`db: fail_payout_reversal_row: ${failErr.message}`);
      return { submitted: false, stripeRejected: true };
    }
    // BIZONYTALAN: a reversal a Stripe-on létrejöhetett → a sor NEM failed,
    // 'requested' marad és azonos idempotencia-kulccsal újraegyezthető
    const { error: relErr } = await sb.rpc("fail_payout_reversal_row", {
      p_reversal_row: row.id, p_reason: `ambiguous: ${msg}`, p_stripe_rejected: false,
    });
    if (relErr) throw new Error(`db: reversal_lock_release: ${relErr.message}`);
    return { submitted: false, ambiguous: true };
  }

  // 2) a Stripe SIKERES volt → a DB-mentés hibája NEM állíthatja failed-re a
  //    sort: kivétel → a webhook 500 → a Stripe retry-ja azonos kulccsal
  //    egyezteti újra (idempotens).
  must(await sb.rpc("record_reversal_sent", {
    p_reversal_row: row.id, p_stripe_reversal_id: reversalId,
  }));
  return { submitted: true, stripeReversalId: reversalId };
}
