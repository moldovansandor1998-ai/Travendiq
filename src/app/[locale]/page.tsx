export const revalidate = 300;
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getCategories, getPopularCities, queryListings } from "@/lib/data";
import { ListingCard } from "@/components/ListingCard";
import { SafeImage } from "@/components/SafeImage";
import { Icon } from "@/components/Icon";

const DESTINATION_IMAGES: Record<string, string> = {
  hurghada: "https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?w=900",
  cairo: "https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?w=900",
  luxor: "https://images.unsplash.com/photo-1568322445389-f64ac2515020?w=900",
  budapest: "https://images.unsplash.com/photo-1549877452-9c387954fbc2?w=900",
  london: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900",
  "new-york-city": "https://images.unsplash.com/photo-1485871981521-5b1fd3805eee?w=900",
  paris: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900",
  barcelona: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=900",
  rome: "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=900",
  dubai: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900",
  istanbul: "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=900",
  athens: "https://images.unsplash.com/photo-1555993539-1732b0258235?w=900",
};

const CATEGORY_ICONS: Record<string, string> = {
  sightseeing: "culture", "day-trips": "compass", "boat-tours": "boat",
  museums: "culture", "food-drink": "food", "nature-adventure": "adventure",
  "water-activities": "water", "shows-events": "ticket", family: "users",
  wellness: "wellness", nightlife: "nightlife", transport: "map-pin",
};

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
          <SafeImage
            src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1800"
            alt="" eager className="h-full w-full object-cover" />
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

      <section className="border-b border-lagoon-100 bg-white" aria-label={locale === "hu" ? "Foglalási előnyök" : "Booking benefits"}>
        <div className="container-page grid gap-5 py-6 sm:grid-cols-2 lg:grid-cols-4">
          <Benefit icon="shield" title={locale === "hu" ? "Biztonságos foglalás" : "Book with confidence"}
            text={locale === "hu" ? "Átlátható árak és ellenőrzött szolgáltatók" : "Clear prices and reviewed providers"} />
          <Benefit icon="calendar" title={locale === "hu" ? "Rugalmas tervezés" : "Flexible planning"}
            text={locale === "hu" ? "Ingyenes lemondás a feltételek szerint" : "Free cancellation where offered"} />
          <Benefit icon="zap" title={locale === "hu" ? "Azonnali visszaigazolás" : "Instant confirmation"}
            text={locale === "hu" ? "A jogosult programok azonnal foglalhatók" : "Eligible activities confirm immediately"} />
          <Benefit icon="headset" title={locale === "hu" ? "Segítség, amikor kell" : "Support when you need it"}
            text={locale === "hu" ? "Foglalásaid egy helyen, könnyen kezelhetők" : "Manage every booking in one place"} />
        </div>
      </section>

      <div className="container-page space-y-16 py-14">
        {/* Népszerű úti célok */}
        <section aria-labelledby="popular">
          <h2 id="popular" className="text-2xl font-bold text-lagoon-950">{t.home.popularDestinations}</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {cities.map((c) => (
              <Link key={c.slug} href={`/${locale}/search?city=${c.slug}`}
                className="card group relative aspect-[4/3] overflow-hidden">
                <SafeImage src={DESTINATION_IMAGES[c.slug]} alt={c.name}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-4 pt-12 text-lg font-bold text-white">
                  {c.name}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Kiemelt */}
        <section aria-labelledby="featured">
          <h2 id="featured" className="text-2xl font-bold text-lagoon-950">{t.home.featured}</h2>
          {featured.length === 0 ? (
            <div className="card mt-5 flex flex-col items-start justify-between gap-5 bg-lagoon-50 p-7 sm:flex-row sm:items-center">
              <div>
                <p className="font-semibold text-lagoon-950">{locale === "hu" ? "Az első élmények hamarosan érkeznek" : "The first experiences are coming soon"}</p>
                <p className="mt-1 text-sm text-lagoon-600">{locale === "hu" ? "Helyi szolgáltató vagy? Mutasd meg programjaidat az utazóknak." : "Are you a local provider? Bring your activities to travelers."}</p>
              </div>
              <Link href={`/${locale}/provider/register`} className="btn-primary shrink-0">{locale === "hu" ? "Szolgáltató leszek" : "Become a provider"}</Link>
            </div>
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
          {topRated.length > 0 ? (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {topRated.map((l) => (
                <ListingCard key={l.slug} locale={locale} l={l}
                  freeCancelLabel={t.listing.freeCancel} personLabel={t.listing.person} />
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-lagoon-600">{locale === "hu" ? "A hitelesített vendégértékelések a foglalások után jelennek meg." : "Verified guest ratings will appear after completed bookings."}</p>}
        </section>

        {/* Kategóriák */}
        <section aria-labelledby="cats">
          <h2 id="cats" className="text-2xl font-bold text-lagoon-950">{t.home.categories}</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((c) => (
              <Link key={c.slug} href={`/${locale}/search?category=${c.slug}`}
                className="card flex items-center gap-2 p-4 text-sm font-medium text-lagoon-800 transition hover:border-lagoon-300 hover:shadow">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lagoon-100 text-lagoon-700"><Icon name={CATEGORY_ICONS[c.slug] ?? c.icon ?? "compass"} /></span>
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Benefit({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lagoon-100 text-lagoon-700"><Icon name={icon} /></span>
      <div><p className="text-sm font-bold text-lagoon-950">{title}</p><p className="mt-0.5 text-xs leading-5 text-lagoon-600">{text}</p></div>
    </div>
  );
}
