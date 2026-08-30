import type { createServiceClient } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/lib/payments";
import { submitPayoutReversal } from "@/lib/payments/reversals";
import { StripeProvider } from "@/lib/payments/stripe";

type Svc = ReturnType<typeof createServiceClient>;

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`db: ${result.error.message}`);
  return result.data;
}

async function adminAlert(
  sb: Svc, subject: string, detail: Record<string, unknown>,
): Promise<string[]> {
  // A riasztás audit- és email-hibája SEM maradhat teljesen csendben:
  // console.error + a hibák visszaadása a hívónak (a cron válaszában látszik).
  const errs: string[] = [];
  const { error: auditErr } = await sb.from("audit_log").insert({
    actor_id: null, actor_role: "admin", action: subject,
    entity: "refund_queue", entity_id: String(detail.id ?? ""),
    diff: detail,
  });
  if (auditErr) {
    console.error(`[adminAlert] audit_log insert failed (${subject}):`, auditErr.message);
    errs.push(`audit: ${auditErr.message}`);
  }
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (adminEmail) {
    const { error: mailErr } = await sb.rpc("enqueue_email", {
      p_dedupe_key: `alert:${subject}:${String(detail.id ?? Date.now())}`,
      p_to: adminEmail, p_template: "security_alert", p_locale: "en",
      p_vars: { message: `${subject}: ${JSON.stringify(detail)}` },
    });
    if (mailErr) {
      console.error(`[adminAlert] enqueue_email failed (${subject}):`, mailErr.message);
      errs.push(`email: ${mailErr.message}`);
    }
  }
  return errs;
}

/**
 * Refund work queue feldolgozó – késői fizetések és minden sikertelen
 * Stripe-refund tartós újrapróbálkozása.
 *
 * Minden refund azonos idempotencia-kulccsal (refund_<belső UUID>) megy a
 * Stripe felé → az újrapróbálkozás sosem hoz létre dupla refundot. A végleges
 * sikert a charge.refunded webhook könyveli (settle_refund_by_stripe_id).
 * Sikertelenség: attempts++, exponenciális backoff, a limit után
 * 'manual_review' + KÖTELEZŐ adminriasztás.
 */
export async function processDueRefunds(sb: Svc, worker: string, limit = 20): Promise<{
  claimed: number; submitted: number; failed: number; manualReview: number;
  errors: string[];
}> {
  const stripe = getPaymentProvider("stripe");
  const claimedRows = must(await sb.rpc("claim_due_refunds", { p_limit: limit, p_worker: worker })) as {
    id: string; booking_id: string; payment_id: string | null; amount: number;
    currency: string; status: string;
  }[];

  let submitted = 0, failed = 0, manualReview = 0;
  const errors: string[] = [];
  for (const row of claimedRows) {
    if (!stripe.isConfigured()) {
      const { error: relErr } = await sb.rpc("fail_refund_attempt", {
        p_refund: row.id, p_error: "stripe_not_configured", p_max_attempts: 1000,
      });
      if (relErr) {
        console.error("[processDueRefunds] fail_refund_attempt:", relErr.message);
        errors.push(`refund ${row.id}: lock release failed: ${relErr.message}`);
      }
      continue;
    }
    const payment = must(await sb.from("payments")
      .select("provider_payment_id").eq("id", row.payment_id).maybeSingle()) as
      { provider_payment_id: string | null } | null;
    if (!payment?.provider_payment_id) {
      const st = must(await sb.rpc("fail_refund_attempt", {
        p_refund: row.id, p_error: "payment_not_found", p_max_attempts: 3,
      })) as string;
      failed++;
      if (st === "manual_review") {
        manualReview++;
        errors.push(...await adminAlert(sb, "refund_manual_review", { id: row.id, booking: row.booking_id, error: "payment_not_found" }));
      }
      continue;
    }
    try {
      const r = await stripe.refund(payment.provider_payment_id, row.amount, row.id);
      if (r.status === "failed") {
        const st = must(await sb.rpc("fail_refund_attempt", {
          p_refund: row.id, p_error: "stripe_refund_failed", p_max_attempts: 8,
        })) as string;
        failed++;
        if (st === "manual_review") {
          manualReview++;
          errors.push(...await adminAlert(sb, "refund_manual_review", { id: row.id, booking: row.booking_id, error: "stripe_refund_failed" }));
        }
        continue;
      }
      must(await sb.rpc("mark_refund_submitted", {
        p_refund: row.id, p_provider_refund_id: r.providerRefundId,
      }));
      submitted++;
    } catch (e) {
      const st = must(await sb.rpc("fail_refund_attempt", {
        p_refund: row.id,
        p_error: e instanceof Error ? e.message : "stripe_error",
        p_max_attempts: 8,
      })) as string;
      failed++;
      if (st === "manual_review") {
        manualReview++;
        errors.push(...await adminAlert(sb, "refund_manual_review", {
          id: row.id, booking: row.booking_id,
          error: e instanceof Error ? e.message : "stripe_error",
        }));
      }
    }
  }
  return { claimed: claimedRows.length, submitted, failed, manualReview, errors };
}

/**
 * Beadatlan reversal-sorok újrapróbálása (crash a DB-kérés után / a Stripe-
 * hívás előtt, vagy a record_reversal_sent DB-hibája). Az idempotencia-kulcs
 * miatt az újraküldés nem hoz létre dupla reversalt.
 */
export async function processDueReversals(sb: Svc, worker: string, limit = 20): Promise<{
  claimed: number; submitted: number; failed: number; errors: string[];
}> {
  const stripe = new StripeProvider();
  const rows = must(await sb.rpc("claim_due_reversals", { p_limit: limit, p_worker: worker })) as {
    reversal_row_id: string; transfer_id: string; requested_amount: number; idempotency_key: string;
  }[];

  let submitted = 0, failed = 0;
  const errors: string[] = [];
  if (!stripe.isConfigured()) {
    return { claimed: rows.length, submitted: 0, failed: 0, errors };
  }
  for (const row of rows) {
    try {
      const res = await submitPayoutReversal(sb, stripe, row.reversal_row_id);
      if (res.submitted) submitted++;
      else failed++;
    } catch (e) {
      // DB-hiba a beküldés során: a sor NEM lehet stripe_failed (a reversal a
      // Stripe-on létrejöhetett) – zár-feloldás, a következő cron azonos
      // idempotencia-kulccsal egyeztet. A feloldás hibája sem maradhat csendben.
      const msg = e instanceof Error ? e.message : "queue_retry";
      console.error(`[processDueReversals] ${row.reversal_row_id}:`, msg);
      errors.push(`reversal ${row.reversal_row_id}: ${msg}`);
      const { error: relErr } = await sb.rpc("fail_payout_reversal_row", {
        p_reversal_row: row.reversal_row_id, p_reason: `queue_retry: ${msg}`, p_stripe_rejected: false,
      });
      if (relErr) {
        console.error("[processDueReversals] fail_payout_reversal_row:", relErr.message);
        errors.push(`reversal ${row.reversal_row_id}: lock release failed: ${relErr.message}`);
      }
      failed++;
    }
  }
  return { claimed: rows.length, submitted, failed, errors };
}
