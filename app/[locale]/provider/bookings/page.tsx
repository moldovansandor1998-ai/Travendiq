export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/lib/utils";
import type { BookingStatus } from "@/lib/booking/status";
import { BookingRowActions } from "./BookingRowActions";

export default async function ProviderBookingsPage({
  params, searchParams,
}: { params: { locale: Locale }; searchParams: { date?: string; status?: string } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: provider } = await sb.from("providers").select("id")
    .eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  let q = sb.from("bookings")
    .select(`id, code, date, start_time, status, grand_total, provider_amount, currency,
      adults, children, infants, lead_name, lead_phone, hotel_name, pickup_address, special_requests,
      listing:listings(translations:listing_translations(locale,title))`)
    .eq("provider_id", provider.id)
    .order("date", { ascending: true })
    .limit(200);
  if (searchParams.date) q = q.eq("date", searchParams.date);
  if (searchParams.status) q = q.eq("status", searchParams.status);

  const { data: bookings } = await q;

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-lagoon-950">{t.provider.bookings}</h1>
        <div className="flex gap-2">
          <form className="flex gap-2">
            <input type="date" name="date" defaultValue={searchParams.date} className="input w-auto py-2" aria-label="Date" />
            <button className="btn-secondary py-2" type="submit">OK</button>
          </form>
          <a className="btn-secondary py-2"
            href={`/api/provider/export?date=${searchParams.date ?? ""}`}>
            CSV ⬇
          </a>
        </div>
      </div>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(bookings ?? []).map((b) => {
          const listing = b.listing as unknown as { translations: { locale: string; title: string }[] } | null;
          const trs = listing?.translations ?? [];
          const title = (trs.find((x) => x.locale === locale) ?? trs[0])?.title ?? "";
          return (
            <div key={b.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-lagoon-900">{title}</p>
                  <p className="text-lagoon-500">
                    <span className="font-mono">{b.code}</span> · {b.date} {String(b.start_time).slice(0, 5)} ·
                    {" "}{b.adults}+{b.children}+{b.infants} pax · {b.lead_name}
                  </p>
                  {(b.hotel_name || b.pickup_address) && (
                    <p className="text-xs text-lagoon-500">🏨 {b.hotel_name} {b.pickup_address}</p>
                  )}
                  {b.special_requests && (
                    <p className="text-xs text-lagoon-500">📝 {b.special_requests}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-lagoon-900">
                    {formatMoney(b.provider_amount, b.currency, locale)}
                  </span>
                  <StatusBadge status={b.status as BookingStatus}
                    label={(t.booking.status as Record<string, string>)[b.status] ?? b.status} />
                </div>
              </div>
              <BookingRowActions bookingId={b.id} status={b.status}
                labels={{
                  accept: t.admin.approve, reject: t.admin.reject,
                  complete: t.providerArea.complete,
                  noShow: "No-show",
                  cancel: t.common.cancel,
                }} />
            </div>
          );
        })}
        {(bookings ?? []).length === 0 && <p className="p-6 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
