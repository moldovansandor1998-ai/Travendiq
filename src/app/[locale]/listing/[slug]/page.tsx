import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDuration } from "@/lib/utils";
import { queryListings } from "@/lib/data";
import { ListingCard } from "@/components/ListingCard";
import { BookingBox } from "@/components/booking/BookingBox";
import { SafeImage } from "@/components/SafeImage";

async function getListing(slug: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("listings")
    .select(`
      *, city:cities(name, slug, lat, lng), category:categories(slug),
      provider:providers(display_name, status),
      translations:listing_translations(*),
      media:listing_media(kind, url, alt, sort_order),
      options:listing_options(id, code, price_delta_adult, price_delta_child, is_active,
        translations:listing_option_translations(locale, name)),
      extras:listing_extras(id, name, price, per_person, is_active),
      reviews(rating, comment, created_at, status)
    `)
    .eq("slug", slug)
    .single();
  return data;
}

async function getSlots(listingId: string) {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("availability")
    .select("date, start_time, capacity, booked_count, price_adult, price_child, is_blocked")
    .eq("listing_id", listingId)
    .is("option_id", null)
    .gte("date", today)
    .lte("date", until)
    .eq("is_blocked", false)
    .order("date")
    .order("start_time")
    .limit(500);
  return (data ?? []).map((s) => ({
    date: s.date,
    startTime: String(s.start_time).slice(0, 5),
    remaining: s.capacity - s.booked_count,
    priceAdult: s.price_adult,
    priceChild: s.price_child,
  }));
}

export async function generateMetadata({ params }: { params: { locale: Locale; slug: string } }): Promise<Metadata> {
  const l = await getListing(params.slug);
  if (!l) return {};
  // SEO-szöveg az AKTUÁLIS locale fordításával (angol fallback, nem mindig en)
  const tr = (l.translations as { locale: string; title: string; short_description: string }[])
    .find((t) => t.locale === params.locale)
    ?? l.translations.find((t: { locale: string }) => t.locale === "en") ?? l.translations[0];
  return {
    title: tr?.title,
    description: tr?.short_description ?? undefined,
    openGraph: {
      title: tr?.title,
      images: (l.media as { url: string }[] | null)?.[0]?.url ? [l.media[0].url] : undefined,
    },
  };
}

export default async function ListingPage({
  params, searchParams,
}: {
  params: { locale: Locale; slug: string };
  searchParams: { date?: string };
}) {
  const { locale, slug } = params;
  const t = getDictionary(locale);
  const l = await getListing(slug);
  if (!l) notFound();

  const trs = l.translations as {
    locale: string; title: string; short_description: string | null; description: string | null;
    includes: string | null; excludes: string | null; bring_with: string | null;
    important_info: string | null; accessibility_info: string | null;
  }[];
  const tr = trs.find((x) => x.locale === locale) ?? trs.find((x) => x.locale === "en") ?? trs[0];
  const media = ((l.media as { kind: string; url: string; alt: string | null; sort_order: number }[]) ?? [])
    .sort((a, b) => a.sort_order - b.sort_order);
  const options = (l.options as {
    id: string; code: string; price_delta_adult: number; is_active: boolean;
    translations: { locale: string; name: string }[];
  }[] ?? []).filter((o) => o.is_active);
  const reviews = (l.reviews as { rating: number; comment: string | null; created_at: string; status: string }[] ?? [])
    .filter((r) => r.status === "published");
  const city = l.city as unknown as { name: string; lat: number | null; lng: number | null } | null;
  const provider = l.provider as unknown as { display_name: string } | null;
  const [similar, slots] = await Promise.all([
    queryListings({ locale, limit: 4 }),
    getSlots(l.id),
  ]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    name: tr?.title,
    description: tr?.short_description ?? undefined,
    offers: {
      "@type": "Offer",
      price: (l.base_price_adult / 100).toFixed(2),
      priceCurrency: l.currency,
      availability: "https://schema.org/InStock",
    },
  };

  void searchParams;

  return (
    <div className="container-page py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div>
          {/* Galéria – csak valódi képek; törött kép esetén fallback,
              alt = a kép alt-je vagy a listing címe */}
          <div className="grid gap-2 sm:grid-cols-2">
            {media.slice(0, 4).map((m, i) => (
              <SafeImage key={i} src={m.url} alt={m.alt ?? tr?.title ?? ""} eager={i === 0}
                className={`w-full rounded-2xl object-cover ${i === 0 ? "sm:col-span-2 aspect-[16/9]" : "aspect-[4/3]"}`} />
            ))}
            {media.length === 0 && (
              <SafeImage src={null} alt={tr?.title ?? ""}
                className="aspect-[16/9] w-full rounded-2xl object-cover sm:col-span-2" />
            )}
          </div>

          <h1 className="mt-6 text-3xl font-extrabold text-lagoon-950">{tr?.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-lagoon-600">
            <span>{city?.name}</span>
            {l.rating_count > 0 && <span className="badge bg-lagoon-700 text-white">★ {Number(l.rating_avg).toFixed(1)} ({l.rating_count})</span>}
            <span>{formatDuration(l.duration_minutes, locale)}</span>
            <span>{(l.languages as string[]).join(" · ").toUpperCase()}</span>
          </div>

          {tr?.description && <Section title="">{tr.description}</Section>}
          {tr?.includes && <Section title={t.listing.included}>{tr.includes}</Section>}
          {tr?.excludes && <Section title={t.listing.notIncluded}>{tr.excludes}</Section>}
          {tr?.bring_with && <Section title={t.listing.bringWith}>{tr.bring_with}</Section>}
          {tr?.important_info && <Section title={t.listing.important}>{tr.important_info}</Section>}
          {tr?.accessibility_info && <Section title={t.listing.accessibility}>{tr.accessibility_info}</Section>}

          <Section title={t.listing.cancellation}>
            {l.free_cancellation
              ? `${t.listing.freeCancel} – ${l.cancel_full_hours}h`
              : l.cancellation_policy}
          </Section>

          <Section title={t.listing.meetingPoint}>
            {l.meeting_point ?? "–"}
          </Section>

          <Section title={t.listing.provider}>{provider?.display_name ?? "–"}</Section>

          {/* Értékelések */}
          <section className="mt-8">
            <h2 className="text-xl font-bold text-lagoon-950">{t.listing.reviews}</h2>
            {reviews.length === 0 ? (
              <p className="mt-3 text-sm text-lagoon-600">–</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {reviews.map((r, i) => (
                  <li key={i} className="card p-4">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-lagoon-700 text-white">★ {r.rating}</span>
                      <span className="badge bg-emerald-100 text-emerald-800">{t.listing.verifiedBooking}</span>
                    </div>
                    {r.comment && <p className="mt-2 text-sm text-lagoon-800">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Foglalási doboz – valódi turnusokkal */}
        <aside className="h-fit lg:sticky lg:top-20">
          <BookingBox
            slug={slug} locale={locale} currency={l.currency}
            basePriceAdult={l.base_price_adult} basePriceChild={l.base_price_child}
            maxParticipants={l.max_participants}
            slots={slots}
            options={options.map((o) => {
              const otr = o.translations.find((x) => x.locale === locale) ?? o.translations.find((x) => x.locale === "en");
              return { id: o.id, name: otr?.name ?? o.code, deltaAdult: o.price_delta_adult };
            })}
            hasTransfer={l.has_transfer} confirmation={l.confirmation}
            labels={{
              selectDate: t.listing.selectDate, bookNow: t.listing.bookNow,
              adults: t.listing.adults, children: t.listing.children, infants: t.listing.infants,
              options: t.listing.options, instant: t.search.instant,
              manual: t.listing.manualConfirmation,
              soldOut: t.listing.noSlots,
              perPerson: t.listing.person, from: t.booking.total,
            }}
          />
        </aside>
      </div>

      {/* Hasonló */}
      {similar.length > 0 && (
        <section className="mt-14">
          <h2 className="text-2xl font-bold text-lagoon-950">{t.listing.similar}</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {similar.filter((s) => s.slug !== slug).slice(0, 4).map((s) => (
              <ListingCard key={s.slug} locale={locale} l={s}
                freeCancelLabel={t.listing.freeCancel} personLabel={t.listing.person} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      {title && <h2 className="text-xl font-bold text-lagoon-950">{title}</h2>}
      <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-lagoon-800">{children}</div>
    </section>
  );
}

