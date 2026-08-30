export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/utils";
import { getDictionary, type Locale } from "@/lib/i18n";

export default async function ProviderFinance({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const pf = t.providerFinance as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers")
    .select("id, stripe_account_id, stripe_onboarding_complete").eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const [{ data: payouts }, { data: ledger }] = await Promise.all([
    sb.from("payouts").select("id, amount, currency, status, scheduled_for, paid_at, created_at, booking_id")
      .eq("provider_id", provider.id).order("created_at", { ascending: false }).limit(100),
    sb.from("ledger_entries").select("id, kind, amount, currency, created_at, booking_id, meta")
      .eq("provider_id", provider.id).order("created_at", { ascending: false }).limit(100),
  ]);

  const sum = (status: string[]) =>
    (payouts ?? []).filter((p) => status.includes(p.status)).reduce((s, p) => s + p.amount, 0);

  const statusLabel = (s: string) => pf[`st_${s}`] ?? s;

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{pf.title}</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label={pf.expectedPayout} value={formatMoney(sum(["held", "pending", "scheduled"]), "EUR", locale)} />
        <Stat label={pf.paidOut} value={formatMoney(sum(["paid"]), "EUR", locale)} />
        <Stat label={locale === "hu" ? "Kifizetési fiók" : "Payout account"}
          value={provider.stripe_onboarding_complete ? pf.connected : pf.notSetUp} />
      </div>

      <h2 className="mt-10 text-xl font-bold text-lagoon-950">{pf.payouts}</h2>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-xs uppercase text-lagoon-700">
            <tr>
              <th className="px-3 py-2 text-start">{pf.date}</th>
              <th className="px-3 py-2 text-start">{pf.amount}</th>
              <th className="px-3 py-2 text-start">{pf.status}</th>
              <th className="px-3 py-2 text-start">{pf.scheduled}</th>
            </tr>
          </thead>
          <tbody>
            {(payouts ?? []).map((p) => (
              <tr key={p.id} className="border-t border-sand-100">
                <td className="px-3 py-2">{new Date(p.created_at).toLocaleDateString(locale)}</td>
                <td className="px-3 py-2 font-semibold">{formatMoney(p.amount, p.currency, locale)}</td>
                <td className="px-3 py-2">
                  <span className={`badge ${p.status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {statusLabel(p.status)}
                  </span>
                </td>
                <td className="px-3 py-2">{p.scheduled_for ? new Date(p.scheduled_for).toLocaleDateString(locale) : "–"}</td>
              </tr>
            ))}
            {(payouts ?? []).length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-lagoon-500">–</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-bold text-lagoon-950">{pf.ledger}</h2>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-xs uppercase text-lagoon-700">
            <tr>
              <th className="px-3 py-2 text-start">{pf.date}</th>
              <th className="px-3 py-2 text-start">{pf.kind}</th>
              <th className="px-3 py-2 text-start">{pf.amount}</th>
              <th className="px-3 py-2 text-start">{pf.note}</th>
            </tr>
          </thead>
          <tbody>
            {(ledger ?? []).map((e) => (
              <tr key={e.id} className="border-t border-sand-100">
                <td className="px-3 py-2">{new Date(e.created_at).toLocaleDateString(locale)}</td>
                <td className="px-3 py-2">{e.kind}</td>
                <td className={`px-3 py-2 font-semibold ${e.amount < 0 ? "text-red-700" : "text-lagoon-900"}`}>
                  {formatMoney(e.amount, e.currency, locale)}
                </td>
                <td className="px-3 py-2 text-lagoon-600">{((e.meta as { note?: string } | null)?.note) ?? "–"}</td>
              </tr>
            ))}
            {(ledger ?? []).length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-lagoon-500">–</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-lagoon-500">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-lagoon-950">{value}</p>
    </div>
  );
}
