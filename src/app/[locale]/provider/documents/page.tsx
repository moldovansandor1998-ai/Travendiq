export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, type Locale } from "@/lib/i18n";
import { DocUploader } from "./DocUploader";
import { createServiceClient } from "@/lib/supabase/server";

const AGREEMENT_VERSION = "2026-08-30-v1";

export default async function ProviderDocuments({ params, searchParams }: { params: { locale: Locale }; searchParams: { error?: string; uploaded?: string; saved?: string } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const pdoc = t.providerDocuments as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers").select("id, status").eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);
  const providerId = provider.id;

  const { data: docs } = await sb.from("provider_documents")
    .select("id, kind, file_path, expires_at, status, note, created_at")
    .eq("provider_id", providerId).order("created_at", { ascending: false });
  const svc = createServiceClient();
  const [{ data: payout }, { data: agreement }] = await Promise.all([
    svc.from("provider_payout_accounts").select("account_holder_name, bank_name, iban, swift_bic, currency, bank_country_code").eq("provider_id", providerId).maybeSingle(),
    svc.from("provider_agreements").select("accepted_name").eq("provider_id", providerId).eq("agreement_key", "provider-terms").eq("agreement_version", AGREEMENT_VERSION).maybeSingle(),
  ]);

  const kindLabels: Record<string, string> = {
    id_card: locale === "hu" ? "Tulajdonos/képviselő személyazonosítója" : "Owner/representative ID", company_reg: pdoc.kind_company_reg,
    license: pdoc.kind_license, insurance: pdoc.kind_insurance,
    bank_statement: locale === "hu" ? "Bankszámla-igazolás" : "Bank account statement",
  };
  const statusLabels: Record<string, string> = {
    uploaded: pdoc.st_uploaded, verified: pdoc.st_verified, rejected: pdoc.st_rejected,
  };

  const today = new Date().toISOString().slice(0, 10);
  const requiredKinds = ["company_reg", "id_card", "bank_statement"];
  const documentRows = docs ?? [];

  async function saveVerification(formData: FormData) {
    "use server";
    const session = createClient();
    const { data: { user: u } } = await session.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const service = createServiceClient();
    const { data: owned } = await service.from("providers").select("id").eq("id", providerId).eq("owner_id", u.id).maybeSingle();
    if (!owned) redirect(`/${locale}/provider/register`);
    const accountHolder = String(formData.get("account_holder_name") ?? "").trim();
    const bankName = String(formData.get("bank_name") ?? "").trim();
    const iban = String(formData.get("iban") ?? "").replace(/\s+/g, "").toUpperCase();
    const swift = String(formData.get("swift_bic") ?? "").replace(/\s+/g, "").toUpperCase();
    const currency = String(formData.get("currency") ?? "EUR").trim().toUpperCase();
    const country = String(formData.get("bank_country_code") ?? "").trim().toUpperCase();
    const acceptedName = String(formData.get("accepted_name") ?? "").trim();
    if (!accountHolder || !bankName || !/^[A-Z]{2}[A-Z0-9]{13,32}$/.test(iban) || !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swift) || !/^[A-Z]{3}$/.test(currency) || !/^[A-Z]{2}$/.test(country) || !acceptedName || formData.get("accept_terms") !== "on") redirect(`/${locale}/provider/documents?error=verification`);
    const { error: payoutError } = await service.from("provider_payout_accounts").upsert({ provider_id: providerId, account_holder_name: accountHolder, bank_name: bankName, iban, swift_bic: swift, currency, bank_country_code: country, updated_at: new Date().toISOString() });
    const { error: agreementError } = await service.from("provider_agreements").upsert({ provider_id: providerId, agreement_key: "provider-terms", agreement_version: AGREEMENT_VERSION, accepted_by: u.id, accepted_name: acceptedName, accepted_at: new Date().toISOString() });
    if (payoutError || agreementError) redirect(`/${locale}/provider/documents?error=verification`);
    redirect(`/${locale}/provider/documents?saved=1`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{pdoc.title}</h1>
      <p className="mt-2 text-sm text-lagoon-600">{pdoc.subtitle}</p>
      <div className="card mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold text-lagoon-950">{locale === "hu" ? "Cégellenőrzés állapota" : "Company verification status"}</p><p className="mt-1 text-sm text-lagoon-600">{locale === "hu" ? "A kötelező iratok ellenőrzése után az adminisztrátor hagyja jóvá a céget." : "An administrator approves the company after all required documents are verified."}</p></div>
          <span className={`badge ${provider.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{provider.status === "approved" ? (locale === "hu" ? "Jóváhagyva" : "Approved") : (locale === "hu" ? "Ellenőrzés alatt" : "Under review")}</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {requiredKinds.map((kind) => {
            const rows = documentRows.filter((d) => d.kind === kind);
            const verified = rows.some((d) => d.status === "verified");
            const uploaded = rows.some((d) => d.status === "uploaded");
            const rejected = rows.find((d) => d.status === "rejected");
            return <div key={kind} className="flex items-center justify-between rounded-lg border border-lagoon-100 px-3 py-2 text-sm"><span>{kindLabels[kind]}</span><span className={`badge ${verified ? "bg-emerald-100 text-emerald-800" : uploaded ? "bg-amber-100 text-amber-800" : rejected ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>{verified ? (locale === "hu" ? "Ellenőrzött" : "Verified") : uploaded ? (locale === "hu" ? "Ellenőrzés alatt" : "In review") : rejected ? (locale === "hu" ? "Pótlás szükséges" : "Resubmit") : (locale === "hu" ? "Hiányzik" : "Missing")}</span></div>;
          })}
        </div>
      </div>
      {searchParams.uploaded === "1" && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{locale === "hu" ? "A dokumentum feltöltve, ellenőrzésre vár." : "Document uploaded and awaiting review."}</p>}
      {searchParams.error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{searchParams.error === "verification" ? (locale === "hu" ? "Tölts ki minden banki mezőt helyes formátumban, és fogadd el a szolgáltatói szerződést." : "Complete all bank fields correctly and accept the provider agreement.") : (locale === "hu" ? "A feltöltés nem sikerült. PDF, JPG, PNG vagy WEBP fájlt válassz, legfeljebb 15 MB méretben." : "Upload failed. Choose a PDF, JPG, PNG or WEBP file up to 15 MB.")}</p>}
      {searchParams.saved === "1" && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{locale === "hu" ? "A kifizetési adatok és a szerződés elfogadása elmentve." : "Payout details and agreement acceptance saved."}</p>}

      <div className="card mt-6 p-5">
        <DocUploader providerId={providerId}
          kinds={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))}
          labels={{
            kind: pdoc.kindLabel,
            expires: pdoc.expiresOptional,
            upload: pdoc.upload,
            uploading: pdoc.uploading,
          }} />
      </div>

      <form action={saveVerification} className="card mt-6 p-5">
        <h2 className="text-lg font-semibold text-lagoon-950">{locale === "hu" ? "Kifizetési bankszámla" : "Payout bank account"}</h2>
        <p className="mt-1 text-sm text-lagoon-600">{locale === "hu" ? "A számlatulajdonos nevének egyeznie kell a feltöltött bankszámla-igazolással." : "The account holder must match the uploaded bank account document."}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <BankField name="account_holder_name" label={locale === "hu" ? "Számlatulajdonos neve" : "Account holder name"} value={payout?.account_holder_name} />
          <BankField name="bank_name" label={locale === "hu" ? "Bank neve" : "Bank name"} value={payout?.bank_name} />
          <BankField name="iban" label="IBAN" value={payout?.iban} placeholder="HU42117730161111101800000000" />
          <BankField name="swift_bic" label="BIC / SWIFT" value={payout?.swift_bic} placeholder="OTPVHUHB" />
          <BankField name="currency" label={locale === "hu" ? "Kifizetés pénzneme" : "Payout currency"} value={payout?.currency ?? "EUR"} placeholder="EUR" />
          <BankField name="bank_country_code" label={locale === "hu" ? "Bank országkódja" : "Bank country code"} value={payout?.bank_country_code} placeholder="HU" />
        </div>
        <div className="mt-6 rounded-xl border border-lagoon-200 bg-lagoon-50 p-4">
          <h3 className="font-semibold text-lagoon-950">{locale === "hu" ? "Szolgáltatói szerződés" : "Provider agreement"}</h3>
          <p className="mt-1 text-sm text-lagoon-700"><a className="font-semibold underline" href={`/${locale}/legal/provider-terms`} target="_blank" rel="noopener noreferrer">{locale === "hu" ? "Szerződés megnyitása és elolvasása" : "Open and read the agreement"}</a></p>
          <BankField name="accepted_name" label={locale === "hu" ? "Elfogadó képviselő teljes neve" : "Full name of authorised signatory"} value={agreement?.accepted_name} />
          <label className="mt-3 flex items-start gap-2 text-sm text-lagoon-800"><input type="checkbox" name="accept_terms" required defaultChecked={!!agreement} className="mt-1" /><span>{locale === "hu" ? `Jogosult vagyok a vállalkozás képviseletére, és elfogadom a Szolgáltatói feltételeket (${AGREEMENT_VERSION}).` : `I am authorised to represent the business and accept the Provider Terms (${AGREEMENT_VERSION}).`}</span></label>
        </div>
        <button type="submit" className="btn-primary mt-5">{locale === "hu" ? "Adatok és elfogadás mentése" : "Save details and acceptance"}</button>
      </form>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {documentRows.map((d) => {
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
        {documentRows.length === 0 && (
          <div className="p-5 text-sm text-lagoon-700">
            <p className="font-semibold text-lagoon-900">{locale === "hu" ? "Még nincs feltöltött dokumentum." : "No documents uploaded yet."}</p>
            <p className="mt-1">{locale === "hu" ? "A fenti űrlapon válaszd ki a dokumentum típusát, majd töltsd fel ellenőrzésre." : "Choose a document type above, then upload the file for review."}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function BankField({ name, label, value, placeholder }: { name: string; label: string; value?: string | null; placeholder?: string }) {
  return <label className="mt-3 block text-sm text-lagoon-800">{label}<input name={name} defaultValue={value ?? ""} placeholder={placeholder} required className="input mt-1" /></label>;
}
