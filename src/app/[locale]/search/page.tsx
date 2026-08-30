export const dynamic = "force-dynamic";

import { getDictionary, type Locale } from "@/lib/i18n";
import { queryListings, getCategories } from "@/lib/data";
import { ListingCard } from "@/components/ListingCard";
import { MapView } from "@/components/MapView";

type SP = Record<string, string | string[] | undefined>;

const LANGUAGES = ["en", "hu", "de", "fr", "es", "it", "ro", "pl", "ar"];

export default async function SearchPage({
  params, searchParams,
}: { params: { locale: Locale }; searchParams: SP }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const sort = (get("sort") ?? "popularity") as "popularity" | "price_asc" | "price_desc" | "rating" | "recommended";
  const view = get("view") === "map" ? "map" : "list";

  const [results, categories] = await Promise.all([
    queryListings({
      locale,
      citySlug: get("city"),
      categorySlug: get("category"),
      q: get("q"),
      sort,
      limit: 60,
      date: get("date"),
      guests: get("guests") ? Number(get("guests")) : undefined,
      maxPriceCents: get("max_price") ? Number(get("max_price")) * 100 : undefined,
      minPriceCents: get("min_price") ? Number(get("min_price")) * 100 : undefined,
      minRating: get("min_rating") ? Number(get("min_rating")) : undefined,
      maxDurationMin: get("max_duration") ? Number(get("max_duration")) : undefined,
      language: get("language"),
      isPrivate: get("private") === "1",
      withTransfer: get("transfer") === "1",
      instant: get("instant") === "1",
      freeCancel: get("free_cancel") === "1",
      wheelchair: get("wheelchair") === "1",
      family: get("family") === "1",
    }),
    getCategories(locale),
  ]);

  const sorts: [string, string][] = [
    ["popularity", t.search.sortPopularity], ["recommended", t.search.sortRecommended],
    ["price_asc", t.search.sortPriceAsc], ["price_desc", t.search.sortPriceDesc], ["rating", t.search.sortRating],
  ];

  // jelenlegi query megtartása a view/sort váltásnál
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") p.set(k, v);
    for (const [k, v] of Object.entries(over)) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <div className="container-page py-8">
      <form className="card mb-7 grid gap-2 p-2 sm:grid-cols-[1fr_170px_130px_auto]" action={`/${locale}/search`}>
        <input name="q" defaultValue={get("q") ?? ""} placeholder={t.home.searchPlaceholder} className="input border-0" aria-label={t.home.searchPlaceholder} />
        <input name="date" type="date" defaultValue={get("date")} className="input border-0" aria-label={t.common.date} />
        <input name="guests" type="number" min="1" defaultValue={get("guests") ?? "2"} className="input border-0" aria-label={t.home.guests} />
        <button className="btn-primary" type="submit">{t.home.search}</button>
      </form>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lagoon-950">{t.nav.search}</h1>
          <p className="mt-1 text-sm text-lagoon-600">{results.length} {t.search.results}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <a href={qs({ view: "list" })} className={`btn-secondary px-3 py-2 ${view === "list" ? "border-lagoon-500" : ""}`}>
            {t.search.listView}
          </a>
          <a href={qs({ view: "map" })} className={`btn-secondary px-3 py-2 ${view === "map" ? "border-lagoon-500" : ""}`}>
            {t.search.mapView}
          </a>
          <form className="flex items-center gap-2">
            {Object.entries(searchParams).filter(([k]) => k !== "sort").map(([k, v]) =>
              typeof v === "string" ? <input key={k} type="hidden" name={k} value={v} /> : null)}
            <label htmlFor="sort" className="text-lagoon-600">{t.search.sort}</label>
            <select id="sort" name="sort" defaultValue={sort} className="input w-auto py-2">
              {sorts.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <button className="btn-secondary py-2" type="submit">OK</button>
          </form>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Teljes szűrőpanel */}
        <aside className="card h-fit p-5">
          <h2 className="font-semibold text-lagoon-900">{t.search.filters}</h2>
          <form className="mt-4 space-y-4 text-sm">
            <input type="hidden" name="q" value={get("q") ?? ""} />
            <input type="hidden" name="city" value={get("city") ?? ""} />
            <input type="hidden" name="sort" value={sort} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-medium text-lagoon-700">{t.search.price} min (€)</label>
                <input name="min_price" type="number" min="0" defaultValue={get("min_price")} className="input px-2 py-2" />
              </div>
              <div>
                <label className="mb-1 block font-medium text-lagoon-700">max (€)</label>
                <input name="max_price" type="number" min="0" defaultValue={get("max_price")} className="input px-2 py-2" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-medium text-lagoon-700">{t.common.date}</label>
                <input name="date" type="date" defaultValue={get("date")} className="input px-2 py-2" />
              </div>
              <div>
                <label className="mb-1 block font-medium text-lagoon-700">{t.home.guests}</label>
                <input name="guests" type="number" min="1" defaultValue={get("guests")} className="input px-2 py-2" />
              </div>
            </div>
            <div>
              <label className="mb-1 block font-medium text-lagoon-700">{t.search.rating} (min)</label>
              <select name="min_rating" defaultValue={get("min_rating") ?? ""} className="input py-2">
                <option value="">{t.common.all}</option>
                <option value="3">3+</option><option value="4">4+</option><option value="4.5">4.5+</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-lagoon-700">{t.search.duration} (max, {t.search.hours})</label>
              <select name="max_duration" defaultValue={get("max_duration") ?? ""} className="input py-2">
                <option value="">{t.common.all}</option>
                <option value="180">3</option><option value="480">8</option>
                <option value="720">12</option><option value="1440">24</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-lagoon-700">{t.search.language}</label>
              <select name="language" defaultValue={get("language") ?? ""} className="input py-2">
                <option value="">{t.common.all}</option>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-lagoon-700">{t.home.categories}</label>
              <select name="category" defaultValue={get("category") ?? ""} className="input py-2">
                <option value="">{t.common.all}</option>
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              {([
                ["free_cancel", t.search.freeCancellation],
                ["instant", t.search.instant],
                ["transfer", t.search.withTransfer],
                ["private", t.search.private],
                ["wheelchair", t.search.wheelchair],
                ["family", t.search.family],
              ] as const).map(([name, label]) => (
                <label key={name} className="flex items-center gap-2 font-medium text-lagoon-700">
                  <input type="checkbox" name={name} value="1" defaultChecked={get(name) === "1"}
                    className="h-4 w-4 rounded border-lagoon-300" />
                  {label}
                </label>
              ))}
            </div>
            <button className="btn-primary w-full py-2" type="submit">{t.search.filters}</button>
          </form>
        </aside>

        {/* Találatok: lista vagy térkép */}
        <section>
          {view === "map" ? (
            <MapView items={results} locale={locale} />
          ) : results.length === 0 ? (
            <div className="card p-10 text-center text-lagoon-600">{t.search.noResults}</div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((l) => (
                <ListingCard key={l.slug} locale={locale} l={l}
                  freeCancelLabel={t.listing.freeCancel} personLabel={t.listing.person} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
