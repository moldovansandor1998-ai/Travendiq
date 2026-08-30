import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { resolveLocale } from "@/lib/i18n/locales";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    { email?: string; password?: string; name?: string; locale?: string } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const name = String(body?.name ?? "").trim().slice(0, 120);
  const locale = resolveLocale(body?.locale ?? "en");
  const svc = createServiceClient();

  if (!(await rateLimit(svc, `register:${clientIp(req)}`, 5, 300))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!EMAIL_RE.test(email) || name.length < 2 || password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (!(await rateLimit(svc, `register-email:${email}`, 3, 900))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { data, error } = await svc.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { data: { full_name: name, locale } },
  });
  if (error || !data.properties?.hashed_token || !data.user?.id) {
    console.error("[auth/register] generateLink failed:", error?.message);
    // Do not reveal whether an account already exists.
    return NextResponse.json({ ok: true });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const next = `/${locale}/auth/confirmed`;
  const confirmUrl = `${origin}/api/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=signup&next=${encodeURIComponent(next)}`;
  const sent = await sendEmail({
    to: email,
    template: "email_confirmation",
    locale: "en",
    vars: { name, link: confirmUrl },
  });

  if (!sent.ok) {
    await svc.auth.admin.deleteUser(data.user.id).catch((deleteError) =>
      console.error("[auth/register] rollback failed:", deleteError)
    );
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
