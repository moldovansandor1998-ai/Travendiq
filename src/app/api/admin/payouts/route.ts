import { NextRequest, NextResponse } from "next/server";
import { payoutActionSchema as schema } from "@/lib/validation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { StripeProvider, classifyStripeError } from "@/lib/payments/stripe";
import { submitPayoutReversal } from "@/lib/payments/reversals";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { formatMoney } from "@/lib/utils";


/**
 * Admin kifizetés-kezelés – SORZÁRRAL (acquire/finalize/abort RPC):
 *  - a release-jogot atomikusan csak egy folyamat kapja meg ('releasing'),
 *  - 'paid' státusz KIZÁRÓLAG bizonyítékkal (tr_ transfer ID vagy manuális
 *    referencia + dátum + megjegyzés),
 *  - aktív refund/chargeback esetén a kifizetés blokkolva (PAYOUT_BLOCKED),
 *  - sikertelen transzfernél a payout visszakerül 'scheduled'-be (retry).
 */
export async function POST(req: NextRequest) {
  const rl = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(rl, `payout:${ip}`, 20))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: isAdmin } = await session.rpc("is_admin");
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const input = parsed.data;

  const sb = createServiceClient();

  if (input.action === "hold") {
    // MINDEN kritikus DB-hívás hibája ellenőrzött – csendes hiba itt pénzügyi
    // inkonzisztenciát okozna (pl. "held"-nek hitt, de valójában nem zárt payout).
    const { data: held, error: holdErr } = await sb.from("payouts")
      .update({ status: "held", hold_reason: input.note ?? "admin_hold" })
      .eq("id", input.payoutId).in("status", ["pending", "scheduled"]).select("id");
    if (holdErr) {
      return NextResponse.json({ error: `hold_failed: ${holdErr.message}` }, { status: 500 });
    }
    if (!held || held.length === 0) {
      return NextResponse.json({ error: "payout_not_holdable" }, { status: 409 });
    }
    const { error: auditErr } = await sb.from("audit_log").insert({ actor_id: user.id,
      actor_role: "admin", action: "payout.held", entity: "payouts",
      entity_id: input.payoutId, diff: { note: input.note } });
    if (auditErr) {
      return NextResponse.json({ error: `audit_failed: ${auditErr.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status: "held" });
  }

  if (input.action === "resolve_reversal") {
    // manuális reversal-rendezés: banki referencia + dátum + rendezett összeg +
    // admin + megjegyzés KÖTELEZŐ (az RPC is kényszeríti), audit loggal
    const { data: res, error: resErr } = await sb.rpc("resolve_reversal_manually", {
      p_reversal_row: input.reversalId, p_admin: user.id,
      p_reference: input.reference, p_resolved_date: input.resolvedDate,
      p_amount: input.amount, p_note: input.note,
    });
    if (resErr) {
      return NextResponse.json({ error: resErr.message }, { status: 409 });
    }
    return NextResponse.json({ ok: true, resolution: res });
  }

  // 1) release-jog megszerzése sorzárral (dupla kifizetés ellen, refund/chargeback-blokkal)
  const { data: acquired, error: acqErr } = await sb.rpc("acquire_payout_release", {
    p_payout: input.payoutId, p_actor: user.id,
  });
  if (acqErr) {
    return NextResponse.json({ error: acqErr.message }, { status: 409 });
  }
  const payout = (acquired as {
    id: string; provider_id: string; amount: number; currency: string;
    booking_id: string | null; attempt_id: string; idempotency_key: string;
  }[] | null)?.[0];
  if (!payout) {
    return NextResponse.json({ error: "invalid_state_or_already_processing" }, { status: 409 });
  }
  // az acquire v3 már ATOMIKUSAN rögzítette a Transfer-attemptet (pontos összeg
  // + idempotencia-kulcs) – ettől a refund már nem módosíthatja az összeget
  const attemptId = payout.attempt_id;
  const attemptKey = payout.idempotency_key;

  /** Abort + hiba-ellenőrzés: ha a visszagörgetés sem sikerül, az 'releasing'-ben
   *  ragadt payoutot azonnal jelezni kell (nem hallgatható el). */
  const abort = async (reason: string) => {
    const { error } = await sb.rpc("abort_payout_release", { p_payout: input.payoutId, p_reason: reason });
    return error?.message ?? null;
  };

  let transferId: string | null = null;
  let transferredAmount: number | null = null;
  let manualRef: string | null = null;
  let manualNote: string | null = null;

  if (input.method === "stripe") {
    const { data: provider, error: provErr } = await sb.from("providers")
      .select("stripe_account_id, contact_email")
      .eq("id", payout.provider_id).single();

    if (provErr) {
      const abortErr = await abort(`provider_lookup_failed: ${provErr.message}`);
      return NextResponse.json({ error: "provider_lookup_failed", abortError: abortErr ?? undefined }, { status: 500 });
    }
    if (!provider?.stripe_account_id) {
      const abortErr = await abort("connect_missing");
      return NextResponse.json({ error: "provider_connect_missing", abortError: abortErr ?? undefined }, { status: 422 });
    }
    const stripe = new StripeProvider();
    if (!stripe.isConfigured()) {
      const abortErr = await abort("stripe_not_configured");
      return NextResponse.json({ error: "stripe_not_configured", abortError: abortErr ?? undefined }, { status: 503 });
    }

    // FRISS Stripe-ellenőrzés közvetlenül a release előtt (nem a DB-ben tárolt,
    // esetleg elavult boolean alapján): a connected accountnak aktív transfers
    // capability-je és engedélyezett payouts-ja kell.
    let acct;
    try {
      acct = await stripe.getAccountDetails(provider.stripe_account_id);
    } catch (e) {
      const abortErr = await abort(`account_check_failed: ${e instanceof Error ? e.message : "unknown"}`);
      return NextResponse.json({ error: "account_check_failed", abortError: abortErr ?? undefined }, { status: 502 });
    }
    // a friss állapotot visszaírjuk a DB-be is (requirements + capabilities) –
    // ha ez elhasal, az elavult Connect-állapot később téves döntést okozna.
    const { error: syncErr } = await sb.rpc("sync_connect_account", {
      p_account_id: provider.stripe_account_id,
      p_charges: acct.chargesEnabled, p_payouts: acct.payoutsEnabled,
      p_details: acct.detailsSubmitted,
      p_requirements: {
        currently_due: acct.currentlyDue, past_due: acct.pastDue,
        disabled_reason: acct.disabledReason,
      },
      p_capabilities: acct.capabilities, p_country: acct.country,
    });
    if (syncErr) {
      const abortErr = await abort(`connect_sync_failed: ${syncErr.message}`);
      return NextResponse.json({ error: "connect_sync_failed", abortError: abortErr ?? undefined }, { status: 500 });
    }
    const canTransfer =
      acct.payoutsEnabled && acct.capabilities.transfers === "active" && !acct.disabledReason;
    if (!canTransfer) {
      const abortErr = await abort("connect_not_transferable");
      return NextResponse.json({
        error: "connect_not_transferable",
        abortError: abortErr ?? undefined,
        detail: {
          payoutsEnabled: acct.payoutsEnabled,
          transfersCapability: acct.capabilities.transfers,
          currentlyDue: acct.currentlyDue, pastDue: acct.pastDue,
          disabledReason: acct.disabledReason,
        },
      }, { status: 422 });
    }

    // a charge azonosítója a source_transaction-hez (Stripe-oldali egyeztetés)
    let sourceChargeId: string | null = null;
    if (payout.booking_id) {
      const { data: pay } = await sb.from("payments")
        .select("stripe_charge_id, provider_payment_id").eq("booking_id", payout.booking_id)
        .eq("provider", "stripe").maybeSingle();
      sourceChargeId = pay?.stripe_charge_id ?? null;
      if (!sourceChargeId && pay?.provider_payment_id) {
        sourceChargeId = await stripe.getChargeId(pay.provider_payment_id).catch(() => null);
        if (sourceChargeId && pay) {
          const { error: backfillErr } = await sb.from("payments")
            .update({ stripe_charge_id: sourceChargeId })
            .eq("provider_payment_id", pay.provider_payment_id);
          if (backfillErr) {
            // a source_transaction egyeztetés pénzügyi nyomvonal – nem opcionális
            const abortErr = await abort(`charge_id_backfill_failed: ${backfillErr.message}`);
            return NextResponse.json({ error: "charge_id_backfill_failed", abortError: abortErr ?? undefined }, { status: 500 });
          }
        }
      }
    }

    // az attempt céljának rögzítése + 'submitting' jelölés a Transfer ELŐTT
    const { error: targetErr } = await sb.rpc("update_transfer_attempt_target", {
      p_attempt: attemptId, p_destination: provider.stripe_account_id,
      p_source_charge: sourceChargeId,
    });
    if (targetErr) {
      const abortErr = await abort(`attempt_target_failed: ${targetErr.message}`);
      return NextResponse.json({ error: "attempt_target_failed", abortError: abortErr ?? undefined }, { status: 500 });
    }

    try {
      const t = await stripe.transferToProvider({
        accountId: provider.stripe_account_id,
        amountCents: payout.amount,   // = az attemptbe fagyasztott összeg
        currency: payout.currency,
        idempotencyKey: attemptKey,   // az attempt idempotencia-kulcsa (újrafuttatható)
        sourceChargeId,
      });
      transferId = t.transferId;
      transferredAmount = t.amountCents; // a TÉNYLEGESEN átutalt összeg
      const { error: subErr } = await sb.rpc("mark_transfer_submitted", {
        p_attempt: attemptId, p_stripe_transfer_id: t.transferId,
      });
      if (subErr) {
        // a Transfer SIKERES volt → a DB-mentés hibája NEM vesztheti el a
        // tr_ ID-t: a payout 'transfer_submitted' lesz, a cron egyezteti
        await sb.rpc("mark_finalize_pending", { p_payout: input.payoutId });
        return NextResponse.json({
          error: "transfer_submitted_db_save_failed", transferId: t.transferId,
        }, { status: 500 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "transfer_failed";
      if (classifyStripeError(e) === "ambiguous") {
        // hálózati timeout / bizonytalan eredmény: a Transfer a Stripe-on
        // LÉTREJÖHETT → NEM biztos sikertelenség. Az attempt 'ambiguous'
        // marad, a cron UGYANAZZAL az idempotencia-kulccsal egyezteti.
        await sb.rpc("mark_transfer_ambiguous", { p_attempt: attemptId, p_error: msg });
        return NextResponse.json({
          error: "transfer_ambiguous_reconcile_pending",
          detail: "A Stripe Transfer eredménye bizonytalan (timeout/kapcsolat). A cron azonos idempotencia-kulccsal egyezteti.",
        }, { status: 502 });
      }
      // egyértelmű Stripe-elutasítás → véglegesen sikertelen, újrapróbálható release
      const abortErr = await abort(`stripe_final_rejection: ${msg}`);
      const { error: auditErr } = await sb.from("audit_log").insert({ actor_id: user.id,
        actor_role: "admin", action: "payout.transfer_failed",
        entity: "payouts", entity_id: input.payoutId });
      return NextResponse.json({
        error: "transfer_failed",
        abortError: abortErr ?? undefined,
        auditError: auditErr?.message,
      }, { status: 502 });
    }
  } else {
    manualRef = `${input.reference} (${input.paidDate})`;
    manualNote = input.note;
  }

  // 2) véglegesítés – a payout + ledger + audit EGYETLEN DB-tranzakcióban
  //    (finalize_payout_release v3): nem létezhet 'paid' payout főkönyv nélkül.
  //    A DB-ben könyvelt összeg MINDIG a ténylegesen átutalt összeg; a releasing
  //    alatt közben keletkezett refund/chargeback kötelezettségek itt válnak
  //    'requested'-dé, és azonnal beküldjük őket a Stripe-nak (automatikus
  //    reversal-korrekció, azonos idempotencia-kulccsal).
  const { data: finalized, error: finErr } = await sb.rpc("finalize_payout_release", {
    p_payout: input.payoutId, p_actor: user.id,
    p_transfer_id: transferId, p_manual_reference: manualRef, p_manual_note: manualNote,
    p_transferred_amount: transferredAmount,
  });
  const fin = finalized as {
    ok: boolean; transferred_amount?: number;
    obligations?: { reversal_row_id: string }[];
  } | null;
  if (finErr || !fin?.ok) {
    // KRITIKUS: ha a Stripe Transfer már SIKERES volt, a payoutot TILOS
    // módosítható 'scheduled' állapotba visszatenni – 'transfer_submitted'
    // marad, és a cron ugyanazzal az eredeti összeggel/kulccsal fejezi be.
    if (transferId) {
      const { error: pendErr } = await sb.rpc("mark_finalize_pending", { p_payout: input.payoutId });
      return NextResponse.json({
        error: "finalize_pending_retry", transferId,
        detail: "A Stripe Transfer sikerült, a helyi finalize függőben – a cron egyezteti.",
        pendingError: pendErr?.message,
      }, { status: 500 });
    }
    const abortErr = await abort("finalize_failed");
    return NextResponse.json({
      error: finErr?.message ?? "finalize_failed", abortError: abortErr ?? undefined,
    }, { status: 500 });
  }

  // 2b) a közben keletkezett refund/chargeback kötelezettségek automatikus
  //     reversal-beküldése (a finalize által visszaadott sorokkal)
  const reversalResults: { row: string; submitted: boolean }[] = [];
  if (input.method === "stripe" && fin.obligations && fin.obligations.length > 0) {
    const stripe = new StripeProvider();
    if (stripe.isConfigured()) {
      for (const ob of fin.obligations) {
        const r = await submitPayoutReversal(sb, stripe, ob.reversal_row_id);
        reversalResults.push({ row: ob.reversal_row_id, submitted: r.submitted });
      }
    }
  }

  // 3) értesítés az email-outboxon keresztül (a pénzügyi tranzakción kívül) –
  //    az enqueue hibája is naplózva + a válaszban jelzve (a payout már 'paid').
  let emailQueued = false;
  let emailError: string | undefined;
  const { data: prov } = await sb.from("providers").select("contact_email").eq("id", payout.provider_id).single();
  if (prov?.contact_email) {
    const { error: enqErr } = await sb.rpc("enqueue_email", {
      p_dedupe_key: `payout_notification:${input.payoutId}`,
      p_to: prov.contact_email, p_template: "payout_notification", p_locale: "en",
      p_vars: { amount: formatMoney(payout.amount, payout.currency, "en") },
    });
    emailQueued = !enqErr;
    if (enqErr) emailError = enqErr.message;
  }

  return NextResponse.json({
    ok: true, status: "paid", transferId, transferredAmount: fin.transferred_amount,
    manualReference: manualRef, emailQueued, emailError, reversals: reversalResults,
  });
}
