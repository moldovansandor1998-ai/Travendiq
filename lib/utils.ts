/** Összeg formázása a legkisebb pénzegységből (cent). */
export function formatMoney(cents: number, currency: string, locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** Locale-érzéketlen, kompakt időtartam ("3 h 30 min" / "45 min"). */
export function formatDuration(minutes: number | null, _locale = "en"): string {
  if (!minutes) return "–";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
