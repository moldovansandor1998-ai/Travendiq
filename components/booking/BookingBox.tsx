"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/utils";

export interface SlotInfo {
  date: string; startTime: string; remaining: number;
  priceAdult: number | null; priceChild: number | null;
}
export interface OptionInfo { id: string; name: string; deltaAdult: number; }

/** Programoldali foglalási doboz: valódi turnusok, opciók, létszám. */
export function BookingBox({
  slug, locale, currency, basePriceAdult, basePriceChild, maxParticipants,
  slots, options, hasTransfer, confirmation, labels,
}: {
  slug: string; locale: string; currency: string;
  basePriceAdult: number; basePriceChild: number | null; maxParticipants: number;
  slots: SlotInfo[]; options: OptionInfo[]; hasTransfer: boolean; confirmation: string;
  labels: { selectDate: string; bookNow: string; adults: string; children: string; infants: string;
    options: string; instant: string; manual: string; soldOut: string; perPerson: string; from: string };
}) {
  const router = useRouter();
  const dates = useMemo(() => Array.from(new Set(slots.filter((s) => s.remaining > 0).map((s) => s.date))), [slots]);
  const [date, setDate] = useState(dates[0] ?? "");
  const times = useMemo(() => slots.filter((s) => s.date === date && s.remaining > 0), [slots, date]);
  const [time, setTime] = useState(times[0]?.startTime ?? "");
  const [optionId, setOptionId] = useState(options[0]?.id ?? "");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);

  const slot = times.find((s) => s.startTime === time) ?? times[0];
  const opt = options.find((o) => o.id === optionId);
  const priceAdult = (slot?.priceAdult ?? basePriceAdult) + (opt?.deltaAdult ?? 0);
  const priceChild = (slot?.priceChild ?? basePriceChild ?? basePriceAdult) + (opt?.deltaAdult ?? 0);
  const estimate = adults * priceAdult + children * priceChild;

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!slot) return;
    const q = new URLSearchParams({
      date, time: slot.startTime, adults: String(adults),
      children: String(children), infants: String(infants),
      ...(optionId ? { option: optionId } : {}),
    });
    router.push(`/${locale}/listing/${slug}/book?${q.toString()}`);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <p className="text-2xl font-extrabold text-lagoon-950">
        {formatMoney(priceAdult, currency, locale)}
        <span className="text-sm font-normal text-lagoon-500"> / {labels.perPerson}</span>
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium text-lagoon-700">{labels.selectDate}</label>
        {dates.length === 0 ? (
          <p className="rounded-xl bg-lagoon-50 p-3 text-sm text-lagoon-600">{labels.soldOut}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <select value={date} onChange={(e) => { setDate(e.target.value); }} className="input" aria-label={labels.selectDate}>
              {dates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={slot?.startTime ?? ""} onChange={(e) => setTime(e.target.value)} className="input" aria-label="Time">
              {times.map((s) => (
                <option key={s.startTime} value={s.startTime}>
                  {s.startTime} ({s.remaining} left)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {options.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-lagoon-700">{labels.options}</label>
          <select value={optionId} onChange={(e) => setOptionId(e.target.value)} className="input">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.deltaAdult > 0 ? ` (+${formatMoney(o.deltaAdult, currency, locale)})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-sm">
        {([
          [labels.adults, adults, setAdults, 1],
          [labels.children, children, setChildren, 0],
          [labels.infants, infants, setInfants, 0],
        ] as const).map(([label, value, set, min]) => (
          <div key={label}>
            <label className="mb-1 block font-medium text-lagoon-700">{label}</label>
            <input type="number" min={min} max={maxParticipants} value={value}
              onChange={(e) => set(Math.max(min, Number(e.target.value)))} className="input px-2" />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-lagoon-100 pt-3 text-sm">
        <span className="text-lagoon-600">{labels.from}</span>
        <span className="font-bold text-lagoon-950">{formatMoney(estimate, currency, locale)}</span>
      </div>

      <button className="btn-primary w-full" type="submit" disabled={!slot}>{labels.bookNow}</button>
      <p className="text-center text-xs text-lagoon-500">
        {confirmation === "instant" ? labels.instant : labels.manual}
        {hasTransfer ? " · 🚐" : ""}
      </p>
    </form>
  );
}
