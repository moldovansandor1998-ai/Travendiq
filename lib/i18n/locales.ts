/**
 * A támogatott locale-lista EGYETLEN forrása. Minden belépési pont
 * (middleware, /r/[code], API-k, oldalak) KIZÁRÓLAG ebből választhat
 * locale-t – kliensbemenet önmagában sosem mérvadó.
 */
export const locales = ["en", "hu", "de", "fr", "es", "it", "ro", "pl", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const rtlLocales: readonly Locale[] = ["ar"];

export function isLocale(v: string): v is Locale {
  return (locales as readonly string[]).includes(v);
}

/**
 * Biztonságos locale-feloldás tetszőleges bemenetből (URL-részlet,
 * Accept-Language fejléc, űrlapmező). Csak engedélyezett locale-t ad vissza,
 * egyébként a defaultLocale-t.
 */
export function resolveLocale(candidate: string | null | undefined): Locale {
  if (!candidate) return defaultLocale;
  const two = candidate.trim().toLowerCase().replace(/^\/+|\/.*$/g, "").slice(0, 2);
  return isLocale(two) ? two : defaultLocale;
}

/** Accept-Language fejlécből az első támogatott locale. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return defaultLocale;
  for (const part of header.split(",")) {
    const code = part.trim().split(";")[0]?.trim().toLowerCase().slice(0, 2) ?? "";
    if (isLocale(code)) return code;
  }
  return defaultLocale;
}

/** RTL-e az adott locale (ar). */
export function isRtl(locale: Locale): boolean {
  return rtlLocales.includes(locale);
}
