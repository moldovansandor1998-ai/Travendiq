import en from "./dictionaries/en.json";
import hu from "./dictionaries/hu.json";
import de from "./dictionaries/de.json";
import fr from "./dictionaries/fr.json";
import es from "./dictionaries/es.json";
import it from "./dictionaries/it.json";
import ro from "./dictionaries/ro.json";
import pl from "./dictionaries/pl.json";
import ar from "./dictionaries/ar.json";
import type { Locale } from "./locales";

export { locales, defaultLocale, rtlLocales, isLocale, resolveLocale, localeFromAcceptLanguage, isRtl } from "./locales";
export type { Locale } from "./locales";

export type Dictionary = typeof en;
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * Mind a 9 nyelv teljes szótára. A deep merge továbbra is angolra esik vissza,
 * ha egy kulcs véletlenül hiányozna valamelyik fájlból.
 */
const dicts: Partial<Record<Locale, DeepPartial<Dictionary>>> = { hu, de, fr, es, it, ro, pl, ar };

function deepMerge<T extends Record<string, unknown>>(base: T, over?: DeepPartial<T>): T {
  if (!over) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object"
        ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out as T;
}

export function getDictionary(locale: Locale): Dictionary {
  return deepMerge(en as unknown as Record<string, unknown>, dicts[locale] as Record<string, unknown>) as unknown as Dictionary;
}
