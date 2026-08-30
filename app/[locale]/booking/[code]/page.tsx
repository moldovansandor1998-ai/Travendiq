import { notFound } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createServiceClient } from "@/lib/supabase/server";
import { signVoucher, voucherQrDataUrl } from "@/lib/qr";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/lib/utils";
import { getBookingWithAccess } from "@/lib/booking/access";
import type { BookingStatus } from "@/lib/booking/status";
import { BookingActions } from "./BookingActions";

export const dynamic = "force-dynamic";

export default async function BookingPage({
  params, searchParams,
}: { params: { locale: Locale; code: string }; searchParams: { paid?: string; token?: string } }) {
  const { locale, code } = params;
  const t = getDictionary(locale);

  const access = await getBookingWithAccess({ code }, searchParams.token ?? null);
  if (!access.ok) {
    if (access.reason === "not_found") notFound();
    return (
      <div className="container-page max-w-xl py-16 text-center">
        <h1 className="text-xl font-bold text-lagoon-950">403</h1>
        <p className="mt-2 text-lagoon-600">
{t.booking.noAccess}
        </p>
      </div>
    );
  }

  const b = access.booking as {
    id: string; code: string; status: BookingStatus; date: string; start_time: string;
    adults: number; children: number; infants: number; grand_total: number; currency: string;
    listing_id: string; guest_access_token: string; customer_locale: string;
    user_id: string | null; cancel_reason: string | null;
  };

  const sb = createServiceClient();
  const { data: listing } = await sb.from("listings")
    .select("translations:listing_translations(locale,title), meeting_point, free_cancellation, cancel_full_hours")
    .eq("id", b.listing_id).single();
  const trs = (listing?.translations ?? []) as { locale: string; title: string }[];
  const title = (trs.find((x) => x.locale === locale) ?? trs.find((x) => x.locale === "en"))?.title ?? "";
  const statusLabel = (t.booking.status as Record<string, string>)[b.status] ?? b.status;

  // A vendég token CSAK a vendéglinkben jelenhet meg: bejelentkezett
  // tulajdonosnál a session azonosít (a voucher API owner-sessiont is elfogad),
  // így a guest_access_token SOHA nem kerül tulajdonosi URL-be.
  const token = access.via === "owner" ? null : (searchParams.token ?? null);

  let qr: string | null = null;
  if (["confirmed", "attended", "pending_confirmation"].includes(b.status) && process.env.VOUCHER_SIGNING_SECRET) {
    qr = await voucherQrDataUrl(signVoucher({ code: b.code, exp: b.date }));
  }

  return (
    <div className="container-page max-w-2xl py-10">
      {searchParams.paid === "1" && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
          {t.checkout.success}
        </div>
      )}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-lagoon-950">{t.booking.title}</h1>
          <StatusBadge status={b.status} label={statusLabel} />
        </div>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-lagoon-500">{t.booking.code}</dt>
            <dd className="font-mono text-lg font-bold text-lagoon-950">{b.code}</dd></div>
          <div><dt className="text-lagoon-500">{t.common.date}</dt>
            <dd className="font-semibold text-lagoon-900">{b.date} {String(b.start_time).slice(0, 5)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-lagoon-500">{t.nav.search}</dt>
            <dd className="font-semibold text-lagoon-900">{title}</dd></div>
          <div><dt className="text-lagoon-500">{t.home.guests}</dt>
            <dd className="font-semibold text-lagoon-900">{b.adults} + {b.children} + {b.infants}</dd></div>
          <div><dt className="text-lagoon-500">{t.booking.total}</dt>
            <dd className="font-semibold text-lagoon-900">{formatMoney(b.grand_total, b.currency, locale)}</dd></div>
        </dl>

        {qr && (
          <div className="mt-6 border-t border-lagoon-100 pt-6 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR" className="mx-auto h-44 w-44 rounded-xl border border-lagoon-100" />
            <p className="mt-2 text-xs text-lagoon-500">{t.booking.showQr}</p>
            {/* Tulajdonosnál token NÉLKÜLI URL (/api/voucher/<code>?format=pdf);
                vendégnél az érvényes tokenes URL. Üres "token=" sosem kerül bele. */}
            <a href={token
              ? `/api/voucher/${b.code}?token=${encodeURIComponent(token)}&format=pdf`
              : `/api/voucher/${b.code}?format=pdf`}
              className="btn-secondary mt-4 inline-flex" target="_blank" rel="noopener">
              {t.booking.voucher} (PDF)
            </a>
          </div>
        )}

        {/* Vásárlói műveletek: lemondás, átfoglalás, értékelés */}
        {(access.via === "owner" || access.via === "guest_token") && (
          <BookingActions
            bookingId={b.id}
            status={b.status}
            locale={locale}
            token={token}
            freeCancelHours={listing?.free_cancellation ? listing.cancel_full_hours : null}
            labels={{
              cancel: t.booking.cancel,
              reschedule: t.booking.reschedule,
              cancelled: t.booking.cancelled,
              confirmCancel: t.booking.confirmCancel,
              review: t.booking.writeReview,
              freeCancelUntil: t.booking.freeCancelUntil,
            }}
          />
        )}
      </div>
    </div>
  );
}
