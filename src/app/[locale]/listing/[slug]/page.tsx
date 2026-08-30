import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDuration } from "@/lib/utils";
import { queryListings } from "@/lib/data";
import { ListingCard } from "@/components/ListingCard";
import { BookingBox } from "@/components/booking/BookingBox";
import { SafeImage } from "@/components/SafeImage";
import { ListingActions } from "@/components/listing/ListingActions";

async function getListing(slug: string) {
  const supabase = createClient();
  const { data } = await supabase.from("listings").select(`
    *, city:cities(name, slug, lat, lng), category:categories(slug), provider:providers(display_name, status),
    translations:listing_translations(*), media:listing_media(kind, url, alt, sort_order),
    options:listing_options(id, code, price_delta_adult, price_delta_child, is_active,
      translations:listing_option_translations(locale, name)),
    reviews(rating, comment, created_at, status, is_verified_booking, user:profiles(full_name))
  `).eq("slug", slug).single();
  return data;
}

async function getSlots(listingId: string) {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase.from("availability")
    .select("date, start_time, capacity, booked_count, price_adult, price_child, is_blocked")
    .eq("listing_id", listingId).is("option_id", null).gte("date", today).lte("date", until)
    .eq("is_blocked", false).order("date").order("start_time").limit(500);
  return (data ?? []).map((s) => ({ date: s.date, startTime: String(s.start_time).slice(0, 5),
    remaining: s.capacity - s.booked_count, priceAdult: s.price_adult, priceChild: s.price_child }));
}

export async function generateMetadata({ params }: { params: { locale: Locale; slug: string } }): Promise<Metadata> {
  const l = await getListing(params.slug);
  if (!l) return {};
  const tr = l.translations.find((x: { locale: string }) => x.locale === params.locale)
    ?? l.translations.find((x: { locale: string }) => x.locale === "en") ?? l.translations[0];
  return { title: tr?.title, description: tr?.short_description ?? undefined,
    openGraph: { title: tr?.title, images: l.media?.[0]?.url ? [l.media[0].url] : undefined } };
}

const hu = { favorite: "Kedvencek", share: "Megosztás", benefits: "A program előnyei", instant: "Azonnali visszaigazolás",
  private: "Privát vagy kis csoport is elérhető", family: "Családbarát program", transfer: "Transzfer elérhető",
  liveGuide: "Élő programvezetés", highlights: "Érdekességek", fullDescription: "Teljes leírás",
  choose: "Résztvevők és időpont kiválasztása", route: "Találkozási pont és útvonal", openMap: "Megnyitás térképen",
  rating: "Utazói vélemények", basedOn: "értékelés alapján", noReviews: "Ehhez a programhoz még nem érkezett értékelés.",
  recommended: "Akár ez is tetszhet…", from: "Kezdőár", availability: "Elérhetőség", provider: "A programszervező",
  important: "Fontos információk", verified: "Ellenőrzött foglalás" };
const en = { favorite: "Save", share: "Share", benefits: "Experience highlights", instant: "Instant confirmation",
  private: "Private or small groups available", family: "Family-friendly experience", transfer: "Pickup available",
  liveGuide: "Live guide", highlights: "Highlights", fullDescription: "Full description", choose: "Select participants and date",
  route: "Meeting point and directions", openMap: "Open in maps", rating: "Traveler reviews", basedOn: "reviews",
  noReviews: "There are no reviews for this experience yet.", recommended: "You might also like…", from: "From",
  availability: "Check availability", provider: "Activity provider", important: "Important information", verified: "Verified booking" };

export default async function ListingPage({ params }: { params: { locale: Locale; slug: string }; searchParams: { date?: string } }) {
  const { locale, slug } = params;
  const t = getDictionary(locale);
  const c = locale === "hu" ? hu : en;
  const l = await getListing(slug);
  if (!l) notFound();
  const trs = l.translations as Array<Record<string, string | null>>;
  const tr = trs.find((x) => x.locale === locale) ?? trs.find((x) => x.locale === "en") ?? trs[0];
  const media = (l.media ?? []).sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order);
  const options = (l.options ?? []).filter((o: { is_active: boolean }) => o.is_active);
  const reviews = (l.reviews ?? []).filter((r: { status: string }) => r.status === "published");
  const city = l.city as { name: string; lat: number | null; lng: number | null } | null;
  const provider = l.provider as { display_name: string } | null;
  const [similar, slots] = await Promise.all([queryListings({ locale, limit: 8 }), getSlots(l.id)]);
  const rating = Number(l.rating_avg || (reviews.length ? reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviews.length : 0));
  const ratingCount = Number(l.rating_count || reviews.length);
  const bullets = String(tr?.short_description ?? tr?.description ?? "").split(/[\n•]/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  const distribution = [5, 4, 3, 2, 1].map((star) => ({ star, count: reviews.filter((r: { rating: number }) => r.rating === star).length }));
  const mapUrl = city?.lat && city?.lng ? `https://www.google.com/maps/search/?api=1&query=${city.lat},${city.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.meeting_point ?? city?.name ?? "")}`;
  const optionProps = options.map((o: { id: string; code: string; price_delta_adult: number; translations: Array<{ locale: string; name: string }> }) => {
    const otr = o.translations.find((x) => x.locale === locale) ?? o.translations.find((x) => x.locale === "en");
    return { id: o.id, name: otr?.name ?? o.code, deltaAdult: o.price_delta_adult };
  });
  const labels = { selectDate: t.listing.selectDate, bookNow: t.listing.bookNow, adults: t.listing.adults,
    children: t.listing.children, infants: t.listing.infants, options: t.listing.options, instant: t.search.instant,
    manual: t.listing.manualConfirmation, soldOut: t.listing.noSlots, perPerson: t.listing.person, from: t.booking.total };

  return <main className="pb-28 lg:pb-12">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "TouristTrip", name: tr?.title,
      description: tr?.short_description, offers: { "@type": "Offer", price: (l.base_price_adult / 100).toFixed(2), priceCurrency: l.currency } }) }} />

    <section className="container-page pt-4 sm:pt-7">
      <div className="relative grid max-h-[650px] min-h-[360px] grid-cols-1 gap-2 overflow-hidden rounded-[28px] bg-lagoon-100 md:grid-cols-[1.7fr_1fr] md:grid-rows-2">
        {(media.length ? media.slice(0, 3) : [{ url: null, alt: null }]).map((m: { url: string | null; alt: string | null }, i: number) =>
          <SafeImage key={i} src={m.url} alt={m.alt ?? String(tr?.title ?? "")} eager={i === 0}
            className={`${i === 0 ? "h-[62vh] min-h-[420px] md:row-span-2 md:h-[650px]" : "hidden h-full md:block"} w-full object-cover`} />)}
        <div className="absolute right-4 top-4"><ListingActions listingId={l.id} favoriteLabel={c.favorite} shareLabel={c.share} /></div>
        {media.length > 1 && <div className="absolute bottom-4 right-4 rounded-full bg-white/95 px-4 py-2 text-sm font-bold text-lagoon-950 shadow-lg">▧ {media.length}</div>}
      </div>
    </section>

    <div className="container-page mt-7 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
      <article className="min-w-0">
        <p className="text-sm font-semibold text-lagoon-600">{city?.name}</p>
        <h1 className="mt-2 max-w-4xl text-3xl font-extrabold leading-tight text-lagoon-950 sm:text-5xl">{tr?.title}</h1>
        {ratingCount > 0 && <a href="#reviews" className="mt-4 inline-flex gap-2 font-bold text-lagoon-950 underline decoration-lagoon-300 underline-offset-4">★ {rating.toFixed(1)} <span className="font-medium">({ratingCount} {c.basedOn})</span></a>}
        {tr?.short_description && <p className="mt-5 max-w-3xl text-lg leading-8 text-lagoon-800">{tr.short_description}</p>}

        <section className="mt-9 border-y border-lagoon-100 py-7"><h2 className="text-2xl font-extrabold text-lagoon-950">{c.benefits}</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Feature icon="◷" title={formatDuration(l.duration_minutes, locale)} text={(l.languages as string[]).join(" · ").toUpperCase()} />
            <Feature icon="✓" title={l.free_cancellation ? t.listing.freeCancel : c.instant} text={l.free_cancellation ? `${l.cancel_full_hours}h` : c.instant} />
            <Feature icon="◎" title={l.confirmation === "instant" ? c.instant : t.listing.manualConfirmation} text={c.liveGuide} />
            <Feature icon="▣" title={l.has_transfer ? c.transfer : (l.is_private_available ? c.private : c.family)} text={l.is_family_friendly ? c.family : c.private} />
          </div>
        </section>

        {bullets.length > 0 && <section className="mt-9"><h2 className="text-2xl font-extrabold text-lagoon-950">{c.highlights}</h2><ul className="mt-5 space-y-3">{bullets.map((b) => <li key={b} className="flex gap-3 leading-7 text-lagoon-800"><span className="text-coral-500">●</span>{b}</li>)}</ul></section>}

        <section id="availability" className="mt-10 scroll-mt-24 overflow-hidden rounded-[28px] bg-lagoon-950 p-5 text-white sm:p-8">
          <h2 className="mb-5 text-2xl font-extrabold">{c.choose}</h2>
          <BookingBox slug={slug} locale={locale} currency={l.currency} basePriceAdult={l.base_price_adult} basePriceChild={l.base_price_child}
            maxParticipants={l.max_participants} slots={slots} options={optionProps} hasTransfer={l.has_transfer} confirmation={l.confirmation} labels={labels} />
        </section>

        <div className="mt-10 divide-y divide-lagoon-100 border-y border-lagoon-100">
          <Accordion title={c.fullDescription} open>{tr?.description}</Accordion>
          <Accordion title={t.listing.included}>{tr?.includes}</Accordion><Accordion title={t.listing.notIncluded}>{tr?.excludes}</Accordion>
          <Accordion title={t.listing.bringWith}>{tr?.bring_with}</Accordion>
          <Accordion title={c.important}>{[tr?.important_info, tr?.accessibility_info].filter(Boolean).join("\n\n")}</Accordion>
          <Accordion title={t.listing.cancellation}>{l.free_cancellation ? `${t.listing.freeCancel} – ${l.cancel_full_hours}h` : l.cancellation_policy}</Accordion>
        </div>

        <section className="mt-10 rounded-[28px] bg-lagoon-50 p-6 sm:p-8"><h2 className="text-2xl font-extrabold text-lagoon-950">{c.route}</h2>
          <p className="mt-4 whitespace-pre-line text-lagoon-800">{l.meeting_point ?? city?.name ?? "–"}</p>
          <a href={mapUrl} target="_blank" rel="noreferrer" className="btn-secondary mt-5 inline-flex">⌖ {c.openMap}</a></section>

        <section id="reviews" className="mt-12 scroll-mt-24"><h2 className="text-3xl font-extrabold text-lagoon-950">{c.rating}</h2>
          {ratingCount ? <div className="mt-6 grid gap-8 sm:grid-cols-[180px_1fr]"><div><div className="text-6xl font-extrabold text-lagoon-950">{rating.toFixed(1)}</div><div className="mt-2 text-xl text-coral-500">★★★★★</div><p className="mt-2 text-sm text-lagoon-600">{ratingCount} {c.basedOn}</p></div>
            <div className="space-y-2">{distribution.map((row) => <div key={row.star} className="flex items-center gap-3 text-sm"><span>{row.star}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-lagoon-100"><div className="h-full bg-lagoon-900" style={{ width: `${reviews.length ? row.count / reviews.length * 100 : 0}%` }} /></div><span>{row.count}</span></div>)}</div></div>
          : <p className="mt-4 text-lagoon-600">{c.noReviews}</p>}
          {reviews.length > 0 && <div className="mt-8 grid gap-5 md:grid-cols-2">{reviews.slice(0, 6).map((r: { rating: number; comment: string | null; is_verified_booking: boolean; user: { full_name: string | null } | null }, i: number) =>
            <article key={i} className="rounded-3xl border border-lagoon-100 p-6"><div className="font-bold text-lagoon-950">{"★".repeat(r.rating)}</div><p className="mt-3 font-bold">{r.user?.full_name || "Travendiq traveler"}</p>{r.is_verified_booking && <p className="mt-1 text-xs text-emerald-700">✓ {c.verified}</p>}{r.comment && <p className="mt-4 leading-7 text-lagoon-800">{r.comment}</p>}</article>)}</div>}
        </section>
        <section className="mt-10 rounded-3xl border border-lagoon-100 p-6"><h2 className="text-xl font-extrabold">{c.provider}</h2><p className="mt-3 text-lagoon-700">{provider?.display_name ?? "–"}</p></section>
      </article>

      <aside className="hidden h-fit lg:sticky lg:top-24 lg:block"><div className="rounded-[28px] border border-lagoon-100 bg-white p-6 shadow-xl shadow-lagoon-950/10">
        <p className="text-sm text-lagoon-600">{c.from}</p><p className="mt-1 text-3xl font-extrabold">{formatMoney(l.base_price_adult, l.currency, locale)} <span className="text-sm font-medium">/ {t.listing.person}</span></p>
        <a href="#availability" className="btn-primary mt-5 flex justify-center">{c.availability}</a><div className="mt-5 space-y-3 text-sm text-lagoon-700"><p>✓ {l.free_cancellation ? t.listing.freeCancel : c.instant}</p><p>✓ {formatDuration(l.duration_minutes, locale)}</p></div>
      </div></aside>
    </div>

    {similar.filter((s) => s.slug !== slug).length > 0 && <section className="container-page mt-16"><h2 className="text-3xl font-extrabold">{c.recommended}</h2><div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{similar.filter((s) => s.slug !== slug).slice(0, 4).map((s) => <ListingCard key={s.slug} locale={locale} l={s} freeCancelLabel={t.listing.freeCancel} personLabel={t.listing.person} />)}</div></section>}

    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-4 py-3 shadow-2xl backdrop-blur lg:hidden"><div className="mx-auto flex max-w-xl items-center justify-between gap-4"><div><p className="text-xs text-lagoon-500">{c.from}</p><p className="font-extrabold">{formatMoney(l.base_price_adult, l.currency, locale)} <span className="text-xs font-medium">/ {t.listing.person}</span></p></div><a href="#availability" className="btn-primary px-7">{c.availability}</a></div></div>
  </main>;
}

function Feature({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="flex gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-lagoon-50 text-xl font-bold">{icon}</span><div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm leading-6 text-lagoon-600">{text}</p></div></div>;
}
function Accordion({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  if (!children) return null;
  return <details className="group py-6" open={open}><summary className="flex cursor-pointer list-none items-center justify-between text-xl font-extrabold">{title}<span className="text-2xl transition group-open:rotate-45">＋</span></summary><div className="mt-4 whitespace-pre-line pr-8 leading-8 text-lagoon-800">{children}</div></details>;
}
