import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveLocale } from "@/lib/i18n/locales";

/**
 * Newsletter feliratkozás.
 *  - a locale VALIDÁLT: csak támogatott, normalizált locale-ra irányítunk;
 *  - az upsert eredménye ELLENŐRZÖTT: adatbázishiba esetén NEM adunk hamis
 *    sikerüzenetet (?subscribed=error).
 */
export async function POST(req: NextRequest) {
  // a locale a támogatott listából normalizálva – sosem nyers kliensbemenet
  const form = await req.formData();
  const locale = resolveLocale(String(form.get("locale") ?? ""));
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  const sb = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(sb, `newsletter:${ip}`, 3))) {
    return NextResponse.redirect(new URL(`/${locale}?subscribed=rate_limited`, req.url), 303);
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.redirect(new URL(`/${locale}?subscribed=invalid`, req.url), 303);
  }

  const { error } = await sb.from("newsletter_subscribers")
    .upsert({ email, locale, is_active: true, unsubscribed_at: null, consented_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) {
    // DB-hiba → NEM hamis siker: hiba-paraméter + naplózás
    console.error("[newsletter] upsert failed:", error.message);
    return NextResponse.redirect(new URL(`/${locale}?subscribed=error`, req.url), 303);
  }

  return NextResponse.redirect(new URL(`/${locale}?subscribed=1`, req.url), 303);
}
