export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/utils";

export default async function AdminDashboard({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect(`/${locale}`);
  const hu = locale === "hu";

  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const { data: expiringDocsRaw } = await sb.from("provider_documents")
    .select("id, kind, expires_at").gte("expires_at", today).lte("expires_at", in30).limit(20);
  const expiringDocs = expiringDocsRaw ?? [];

  const [
    { count: bookingCount }, { data: paidBookings }, { count: providerCount },
    { count: pendingProviders }, { count: pendingListings }, { data: refunds },
  ] = await Promise.all([
    sb.from("bookings").select("id", { count: "exact", head: true }),
    sb.from("bookings").select("grand_total, commission_amount").not("paid_at", "is", null),
    sb.from("providers").select("id", { count: "exact", head: true }).eq("status", "approved"),
    sb.from("providers").select("id", { count: "exact", head: true }).in("status", ["under_review", "docs_required"]),
    sb.from("listings").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    sb.from("refunds").select("amount"),
  ]);

  const gross = (paidBookings ?? []).reduce((s, b) => s + b.grand_total, 0);
  const revenue = (paidBookings ?? []).reduce((s, b) => s + b.commission_amount, 0);
  const refunded = (refunds ?? []).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.admin.dashboard}</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.admin.bookings} value={String(bookingCount ?? 0)} />
        <Stat label={t.admin.grossVolume} value={formatMoney(gross, "EUR", locale)} />
        <Stat label={t.admin.platformRevenue} value={formatMoney(revenue, "EUR", locale)} />
        <Stat label={t.admin.refunds} value={formatMoney(refunded, "EUR", locale)} />
        <Stat label={t.admin.activeProviders} value={String(providerCount ?? 0)} />
        <Stat label={t.admin.pendingProviders} value={String(pendingProviders ?? 0)} href={`/${locale}/admin/providers`} />
        <Stat label={t.admin.pendingListings} value={String(pendingListings ?? 0)} href={`/${locale}/admin/listings`} />
        <Stat label={t.admin.chargebacks} value="0" />
      </div>

      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link className="btn-secondary" href={`/${locale}/admin/providers`}>{t.admin.pendingProviders}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/listings`}>{t.admin.pendingListings}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/kyc`}>{hu ? "KYC dokumentumok" : "KYC documents"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/users`}>{hu ? "Felhasználók" : "Users"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/bookings`}>{hu ? "Foglalások" : "Bookings"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/payouts`}>{hu ? "Kifizetések" : "Payouts"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/commissions`}>{hu ? "Jutalék-szabályok" : "Commissions"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/coupons`}>{hu ? "Kuponok" : "Coupons"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/affiliates`}>Affiliate</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/reviews`}>{hu ? "Értékelések" : "Reviews"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/taxonomy`}>{hu ? "Törzsadatok" : "Taxonomy"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/cms`}>CMS</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/logs`}>{hu ? "Naplók" : "Logs"}</Link>
        <Link className="btn-secondary" href={`/${locale}/admin/security`}>2FA</Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 text-xs text-lagoon-600">
        <span>{hu ? "CSV export:" : "CSV export:"}</span>
        {["bookings", "payouts", "users", "ledger"].map((k) => (
          <a key={k} href={`/api/admin/export?kind=${k}`} className="font-semibold text-lagoon-700 underline">{k}</a>
        ))}
      </div>

      {expiringDocs.length > 0 && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">
            {hu ? "Lejáró dokumentumok (30 nap)" : "Expiring documents (30 days)"}
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {expiringDocs.map((d) => (
              <li key={d.id}>{d.kind} · {hu ? "lejár" : "expires"}: {d.expires_at}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-lagoon-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-lagoon-950">{value}</p>
    </>
  );
  return href
    ? <Link href={href} className="card block p-5 transition hover:shadow-md">{inner}</Link>
    : <div className="card p-5">{inner}</div>;
}
