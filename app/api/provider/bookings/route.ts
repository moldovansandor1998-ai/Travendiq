import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { bookingLink } from "@/lib/booking/links";
import { requestRefund } from "@/lib/booking/refund-flow";

const schema = z.object({
  bookingId: z.string().uuid(),
  action: z.enum(["accept", "reject", "complete", "no_show", "cancel"]),
  note: z.string().max(300).optional(),
});

/** Szolgáltatói foglalásműveletek (jogosultság-ellenőrzéssel). */
export async function POST(req: NextRequest) {
  const rl = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(rl, `provbook:${ip}`, 30))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { bookingId, action, note } = parsed.data;

  const sb = createServiceClient();
  const { data: b } = await sb.from("bookings")
    .select("id, code, status, provider_id, currency, grand_total, customer_locale, lead_email, guest_email, user_id, guest_access_token")
    .eq("id", bookingId).maybeSingle();
  if (!b) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [{ data: member }, { data: staff }] = await Promise.all([
    session.rpc("is_provider_member", { p: b.provider_id }),
    session.rpc("is_staff"),
  ]);
  if (!member && !staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const to = b.lead_email ?? b.guest_email;
  const link = bookingLink({
    code: b.code, locale: b.customer_locale,
    guestToken: b.user_id ? null : b.guest_access_token,
  });

  switch (action) {
    case "accept":
    case "reject": {
      const { error } = await sb.rpc("provider_respond_booking", {
        p_booking: bookingId, p_accept: action === "accept", p_note: note ?? null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      if (action === "reject") {
        // teljes refund – a véglegesítést a Stripe webhook (charge.refunded) végzi
        await requestRefund(sb, {
          bookingId, amountCents: b.grand_total, currency: b.currency, reason: "provider_cancelled",
        });
      }
      if (to) {
        await sendEmail({ to, template: action === "accept" ? "booking_confirmation" : "booking_cancelled",
          locale: b.customer_locale, vars: { code: b.code, reason: "provider", link } });
      }
      break;
    }
    case "complete": {
      await sb.from("bookings").update({ status: "attended" }).eq("id", bookingId)
        .in("status", ["confirmed"]);
      const { error } = await sb.rpc("complete_booking", { p_booking: bookingId });
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      if (to) {
        await sendEmail({ to, template: "review_request", locale: b.customer_locale,
          vars: { code: b.code, link } });
      }
      break;
    }
    case "no_show": {
      await sb.from("bookings").update({ status: "no_show" }).eq("id", bookingId)
        .in("status", ["confirmed"]);
      break;
    }
    case "cancel": {
      const { data: refundAmount, error } = await sb.rpc("cancel_booking", {
        p_booking: bookingId, p_reason: "provider_cancelled", p_refund_amount: b.grand_total,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      if ((refundAmount as number) > 0) {
        await requestRefund(sb, {
          bookingId, amountCents: refundAmount as number, currency: b.currency, reason: "provider_cancelled",
        });
      }
      if (to) {
        await sendEmail({ to, template: "booking_cancelled", locale: b.customer_locale,
          vars: { code: b.code, reason: "provider_cancelled", link,
            amount: ((refundAmount as number) / 100).toFixed(2), currency: b.currency } });
      }
      break;
    }
  }

  await sb.from("audit_log").insert({
    actor_id: user.id, actor_role: staff && !member ? "admin" : "provider",
    action: `booking.${action}`, entity: "bookings", entity_id: bookingId, diff: { note },
  });

  return NextResponse.json({ ok: true });
}
