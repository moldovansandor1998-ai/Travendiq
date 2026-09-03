import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit, releaseRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { resolveLocale } from "@/lib/i18n/locales";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string; name?: string; locale?: string } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const name = String(body?.name ?? "").trim().slice(0, 120);
  const locale = resolveLocale(body?.locale ?? "en");
  const svc = createServiceClient();
  const ipKey = `register:${clientIp(req)}`;
  const emailKey = `register-email:${email}`;

  if (!(await rateLimit(svc, ipKey, 5, 300))) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (!EMAIL_RE.test(email) || name.length < 2 || password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (!(await rateLimit(svc, emailKey, 3, 900))) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data, error } = await svc.auth.admin.generateLink({
    type: "signup", email, password,
    options: { data: { full_name: name, locale, registration_intent: "provider" } },
  });

  if (error || !data.properties?.hashed_token || !data.user?.id) {
    console.error("[auth/register] generateLink failed:", error?.message);
    await Promise.all([releaseRateLimit(svc, ipKey), releaseRateLimit(svc, emailKey)]);
    const message = (error?.message ?? "").toLowerCase();
    if (message.includes("weak") || message.includes("password")) {
      return NextResponse.json({ error: "weak_password" }, { status: 400 });
    }
    if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
      return NextResponse.json({ error: "account_exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "registration_failed" }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const next = `/${locale}/auth/confirmed`;
  const confirmUrl = `${origin}/api/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=signup&next=${encodeURIComponent(next)}`;
  const sent = await sendEmail({ to: email, template: "email_confirmation", locale, vars: { name, link: confirmUrl } });

  if (!sent.ok) {
    console.error("[auth/register] confirmation email failed", { email, error: sent.error });
    await svc.auth.admin.deleteUser(data.user.id).catch((deleteError) => console.error("[auth/register] rollback failed:", deleteError));
    await Promise.all([releaseRateLimit(svc, ipKey), releaseRateLimit(svc, emailKey)]);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
