export const revalidate = 300;
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getCategories, getPopularCities, queryListings } from "@/lib/data";
import { ListingCard } from "@/components/ListingCard";

export default async function HomePage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const [cities, categories, featured, topRated] = await Promise.all([
    getPopularCities(),
    getCategories(locale),
    queryListings({ locale, featured: true, limit: 8 }),
    queryListings({ locale, sort: "rating", limit: 8 }),
  ]);

  return (
    <div>
      {/* HERO + kereső */}
      <section className="relative overflow-hidden bg-lagoon-900 text-white">
        <div className="absolute inset-0 opacity-25">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1800"
            alt="" className="h-full w-full object-cover" />
        </div>
        <div className="container-page relative py-20 sm:py-28">
          <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">
            {t.home.heroTitle}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-lagoon-100">{t.home.heroSubtitle}</p>

          <form action={`/${locale}/search`} className="card mt-8 grid max-w-3xl gap-2 p-2 sm:grid-cols-[1fr_160px_140px_auto]">
            <input name="q" placeholder={t.home.searchPlaceholder} className="input border-0" aria-label={t.home.searchPlaceholder} />
            <input name="date" type="date" className="input border-0" aria-label={t.home.date} />
            <select name="guests" className="input border-0" aria-label={t.home.guests} defaultValue="2">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n} {t.common.guestsLabel}</option>
              ))}
            </select>
            <button className="btn-primary" type="submit">{t.home.search}</button>
          </form>
        </div>
      </section>

      <div className="container-page space-y-16 py-14">
        {/* Népszerű úti célok */}
        <section aria-labelledby="popular">
          <h2 id="popular" className="text-2xl font-bold text-lagoon-950">{t.home.popularDestinations}</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {cities.map((c) => (
              <Link key={c.slug} href={`/${locale}/search?city=${c.slug}`}
                className="rounded-full border border-lagoon-200 bg-white px-4 py-2 text-sm font-medium text-lagoon-800 transition hover:border-lagoon-400 hover:bg-lagoon-50">
                {c.name}
              </Link>
            ))}
          </div>
        </section>

        {/* Kiemelt */}
        <section aria-labelledby="featured">
          <h2 id="featured" className="text-2xl font-bold text-lagoon-950">{t.home.featured}</h2>
          {featured.length === 0 ? (
            <div className="card mt-5 p-6 text-sm text-lagoon-600">{t.home.emptyFeatured}</div>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((l) => (
                <ListingCard key={l.slug} locale={locale} l={l}
                  freeCancelLabel={t.listing.freeCancel} personLabel={t.listing.person} />
              ))}
            </div>
          )}
        </section>

        {/* Legjobbra értékelt */}
        <section aria-labelledby="top">
          <h2 id="top" className="text-2xl font-bold text-lagoon-950">{t.home.topRated}</h2>
          {topRated.length > 0 && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {topRated.map((l) => (
                <ListingCard key={l.slug} locale={locale} l={l}
                  freeCancelLabel={t.listing.freeCancel} personLabel={t.listing.person} />
              ))}
            </div>
          )}
        </section>

        {/* Kategóriák */}
        <section aria-labelledby="cats">
          <h2 id="cats" className="text-2xl font-bold text-lagoon-950">{t.home.categories}</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((c) => (
              <Link key={c.slug} href={`/${locale}/search?category=${c.slug}`}
                className="card flex items-center gap-2 p-4 text-sm font-medium text-lagoon-800 transition hover:border-lagoon-300 hover:shadow">
                <CategoryIcon name={c.icon} />
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Egyszerű inline ikonrendszer – végleges ikonkészlettel cserélhető. */
function CategoryIcon({ name }: { name: string | null }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lagoon-100 text-lagoon-700" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
        <title>{name ?? "icon"}</title>
      </svg>
    </span>
  );
}
