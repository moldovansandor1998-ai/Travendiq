import { createServiceClient } from "@/lib/supabase/server";
import { StripeProvider } from "@/lib/payments/stripe";
import { submitPayoutReversal } from "@/lib/payments/reversals";
import { bookingLink } from "@/lib/booking/links";

type Svc = ReturnType<typeof createServiceClient>;

/**
 * Stripe webhook eseménykezelők.
 *
 * Szabályok:
 *  - MINDEN pénzügyi DB-művelet error-értéke ellenőrzött (must/mustRpc): hiba
 *    esetén kivétel → a route NEM jelöli processed-nek az eseményt → Stripe retry.
 *  - Emailküldés NINCS a pénzügyi feldolgozásban: csak outbox-sorba állítás
 *    (enqueue_email, dedupe_key-vel idempotens).
 *  - Refundok: provider_refund_id (re_...) szerinti EGYENKÉNTI egyeztetés.
 *  - Már kifizetett transzfer visszavonása: transfers.createReversal, külön
 *    idempotencia-kulccsal (revref_<refundId> / revcb_<disputeId>); elégtelen
 *    connected-account balance → reversal 'failed' + admin riasztás.
 */

/** Dob, ha a Supabase-művelet hibát adott (így az esemény nem lesz processed). */
function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`db: ${result.error.message}`);
  return result.data;
}

interface BookingRow {
  id: string; code: string; status: string; customer_locale: string;
  lead_email: string | null; guest_email: string | null;
  user_id: string | null; guest_access_token: string | null;
  listing_id: string; provider_id: string; grand_total: number;
  commission_amount: number; provider_amount: number; currency: string; date: string;
}

async function bookingForPayment(sb: Svc, providerPaymentId: string) {
  const payment = must(await sb.from("payments")
    .select(`id, booking_id, amount, refunded_amount,
      bookings(id, code, status, customer_locale, lead_email, guest_email, user_id, guest_access_token,
        listing_id, provider_id, grand_total, commission_amount, provider_amount, currency, date)`)
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle()) as { id: string; booking_id: string; amount: number; refunded_amount: number | null; bookings: unknown } | null;
  if (!payment?.bookings) return null;
  return { payment, booking: payment.bookings as unknown as BookingRow };
}

async function enqueueBookingEmail(sb: Svc, b: BookingRow, template: string, vars: Record<string, string | undefined>) {
  const to = b.lead_email ?? b.guest_email;
  if (!to) return;
  const link = bookingLink({
    code: b.code, locale: b.customer_locale,
    guestToken: b.user_id ? null : b.guest_access_token,
  });
  const { error } = await sb.rpc("enqueue_email", {
    p_dedupe_key: `${template}:${b.id}`,
    p_to: to, p_template: template, p_locale: b.customer_locale,
    p_vars: { ...vars, code: b.code, link },
  });
  if (error) throw new Error(`enqueue_email: ${error.message}`);
}

async function adminAlert(sb: Svc, subject: string, detail: Record<string, unknown>) {
  // audit + admin email (outbox) – a rendszergazda értesül a beavatkozást igénylő esetről
  must(await sb.from("audit_log").insert({
    actor_id: null, actor_role: "admin", action: subject,
    entity: "stripe", entity_id: String(detail.id ?? detail.dispute ?? ""),
    diff: detail,
  }));
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (adminEmail) {
    // az audit_log sor már megvan (must()) – a riasztás-email sorbaállításának
    // hibája naplózott, de NEM állíthatja vissza a pénzügyi eseményt
    const { error: enqErr } = await sb.rpc("enqueue_email", {
      p_dedupe_key: `alert:${subject}:${String(detail.id ?? detail.dispute ?? Date.now())}`,
      p_to: adminEmail, p_template: "security_alert", p_locale: "en",
      p_vars: { message: `${subject}: ${JSON.stringify(detail)}` },
    });
    if (enqErr) console.error(`[webhooks] adminAlert enqueue failed (${subject}):`, enqErr.message);
  }
}

/**
 * A refund/chargeback által létrehozott (DB-ben, sorzár alatt már rögzített)
 * reversal-sorok beküldése a Stripe-nak. A sor létrehozása és a beküldés
 * szétválik: a Stripe-hiba stripe_failed, a DB-mentési hiba NEM failed –
 * a webhook kivételt dob, a Stripe újraküldi, a replay azonos
 * idempotencia-kulccsal egyeztet.
 */
async function submitReversalsForRefund(sb: Svc, refundId: string): Promise<void> {
  const stripe = new StripeProvider();
  if (!stripe.isConfigured()) return;
  const rows = must(await sb.from("payout_reversals")
    .select("id").eq("refund_id", refundId)
    .in("status", ["requested", "submitting"]).is("stripe_reversal_id", null)) as { id: string }[];
  for (const row of rows) {
    const res = await submitPayoutReversal(sb, stripe, row.id);
    if (!res.submitted && !res.skippedReason) {
      await adminAlert(sb, "transfer_reversal_failed", { id: row.id, refund: refundId });
    }
  }
}

// ============================ ESEMÉNYKEZELŐK ============================

export async function handlePaymentSucceeded(sb: Svc, obj: Record<string, unknown>) {
  const chargeId = typeof obj.latest_charge === "string" ? obj.latest_charge : null;
  const res = must(await sb.rpc("settle_payment_success", {
    p_intent_id: String(obj.id), p_charge_id: chargeId,
  })) as {
    found: boolean; already?: boolean; late?: boolean; booking_id?: string;
    booking_status?: string; auto_refund_id?: string | null;
  } | null;

  if (!res?.found || !res.booking_id) return; // ismeretlen intent – nincs mit tenni
  if (res.already) return; // idempotens: már könyvelve

  // ===== későn sikerült fizetés: NINCS payout – refund a WORK QUEUE-ban =====
  // A késői fizetés NEM tekinthető rendezettnek attól, hogy létrejött egy
  // pending refund: a tényleges Stripe-visszatérítést a refund work queue
  // (/api/cron/refund-queue) végzi, idempotens újrapróbálkozásokkal; sikertelenség
  // esetén attempts/next_retry_at követés + kötelező adminriasztás, végül
  // 'manual_review'. Itt csak "felvesszük a sorba azonnalira" + riasztunk.
  if (res.late) {
    await adminAlert(sb, "late_payment_auto_refund", {
      id: res.booking_id, intent: String(obj.id),
      booking_status: res.booking_status ?? "unknown",
      auto_refund_id: res.auto_refund_id ?? null,
    });
    if (res.auto_refund_id) {
      must(await sb.from("refunds")
        .update({ next_retry_at: new Date().toISOString() })
        .eq("id", res.auto_refund_id).eq("status", "pending"));
    }
    return; // nincs booking_confirmation/payment_receipt email a késői fizetéshez
  }

  // email-címzés a tranzakciós könyvelés UTÁN, outboxon keresztül
  const hit = await bookingForPayment(sb, String(obj.id));
  if (!hit) return;
  const b = hit.booking;
  const listing = must(await sb.from("listings")
    .select("translations:listing_translations(locale,title)").eq("id", b.listing_id).single());
  const trs = (listing?.translations ?? []) as { locale: string; title: string }[];
  const title = (trs.find((x) => x.locale === b.customer_locale) ?? trs[0])?.title ?? "";

  await enqueueBookingEmail(sb, b, "payment_receipt", {
    amount: (b.grand_total / 100).toFixed(2), currency: b.currency,
  });
  await enqueueBookingEmail(sb, b, "booking_confirmation", { title, date: b.date });
}

export async function handlePaymentFailed(sb: Svc, obj: Record<string, unknown>) {
  must(await sb.from("payments").update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("provider_payment_id", String(obj.id))
    .in("status", ["requires_payment", "authorized"]));
}

/** charge.refunded – a refunds.data rekordok EGYENKÉNTI feldolgozása. */
export async function handleChargeRefunded(sb: Svc, obj: Record<string, unknown>) {
  const piId = String(obj.payment_intent ?? obj.id);
  const hit = await bookingForPayment(sb, piId);
  if (!hit) return;
  const { payment } = hit;
  const b = hit.booking;

  const refunds = Array.isArray((obj.refunds as { data?: unknown[] })?.data)
    ? (obj.refunds as { data: { id: string; amount: number; status: string; currency: string }[] }).data
    : [];

  let settledAny = false;

  for (const rf of refunds) {
    if (!rf.id?.startsWith("re_")) continue;
    // 1) belső refund egyeztetése/létrehozása EZRE a Stripe refund ID-ra.
    //    A settle_refund v4 a DB-ben, sorzár alatt dönt: ki nem fizetett payout
    //    → atomikus csökkentés/cancelled; 'releasing' → awaiting_transfer
    //    kötelezettség (a payout összege érintetlen!); 'paid' → requested
    //    reversal-sor (elérhető összegig cap-elve).
    const res = must(await sb.rpc("settle_refund_by_stripe_id", {
      p_stripe_refund_id: rf.id, p_payment: payment.id,
      p_amount: rf.amount, p_currency: rf.currency.toUpperCase(),
      p_stripe_status: rf.status,
    })) as { found: boolean; settled?: boolean; refund_id?: string } | null;

    // 2) a létrejött 'requested' reversal-sorok beküldése a Stripe-nak
    //    (idempotencia-kulccsal; a finalize a 'releasing' alatt keletkezett
    //    kötelezettségeket adja át az admin route-nak)
    if (res?.settled && res.refund_id) {
      await submitReversalsForRefund(sb, res.refund_id);
    }
    settledAny = settledAny || Boolean(res?.settled);
  }

  // 3) payment refunded_amount szinkron a Stripe-összesítőből
  const amountRefunded = Number(obj.amount_refunded ?? 0);
  must(await sb.from("payments").update({
    refunded_amount: amountRefunded,
    status: amountRefunded >= payment.amount && payment.amount > 0 ? "refunded"
      : amountRefunded > 0 ? "partially_refunded" : undefined,
    updated_at: new Date().toISOString(),
  }).eq("id", payment.id));
  must(await sb.rpc("sync_booking_refund_status", { p_booking: b.id }));

  if (settledAny) {
    await enqueueBookingEmail(sb, b, "refund_processed", {
      amount: (amountRefunded / 100).toFixed(2), currency: b.currency,
    });
  }
}

/** charge.dispute.created – payout-blokk + DB-oldali, cap-elt reversal-kérés. */
export async function handleDisputeCreated(sb: Svc, obj: Record<string, unknown>) {
  const piId = String(obj.payment_intent ?? "");
  const disputeId = String(obj.id ?? "");
  const amount = Number(obj.amount ?? 0);
  const currency = String(obj.currency ?? "").toUpperCase();

  // handle_chargeback v2: a reversal-összeg az ADATBÁZISBAN, sorzárral dől el
  // (available = amount − succeeded − requested/submitting/submitted −
  // awaiting_transfer; csak az elérhető különbözet kerül be – nincs elnyelt
  // REVERSAL_EXCEEDS_PAYOUT). 'releasing' payoutnál awaiting_transfer
  // kötelezettség keletkezik, amit a finalize aktivál.
  const res = must(await sb.rpc("handle_chargeback", {
    p_intent_id: piId, p_dispute_id: disputeId, p_amount: amount, p_currency: currency,
  })) as {
    found: boolean; booking_id?: string; reversal_row_id?: string | null;
    requested_amount?: number; reversal_status?: string;
    idempotent_replay?: boolean; capped?: boolean;
  } | null;
  if (!res?.found) return;

  if (res.reversal_row_id && res.reversal_status === "requested") {
    const stripe = new StripeProvider();
    if (stripe.isConfigured()) {
      const sub = await submitPayoutReversal(sb, stripe, res.reversal_row_id);
      if (!sub.submitted && !sub.skippedReason) {
        await adminAlert(sb, "chargeback_reversal_stripe_failed", {
          id: res.reversal_row_id, dispute: disputeId,
          amount: res.requested_amount, booking: res.booking_id,
        });
      }
    } else {
      await adminAlert(sb, "chargeback_reversal_pending_manual", {
        id: res.reversal_row_id, dispute: disputeId, amount: res.requested_amount,
      });
    }
  }
}

export async function handleDisputeClosed(sb: Svc, obj: Record<string, unknown>) {
  const piId = String(obj.payment_intent ?? "");
  const status = String(obj.status ?? "");
  const hit = await bookingForPayment(sb, piId);
  if (!hit) return;
  const { payment } = hit;
  const b = hit.booking;

  if (status === "won") {
    must(await sb.from("payments").update({ status: "captured" }).eq("id", payment.id)
      .eq("status", "chargeback"));
    must(await sb.from("bookings").update({ status: "confirmed" })
      .eq("id", b.id).eq("status", "disputed"));
    // Ha a chargeback miatt korábban Transfer Reversal történt, a szolgáltató
    // pénze most jogosan újra kifizethető: kontrollált új (scheduled) payout
    // jön létre – KIZÁRÓLAG az EHHEZ a dispute-hoz tartozó sikeres reversalok
    // összegével (a korábbi refund-reversalok sosem kerülnek vissza).
    must(await sb.rpc("resolve_chargeback_won", {
      p_booking: b.id, p_dispute: String(obj.id ?? ""),
    }));
  } else if (status === "lost") {
    // a Stripe a chargebacknél levonta az összeget – végleges veszteségként könyveljük
    must(await sb.from("payments").update({ status: "refunded" }).eq("id", payment.id)
      .eq("status", "chargeback"));
    must(await sb.from("bookings").update({ status: "refunded" })
      .eq("id", b.id).eq("status", "disputed"));
    const exists = must(await sb.from("ledger_entries")
      .select("id").eq("booking_id", b.id).eq("kind", "adjustment")
      .eq("meta->>note", "chargeback_lost").eq("meta->>dispute", String(obj.id ?? ""))
      .limit(1).maybeSingle());
    if (!exists) {
      must(await sb.from("ledger_entries").insert({
        provider_id: b.provider_id, booking_id: b.id, kind: "adjustment",
        amount: -b.grand_total, currency: b.currency,
        meta: { note: "chargeback_lost", dispute: String(obj.id ?? "") },
      }));
    }
    must(await sb.rpc("sync_booking_refund_status", { p_booking: b.id }));
  }
}

/** account.updated – Connect részletes állapot (requirements + capabilities) szinkron. */
export async function handleAccountUpdated(sb: Svc, obj: Record<string, unknown>) {
  const accountId = String(obj.id ?? "");
  if (!accountId.startsWith("acct_")) return;
  const req = (obj.requirements ?? {}) as Record<string, unknown>;
  const caps = (obj.capabilities ?? {}) as Record<string, unknown>;
  must(await sb.rpc("sync_connect_account", {
    p_account_id: accountId,
    p_charges: Boolean(obj.charges_enabled),
    p_payouts: Boolean(obj.payouts_enabled),
    p_details: Boolean(obj.details_submitted),
    p_requirements: {
      currently_due: req.currently_due ?? [],
      past_due: req.past_due ?? [],
      disabled_reason: req.disabled_reason ?? null,
    },
    p_capabilities: caps,
    p_country: obj.country ?? null,
  }));
}

/**
 * transfer.reversed – minden Stripe reversal ID KÜLÖN, idempotens egyeztetéssel.
 * Ha a payload csak az összesített amount_reversed-et hozza, kizárólag a
 * korábban könyvelt (succeeded) reversal-összeghez képesti DELTA kerül
 * rögzítésre (settle_transfer_reversed_aggregate); a trr_... szintű
 * egyeztetéshez a hívó lekérheti a teljes Transfer objektumot a Stripe API-ból.
 */
export async function handleTransferReversed(sb: Svc, obj: Record<string, unknown>) {
  const transferId = String(obj.id ?? "");
  const reversals = Array.isArray((obj.reversals as { data?: unknown[] })?.data)
    ? (obj.reversals as {
        data: { id: string; amount: number; metadata?: Record<string, unknown> }[];
      }).data
    : [];

  if (reversals.length > 0) {
    for (const r of reversals) {
      if (!r.id) continue;
      // ELSŐDLEGES párosítás: a createReversal-kor elküldött
      // metadata.reversal_row_id – sosem az "első stripe_reversal_id IS NULL
      // sor". Metadata nélküli (legacy / dashboardon indított) reversalnél az
      // RPC csak akkor párosít, ha PONTOSAN EGY azonos összegű jelölt van,
      // különben reconciliation_required árva-sort hoz létre.
      const metaRow = r.metadata?.reversal_row_id;
      must(await sb.rpc("settle_payout_reversal", {
        p_stripe_reversal_id: r.id,
        p_amount: r.amount,
        p_transfer_id: transferId,
        p_reversal_row:
          typeof metaRow === "string" && metaRow.length > 0 ? metaRow : null,
      }));
    }
    return;
  }

  // aggregált fallback: csak a különbözet könyvelhető
  const total = Number(obj.amount_reversed ?? 0);
  if (total <= 0) return;
  must(await sb.rpc("settle_transfer_reversed_aggregate", {
    p_transfer_id: transferId, p_amount_reversed_total: total,
  }));
}

export async function handleTransferCreated(sb: Svc, obj: Record<string, unknown>) {
  const transferId = String(obj.id ?? "");
  must(await sb.from("payouts").update({ transfer_status: "created" })
    .eq("provider_payout_id", transferId));
}

/**
 * payout.paid / payout.failed – ezek a CONNECTED ACCOUNT saját banki
 * kifizetés-eseményei (po_...). NEM a mi payouts.transfer_id-nkkel (tr_...)
 * egyeztethetők! Csak audit-naplózzuk, a Stripe account/context azonosítóval.
 */
export async function handleStripePayoutEvent(sb: Svc, type: string, obj: Record<string, unknown>, accountContext: string | null) {
  must(await sb.from("audit_log").insert({
    actor_id: null, actor_role: "admin",
    action: `stripe.${type}`,
    entity: "connected_account_payout",
    entity_id: String(obj.id ?? ""),
    diff: {
      stripe_account: accountContext,
      amount: obj.amount ?? null,
      currency: obj.currency ?? null,
      status: obj.status ?? null,
      failure_code: obj.failure_code ?? null,
    },
  }));
}

export async function dispatchStripeEvent(
  sb: Svc, type: string, raw: { data: { object: Record<string, unknown> }; account?: string },
) {
  const obj = raw.data.object;
  const account = typeof raw.account === "string" ? raw.account : null;
  switch (type) {
    case "payment_intent.succeeded": return handlePaymentSucceeded(sb, obj);
    case "payment_intent.payment_failed": return handlePaymentFailed(sb, obj);
    case "charge.refunded": return handleChargeRefunded(sb, obj);
    case "charge.dispute.created": return handleDisputeCreated(sb, obj);
    case "charge.dispute.closed": return handleDisputeClosed(sb, obj);
    case "account.updated": return handleAccountUpdated(sb, obj);
    case "transfer.created": return handleTransferCreated(sb, obj);
    case "transfer.reversed": return handleTransferReversed(sb, obj);
    case "payout.paid":
    case "payout.failed": return handleStripePayoutEvent(sb, type, obj, account);
    default: return; // nem kezelt típus – processed-nek jelölhető, művelet nélkül
  }
}
