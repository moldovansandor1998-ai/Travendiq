export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, audit } from "@/lib/admin";

export default async function AdminProvidersPage({ params, searchParams }: { params: { locale: Locale }; searchParams: { error?: string } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect(`/${locale}`);

  const { data: pending } = await sb.from("providers")
    .select("id, legal_name, display_name, country_code, city, status, created_at, contact_email")
    .in("status", ["under_review", "docs_required", "incomplete"])
    .order("created_at");

  async function review(formData: FormData) {
    "use server";
    const { user: u, svc } = await requireAdmin(locale);
    const id = String(formData.get("id"));
    const action = String(formData.get("action"));
    const status = action === "approve" ? "approved" : action === "docs" ? "docs_required" : "rejected";
    if (status === "approved") {
      const required = new Set(["company_reg", "id_card", "bank_statement"]);
      const [{ data: verified }, { data: payout }, { data: agreement }] = await Promise.all([
        svc.from("provider_documents").select("kind").eq("provider_id", id).eq("status", "verified"),
        svc.from("provider_payout_accounts").select("provider_id").eq("provider_id", id).maybeSingle(),
        svc.from("provider_agreements").select("provider_id").eq("provider_id", id).eq("agreement_key", "provider-terms").eq("agreement_version", "2026-08-30-v1").maybeSingle(),
      ]);
      for (const d of verified ?? []) required.delete(d.kind);
      if (required.size > 0 || !payout || !agreement) redirect(`/${locale}/admin/providers?error=documents`);
    }
    await svc.from("providers").update({
      status, reviewed_by: u?.id, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    await audit(svc, { actorId: u.id, action: `provider.${status}`, entity: "providers", entityId: id });
    redirect(`/${locale}/admin/providers`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.admin.pendingProviders}</h1>
      {searchParams.error === "documents" && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{locale === "hu" ? "A jóváhagyáshoz ellenőrzött cégkivonat, képviselői személyazonosító és bankszámla-igazolás, továbbá elmentett bankszámlaadatok és szerződéselfogadás szükséges." : "Approval requires verified registration, representative ID and bank documents, saved payout details and acceptance of the Provider Terms."}</p>}
      <div className="card mt-6 divide-y divide-lagoon-100">
        {(pending ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-4 p-4 text-sm">
            <div>
              <p className="font-semibold text-lagoon-900">{p.display_name} <span className="text-lagoon-400">({p.legal_name})</span></p>
              <p className="text-lagoon-600">{p.country_code} · {p.city} · {p.contact_email} · {p.status}</p>
            </div>
            <form action={review} className="flex gap-2">
              <input type="hidden" name="id" value={p.id} />
              <button name="action" value="approve" className="btn-primary px-4 py-2">{t.admin.approve}</button>
              <button name="action" value="docs" className="btn-secondary px-4 py-2">Docs</button>
              <button name="action" value="reject" className="btn-secondary px-4 py-2 text-red-700">{t.admin.reject}</button>
            </form>
          </div>
        ))}
        {(pending ?? []).length === 0 && <p className="p-6 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
