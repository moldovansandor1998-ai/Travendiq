import { createHmac, timingSafeEqual } from "crypto";

/**
 * Affiliate referral-cookie HMAC-aláírással.
 *
 * A sima httpOnly cookie NEM védi ki, hogy egy módosított HTTP-kliens
 * tetszőleges, ismert affiliate link UUID-t küldjön. Ezért a cookie értéke:
 *
 *   <linkId>.<expiresAt>.<hmac>
 *
 * ahol hmac = HMAC-SHA256(AFFILIATE_COOKIE_SECRET, "<linkId>.<expiresAt>").
 *
 *  - AFFILIATE_COOKIE_SECRET: KÖTELEZŐ, külön, erős titok (min. 16 karakter);
 *  - hiányzó titok esetén NEM állítunk be cookie-t és minden feloldás null;
 *  - hibás formátum, hibás aláírás vagy lejárt cookie → null;
 *  - a titok sosem kerül kliensbundle-be (szerveroldali modul).
 */

const TTL_SECONDS = 30 * 86400; // 30 nap – a régi cookie maxAge-jével azonos

function secret(): string | null {
  const s = process.env.AFFILIATE_COOKIE_SECRET;
  return s && s.length >= 16 ? s : null;
}

export function signAffiliateCookie(linkId: string): string | null {
  const key = secret();
  if (!key) {
    console.error("[affiliate] AFFILIATE_COOKIE_SECRET hiányzik vagy túl rövid – cookie NEM kerül beállításra");
    return null;
  }
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${linkId}.${expires}`;
  const sig = createHmac("sha256", key).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/**
 * A cookie értékének ellenőrzése és feloldása.
 * Visszatérés: a link UUID, ha a formátum, az aláírás ÉS a lejárat rendben van;
 * egyébként null (a foglalás affiliate-mentesen megy tovább – sosem hiba).
 */
export function verifyAffiliateCookie(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = secret();
  if (!key) return null; // titok nélkül SEMMILYEN cookie nem érvényes

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [linkId, expiresRaw, sig] = parts;
  if (!/^[0-9a-fA-F-]{36}$/.test(linkId)) return null;
  const expires = Number(expiresRaw);
  if (!Number.isSafeInteger(expires)) return null;
  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;

  const expected = createHmac("sha256", key).update(`${linkId}.${expiresRaw}`).digest("hex");
  // konstans idejű összehasonlítás (timing-támadás ellen)
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (expires * 1000 <= Date.now()) return null; // lejárt
  return linkId.toLowerCase();
}

/** A cookie beállításakor használt maxAge (másodperc). */
export const AFFILIATE_COOKIE_MAX_AGE = TTL_SECONDS;
