import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/lib/payments";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getBookingWithAccess } from "@/lib/booking/access";
import { bookingLink, voucherLink } from "@/lib/booking/links";

const bodySchema = z.object({ token: z.string().uuid().nullable().optional() });

interface PreparedBooking {
  id: string; code: string; grand_total: number; currency: string;
  commission_amount: number; provider_amount: number; provider_id: string;
  listing_id: string; customer_locale: string; lead_email: string | null;
  guest_email: string | null; user_id: string | null;
  guest_access_token: string | null; date: string;
}

/**
 * Fizetés indítása – SEPARATE CHARGES AND TRANSFERS modell:
 * a PaymentIntent mindig a PLATFORM számláján jön létre (nincs destination).
 *
 * Versenyvédelem: a PaymentIntent LÉTREHOZÁSA ELŐTT a prepare_booking_payment
 * RPC atomikusan lejárat-takarít + sorzárral újraellenőriz – lejárt vagy közben
 * módosult foglaláshoz nem jön létre PaymentIntent. A payments sor idempotencia-
 * kulcsa (pay_<bookingId>) + a booking-scoped unique index a dupla fizetés ellen véd.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sb = createServiceClient();
  const ip = clientIp(req);
  const limit = Number(process.env.RATE_LIMIT_BOOKING_PER_MINUTE ?? 5);
  if (!(await rateLimit(sb, `pay:${ip}`, limit))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const access = await getBookingWithAccess({ id: params.id }, parsed.data.token ?? null);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.reason === "not_found" ? 404 : 403 });
  }

  // atomikus előkészítés: lejáratok feldolgozása + sorzár + állapot-újraellenőrzés
  const { data: prepared, error: prepErr } = await sb.rpc("prepare_booking_payment", {
    p_booking: params.id, p_ttl_minutes: 30,
  });
  if (prepErr || !prepared) {
    return NextResponse.json(
      { error: "invalid_state", detail: prepErr?.message ?? "not_payable" },
      { status: 409 },
    );
  }
  const b = prepared as unknown as PreparedBooking;

  // vendég-token a linkekhez CSAK ha nincs bejelentkezett tulajdonos
  const guestToken = b.user_id ? null : b.guest_access_token;

  /** Dev/ingyenes teljesítés ugyanazon az egytranzakciós settle-RPC-n keresztül. */
  const finalizeFreeOrDev = async (providerPaymentId: string) => {
    const { error: payErr } = await sb.from("payments").upsert({
      booking_id: b.id, provider: providerPaymentId.startsWith("dev_") ? "dev" : "stripe",
      provider_payment_id: providerPaymentId,
      status: "requires_payment", amount: b.grand_total, currency: b.currency,
      application_fee: b.commission_amount,
      idempotency_key: `pay_${b.id}`,
    }, { onConflict: "idempotency_key" });
    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

    const { data: settled, error: setErr } = await sb.rpc("settle_payment_success", {
      p_intent_id: providerPaymentId, p_charge_id: null,
    });
    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

    // email outbox (idempotens dedupe) – a cron dolgozza fel.
    // A sorbaállítás hibája NEM csendes: naplózzuk (a fizetés már sikeres,
    // az email később az adminriasztásból pótolható).
    const to = b.lead_email ?? b.guest_email;
    if (to && (settled as { already?: boolean } | null)?.already !== true) {
      const link = bookingLink({ code: b.code, locale: b.customer_locale, guestToken });
      const voucher = voucherLink({ code: b.code, locale: b.customer_locale, guestToken });
      const { error: e1 } = await sb.rpc("enqueue_email", {
        p_dedupe_key: `payment_receipt:${b.id}`, p_to: to, p_template: "payment_receipt",
        p_locale: b.customer_locale,
        p_vars: { code: b.code, amount: (b.grand_total / 100).toFixed(2), currency: b.currency, link },
      });
      if (e1) console.error("[pay] enqueue payment_receipt failed:", e1.message);
      const { error: e2 } = await sb.rpc("enqueue_email", {
        p_dedupe_key: `booking_confirmation:${b.id}`, p_to: to, p_template: "booking_confirmation",
        p_locale: b.customer_locale,
        p_vars: { code: b.code, date: b.date, link, voucher },
      });
      if (e2) console.error("[pay] enqueue booking_confirmation failed:", e2.message);
    }
    return null;
  };

  // ingyenes foglalás: nincs fizetés, azonnali visszaigazolás
  if (b.grand_total === 0) {
    const errRes = await finalizeFreeOrDev(`dev_${b.id}`);
    if (errRes) return errRes;
    return NextResponse.json({ free: true });
  }

  const provider = getPaymentProvider("stripe");
  if (provider.isConfigured()) {
    // ha már létezik aktív PaymentIntent ehhez a foglaláshoz, azt adjuk vissza
    // (újratöltés/dupla kattintás esetén sem jön létre második)
    const { data: existing } = await sb.from("payments")
      .select("provider_payment_id, status")
      .eq("booking_id", b.id).eq("provider", "stripe")
      .eq("status", "requires_payment")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (existing?.provider_payment_id) {
      const secret = await provider.getClientSecret(existing.provider_payment_id).catch(() => null);
      if (secret) return NextResponse.json({ clientSecret: secret });
    }

    // separate charges: NINCS destination – a teljes összeg a platformnál marad
    const intent = await provider.createPayment({
      bookingId: b.id, bookingCode: b.code,
      amountCents: b.grand_total, currency: b.currency,
      customerEmail: b.lead_email ?? b.guest_email,
      idempotencyKey: `pi_${b.id}`,
    });
    const { error: upErr } = await sb.from("payments").upsert({
      booking_id: b.id, provider: "stripe", provider_payment_id: intent.providerPaymentId,
      status: "requires_payment", amount: b.grand_total, currency: b.currency,
      application_fee: b.commission_amount,
      stripe_charge_id: intent.chargeId ?? null,
      idempotency_key: `pay_${b.id}`,
    }, { onConflict: "idempotency_key" });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ clientSecret: intent.clientSecret });
  }

  // DEV: explicit szimuláció csak nem-productionben
  const devSimulate = req.headers.get("x-dev-simulate") === "1";
  if (devSimulate && process.env.NODE_ENV !== "production") {
    const errRes = await finalizeFreeOrDev(`dev_${b.id}`);
    if (errRes) return errRes;
    return NextResponse.json({ dev: true });
  }
  return NextResponse.json({ error: "payment_provider_not_configured" }, { status: 503 });
}
