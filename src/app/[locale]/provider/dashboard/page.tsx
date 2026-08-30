export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/lib/utils";
import type { BookingStatus } from "@/lib/booking/status";

export default async function ProviderDashboard({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const pd = t.providerDash as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: provider } = await sb.from("providers").select("*")
    .eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const [{ data: listings }, { data: bookings }, { data: payouts }] = await Promise.all([
    sb.from("listings").select("id, slug, status, is_test, translations:listing_translations(locale,title)")
      .eq("provider_id", provider.id).order("created_at", { ascending: false }).limit(20),
    sb.from("bookings").select("id, code, date, status, grand_total, currency, provider_amount, lead_name")
      .eq("provider_id", provider.id).order("created_at", { ascending: false }).limit(20),
    sb.from("payouts").select("amount, currency, status").eq("provider_id", provider.id),
  ]);

  const statusLabels = t.provider.status as Record<string, string>;
  const expected = (payouts ?? []).filter((p) => p.status === "held" || p.status === "pending" || p.status === "scheduled")
    .reduce((s, p) => s + p.amount, 0);
  const paid = (payouts ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lagoon-950">{provider.display_name}</h1>
          <p className="mt-1 text-sm">
            <span className={`badge ${provider.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {statusLabels[provider.status] ?? provider.status}
            </span>
          </p>
        </div>
        <Link href={`/${locale}/provider/listings/new`} className="btn-primary">{t.provider.newListing}</Link>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2 text-sm">
        {[
          [`/${locale}/provider/bookings`, pd.navBookings],
          [`/${locale}/provider/coupons`, pd.navCoupons],
          [`/${locale}/provider/finance`, pd.navFinance],
          [`/${locale}/provider/team`, pd.navTeam],
          [`/${locale}/provider/documents`, pd.navDocuments],
          [`/${locale}/provider/settings`, pd.navSettings],
          [`/${locale}/checkin`, pd.navCheckin],
        ].map(([href, label]) => (
          <Link key={href} href={href}
            className="rounded-lg border border-lagoon-200 bg-white px-3 py-1.5 font-medium text-lagoon-800 hover:border-lagoon-400">
            {label}
          </Link>
        ))}
      </nav>

      {provider.status !== "approved" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t.provider.pendingReview}
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat label={t.provider.bookings} value={String(bookings?.length ?? 0)} />
        <Stat label={`${t.provider.payouts} (${pd.expected})`} value={formatMoney(expected, "EUR", locale)} />
        <Stat label={pd.paidOut} value={formatMoney(paid, "EUR", locale)} />
      </div>

      <h2 className="mt-10 text-xl font-bold text-lagoon-950">{t.provider.myListings}</h2>
      <div className="card mt-4 divide-y divide-lagoon-100">
        {(listings ?? []).map((l) => {
          const trs = (l.translations ?? []) as { locale: string; title: string }[];
          const title = (trs.find((x) => x.locale === locale) ?? trs[0])?.title ?? l.slug;
          return (
            <div key={l.id} className="flex items-center justify-between gap-4 p-4 text-sm">
              <div className="flex items-center gap-3">
                <Link href={`/${locale}/provider/listings/${l.id}`} className="font-medium text-lagoon-900 hover:underline">{title}</Link>
                {l.is_test && <span className="badge bg-amber-100 text-amber-800">demo</span>}
              </div>
              <span className="badge bg-lagoon-100 text-lagoon-800">{l.status}</span>
            </div>
          );
        })}
        {(listings ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>

      <h2 className="mt-10 text-xl font-bold text-lagoon-950">{t.provider.bookings}</h2>
      <div className="card mt-4 divide-y divide-lagoon-100">
        {(bookings ?? []).map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <span className="font-mono font-semibold text-lagoon-900">{b.code}</span>
              <span className="ml-3 text-lagoon-600">{b.date} · {b.lead_name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-lagoon-900">{formatMoney(b.provider_amount, b.currency, locale)}</span>
              <StatusBadge status={b.status as BookingStatus}
                label={(t.booking.status as Record<string, string>)[b.status] ?? b.status} />
            </div>
          </div>
        ))}
        {(bookings ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-lagoon-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-lagoon-950">{value}</p>
    </div>
  );
}
