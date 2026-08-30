import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { bookingInputSchema } from "@/lib/validation";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isLocale } from "@/lib/i18n";
import { verifyAffiliateCookie } from "@/lib/affiliate-cookie";

/**
 * Foglalás létrehozása – Zod-validált bemenet, service-role RPC hívás.
 * A create_booking RPC végzi: kapacitás-zárolás, árszámítás (szezonális,
 * opció, extrák, zóna), kupon, jutalék, affiliate. A kliens ára sosem mérvadó.
 *
 * AFFILIATE: a p_affiliate_link KIZÁRÓLAG a szerver által beállított, httpOnly
 * 'travendiq_ref' cookie-ból származhat (a /r/[code] útvonal írja). A kliens
 * által beküldött affiliateLink UUID-t a séma nem is fogadja el – a
 * kliensoldali csalás technikailag kizárt.
 */
export async function POST(req: NextRequest) {
  const sb = createServiceClient();

  const ip = clientIp(req);
  const limit = Number(process.env.RATE_LIMIT_BOOKING_PER_MINUTE ?? 5);
  if (!(await rateLimit(sb, `booking:${ip}`, limit))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  // egyszerű bot-csapda: honeypot mező
  const raw = await req.json().catch(() => null);
  if (raw?.website) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const parsed = bookingInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const v = parsed.data;

  const session = createClient();
  const { data: { user } } = await session.auth.getUser();

  // affiliate: KIZÁRÓLAG a /r/[code] által beállított, HMAC-ALÁÍRT szerveroldali
  // cookie. Módosított, hamisított vagy lejárt cookie → null (a foglalás
  // affiliate-mentesen megy tovább). A kliens által beküldött UUID-t a séma
  // nem fogadja el; a link aktív/jóváhagyott állapotát a create_booking RPC
  // adatbázisban ismét ellenőrzi.
  const affiliateLink = verifyAffiliateCookie(req.cookies.get("travendiq_ref")?.value);

  // lejárt pending foglalások takarítása – a hiba NEM csendes
  const { error: expErr } = await sb.rpc("expire_pending_bookings", { p_minutes: 30 });
  if (expErr) {
    console.error("[bookings/create] expire_pending_bookings failed:", expErr.message);
  }

  const localeHeader = req.headers.get("x-locale") ?? "en";
  const { data: bookingId, error } = await sb.rpc("create_booking", {
    p_listing: v.listingId,
    p_option: v.optionId ?? null,
    p_date: v.date,
    p_start_time: v.startTime,
    p_adults: v.adults,
    p_children: v.children,
    p_infants: v.infants,
    p_user: user?.id ?? null,
    p_guest_email: user ? null : v.leadEmail,
    p_customer_locale: isLocale(localeHeader) ? localeHeader : "en",
    p_lead_name: v.leadName,
    p_lead_email: v.leadEmail,
    p_lead_phone: v.leadPhone,
    p_hotel: v.hotel,
    p_pickup: v.pickup,
    p_special: v.requests,
    p_coupon_code: v.coupon || null,
    p_idempotency_key: v.idempotencyKey,
    p_affiliate_link: affiliateLink,
    p_extras: v.extras.map((x) => ({ extra_id: x.extraId, quantity: x.quantity })),
    p_zone: v.zoneId ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  // a foglalás már létrejött az RPC-ben – a kód/összeg visszaolvasásának
  // hibája NEM maradhat csendben (a kliens bookingId nélküli kóddal maradna)
  const { data: booking, error: readErr } = await sb.from("bookings")
    .select("code, grand_total, currency, guest_access_token")
    .eq("id", bookingId).single();
  if (readErr) {
    console.error("[bookings/create] booking readback failed:", readErr.message, { bookingId });
    return NextResponse.json(
      { error: "booking_created_but_unreadable", bookingId },
      { status: 500 },
    );
  }

  return NextResponse.json({
    bookingId,
    code: booking?.code,
    grandTotal: booking?.grand_total,
    currency: booking?.currency,
    // a vendég tokent csak a foglalást létrehozó kliens kapja meg (egyszeri, session-höz kötött folyamat)
    guestToken: user ? null : booking?.guest_access_token,
  });
}
