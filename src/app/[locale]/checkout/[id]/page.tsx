import { notFound } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createServiceClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/utils";
import { getBookingWithAccess } from "@/lib/booking/access";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { DevSimulateButton } from "@/components/checkout/DevSimulateButton";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  params, searchParams,
}: { params: { locale: Locale; id: string }; searchParams: { token?: string } }) {
  const { locale, id } = params;
  const t = getDictionary(locale);

  // Hozzáférés-ellenőrzés: tulajdonos / vendég token / provider / staff
  const access = await getBookingWithAccess({ id }, searchParams.token ?? null);
  if (!access.ok) {
    if (access.reason === "not_found") notFound();
    return (
      <div className="container-page max-w-xl py-16 text-center">
        <h1 className="text-xl font-bold text-lagoon-950">403</h1>
        <p className="mt-2 text-lagoon-600">
          {t.checkout.noAccess}
        </p>
      </div>
    );
  }

  const b = access.booking as {
    id: string; code: string; status: string; grand_total: number; currency: string;
    date: string; start_time: string; listing_id: string; customer_locale: string;
  };

  const sb = createServiceClient();
  const { data: listing } = await sb.from("listings")
    .select("translations:listing_translations(locale,title)").eq("id", b.listing_id).single();
  const trs = (listing?.translations ?? []) as { locale: string; title: string }[];
  const title = (trs.find((x) => x.locale === locale) ?? trs.find((x) => x.locale === "en"))?.title ?? "";

  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const isProd = process.env.NODE_ENV === "production";
  const tokenQ = searchParams.token ? `&token=${searchParams.token}` : "";
  const returnUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/${locale}/booking/${b.code}?token=${searchParams.token ?? ""}`;

  if (b.status !== "pending_payment") {
    return (
      <div className="container-page max-w-xl py-16 text-center">
        <p className="text-lagoon-700">{t.booking.status[b.status as keyof typeof t.booking.status] ?? b.status}</p>
        <a href={`/${locale}/booking/${b.code}?${tokenQ}`} className="btn-primary mt-4 inline-flex">{t.booking.title}</a>
      </div>
    );
  }

  return (
    <div className="container-page max-w-xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.checkout.title}</h1>
      <div className="card mt-6 space-y-4 p-6">
        <div className="flex justify-between text-sm">
          <span className="text-lagoon-600">{title}</span>
          <span className="text-lagoon-500">{b.date} {String(b.start_time).slice(0, 5)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-lagoon-100 pt-3">
          <span className="font-semibold text-lagoon-900">{t.booking.total}</span>
          <span className="text-xl font-extrabold text-lagoon-950">{formatMoney(b.grand_total, b.currency, locale)}</span>
        </div>

        {stripeReady ? (
          <CheckoutForm
            bookingId={b.id}
            token={searchParams.token}
            returnUrl={returnUrl}
            labels={{ pay: t.checkout.pay, secure: t.checkout.secure, failed: t.checkout.failed, loading: t.common.loading }}
          />
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">{t.checkout.devMode}</p>
            {!isProd ? (
              <DevSimulateButton bookingId={b.id} token={searchParams.token}
                returnPath={`/${locale}/booking/${b.code}?paid=1${tokenQ}`}
                label={t.checkout.devConfirm} />
            ) : (
              <p className="mt-2 text-sm text-amber-800">Stripe keys required in production.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
