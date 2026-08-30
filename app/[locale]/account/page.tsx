import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/lib/utils";
import type { BookingStatus } from "@/lib/booking/status";

export const dynamic = "force-dynamic";

/** Vásárlói fiók: saját foglalások listája. */
export default async function AccountPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: bookings } = await sb.from("bookings")
    .select(`id, code, date, start_time, status, grand_total, currency,
      listing:listings(slug, translations:listing_translations(locale,title))`)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.nav.bookings}</h1>
      <div className="card mt-6 divide-y divide-lagoon-100">
        {(bookings ?? []).map((b) => {
          const listing = b.listing as unknown as { slug: string; translations: { locale: string; title: string }[] } | null;
          const trs = listing?.translations ?? [];
          const title = (trs.find((x) => x.locale === locale) ?? trs[0])?.title ?? "";
          return (
            <Link key={b.id} href={`/${locale}/booking/${b.code}`}
              className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm transition hover:bg-lagoon-50">
              <div>
                <p className="font-semibold text-lagoon-900">{title}</p>
                <p className="text-lagoon-500">
                  <span className="font-mono">{b.code}</span> · {b.date} {String(b.start_time).slice(0, 5)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-lagoon-900">{formatMoney(b.grand_total, b.currency, locale)}</span>
                <StatusBadge status={b.status as BookingStatus}
                  label={(t.booking.status as Record<string, string>)[b.status] ?? b.status} />
              </div>
            </Link>
          );
        })}
        {(bookings ?? []).length === 0 && (
          <p className="p-6 text-sm text-lagoon-500">
            {t.account.noBookings}
          </p>
        )}
      </div>
    </div>
  );
}
