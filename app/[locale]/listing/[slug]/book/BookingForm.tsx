"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/utils";

/**
 * Foglalási űrlap: kapcsolattartás, extrák, transzferzóna, kupon.
 * A becsült ár ugyanazzal a képlettel számol, mint a szerver (create_booking RPC);
 * a végső összeget mindig a szerver számítja.
 */
export function BookingForm({
  locale, listingId, currency, slot, base, optionId, options, extras, zones,
  hasTransfer, init, userEmail, labels,
}: {
  locale: string; listingId: string; currency: string;
  slot: { date: string; time: string; priceAdult: number | null; priceChild: number | null; remaining: number };
  base: { priceAdult: number; priceChild: number | null };
  optionId: string | null;
  options: { id: string; name: string; deltaAdult: number; deltaChild: number | null }[];
  extras: { id: string; name: string; price: number; per_person: boolean }[];
  zones: { id: string; zone_name: string; pickup_fee: number }[];
  hasTransfer: boolean;
  init: { adults: number; children: number; infants: number };
  userEmail: string | null;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [adults, setAdults] = useState(init.adults);
  const [children, setChildren] = useState(init.children);
  const [infants, setInfants] = useState(init.infants);
  const [selOption, setSelOption] = useState(optionId ?? options[0]?.id ?? "");
  const [selExtras, setSelExtras] = useState<Record<string, number>>({});
  const [zoneId, setZoneId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opt = options.find((o) => o.id === selOption);
  const priceAdult = (slot.priceAdult ?? base.priceAdult) + (opt?.deltaAdult ?? 0);
  const priceChild = (slot.priceChild ?? base.priceChild ?? base.priceAdult) + (opt?.deltaChild ?? opt?.deltaAdult ?? 0);

  const estimate = useMemo(() => {
    let total = adults * priceAdult + children * priceChild;
    for (const [id, qty] of Object.entries(selExtras)) {
      const x = extras.find((e) => e.id === id);
      if (x && qty > 0) total += x.per_person ? x.price * qty * (adults + children + infants) : x.price * qty;
    }
    const zone = zones.find((z) => z.id === zoneId);
    if (zone) total += zone.pickup_fee;
    return total;
  }, [adults, children, infants, selExtras, zoneId, priceAdult, priceChild, extras, zones]);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(ev.currentTarget);
    const idempotencyKey = crypto.randomUUID();
    const body = {
      listingId,
      optionId: selOption || null,
      date: slot.date,
      startTime: slot.time,
      adults, children, infants,
      leadName: String(fd.get("name") ?? ""),
      leadEmail: String(fd.get("email") ?? ""),
      leadPhone: String(fd.get("phone") ?? ""),
      hotel: String(fd.get("hotel") ?? ""),
      pickup: String(fd.get("pickup") ?? ""),
      requests: String(fd.get("requests") ?? ""),
      coupon: String(fd.get("coupon") ?? ""),
      zoneId: zoneId || null,
      extras: Object.entries(selExtras).filter(([, q]) => q > 0).map(([extraId, quantity]) => ({ extraId, quantity })),
      idempotencyKey,
      website: String(fd.get("website") ?? ""), // honeypot
    };
    const res = await fetch("/api/bookings/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-locale": locale },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error === "NOT_ENOUGH_CAPACITY" || data.error === "SLOT_UNAVAILABLE"
        ? (labels.notEnoughCapacity)
        : (data.error ?? "error"));
      setBusy(false);
      return;
    }
    const tokenQ = data.guestToken ? `?token=${data.guestToken}` : "";
    router.push(`/${locale}/checkout/${data.bookingId}${tokenQ}`);
  }

  return (
    <form onSubmit={submit} className="card mt-6 space-y-5 p-6">
      {/* résztvevők + opció módosítása */}
      <div className="grid grid-cols-3 gap-2 text-sm">
        {([
          [labels.adults, adults, setAdults, 1],
          [labels.children, children, setChildren, 0],
          [labels.infants, infants, setInfants, 0],
        ] as const).map(([label, value, set, min]) => (
          <div key={label}>
            <label className="mb-1 block font-medium text-lagoon-700">{label}</label>
            <input type="number" min={min} max={slot.remaining} value={value}
              onChange={(e) => set(Math.max(min, Number(e.target.value)))} className="input px-2" />
          </div>
        ))}
      </div>

      {options.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-lagoon-700">{labels.options}</label>
          <select value={selOption} onChange={(e) => setSelOption(e.target.value)} className="input">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.deltaAdult > 0 ? ` (+${formatMoney(o.deltaAdult, currency, locale)})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {extras.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-lagoon-700">{labels.extras}</legend>
          <div className="space-y-2">
            {extras.map((x) => (
              <label key={x.id} className="flex items-center justify-between gap-3 rounded-xl border border-lagoon-100 p-3 text-sm">
                <span className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4"
                    checked={(selExtras[x.id] ?? 0) > 0}
                    onChange={(e) => setSelExtras((s) => ({ ...s, [x.id]: e.target.checked ? 1 : 0 }))} />
                  {x.name}
                </span>
                <span className="text-lagoon-600">
                  {formatMoney(x.price, currency, locale)}{x.per_person ? ` /${labels.adults.toLowerCase()}` : ""}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {hasTransfer && zones.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-lagoon-700">{labels.zone}</label>
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input">
            <option value="">—</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.zone_name}{z.pickup_fee > 0 ? ` (+${formatMoney(z.pickup_fee, currency, locale)})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <h2 className="pt-2 font-semibold text-lagoon-900">{labels.contact}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label={labels.name} required autoComplete="name" />
        <Field name="email" label={labels.email} type="email" required autoComplete="email" defaultValue={userEmail ?? ""} />
        <Field name="phone" label={labels.phone} type="tel" autoComplete="tel" />
        <Field name="coupon" label={labels.coupon} placeholder="PROMO10" />
      </div>
      {/* honeypot – botvédelem */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      {hasTransfer && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="hotel" label={labels.hotel} />
          <Field name="pickup" label={labels.pickup} />
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor="requests">{labels.requests}</label>
        <textarea id="requests" name="requests" rows={3} maxLength={1000} className="input" />
      </div>

      {!userEmail && <p className="text-xs text-lagoon-500">{labels.guest}: {labels.guestNote}</p>}

      <div className="flex items-center justify-between border-t border-lagoon-100 pt-4">
        <div>
          <p className="text-xs text-lagoon-500">{labels.total}</p>
          <p className="text-xl font-extrabold text-lagoon-950">{formatMoney(estimate, currency, locale)}</p>
        </div>
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? labels.loading : labels.continue}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

function Field({ name, label, type = "text", required = false, autoComplete, defaultValue, placeholder }: {
  name: string; label: string; type?: string; required?: boolean;
  autoComplete?: string; defaultValue?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} autoComplete={autoComplete}
        defaultValue={defaultValue} placeholder={placeholder} maxLength={200} className="input" />
    </div>
  );
}
