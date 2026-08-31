import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ListingCard, type ListingCardData } from "@/components/ListingCard";

export const dynamic = "force-dynamic";

export default async function FavoritesPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data } = await sb.from("favorites")
    .select(`listing:listings(slug, base_price_adult, currency, rating_avg, rating_count,
      duration_minutes, free_cancellation,
      city:cities(name),
      translations:listing_translations(locale,title),
      media:listing_media(url, sort_order))`)
    .eq("user_id", user.id);

  const items: ListingCardData[] = (data ?? []).map((f) => {
    const l = f.listing as unknown as {
      slug: string; base_price_adult: number; currency: string; rating_avg: number;
      rating_count: number; duration_minutes: number | null; free_cancellation: boolean;
      city: { name: string } | null;
      translations: { locale: string; title: string }[];
      media: { url: string; sort_order: number }[];
    };
    const tr = l.translations.find((x) => x.locale === locale) ?? l.translations.find((x) => x.locale === "en");
    return {
      slug: l.slug, title: tr?.title ?? l.slug, city: l.city?.name ?? "",
      image: l.media.sort((a, b) => a.sort_order - b.sort_order)[0]?.url ?? null,
      priceFrom: l.base_price_adult, currency: l.currency,
      rating: Number(l.rating_avg), ratingCount: l.rating_count,
      durationMinutes: l.duration_minutes, freeCancellation: l.free_cancellation,
    };
  });

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.nav.favorites}</h1>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-lagoon-500">–</p>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((l) => (
            <ListingCard key={l.slug} locale={locale} l={l}
              freeCancelLabel={t.listing.freeCancel} personLabel={t.listing.person} />
          ))}
        </div>
      )}
    </div>
  );
}
