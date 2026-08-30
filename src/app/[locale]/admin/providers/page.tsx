export const dynamic = "force-dynamic";
import Image from "next/image";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { requireAdmin, audit } from "@/lib/admin";
import { sendEmail } from "@/lib/email";

const REQUIRED = ["company_reg", "id_card", "bank_statement"];
const labels: Record<string, [string, string]> = {
  company_reg: ["Cégkivonat", "Company registration"],
  id_card: ["Tulajdonos/képviselő személyazonosítója", "Owner/representative ID"],
  bank_statement: ["Bankszámla-igazolás", "Bank account statement"],
};

export default async function AdminProvidersPage({ params, searchParams }: {
  params: { locale: Locale }; searchParams: { error?: string };
}) {
  const { locale } = params;
  const hu = locale === "hu";
  const t = getDictionary(locale);
  const { svc } = await requireAdmin(locale);
  const { data: providers } = await svc.from("providers")
    .select("id,legal_name,display_name,country_code,city,status,review_note,contact_email,contact_name,contact_phone,tax_id")
    .in("status", ["under_review", "docs_required", "incomplete", "rejected"]).order("created_at");
  const ids = (providers ?? []).map((p) => p.id);
  const [{ data: docs }, { data: payouts }, { data: agreements }] = ids.length ? await Promise.all([
    svc.from("provider_documents").select("id,provider_id,kind,file_path,status,note,created_at").in("provider_id", ids).order("created_at", { ascending: false }),
    svc.from("provider_payout_accounts").select("provider_id,account_holder_name,bank_name,iban,swift_bic,currency,bank_country_code").in("provider_id", ids),
    svc.from("provider_agreements").select("provider_id,agreement_version,accepted_name,accepted_at").in("provider_id", ids).eq("agreement_key", "provider-terms"),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];

  const signed = new Map<string, string>();
  await Promise.all((docs ?? []).map(async (d) => {
    const { data } = await svc.storage.from("provider-docs").createSignedUrl(d.file_path, 900);
    if (data?.signedUrl) signed.set(d.id, data.signedUrl);
  }));

  async function reviewProvider(formData: FormData) {
    "use server";
    const { user, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("id") ?? "");
    const action = String(formData.get("action") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    const status = action === "approve" ? "approved" : action === "docs" ? "docs_required" : "rejected";
    if (status !== "approved" && !reason) throw new Error("reason required");
    if (status === "approved") {
      const [{ data: verified }, { data: payout }, { data: agreement }] = await Promise.all([
        s.from("provider_documents").select("kind").eq("provider_id", id).eq("status", "verified"),
        s.from("provider_payout_accounts").select("provider_id").eq("provider_id", id).maybeSingle(),
        s.from("provider_agreements").select("provider_id").eq("provider_id", id).eq("agreement_key", "provider-terms").eq("agreement_version", "2026-08-30-v1").maybeSingle(),
      ]);
      const kinds = new Set((verified ?? []).map((d) => d.kind));
      if (REQUIRED.some((kind) => !kinds.has(kind)) || !payout || !agreement) redirect(`/${locale}/admin/providers?error=documents`);
    }
    const { data: provider } = await s.from("providers").select("contact_email,display_name").eq("id", id).single();
    await s.from("providers").update({ status, review_note: reason || null, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", id);
    await audit(s, { actorId: user.id, action: `provider.${status}`, entity: "providers", entityId: id, diff: reason ? { reason } : undefined });
    if (provider?.contact_email) {
      const result = await sendEmail({
        to: provider.contact_email,
        template: status === "approved" ? "provider_approved" : status === "docs_required" ? "provider_docs_required" : "provider_rejected",
        locale,
        vars: { name: provider.display_name, reason, missingDocs: reason, link: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.travendiq.com"}/${locale}/provider/documents` },
      });
      if (!result.ok) redirect(`/${locale}/admin/providers?error=email`);
    }
    revalidatePath(`/${locale}/admin/providers`);
  }

  async function reviewDocument(formData: FormData) {
    "use server";
    const { user, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("doc_id") ?? "");
    const providerId = String(formData.get("provider_id") ?? "");
    const action = String(formData.get("action") ?? "");
    const note = String(formData.get("note") ?? "").trim() || null;
    if (!id || !providerId || !["verify", "reject"].includes(action)) throw new Error("invalid action");
    await s.from("provider_documents").update({
      status: action === "verify" ? "verified" : "rejected", note,
      reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).eq("id", id).eq("provider_id", providerId);
    await audit(s, { actorId: user.id, action: `kyc.${action}`, entity: "provider_documents", entityId: id });
    if (action === "reject") {
      const { data: provider } = await s.from("providers").select("contact_email,display_name").eq("id", providerId).single();
      if (provider?.contact_email) await sendEmail({
        to: provider.contact_email, template: "provider_docs_required", locale,
        vars: { name: provider.display_name, missingDocs: note ?? (hu ? "A beküldött dokumentum nem fogadható el." : "The submitted document could not be accepted."), link: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.travendiq.com"}/${locale}/provider/documents` },
      });
    }
    revalidatePath(`/${locale}/admin/providers`);
  }

  return <div className="container-page py-10">
    <h1 className="text-2xl font-bold text-lagoon-950">{t.admin.pendingProviders}</h1>
    {searchParams.error === "documents" && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{hu ? "Jóváhagyás előtt mindhárom dokumentumot ellenőrizni kell, továbbá szükséges a bankszámla és a szerződés elfogadása." : "Verify all three documents and confirm payout details and agreement before approval."}</p>}
    {searchParams.error === "email" && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{hu ? "Az állapot elmentve, de az értesítő email küldése nem sikerült." : "Status saved, but the notification email could not be sent."}</p>}
    <div className="mt-6 space-y-6">
      {(providers ?? []).map((p) => {
        const providerDocs = (docs ?? []).filter((d) => d.provider_id === p.id);
        const payout = (payouts ?? []).find((row) => row.provider_id === p.id);
        const agreement = (agreements ?? []).find((row) => row.provider_id === p.id);
        const documentIssues = REQUIRED.filter((kind) => providerDocs.find((d) => d.kind === kind)?.status !== "verified").length;
        const issueCount = documentIssues + (payout ? 0 : 1) + (agreement ? 0 : 1);
        return <details key={p.id} className="group card overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 hover:bg-lagoon-50 sm:px-5">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-black ${issueCount ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{issueCount ? "!" : "✓"}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-bold text-lagoon-950">{p.display_name}</h2><span className="hidden truncate text-sm text-lagoon-500 sm:inline">{p.legal_name}</span></div>
              <p className="truncate text-xs text-lagoon-600">{p.country_code} · {p.city} · {p.contact_email}</p>
            </div>
            <span className={`badge shrink-0 ${issueCount ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{issueCount ? (hu ? `${issueCount} teendő` : `${issueCount} actions`) : (hu ? "Nincs teendő" : "No action")}</span>
            <span className="text-xl text-lagoon-500 transition group-open:rotate-45">＋</span>
          </summary>
          <div className="border-t border-lagoon-100">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-lagoon-100 p-5">
            <div>
              <h2 className="text-lg font-bold text-lagoon-950">{p.display_name} <span className="font-normal text-lagoon-500">({p.legal_name})</span></h2>
              <p className="mt-1 text-sm text-lagoon-700">{p.country_code} · {p.city} · {p.contact_email} · {p.contact_phone}</p>
              <p className="mt-1 text-xs text-lagoon-500">{hu ? "Kapcsolattartó" : "Contact"}: {p.contact_name} · {hu ? "Adószám" : "Tax ID"}: {p.tax_id} · {p.status}</p>
              {p.review_note && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-800">{hu ? "Admin megjegyzés" : "Admin note"}: {p.review_note}</p>}
            </div>
            <div className="flex max-w-xl flex-wrap justify-end gap-2">
            <form action={reviewProvider}>
              <input type="hidden" name="id" value={p.id}/>
              <button name="action" value="approve" className="btn-primary px-4 py-2">{t.admin.approve}</button>
            </form>
            <form action={reviewProvider} className="flex flex-wrap justify-end gap-2">
              <input type="hidden" name="id" value={p.id}/>
              <input name="reason" required defaultValue={p.review_note ?? ""} placeholder={hu ? "Megjegyzés / elutasítás oka" : "Note / rejection reason"} className="input min-w-64 py-2 text-sm"/>
              <button name="action" value="docs" className="btn-secondary px-4 py-2">{hu ? "Pótlás kérése" : "Request documents"}</button>
              <button name="action" value="reject" className="btn-secondary px-4 py-2 text-red-700">{t.admin.reject}</button>
            </form>
            </div>
          </div>
          <div className="grid gap-4 p-5 lg:grid-cols-3">
            {REQUIRED.map((kind) => {
              const doc = providerDocs.find((d) => d.kind === kind);
              const url = doc ? signed.get(doc.id) : undefined;
              return <article key={kind} className="rounded-xl border border-lagoon-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-lagoon-950">{labels[kind][hu ? 0 : 1]}</h3>
                  <span className={`badge ${doc?.status === "verified" ? "bg-emerald-100 text-emerald-800" : doc?.status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{doc?.status ?? (hu ? "hiányzik" : "missing")}</span>
                </div>
                {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 block overflow-hidden rounded-lg border border-lagoon-100 bg-slate-50">
                  <Image src={url} alt={labels[kind][hu ? 0 : 1]} width={640} height={420} unoptimized className="h-40 w-full object-contain"/>
                  <span className="block border-t border-lagoon-100 p-2 text-center text-xs font-semibold text-lagoon-700 underline">{hu ? "Teljes méret megnyitása" : "Open full size"}</span>
                </a> : <p className="mt-3 rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-500">{hu ? "Nincs feltöltve" : "Not uploaded"}</p>}
                {doc && <div className="mt-3 space-y-2">
                  <form action={reviewDocument}><input type="hidden" name="doc_id" value={doc.id}/><input type="hidden" name="provider_id" value={p.id}/><button name="action" value="verify" className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">{hu ? "Dokumentum elfogadása" : "Verify document"}</button></form>
                  <form action={reviewDocument} className="flex gap-1"><input type="hidden" name="doc_id" value={doc.id}/><input type="hidden" name="provider_id" value={p.id}/><input name="note" required placeholder={hu ? "Elutasítás oka" : "Rejection reason"} className="input min-w-0 flex-1 py-1 text-xs"/><button name="action" value="reject" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white">{hu ? "Elutasít" : "Reject"}</button></form>
                </div>}
              </article>;
            })}
          </div>
          <div className="grid gap-4 border-t border-lagoon-100 bg-lagoon-50/40 p-5 md:grid-cols-2">
            <div><h3 className="text-sm font-semibold text-lagoon-950">{hu ? "Kifizetési bankszámla" : "Payout bank account"}</h3>{payout ? <dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-lagoon-700"><dt>{hu ? "Tulajdonos" : "Holder"}</dt><dd>{payout.account_holder_name}</dd><dt>Bank</dt><dd>{payout.bank_name}</dd><dt>IBAN</dt><dd className="break-all font-mono">{payout.iban}</dd><dt>SWIFT/BIC</dt><dd className="font-mono">{payout.swift_bic}</dd><dt>{hu ? "Pénznem" : "Currency"}</dt><dd>{payout.currency} · {payout.bank_country_code}</dd></dl> : <p className="mt-2 text-xs font-semibold text-amber-700">{hu ? "Még nincs elmentve." : "Not saved yet."}</p>}</div>
            <div><h3 className="text-sm font-semibold text-lagoon-950">{hu ? "Szolgáltatói szerződés" : "Provider agreement"}</h3>{agreement ? <p className="mt-2 text-xs text-lagoon-700">{agreement.accepted_name} · {agreement.agreement_version} · {new Date(agreement.accepted_at).toLocaleString(locale)}</p> : <p className="mt-2 text-xs font-semibold text-amber-700">{hu ? "Még nincs elfogadva." : "Not accepted yet."}</p>}</div>
          </div>
          </div>
        </details>;
      })}
      {(providers ?? []).length === 0 && <div className="card p-6 text-sm text-lagoon-500">–</div>}
    </div>
  </div>;
}
