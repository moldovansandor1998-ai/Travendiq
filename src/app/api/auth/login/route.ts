import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveLocale } from "@/lib/i18n/locales";

/** Jelszavas bejelentkezés megosztott, adatbázis-alapú brute-force védelemmel. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    { email?: string; password?: string; locale?: string; next?: string } | null;
  const locale = resolveLocale(body?.locale ?? "");
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const next =
    typeof body?.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//")
      ? body.next
      : `/${locale}`;

  const svc = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(svc, `login:${ip}`, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
  }
  // Email-szintű limit: egyetlen fiók ellen sem lehet korlátlanul próbálkozni.
  if (!(await rateLimit(svc, `login-email:${email}`, 5, 300))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const sb = createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.warn("[auth/login] password sign-in rejected:", error.message);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, next });
}
