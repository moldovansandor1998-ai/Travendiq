export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export default async function ProviderRegisterPage(
  props: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ error?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  if (user) {
    const { data: existing } = await sb.from("providers").select("id").eq("owner_id", user.id).limit(1).maybeSingle();
    if (existing) redirect(`/${locale}/provider/dashboard`);
  }

  async function register(formData: FormData) {
    "use server";
    const sb = await createClient();
    const { data: { user: u } } = await sb.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);

    // A session kliens csak a személyazonosság ellenőrzésére szolgál. A profil
    // létrehozása szerveroldali művelet, mert az RLS alól még nem olvasható a
    // felhasználóhoz tartozó szolgáltató a létrehozás pillanatában.
    const svc = createServiceClient();
    const taxId = String(formData.get("tax_id") ?? "").trim();
    const phone = String(formData.get("contact_phone") ?? "").trim();
    if (!taxId || !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      redirect(`/${locale}/provider/register?error=validation`);
    }
    const payload = {
      owner_id: u.id,
      legal_name: String(formData.get("legal_name")),
      display_name: String(formData.get("display_name")),
      is_company: true,
      country_code: String(formData.get("country")),
      city: String(formData.get("city") ?? ""),
      address: String(formData.get("address") ?? ""),
      tax_id: taxId,
      contact_name: String(formData.get("contact_name") ?? ""),
      contact_email: String(formData.get("contact_email") ?? ""),
      contact_phone: phone,
      status: "under_review",
    } as const;
    const { data: existing } = await svc.from("providers").select("id").eq("owner_id", u.id).maybeSingle();
    const result = existing
      ? await svc.from("providers").update(payload).eq("id", existing.id).eq("owner_id", u.id).select("id").single()
      : await svc.from("providers").insert(payload).select("id").single();
    const { data: provider, error } = result;

    if (error || !provider) {
      console.error("[provider/register] save failed:", error?.message ?? "missing provider");
      redirect(`/${locale}/provider/register?error=save`);
    }

    const { error: roleError } = await svc.from("user_roles").upsert({ user_id: u.id, role: "provider" });
    if (roleError) console.error("[provider/register] role failed:", roleError.message);
    await svc.from("audit_log").insert({
      actor_id: u.id, actor_role: "provider",
      action: "provider.registered", entity: "providers", entity_id: provider.id,
    });
    redirect(`/${locale}/provider/dashboard`);
  }

  if (!user) {
    return (
      <div className="container-page max-w-md py-16 text-center">
        <h1 className="text-3xl font-bold text-lagoon-950">{locale === "hu" ? "Szolgáltatói regisztráció" : "Provider registration"}</h1>
        <p className="mt-3 text-lagoon-700">{locale === "hu" ? "Új partnerként először hozz létre egy céges partnerfiókot. Ha már regisztráltál, jelentkezz be." : "New partners should create a company partner account first. If you already registered, sign in."}</p>
        <div className="mt-6 grid gap-3"><a href={`/${locale}/auth/register`} className="btn-primary">{locale === "hu" ? "Új partnerfiók regisztrációja" : "Register a new partner account"}</a><a href={`/${locale}/auth/login`} className="btn-secondary">{locale === "hu" ? "Már van fiókom – bejelentkezés" : "I already have an account – sign in"}</a></div>
      </div>
    );
  }

  return (
    <div className="container-page max-w-2xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.provider.register}</h1>
      {searchParams.error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{searchParams.error === "validation" ? "Az adószám kötelező, a telefonszámot pedig nemzetközi formátumban add meg (például +36301234567)." : "A szolgáltatói adatok mentése nem sikerült. Ellenőrizd a mezőket, majd próbáld újra."}</p>}
      <form action={register} className="card mt-6 space-y-4 p-6">
        <p className="rounded-xl bg-lagoon-50 p-3 text-sm font-medium text-lagoon-800">{locale === "hu" ? "A Travendiq szolgáltatói felületére kizárólag bejegyzett vállalkozások jelentkezhetnek." : "Only registered businesses can apply as Travendiq providers."}</p>
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
          <Field label={`${t.provider.taxId} *`} name="tax_id" required />
          <Field label={t.provider.contactName} name="contact_name" required />
          <Field label={t.provider.contactEmail} name="contact_email" type="email" required />
          <Field label={locale === "hu" ? "Telefon / WhatsApp *" : "Phone / WhatsApp *"} name="contact_phone" type="tel" required placeholder="+36301234567" />
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

function Field({ label, name, type = "text", required = false, placeholder }: {
  label: string; name: string; type?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} placeholder={placeholder} className="input" />
    </div>
  );
}
