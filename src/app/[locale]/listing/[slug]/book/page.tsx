import { notFound } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { BookingForm } from "./BookingForm";
import { MARKETPLACE_LIVE } from "@/lib/launch";

export const dynamic = "force-dynamic";

export default async function BookPage({
  params, searchParams,
}: {
  params: { locale: Locale; slug: string };
  searchParams: { date?: string; time?: string; adults?: string; children?: string; infants?: string; option?: string; error?: string };
}) {
  if (!MARKETPLACE_LIVE) notFound();
  const { locale, slug } = params;
  const t = getDictionary(locale);
  const supabase = createClient();

  const { data: l } = await supabase
    .from("listings")
    .select(`id, slug, currency, base_price_adult, base_price_child, max_participants, has_transfer,
      confirmation,
      translations:listing_translations(locale,title),
      options:listing_options(id, code, price_delta_adult, price_delta_child, is_active,
        translations:listing_option_translations(locale,name)),
      extras:listing_extras(id, name, price, per_person, is_active),
      zones:listing_transfer_zones(id, zone_name, pickup_fee)`)
    .eq("slug", slug)
    .single();
  if (!l) notFound();

  const date = searchParams.date ?? "";
  const time = searchParams.time ?? "09:00";
  const adults = Math.max(0, Number(searchParams.adults ?? 1));
  const children = Math.max(0, Number(searchParams.children ?? 0));
  const infants = Math.max(0, Number(searchParams.infants ?? 0));
  const optionId = searchParams.option || null;

  // szerveroldali slot-ellenőrzés és ár (a becslés alapja – az RPC ezzel számol)
  const { data: slot } = await supabase
    .from("availability")
    .select("capacity, booked_count, price_adult, price_child, is_blocked")
    .eq("listing_id", l.id)
    .is("option_id", optionId)
    .eq("date", date)
    .eq("start_time", time)
    .maybeSingle();

  const trs = (l.translations ?? []) as { locale: string; title: string }[];
  const title = (trs.find((x) => x.locale === locale) ?? trs.find((x) => x.locale === "en"))?.title ?? slug;

  const options = ((l.options ?? []) as {
    id: string; code: string; price_delta_adult: number; price_delta_child: number | null; is_active: boolean;
    translations: { locale: string; name: string }[];
  }[]).filter((o) => o.is_active).map((o) => {
    const otr = o.translations.find((x) => x.locale === locale) ?? o.translations.find((x) => x.locale === "en");
    return { id: o.id, name: otr?.name ?? o.code, deltaAdult: o.price_delta_adult, deltaChild: o.price_delta_child };
  });
  const extras = ((l.extras ?? []) as { id: string; name: string; price: number; per_person: boolean; is_active: boolean }[])
    .filter((x) => x.is_active);
  const zones = (l.zones ?? []) as { id: string; zone_name: string; pickup_fee: number }[];

  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="container-page max-w-3xl py-8">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.booking.title}</h1>
      <p className="mt-1 text-lagoon-600">{title} · {date} {time}</p>

      {searchParams.error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {searchParams.error === "NOT_ENOUGH_CAPACITY" || searchParams.error === "SLOT_UNAVAILABLE"
            ? (t.booking.notEnoughCapacity)
            : searchParams.error}
        </div>
      )}
      {!slot || slot.is_blocked || slot.capacity - slot.booked_count < adults + children + infants ? (
        <div className="card mt-6 p-6 text-sm text-lagoon-700">
          {t.booking.slotUnavailable}
        </div>
      ) : (
        <BookingForm
          locale={locale}
          listingId={l.id}
          currency={l.currency}
          slot={{ date, time, priceAdult: slot.price_adult, priceChild: slot.price_child,
            remaining: slot.capacity - slot.booked_count }}
          base={{ priceAdult: l.base_price_adult, priceChild: l.base_price_child }}
          optionId={optionId}
          options={options}
          extras={extras}
          zones={zones}
          hasTransfer={l.has_transfer}
          init={{ adults, children, infants }}
          userEmail={user?.email ?? null}
          labels={{
            contact: t.booking.contact, name: t.booking.name, email: t.booking.email,
            phone: t.booking.phone, coupon: t.booking.coupon, hotel: t.booking.hotel,
            pickup: t.booking.pickup, requests: t.booking.requests,
            extras: t.listing.extras, zone: t.listing.meetingPoint,
            total: t.booking.total, continue: t.booking.continue,
            guest: t.booking.guest, guestNote: t.booking.guestNote,
            adults: t.listing.adults, children: t.listing.children, infants: t.listing.infants,
            options: t.listing.options,
            notEnoughCapacity: t.booking.notEnoughCapacity,
            loading: t.common.loading,
          }}
        />
      )}
    </div>
  );
}
