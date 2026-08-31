export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getDictionary, type Locale } from "@/lib/i18n";
import { formatMoney } from "@/lib/utils";

export default async function AffiliatePage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const { locale } = params;
  const t = getDictionary(locale);
  const af = t.affiliate as Record<string, string>;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: links } = await sb.from("promoter_links")
    .select("id, code, kind, approval_status, is_active, commission_rate, payout_email, payout_iban, created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false });

  const linkIds = (links ?? []).map((l) => l.id);
  const [{ data: clicks }, { data: commissions }] = linkIds.length
    ? await Promise.all([
        sb.from("affiliate_clicks").select("id, link_id, created_at").in("link_id", linkIds)
          .order("created_at", { ascending: false }).limit(500),
        sb.from("affiliate_commissions").select("id, link_id, amount, currency, status, fraud_flag, created_at")
          .in("link_id", linkIds).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travendiq.com";

  async function register(formData: FormData) {
    "use server";
    const sb2 = await createClient();
    const { data: { user: u } } = await sb2.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const payoutEmail = String(formData.get("payout_email") ?? "").trim();
    const payoutIban = String(formData.get("payout_iban") ?? "").trim();
    if (!payoutEmail && !payoutIban) throw new Error("payout data required");
    const svc = createServiceClient();
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    // DB-hiba nem maradhat csendben – hamis "sikeres regisztráció" tiltva
    const { error: insErr } = await svc.from("promoter_links").insert({
      user_id: u.id, code, kind: "link", payout_email: payoutEmail || null, payout_iban: payoutIban || null,
    });
    if (insErr) {
      console.error("[affiliate] promoter_links insert failed:", insErr.message);
      throw new Error("registration failed");
    }
    const { error: roleErr } = await svc.from("user_roles").upsert({ user_id: u.id, role: "promoter" });
    if (roleErr) {
      console.error("[affiliate] user_roles upsert failed:", roleErr.message);
      throw new Error("registration failed");
    }
    revalidatePath(`/${locale}/affiliate`);
  }

  const pending = (commissions ?? []).filter((c) => c.status === "pending").reduce((s, c) => s + c.amount, 0);
  const paid = (commissions ?? []).filter((c) => c.status === "paid").reduce((s, c) => s + c.amount, 0);
  const clickCount = (clicks ?? []).length;
  const conversions = (commissions ?? []).length;

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{af.title}</h1>

      {(links ?? []).length === 0 ? (
        <form action={register} className="card mt-6 max-w-xl p-5">
          <h2 className="font-semibold text-lagoon-900">{af.registerTitle}</h2>
          <p className="mt-1 text-sm text-lagoon-600">{af.registerSubtitle}</p>
          <div className="mt-3 grid gap-3">
            <label className="text-sm">{af.payoutEmail}
              <input name="payout_email" type="email" className="input mt-1" />
            </label>
            <label className="text-sm">IBAN ({af.optional})
              <input name="payout_iban" className="input mt-1" placeholder="HU42 1177 3016 1111 1018 0000 0000" />
            </label>
            <button className="btn-primary" type="submit">{af.register}</button>
          </div>
        </form>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            <Stat label={af.clicks} value={String(clickCount)} />
            <Stat label={af.conversions} value={String(conversions)} />
            <Stat label={af.pendingCommission} value={formatMoney(pending, "EUR", locale)} />
            <Stat label={af.paidOut} value={formatMoney(paid, "EUR", locale)} />
          </div>

          <h2 className="mt-10 text-xl font-bold text-lagoon-950">{af.myLinks}</h2>
          <div className="card mt-4 divide-y divide-lagoon-100">
            {(links ?? []).map((l) => {
              const url = `${site}/r/${l.code}`;
              const cCount = (clicks ?? []).filter((c) => c.link_id === l.id).length;
              return (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-lagoon-900">{url}</p>
                    <p className="text-xs text-lagoon-500">
                      {cCount} {af.clicksLower} · {l.commission_rate ?? 5}%
                    </p>
                  </div>
                  <span className={`badge ${l.approval_status === "approved" ? "bg-emerald-100 text-emerald-800" : l.approval_status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                    {l.approval_status === "approved" ? af.approved
                      : l.approval_status === "rejected" ? af.rejected
                      : af.pendingApproval}
                  </span>
                </div>
              );
            })}
          </div>

          <h2 className="mt-10 text-xl font-bold text-lagoon-950">{af.commissions}</h2>
          <div className="card mt-4 divide-y divide-lagoon-100">
            {(commissions ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between p-4 text-sm">
                <span className="text-lagoon-600">{new Date(c.created_at).toLocaleDateString(locale)}</span>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{formatMoney(c.amount, c.currency, locale)}</span>
                  <span className={`badge ${c.status === "paid" ? "bg-emerald-100 text-emerald-800" : c.status === "reversed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                    {c.status}
                  </span>
                </div>
              </div>
            ))}
            {(commissions ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
          </div>
        </>
      )}
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
