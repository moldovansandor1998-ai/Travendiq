export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, type Locale } from "@/lib/i18n";
import { DocUploader } from "./DocUploader";

export default async function ProviderDocuments({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const pdoc = t.providerDocuments as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers").select("id, status").eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const { data: docs } = await sb.from("provider_documents")
    .select("id, kind, file_path, expires_at, status, note, created_at")
    .eq("provider_id", provider.id).order("created_at", { ascending: false });

  const kindLabels: Record<string, string> = {
    id_card: pdoc.kind_id_card, company_reg: pdoc.kind_company_reg,
    license: pdoc.kind_license, insurance: pdoc.kind_insurance, tax: pdoc.kind_tax,
  };
  const statusLabels: Record<string, string> = {
    uploaded: pdoc.st_uploaded, verified: pdoc.st_verified, rejected: pdoc.st_rejected,
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{pdoc.title}</h1>
      <p className="mt-2 text-sm text-lagoon-600">{pdoc.subtitle}</p>

      <div className="card mt-6 p-5">
        <DocUploader providerId={provider.id}
          kinds={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))}
          labels={{
            kind: pdoc.kindLabel,
            expires: pdoc.expiresOptional,
            upload: pdoc.upload,
            uploading: pdoc.uploading,
          }} />
      </div>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(docs ?? []).map((d) => {
          const expired = d.expires_at && d.expires_at < today;
          return (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium text-lagoon-900">{kindLabels[d.kind] ?? d.kind}</p>
                <p className="text-xs text-lagoon-500">
                  {new Date(d.created_at).toLocaleDateString(locale)}
                  {d.expires_at && ` · ${pdoc.expires}: ${d.expires_at}`}
                  {expired && <span className="ms-2 font-semibold text-red-700">{pdoc.expired}</span>}
                  {d.note && ` · ${d.note}`}
                </p>
              </div>
              <span className={`badge ${d.status === "verified" ? "bg-emerald-100 text-emerald-800" : d.status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                {statusLabels[d.status] ?? d.status}
              </span>
            </div>
          );
        })}
        {(docs ?? []).length === 0 && (
          <div className="p-5 text-sm text-lagoon-700">
            <p className="font-semibold text-lagoon-900">{locale === "hu" ? "Még nincs feltöltött dokumentum." : "No documents uploaded yet."}</p>
            <p className="mt-1">{locale === "hu" ? "A fenti űrlapon válaszd ki a dokumentum típusát, majd töltsd fel ellenőrzésre." : "Choose a document type above, then upload the file for review."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
