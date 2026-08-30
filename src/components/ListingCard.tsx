import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { formatMoney, formatDuration } from "@/lib/utils";
import { SafeImage } from "@/components/SafeImage";

export interface ListingCardData {
  slug: string;
  title: string;
  city: string;
  image: string | null;
  priceFrom: number;
  currency: string;
  rating: number;
  ratingCount: number;
  durationMinutes: number | null;
  freeCancellation: boolean;
  isTest?: boolean;
  lat?: number | null;
  lng?: number | null;
}

export function ListingCard({ locale, l, freeCancelLabel, personLabel }: {
  locale: Locale;
  l: ListingCardData;
  freeCancelLabel: string;
  personLabel: string;
}) {
  return (
    <Link
      href={`/${locale}/listing/${l.slug}`}
      className="card group block overflow-hidden transition hover:shadow-md"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-lagoon-100">
        {/* törött kép fallback + kötelező alt (a listing címe) */}
        <SafeImage
          src={l.image}
          alt={l.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        {l.freeCancellation && (
          <span className="badge absolute bottom-2 left-2 bg-white/95 text-lagoon-700">{freeCancelLabel}</span>
        )}
      </div>
      <div className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-lagoon-500">{l.city}</p>
        <h3 className="mt-1 line-clamp-2 font-semibold text-lagoon-950">{l.title}</h3>
        <div className="mt-2 flex items-center gap-2 text-sm">
          {l.ratingCount > 0 ? (
            <span className="badge bg-lagoon-700 text-white">★ {l.rating.toFixed(1)}</span>
          ) : null}
          <span className="text-lagoon-500">{formatDuration(l.durationMinutes, locale)}</span>
        </div>
        <p className="mt-2 text-sm font-bold text-lagoon-900">
          {formatMoney(l.priceFrom, l.currency, locale)}
          <span className="font-normal text-lagoon-500"> / {personLabel}</span>
        </p>
      </div>
    </Link>
  );
}
