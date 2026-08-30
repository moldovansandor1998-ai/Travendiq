import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveLocale } from "@/lib/i18n/locales";

/**
 * Magic-link (OTP) kezdeményezés szerveroldalon.
 *  - MEGOSZTOTT rate limit (00025 check_rate_limit RPC): IP-nként 10/perc,
 *    emailcímenként 5 / 5 perc – serverless környezetben is érvényes;
 *  - a locale a támogatott listából normalizálva (resolveLocale);
 *  - a Supabase-hiba NEM marad csendben: 500 + console.error,
 *    a kliens nem kaphat hamis sikerjelzést;
 *  - emailRedirectTo csak same-origin belső útvonal lehet ("/"-rel kezdődik).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    { email?: string; locale?: string; next?: string } | null;
  const locale = resolveLocale(body?.locale ?? "");
  const email = String(body?.email ?? "").trim().toLowerCase();
  const next =
    typeof body?.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//")
      ? body.next
      : `/${locale}`;

  const svc = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(svc, `login:${ip}`, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  // email-szintű limit: ugyanarra a címre sem mehet korlátlan magic link
  if (!(await rateLimit(svc, `login-email:${email}`, 5, 300))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const sb = createClient();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}${next}`, shouldCreateUser: false },
  });
  if (error) {
    console.error("[auth/login] signInWithOtp failed:", error.message);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
