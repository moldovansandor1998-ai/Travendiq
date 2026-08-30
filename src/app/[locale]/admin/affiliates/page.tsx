export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import { formatMoney } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

export default async function AdminAffiliates({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  const [{ data: links }, { data: commissions }] = await Promise.all([
    svc.from("promoter_links")
      .select("id, user_id, code, kind, approval_status, is_active, commission_rate, payout_email, created_at, user:profiles(email, full_name)")
      .order("created_at", { ascending: false }),
    svc.from("affiliate_commissions")
      .select("id, link_id, booking_id, amount, currency, status, fraud_flag, fraud_reason, created_at")
      .order("created_at", { ascending: false }).limit(100),
  ]);

  async function review(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("link_id") ?? "");
    const action = String(formData.get("action") ?? "");
    if (!["approve", "reject", "deactivate"].includes(action)) throw new Error("invalid action");
    await s.from("promoter_links").update(
      action === "deactivate"
        ? { is_active: false }
        : { approval_status: action === "approve" ? "approved" : "rejected" }
    ).eq("id", id);
    await audit(s, { actorId: u.id, action: `affiliate.${action}`, entity: "promoter_links", entityId: id });
    revalidatePath(`/${locale}/admin/affiliates`);
  }

  async function flagCommission(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("commission_id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) throw new Error("reason required");
    await s.from("affiliate_commissions").update({ fraud_flag: true, fraud_reason: reason, status: "reversed" }).eq("id", id);
    await audit(s, { actorId: u.id, action: "affiliate.commission_flag", entity: "affiliate_commissions", entityId: id, diff: { reason } });
    revalidatePath(`/${locale}/admin/affiliates`);
  }

  const approvalLabels: Record<string, string> = hu
    ? { pending: "Jóváhagyásra vár", approved: "Jóváhagyva", rejected: "Elutasítva" }
    : { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  const commLabels: Record<string, string> = hu
    ? { pending: "Függő", approved: "Jóváhagyva", paid: "Kifizetve", reversed: "Visszavonva / csalás" }
    : { pending: "Pending", approved: "Approved", paid: "Paid", reversed: "Reversed / fraud" };

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Affiliate partnerek" : "Affiliate partners"}</h1>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(links ?? []).map((l) => {
          const usr = l.user as unknown as { email: string; full_name: string | null } | null;
          return (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium text-lagoon-900">
                  {usr?.full_name ?? usr?.email ?? l.user_id}
                  <span className="ms-2 font-mono text-xs text-lagoon-500">{l.code}</span>
                </p>
                <p className="text-xs text-lagoon-500">
                  {l.kind} · {l.commission_rate ?? 5}% · {new Date(l.created_at).toLocaleDateString(locale)}
                  {l.payout_email && ` · ${l.payout_email}`}
                  {!l.is_active && ` · ${hu ? "deaktiválva" : "deactivated"}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${l.approval_status === "approved" ? "bg-emerald-100 text-emerald-800" : l.approval_status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  {approvalLabels[l.approval_status] ?? l.approval_status}
                </span>
                {l.approval_status === "pending" && (
                  <>
                    <form action={review}>
                      <input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="action" value="approve" />
                      <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">{hu ? "Jóváhagy" : "Approve"}</button>
                    </form>
                    <form action={review}>
                      <input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="action" value="reject" />
                      <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">{hu ? "Elutasít" : "Reject"}</button>
                    </form>
                  </>
                )}
                {l.approval_status === "approved" && l.is_active && (
                  <form action={review}>
                    <input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="action" value="deactivate" />
                    <button className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">{hu ? "Deaktivál" : "Deactivate"}</button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
        {(links ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>

      <h2 className="mt-10 text-xl font-bold text-lagoon-950">{hu ? "Jutalékok" : "Commissions"}</h2>
      <div className="card mt-4 divide-y divide-lagoon-100">
        {(commissions ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <span className="font-semibold">{formatMoney(c.amount, c.currency, locale)}</span>
              <span className="ms-3 text-xs text-lagoon-500">
                {new Date(c.created_at).toLocaleDateString(locale)}
                {c.fraud_flag && ` · ⚑ ${c.fraud_reason}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${c.status === "paid" ? "bg-emerald-100 text-emerald-800" : c.fraud_flag ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                {commLabels[c.status] ?? c.status}
              </span>
              {!c.fraud_flag && ["pending", "approved"].includes(c.status) && (
                <form action={flagCommission} className="flex items-center gap-1">
                  <input type="hidden" name="commission_id" value={c.id} />
                  <input name="reason" required placeholder={hu ? "Indok" : "Reason"} className="input w-28 py-1 text-xs" />
                  <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">⚑</button>
                </form>
              )}
            </div>
          </div>
        ))}
        {(commissions ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
