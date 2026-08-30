import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { localeFromAcceptLanguage, resolveLocale, defaultLocale } from "@/lib/i18n/locales";
import { signAffiliateCookie, AFFILIATE_COOKIE_MAX_AGE } from "@/lib/affiliate-cookie";

export const dynamic = "force-dynamic";

/**
 * Affiliate kattintáskövetés + átirányítás: /r/ABC123 → /<locale>/listing/...
 *
 * Adatvédelem:
 *  - az IP-t CSAK külön, erős AFFILIATE_IP_SALT környezeti titokkal hash-eljük;
 *  - NINCS beégetett alapértelmezett salt ("travendiq");
 *  - hiányzó titok esetén NEM tárolunk gyenge IP-hash-t (null kerül be);
 *  - a user-agent csonkolva tárolódik.
 * Locale: a refererben szereplő vagy a böngésző által kért TÁMOGATOTT locale,
 * sosem a kliens által szabadon megadott érték; nem mindig "/en".
 */
export async function GET(req: Request, { params }: { params: { code: string } }) {
  const svc = createServiceClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

  // a cél locale: refererből megörzött vagy Accept-Language-ből BIZTONSÁGOSAN
  // választott támogatott locale
  let locale = defaultLocale;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refPath = new URL(referer).pathname.split("/").filter(Boolean)[0];
      locale = resolveLocale(refPath ?? null);
    } catch { locale = defaultLocale; }
  }
  if (locale === defaultLocale) {
    locale = localeFromAcceptLanguage(req.headers.get("accept-language"));
  }
  const home = `${site}/${locale}`;

  const ip = clientIp(req);
  if (!(await rateLimit(svc, `ref:${ip}`, 30))) {
    return NextResponse.redirect(home, 302);
  }

  const { data: link, error: linkErr } = await svc.from("promoter_links")
    .select("id, listing_id, is_active, approval_status, listing:listings(slug)")
    .eq("code", params.code)
    .maybeSingle();

  if (linkErr) {
    console.error("[/r/[code]] promoter_links lookup failed:", linkErr.message);
    return NextResponse.redirect(home, 302);
  }
  if (!link || !link.is_active || link.approval_status !== "approved") {
    return NextResponse.redirect(home, 302);
  }

  // IP-hash: KIZÁRÓLAG külön, erős AFFILIATE_IP_SALT titokkal; hiányában null
  const salt = process.env.AFFILIATE_IP_SALT;
  const ipHash = ip !== "unknown" && salt && salt.length >= 16
    ? createHash("sha256").update(`${ip}|${salt}`).digest("hex").slice(0, 32)
    : null;

  const { error: clickErr } = await svc.from("affiliate_clicks").insert({
    link_id: link.id,
    ip_hash: ipHash,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  });
  if (clickErr) {
    // a kattintás-naplózás hibája nem blokkolja a felhasználót, de NEM csendes
    console.error("[/r/[code]] affiliate_clicks insert failed:", clickErr.message);
  }

  const listing = link.listing as unknown as { slug: string } | null;
  const target = listing ? `${site}/${locale}/listing/${listing.slug}` : `${site}/${locale}/search`;

  // affiliate cookie: HMAC-aláírt (linkId.lejárat.aláírás) – módosított
  // HTTP-kliens sem hamisíthat ismert UUID-t, mert az aláíráshoz a
  // kizárólag szerveroldali AFFILIATE_COOKIE_SECRET kell. Hiányzó titok
  // esetén NEM állítunk be érvényteleníthetetlen cookie-t.
  const res = NextResponse.redirect(target, 302);
  const signed = signAffiliateCookie(link.id);
  if (signed) {
    res.cookies.set("travendiq_ref", signed, {
      maxAge: AFFILIATE_COOKIE_MAX_AGE, httpOnly: true, sameSite: "lax",
      secure: process.env.NODE_ENV === "production", path: "/",
    });
  }
  return res;
}
