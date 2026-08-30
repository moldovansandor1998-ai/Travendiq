import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getBookingWithAccess } from "@/lib/booking/access";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requestRefund } from "@/lib/booking/refund-flow";
import { sendEmail } from "@/lib/email";
import { bookingLink } from "@/lib/booking/links";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    bookingId: z.string().uuid(),
    token: z.string().uuid().nullable().optional(),
    reason: z.enum(["customer", "provider_cancelled", "weather", "admin"]).default("customer"),
  }),
  z.object({
    action: z.literal("reschedule"),
    bookingId: z.string().uuid(),
    token: z.string().uuid().nullable().optional(),
    newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    newTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
]);

/** Vásárlói foglalásműveletek: lemondás (auto refund) és átfoglalás. */
export async function POST(req: NextRequest) {
  const rl = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(rl, `manage:${ip}`, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const input = parsed.data;

  const access = await getBookingWithAccess({ id: input.bookingId }, input.token ?? null);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.reason === "not_found" ? 404 : 403 });
  }
  // csak a vásárló (owner/guest) vagy staff hajthatja végre ezeket az akciókat itt
  if (!["owner", "guest_token", "staff"].includes(access.via)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = createServiceClient();
  const b = access.booking as {
    id: string; code: string; currency: string; customer_locale: string;
    lead_email: string | null; guest_email: string | null; status: string;
    user_id: string | null; guest_access_token: string | null;
  };
  // vendég-link tokennel (bejelentkezett tulajdonosnál token nélkül)
  const guestToken = b.user_id ? null : b.guest_access_token;
  const link = bookingLink({ code: b.code, locale: b.customer_locale, guestToken });

  if (input.action === "reschedule") {
    const { error } = await sb.rpc("reschedule_booking", {
      p_booking: input.bookingId, p_new_date: input.newDate, p_new_time: input.newTime,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    const to = b.lead_email ?? b.guest_email;
    if (to) {
      await sendEmail({ to, template: "booking_modified", locale: b.customer_locale,
        vars: { code: b.code, message: `New date: ${input.newDate} ${input.newTime}`, link } });
    }
    return NextResponse.json({ ok: true });
  }

  // cancel – a refund CSAK Stripe-megerősítés után lesz 'succeeded' (webhook: charge.refunded)
  const { data: refundAmount, error } = await sb.rpc("cancel_booking", {
    p_booking: input.bookingId, p_reason: input.reason, p_refund_amount: null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });

  if ((refundAmount as number) > 0) {
    // KIZÁRÓLAG a központi refund-folyamat (nincs itt lemásolt Stripe-logika):
    // atomikus kérelem → sorzár → Stripe refund (idempotencia-kulcs = refund UUID)
    // → a végleges sikert a charge.refunded webhook könyveli.
    const rf = await requestRefund(sb, {
      bookingId: input.bookingId, amountCents: refundAmount as number,
      currency: b.currency, reason: input.reason,
    });
    if (!rf.ok) {
      // a lemondás megtörtént, de a refund-indítás NEM sikerült – ezt nem
      // szabad sikerként jelenteni: a kliens és az admin is lássa a hibát.
      return NextResponse.json({
        error: "refund_initiation_failed", detail: rf.error, cancelled: true,
      }, { status: 502 });
    }
  }

  const to = b.lead_email ?? b.guest_email;
  if (to) {
    await sendEmail({ to, template: "booking_cancelled", locale: b.customer_locale,
      vars: { code: b.code, reason: input.reason, link,
        amount: refundAmount ? ((refundAmount as number) / 100).toFixed(2) : undefined, currency: b.currency } });
    // refund_processed emailt a webhook küldi a Stripe-megerősítés után
  }
  return NextResponse.json({ ok: true, refund: refundAmount });
}
