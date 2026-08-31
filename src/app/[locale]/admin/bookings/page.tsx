export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import { formatMoney } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { requestRefund } from "@/lib/booking/refund-flow";
import type { Locale } from "@/lib/i18n";
import type { BookingStatus } from "@/lib/booking/status";

export default async function AdminBookings(
  props: {
    params: Promise<{ locale: Locale }>;
    searchParams: Promise<{ status?: string; q?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  let query = svc.from("bookings")
    .select("id, code, date, status, grand_total, currency, lead_name, lead_email, created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.q) query = query.ilike("code", `%${searchParams.q}%`);
  const { data: bookings } = await query;

  async function refund(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("booking_id") ?? "");
    const amountRaw = String(formData.get("amount") ?? "");
    const { data: b } = await s.from("bookings")
      .select("id, code, grand_total, currency, lead_email, status, user_id, guest_access_token, customer_locale")
      .eq("id", id).single();
    if (!b) throw new Error("not found");
    const amount = amountRaw ? Math.round(Number(amountRaw) * 100) : b.grand_total;
    if (amount <= 0 || amount > b.grand_total) throw new Error("invalid amount");

    // új refund-folyamat: pending → Stripe → a webhook (charge.refunded) zárja le;
    // a booking csak Stripe-megerősítés után lesz 'refunded'
    const res = await requestRefund(s, {
      bookingId: id, amountCents: amount, currency: b.currency,
      reason: "admin_manual", adminOverride: true, actorId: u.id,
    });
    if (!res.ok) throw new Error(res.error ?? "refund_failed");

    await audit(s, { actorId: u.id, action: "booking.refund_requested", entity: "bookings", entityId: id, diff: { amount, refundId: res.refundId } });
    revalidatePath(`/${locale}/admin/bookings`);
  }

  const statuses = ["pending_payment", "pending_confirmation", "confirmed", "completed", "attended", "cancelled_by_customer", "cancelled_by_provider", "refunded", "disputed", "no_show", "expired"];

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Foglalások" : "Bookings"}</h1>
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={searchParams.q ?? ""} placeholder={hu ? "Kód…" : "Code…"} className="input max-w-[10rem]" />
        <select name="status" defaultValue={searchParams.status ?? ""} className="input max-w-[14rem]">
          <option value="">{hu ? "Minden státusz" : "All statuses"}</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">{hu ? "Szűrés" : "Filter"}</button>
      </form>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(bookings ?? []).map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <span className="font-mono font-semibold text-lagoon-900">{b.code}</span>
              <span className="ms-3 text-lagoon-600">{b.date} · {b.lead_name} · {b.lead_email}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold">{formatMoney(b.grand_total, b.currency, locale)}</span>
              <StatusBadge status={b.status as BookingStatus} label={b.status} />
              {["confirmed", "completed", "attended", "pending_confirmation"].includes(b.status) && (
                <form action={refund} className="flex items-center gap-1">
                  <input type="hidden" name="booking_id" value={b.id} />
                  <input name="amount" type="number" step="0.01" min={0.01}
                    placeholder={(b.grand_total / 100).toFixed(2)} className="input w-24 py-1 text-xs" />
                  <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">
                    {hu ? "Visszatérítés" : "Refund"}
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
        {(bookings ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
