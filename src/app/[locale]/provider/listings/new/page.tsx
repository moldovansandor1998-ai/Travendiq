export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

export default async function NewListingPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: provider } = await sb.from("providers").select("id, status")
    .eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const { data: categories } = await sb.from("categories").select("id, slug")
    .eq("is_active", true).order("sort_order");
  const { data: cities } = await sb.from("cities").select("id, name, country_code").eq("is_active", true);

  async function createListing(formData: FormData) {
    "use server";
    const sb = createClient();
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

    if (!error && listing) {
      await sb.from("listing_translations").insert([
        { listing_id: listing.id, locale: "en", title, description: String(formData.get("description_en") ?? "") },
        ...(String(formData.get("title_hu") ?? "")
          ? [{ listing_id: listing.id, locale: "hu", title: String(formData.get("title_hu")) }] : []),
      ]);
      // alap elérhetőség: következő 60 nap
      const days = Array.from({ length: 60 }, (_, i) => {
        const d = new Date(Date.now() + (i + 1) * 86400000);
        return {
          listing_id: listing.id, date: d.toISOString().slice(0, 10),
          start_time: "09:00", capacity: Number(formData.get("max_participants") ?? 20),
        };
      });
      await sb.from("availability").insert(days);
    }
    redirect(`/${locale}/provider/dashboard`);
  }

  return (
    <div className="container-page max-w-2xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.provider.newListing}</h1>
      {provider.status !== "approved" && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t.provider.pendingReview}
        </p>
      )}
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
              {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.slug}</option>)}
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
            <input name="duration" type="number" min="0" className="input" />
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
          <textarea name="description_en" rows={5} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.listing.meetingPoint}</label>
          <input name="meeting_point" className="input" />
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
        <button className="btn-primary" type="submit">{t.common.save}</button>
      </form>
    </div>
  );
}
