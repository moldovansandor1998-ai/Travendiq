import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { StripeProvider, isSupportedConnectCountry } from "@/lib/payments/stripe";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isLocale } from "@/lib/i18n";

const bodySchema = z.object({ locale: z.string().optional() }).nullable();

/**
 * Stripe Connect Express onboarding.
 * - a country a támogatott Connect-országlistára validált (hiányzó/nem támogatott
 *   ország → 422, ország-változtatás meglévő accountnál → 409, új account kell),
 * - a return/refresh URL megőrzi a felhasználó locale-ját,
 * - a Stripe-onboarding hibái külön hibakóddal jelennek meg (audit-naplózva).
 */
export async function POST(req: NextRequest) {
  const rl = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(rl, `connect:${ip}`, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const locale = parsed.success && parsed.data?.locale && isLocale(parsed.data.locale)
    ? parsed.data.locale : "en";

  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = createServiceClient();
  const { data: provider } = await sb.from("providers")
    .select("id, owner_id, country_code, contact_email, is_company, stripe_account_id, stripe_account_country")
    .eq("owner_id", user.id).maybeSingle();
  if (!provider) return NextResponse.json({ error: "no_provider" }, { status: 404 });

  // ország-validáció: hiányzó vagy nem támogatott Connect-ország
  if (!provider.country_code) {
    return NextResponse.json({ error: "country_missing" }, { status: 422 });
  }
  if (!isSupportedConnectCountry(provider.country_code)) {
    return NextResponse.json({
      error: "country_not_supported",
      detail: `Stripe Connect Express nem érhető el ebben az országban: ${provider.country_code}`,
    }, { status: 422 });
  }

  const stripe = new StripeProvider();
  if (!stripe.isConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }

  let accountId = provider.stripe_account_id;
  try {
    if (accountId) {
      // meglévő account: ország-eltérés kezelése (a Stripe country nem módosítható)
      const details = await stripe.getAccountDetails(accountId);
      if (details.country && details.country.toUpperCase() !== provider.country_code.toUpperCase()) {
        return NextResponse.json({
          error: "country_change_requires_new_account",
          detail: `A Connect-számla országa (${details.country}) eltér a szolgáltató országától (${provider.country_code}). Az ország módosításához új Connect-számla kell – vedd fel a kapcsolatot a supporttal.`,
        }, { status: 409 });
      }
    } else {
      const { accountId: id } = await stripe.createConnectAccount({
        email: provider.contact_email ?? user.email ?? "",
        country: provider.country_code,
        businessType: provider.is_company ? "company" : "individual",
      });
      accountId = id;
      await sb.from("providers").update({
        stripe_account_id: accountId,
        stripe_account_country: provider.country_code.toUpperCase(),
      }).eq("id", provider.id);
    }

    const site = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;
    const url = await stripe.createOnboardingLink(
      accountId,
      `${site}/api/connect/return?locale=${locale}`,
      `${site}/api/connect/return?locale=${locale}&refresh=1`
    );

    await sb.from("audit_log").insert({
      actor_id: user.id, actor_role: "provider",
      action: "connect.onboarding_started", entity: "providers", entity_id: provider.id,
      diff: { accountId, locale },
    });

    return NextResponse.json({ url });
  } catch (e) {
    // Stripe onboarding hiba: külön hibakód + audit
    const msg = e instanceof Error ? e.message : "stripe_onboarding_error";
    await sb.from("audit_log").insert({
      actor_id: user.id, actor_role: "provider",
      action: "connect.onboarding_error", entity: "providers", entity_id: provider.id,
      diff: { error: msg },
    });
    return NextResponse.json({ error: "onboarding_failed", detail: msg }, { status: 502 });
  }
}
