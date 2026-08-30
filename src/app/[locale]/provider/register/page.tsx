export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export default async function ProviderRegisterPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();

  async function register(formData: FormData) {
    "use server";
    const sb = createClient();
    const { data: { user: u } } = await sb.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);

    const { data: provider, error } = await sb.from("providers").insert({
      owner_id: u.id,
      legal_name: String(formData.get("legal_name")),
      display_name: String(formData.get("display_name")),
      is_company: formData.get("kind") === "company",
      country_code: String(formData.get("country")),
      city: String(formData.get("city") ?? ""),
      address: String(formData.get("address") ?? ""),
      tax_id: String(formData.get("tax_id") ?? ""),
      contact_name: String(formData.get("contact_name") ?? ""),
      contact_email: String(formData.get("contact_email") ?? ""),
      contact_phone: String(formData.get("contact_phone") ?? ""),
      status: "under_review",
    }).select("id").single();

    if (!error && provider) {
      await sb.from("user_roles").upsert({ user_id: u.id, role: "provider" });
      await sb.from("audit_log").insert({
        actor_id: u.id, actor_role: "provider",
        action: "provider.registered", entity: "providers", entity_id: provider.id,
      });
    }
    redirect(`/${locale}/provider/dashboard`);
  }

  if (!user) {
    return (
      <div className="container-page max-w-md py-16 text-center">
        <p className="text-lagoon-700">{t.provider.register}</p>
        <a href={`/${locale}/auth/login`} className="btn-primary mt-4 inline-flex">{t.nav.signIn}</a>
      </div>
    );
  }

  return (
    <div className="container-page max-w-2xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.provider.register}</h1>
      <form action={register} className="card mt-6 space-y-4 p-6">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 font-medium text-lagoon-700">
            <input type="radio" name="kind" value="company" defaultChecked /> {t.provider.company}
          </label>
          <label className="flex items-center gap-2 font-medium text-lagoon-700">
            <input type="radio" name="kind" value="individual" /> {t.provider.individual}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.provider.legalName} name="legal_name" required />
          <Field label={t.provider.displayName} name="display_name" required />
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.provider.country}</label>
            <select name="country" className="input" required>
              <option value="EG">Egypt</option><option value="HU">Hungary</option>
              <option value="DE">Germany</option><option value="AT">Austria</option>
              <option value="FR">France</option><option value="ES">Spain</option>
              <option value="IT">Italy</option><option value="RO">Romania</option>
              <option value="PL">Poland</option><option value="AE">UAE</option>
              <option value="GB">United Kingdom</option><option value="US">United States</option>
            </select>
          </div>
          <Field label={t.provider.city} name="city" />
          <Field label={t.provider.address} name="address" />
          <Field label={t.provider.taxId} name="tax_id" />
          <Field label={t.provider.contactName} name="contact_name" required />
          <Field label={t.provider.contactEmail} name="contact_email" type="email" required />
          <Field label={t.provider.contactPhone} name="contact_phone" type="tel" />
        </div>
        <p className="text-xs leading-relaxed text-lagoon-500">
          A regisztráció után KYC-dokumentumok (személyi/cégirat, engedélyek, biztosítás)
          feltöltése szükséges. Jóváhagyás nélkül fizetős program nem publikálható.
        </p>
        <button className="btn-primary" type="submit">{t.provider.submit}</button>
      </form>
    </div>
  );
}

function Field({ label, name, type = "text", required = false }: {
  label: string; name: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} className="input" />
    </div>
  );
}
