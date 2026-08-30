import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { StripeProvider } from "@/lib/payments/stripe";
import { isLocale, defaultLocale } from "@/lib/i18n";

/**
 * Connect onboarding visszatérés.
 * - a felhasználó locale-ja megmarad (?locale= paraméter, a profil locale
 *   fallbackkel – NEM fix magyar oldalra irányít),
 * - a TELJES Connect-állapot szinkronizálódik: charges/payouts/details +
 *   requirements (currently_due, past_due, disabled_reason) + capabilities,
 * - refresh=1 esetén új onboarding link készül és visszairányít a Stripe-hoz.
 */
export async function GET(req: NextRequest) {
  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  const sb = createServiceClient();

  const qLocale = req.nextUrl.searchParams.get("locale");
  let locale = qLocale && isLocale(qLocale) ? qLocale : defaultLocale;

  if (!user) {
    return NextResponse.redirect(new URL(`/${locale}/auth/login`, req.url));
  }

  const { data: provider } = await sb.from("providers")
    .select("id, stripe_account_id")
    .eq("owner_id", user.id).maybeSingle();

  // profil-locale fallback, ha a query nem volt érvényes
  if (!qLocale || !isLocale(qLocale)) {
    const { data: profile } = await sb.from("profiles").select("locale").eq("id", user.id).maybeSingle();
    if (profile?.locale && isLocale(profile.locale)) locale = profile.locale;
  }

  if (provider?.stripe_account_id) {
    const stripe = new StripeProvider();
    if (stripe.isConfigured()) {
      try {
        const s = await stripe.getAccountDetails(provider.stripe_account_id);
        // a Stripe-lekérdezés már sikerült – a DB-szinkron hibája NEM csendes:
        // a felhasználó az error ágra kerül (a Connect webhook korrigálja)
        const { error: syncErr } = await sb.rpc("sync_connect_account", {
          p_account_id: provider.stripe_account_id,
          p_charges: s.chargesEnabled, p_payouts: s.payoutsEnabled,
          p_details: s.detailsSubmitted,
          p_requirements: {
            currently_due: s.currentlyDue, past_due: s.pastDue,
            disabled_reason: s.disabledReason,
          },
          p_capabilities: s.capabilities, p_country: s.country,
        });
        if (syncErr) {
          console.error("[connect/return] sync_connect_account failed:", syncErr.message);
          throw new Error(`sync_failed: ${syncErr.message}`);
        }

        // refresh=1 VAGY lejárt link: új onboarding URL és vissza a Stripe-hoz
        const needsMore = s.currentlyDue.length > 0 || !s.detailsSubmitted;
        if (req.nextUrl.searchParams.get("refresh") === "1" || (needsMore && req.nextUrl.searchParams.get("retry") === "1")) {
          const site = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;
          const url = await stripe.createOnboardingLink(
            provider.stripe_account_id,
            `${site}/api/connect/return?locale=${locale}`,
            `${site}/api/connect/return?locale=${locale}&refresh=1`
          );
          return NextResponse.redirect(url);
        }

        const complete = s.chargesEnabled && s.payoutsEnabled && s.detailsSubmitted
          && s.currentlyDue.length === 0 && s.pastDue.length === 0 && !s.disabledReason;
        return NextResponse.redirect(
          new URL(`/${locale}/provider/settings?connect=${complete ? "done" : "incomplete"}`, req.url),
        );
      } catch (e) {
        return NextResponse.redirect(
          new URL(`/${locale}/provider/settings?connect=error&reason=${encodeURIComponent(e instanceof Error ? e.message : "sync_failed")}`, req.url),
        );
      }
    }
  }
  return NextResponse.redirect(new URL(`/${locale}/provider/settings?connect=done`, req.url));
}
