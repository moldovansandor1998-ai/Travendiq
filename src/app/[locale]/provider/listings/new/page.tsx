export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

export default async function NewListingPage({ params, searchParams }: { params: { locale: Locale }; searchParams: { error?: string } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: provider } = await sb.from("providers").select("id, status")
    .eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  if (provider.status !== "approved") {
    const labels: Record<string, string> = locale === "hu" ? {
      incomplete: "Hiányos jelentkezés", under_review: "Ellenőrzés alatt",
      docs_required: "Dokumentumpótlás szükséges", rejected: "Elutasítva",
      suspended: "Felfüggesztve",
    } : {
      incomplete: "Incomplete application", under_review: "Under review",
      docs_required: "More documents required", rejected: "Rejected",
      suspended: "Suspended",
    };
    return (
      <div className="container-page max-w-2xl py-12">
        <h1 className="text-2xl font-bold text-lagoon-950">{t.provider.newListing}</h1>
        <div className="card mt-6 p-7">
          <span className="badge bg-amber-100 text-amber-900">{labels[provider.status] ?? provider.status}</span>
          <h2 className="mt-4 text-xl font-bold text-lagoon-950">{locale === "hu" ? "A cég jóváhagyása szükséges" : "Company approval required"}</h2>
          <p className="mt-2 text-sm leading-6 text-lagoon-700">{locale === "hu" ? "Programot csak a cégadatok és a kötelező dokumentumok sikeres ellenőrzése után tölthetsz fel. A Dokumentumok oldalon látod minden irat állapotát, az elutasítás okát, és ott pótolhatod a hiányzó fájlokat." : "You can add activities after the company details and required documents have been verified. The Documents page shows each document status, rejection reasons and missing files."}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/${locale}/provider/documents`} className="btn-primary">{locale === "hu" ? "Dokumentumok és ellenőrzés" : "Documents and verification"}</Link>
            <Link href={`/${locale}/provider/dashboard`} className="btn-secondary">{locale === "hu" ? "Vissza az áttekintéshez" : "Back to overview"}</Link>
          </div>
        </div>
      </div>
    );
  }

  const { data: categories } = await sb.from("categories").select("id, slug, translations:category_translations(locale,name)")
    .eq("is_active", true).order("sort_order");
  const { data: cities } = await sb.from("cities").select("id, name, country_code").eq("is_active", true);

  async function createListing(formData: FormData) {
    "use server";
    const sb = createClient();
    const { data: { user: actionUser } } = await sb.auth.getUser();
    if (!actionUser) redirect(`/${locale}/auth/login`);
    const title = String(formData.get("title_en") ?? "");
    const cityId = String(formData.get("city_id"));
    const city = (cities ?? []).find((c) => c.id === cityId);

    const { data: listing, error } = await sb.from("listings").insert({
      provider_id: provider!.id,
      category_id: String(formData.get("category_id")),
      city_id: cityId,
      country_code: city?.country_code ?? "EG",
      slug: `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`,
      status: "draft",
      duration_minutes: Number(formData.get("duration") ?? 0) || null,
      max_participants: Number(formData.get("max_participants") ?? 20),
      base_price_adult: Math.round(Number(formData.get("price") ?? 0) * 100),
      currency: String(formData.get("currency") ?? "EUR"),
      has_transfer: formData.get("has_transfer") === "on",
      is_family_friendly: formData.get("family") === "on",
      confirmation: formData.get("confirmation") === "manual" ? "manual" : "instant",
      meeting_point: String(formData.get("meeting_point") ?? ""),
    }).select("id").single();

    if (error || !listing) redirect(`/${locale}/provider/listings/new?error=create`);
    const { error: translationError } = await sb.from("listing_translations").insert([
        { listing_id: listing.id, locale: "en", title, description: String(formData.get("description_en") ?? "") },
        ...(String(formData.get("title_hu") ?? "")
          ? [{ listing_id: listing.id, locale: "hu", title: String(formData.get("title_hu")) }] : []),
      ]);
    if (translationError) redirect(`/${locale}/provider/listings/${listing.id}?tab=basics&error=translation`);
    redirect(`/${locale}/provider/listings/${listing.id}?created=1&tab=media`);
  }

  return (
    <div className="container-page max-w-2xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.provider.newListing}</h1>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-semibold text-lagoon-600">
        <span className="rounded-lg bg-lagoon-700 px-2 py-3 text-white">1. {locale === "hu" ? "Alapadatok" : "Basics"}</span>
        <span className="rounded-lg bg-lagoon-50 px-2 py-3">2. {locale === "hu" ? "Képek és opciók" : "Media & options"}</span>
        <span className="rounded-lg bg-lagoon-50 px-2 py-3">3. {locale === "hu" ? "Naptár és beküldés" : "Calendar & review"}</span>
      </div>
      {searchParams.error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{locale === "hu" ? "A program mentése nem sikerült. Ellenőrizd az adatokat, majd próbáld újra." : "The activity could not be saved. Check the details and try again."}</p>}
      <form action={createListing} className="card mt-6 space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">Title (EN)</label>
            <input name="title_en" required className="input" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">Cím (HU, opcionális)</label>
            <input name="title_hu" className="input" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.home.categories}</label>
            <select name="category_id" required className="input">
              {(categories ?? []).map((c) => { const trs = c.translations as { locale: string; name: string }[]; return <option key={c.id} value={c.id}>{trs?.find((x) => x.locale === locale)?.name ?? trs?.find((x) => x.locale === "en")?.name ?? c.slug}</option>; })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.provider.city}</label>
            <select name="city_id" required className="input">
              {(cities ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.search.price} (EUR/felnőtt)</label>
            <input name="price" type="number" min="0" step="0.01" required className="input" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.search.duration} (perc)</label>
            <input name="duration" type="number" min="15" required className="input" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">Max. férőhely</label>
            <input name="max_participants" type="number" min="1" defaultValue={20} className="input" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.common.currency}</label>
            <select name="currency" className="input">
              <option value="EUR">EUR</option><option value="USD">USD</option>
              <option value="HUF">HUF</option><option value="EGP">EGP</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-lagoon-700">Description (EN)</label>
          <textarea name="description_en" rows={5} required minLength={80} className="input" />
          <p className="mt-1 text-xs text-lagoon-500">{locale === "hu" ? "Legalább 80 karakter: írd le pontosan, mit él át és mit kap a vendég." : "At least 80 characters: explain exactly what the guest will experience and receive."}</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.listing.meetingPoint}</label>
          <input name="meeting_point" required className="input" />
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2 font-medium text-lagoon-700">
            <input type="checkbox" name="has_transfer" className="h-4 w-4" /> {t.search.withTransfer}
          </label>
          <label className="flex items-center gap-2 font-medium text-lagoon-700">
            <input type="checkbox" name="family" className="h-4 w-4" /> {t.search.family}
          </label>
          <label className="flex items-center gap-2 font-medium text-lagoon-700">
            <input type="radio" name="confirmation" value="instant" defaultChecked /> {t.search.instant}
          </label>
          <label className="flex items-center gap-2 font-medium text-lagoon-700">
            <input type="radio" name="confirmation" value="manual" /> {t.listing.manualConfirmation}
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-lagoon-100 pt-4">
          <p className="text-xs text-lagoon-500">{locale === "hu" ? "Piszkozatként mentjük. A program csak ellenőrzés és jóváhagyás után jelenik meg." : "Saved as a draft. It only becomes public after review and approval."}</p>
          <button className="btn-primary" type="submit">{locale === "hu" ? "Mentés és tovább a képekhez" : "Save and add photos"}</button>
        </div>
      </form>
    </div>
  );
}
