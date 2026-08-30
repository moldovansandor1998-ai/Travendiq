import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveLocale } from "@/lib/i18n/locales";

/**
 * Vendégfoglalások átvétele: a magic linkkel belépett user emailcíméhez
 * tartozó user_id nélküli foglalásokat hozzárendeljük a fiókjához.
 * A locale csak támogatott érték lehet; a DB-hiba nem marad csendben.
 */
export async function GET(req: NextRequest) {
  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  const locale = resolveLocale(req.nextUrl.searchParams.get("locale"));
  if (!user?.email) {
    return NextResponse.redirect(new URL(`/${locale}/auth/login`, req.url));
  }

  const sb = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(sb, `claim:${user.id}:${ip}`, 10))) {
    return NextResponse.redirect(new URL(`/${locale}/account?claimed=rate_limited`, req.url));
  }

  const email = user.email.toLowerCase();
  const r1 = await sb.from("bookings")
    .update({ user_id: user.id })
    .is("user_id", null)
    .eq("guest_email", email);
  const r2 = await sb.from("bookings")
    .update({ user_id: user.id })
    .is("user_id", null)
    .eq("lead_email", email);

  if (r1.error || r2.error) {
    // felhasználói állapotot érintő DB-hiba – nem csendes, nem hamis siker
    console.error("[account/claim]", r1.error?.message ?? r2.error?.message);
    return NextResponse.redirect(new URL(`/${locale}/account?claimed=error`, req.url));
  }

  return NextResponse.redirect(new URL(`/${locale}/account?claimed=1`, req.url));
}
