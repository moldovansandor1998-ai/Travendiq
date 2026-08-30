import type { createServiceClient } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/lib/payments";

type Svc = ReturnType<typeof createServiceClient>;

/**
 * Központi refund-indítás (teljes vagy részleges):
 *  1. atomikus refund-kérelem a DB-ben (duplikáció- és túlrefundálás-védelem),
 *  2. sorzárral 'processing' állapot,
 *  3. Stripe refund – az idempotencia-kulcs a BELSŐ refund rekord UUID-ja,
 *     így két azonos összegű részleges refund is külön Stripe-refund,
 *  4. a végleges 'succeeded' státuszt a charge.refunded webhook állítja
 *     (settle_refund_by_stripe_id, provider_refund_id-egyeztetéssel) –
 *     addig a booking NEM lesz 'refunded'.
 * Hibánál a refund visszakerül 'pending'-be (biztonságos újrapróbálkozás).
 */
export async function requestRefund(sb: Svc, input: {
  bookingId: string; amountCents: number; currency: string; reason: string;
  adminOverride?: boolean; actorId?: string;
}): Promise<{ ok: boolean; refundId?: string; error?: string }> {
  const { data: payment } = await sb.from("payments")
    .select("id, provider_payment_id, provider")
    .eq("booking_id", input.bookingId)
    .in("status", ["captured", "partially_refunded"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!payment) return { ok: false, error: "no_captured_payment" };

  const { data: refundId, error } = await sb.rpc("create_refund_request", {
    p_booking: input.bookingId, p_payment: payment.id, p_amount: input.amountCents,
    p_currency: input.currency, p_reason: input.reason,
    p_admin_override: input.adminOverride ?? false, p_actor: input.actorId ?? null,
  });
  if (error) return { ok: false, error: error.message };

  if (payment.provider !== "stripe" || !payment.provider_payment_id) {
    return { ok: true, refundId: refundId as string }; // nem-Stripe: manuális kiegyenlítés
  }

  const stripe = getPaymentProvider("stripe");
  if (!stripe.isConfigured()) return { ok: true, refundId: refundId as string };

  // sorzár: csak egy feldolgozó futhat
  const { data: locked } = (await sb.rpc("mark_refund_processing", { p_refund: refundId })) as { data: boolean | null };
  if (!locked) return { ok: true, refundId: refundId as string };

  /**
   * A Stripe-refund UTÁNI DB-mentés hibája KRITIKUS: a külső művelet már
   * sikerült, a sort ezért NEM állíthatjuk tévesen sikertelenre – a
   * fail_refund p_retry: true tartós, újra-feldolgozható (retry) állapotba
   * teszi. Ha a fail_refund mentése MAGA is elhasal, a sor 'processing'
   * állapotban marad és a refund-queue lock-timeoutja claimeli újra.
   * Mindkét eset naplózott – egyik sem csendes.
   */
  const failRefund = async (reason: string) => {
    const { error: failErr } = await sb.rpc("fail_refund", {
      p_refund: refundId, p_reason: reason, p_retry: true,
    });
    if (failErr) {
      console.error(`[refund-flow] fail_refund DB-hiba (${refundId}): ${failErr.message} – a sor 'processing' marad, a queue retry-ja dolgozza fel`);
    }
  };

  try {
    const r = await stripe.refund(payment.provider_payment_id, input.amountCents, refundId as string);
    const { error: updErr } = await sb.from("refunds")
      .update({ provider_refund_id: r.providerRefundId }).eq("id", refundId);
    if (updErr) {
      console.error(`[refund-flow] provider_refund_id mentési hiba (${refundId}):`, updErr.message);
      await failRefund(`db_update: ${updErr.message}`);
      return { ok: false, refundId: refundId as string, error: updErr.message };
    }
    if (r.status === "failed") {
      await failRefund("stripe_refund_failed");
      return { ok: false, refundId: refundId as string, error: "stripe_refund_failed" };
    }
    return { ok: true, refundId: refundId as string };
  } catch (e) {
    await failRefund(e instanceof Error ? e.message : "stripe_error");
    return { ok: false, refundId: refundId as string, error: "stripe_error" };
  }
}
