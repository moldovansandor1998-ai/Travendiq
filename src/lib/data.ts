import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";
import type { ListingCardData } from "@/components/ListingCard";

export interface ListingFilters {
  locale: Locale;
  citySlug?: string;
  categorySlug?: string;
  q?: string;
  featured?: boolean;
  limit?: number;
  sort?: "popularity" | "price_asc" | "price_desc" | "rating" | "recommended";
  // NINCS includeTest kapcsoló: draft/test listing publikus lekérdezésből
  // SOHA nem térhet vissza (RLS is tiltja, de a lekérdezés sem kérheti).
  // teljes szűrőkészlet
  date?: string;
  guests?: number;
  maxPriceCents?: number;
  minPriceCents?: number;
  minRating?: number;
  maxDurationMin?: number;
  language?: string;
  isPrivate?: boolean;
  withTransfer?: boolean;
  instant?: boolean;
  freeCancel?: boolean;
  wheelchair?: boolean;
  family?: boolean;
}

/** Listing + fordítás lekérése locale-fallback-kel, teljes szűrőkészlettel. */
export async function queryListings(opts: ListingFilters): Promise<ListingCardData[]> {
  const supabase = createClient();

  const needsAvailability = Boolean(opts.date);
  const select = `
      slug, base_price_adult, currency, rating_avg, rating_count, duration_minutes,
      free_cancellation, booking_count, recommendation_score, is_test,
      is_private_available, has_transfer, is_family_friendly, is_wheelchair_accessible,
      confirmation, languages, meeting_lat, meeting_lng,
      city:cities!inner(name, slug, lat, lng),
      category:categories!inner(slug),
      translations:listing_translations(locale, title),
      media:listing_media(url, sort_order)
      ${needsAvailability ? ", availability!inner(date, capacity, booked_count, is_blocked)" : ""}`;

  let q = supabase
    .from("listings")
    .select(select)
    .eq("status", "published")
    .eq("is_test", false) // draft/test listing sosem publikus
    .limit(opts.limit ?? 48);
  if (opts.featured) q = q.eq("is_featured", true);
  if (opts.citySlug) q = q.eq("city.slug", opts.citySlug);
  if (opts.categorySlug) q = q.eq("category.slug", opts.categorySlug);
  if (opts.maxPriceCents !== undefined) q = q.lte("base_price_adult", opts.maxPriceCents);
  if (opts.minPriceCents !== undefined) q = q.gte("base_price_adult", opts.minPriceCents);
  if (opts.minRating !== undefined) q = q.gte("rating_avg", opts.minRating);
  if (opts.maxDurationMin !== undefined) q = q.lte("duration_minutes", opts.maxDurationMin);
  if (opts.language) q = q.contains("languages", [opts.language]);
  if (opts.isPrivate) q = q.eq("is_private_available", true);
  if (opts.withTransfer) q = q.eq("has_transfer", true);
  if (opts.instant) q = q.eq("confirmation", "instant");
  if (opts.freeCancel) q = q.eq("free_cancellation", true);
  if (opts.wheelchair) q = q.eq("is_wheelchair_accessible", true);
  if (opts.family) q = q.eq("is_family_friendly", true);
  if (opts.date) {
    q = q.eq("availability.date", opts.date).eq("availability.is_blocked", false);
  }

  switch (opts.sort) {
    case "price_asc": q = q.order("base_price_adult", { ascending: true }); break;
    case "price_desc": q = q.order("base_price_adult", { ascending: false }); break;
    case "rating": q = q.order("rating_avg", { ascending: false }); break;
    case "recommended": q = q.order("recommendation_score", { ascending: false }); break;
    default: q = q.order("booking_count", { ascending: false });
  }

  interface ListingRow {
    slug: string; base_price_adult: number; currency: string;
    rating_avg: number; rating_count: number; duration_minutes: number;
    free_cancellation: boolean; is_test: boolean;
    meeting_lat: number | null; meeting_lng: number | null;
    city: { name: string; lat: number | null; lng: number | null } | null;
    translations: { locale: string; title: string }[] | null;
    media: { url: string; sort_order: number }[] | null;
    availability?: { capacity: number; booked_count: number }[];
  }

  const { data: rawData, error } = await q;
  if (error) {
    console.error("queryListings", error.message);
    return [];
  }
  const data = (rawData ?? []) as unknown as ListingRow[];

  let items = data.map((row) => {
    const translations = row.translations ?? [];
    const tr =
      translations.find((t) => t.locale === opts.locale) ??
      translations.find((t) => t.locale === "en") ??
      translations[0];
    const media = row.media ?? [];
    const city = row.city;
    return {
      slug: row.slug,
      title: tr?.title ?? row.slug,
      city: city?.name ?? "",
      image: media.sort((a, b) => a.sort_order - b.sort_order)[0]?.url ?? null,
      priceFrom: row.base_price_adult,
      currency: row.currency,
      rating: Number(row.rating_avg),
      ratingCount: row.rating_count,
      durationMinutes: row.duration_minutes,
      freeCancellation: row.free_cancellation,
      isTest: row.is_test,
      lat: (row.meeting_lat as number | null) ?? city?.lat ?? null,
      lng: (row.meeting_lng as number | null) ?? city?.lng ?? null,
    } satisfies ListingCardData;
  });

  // szöveges keresés (cím + város) – a fordításokon
  if (opts.q) {
    const needle = opts.q.toLowerCase();
    items = items.filter((i) =>
      i.title.toLowerCase().includes(needle) || i.city.toLowerCase().includes(needle));
  }

  // férőhely-szűrés (availability join eredménye)
  if (opts.date && opts.guests) {
    items = items.filter((i) => {
      const row = data.find((r) => r.slug === i.slug);
      const av = row?.availability ?? [];
      return av.some((a) => a.capacity - a.booked_count >= (opts.guests ?? 1));
    });
  }

  return items;
}

export async function getPopularCities() {
  const supabase = createClient();
  const { data } = await supabase
    .from("cities")
    .select("slug, name, country_code")
    .eq("is_popular", true)
    .eq("is_active", true)
    .limit(12);
  return data ?? [];
}

export async function getCategories(locale: Locale) {
  const supabase = createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, slug, icon, translations:category_translations(locale, name)")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []).map((c) => {
    const trs = (c.translations ?? []) as { locale: string; name: string }[];
    return {
      slug: c.slug,
      icon: c.icon,
      name:
        trs.find((t) => t.locale === locale)?.name ??
        trs.find((t) => t.locale === "en")?.name ??
        c.slug,
    };
  });
}
