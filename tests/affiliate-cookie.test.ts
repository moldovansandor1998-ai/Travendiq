import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signAffiliateCookie, verifyAffiliateCookie } from "@/lib/affiliate-cookie";

/**
 * Affiliate referral-cookie HMAC-tesztek – tiszta kriptográfiai egységteszt,
 * NEM igényel Supabase/Stripe környezetet (nem jelenthető "kihagyott"
 * integrációs tesztként – valóban lefut minden `npm test` alatt).
 */
describe("affiliate referral cookie (HMAC)", () => {
  const LINK = "11111111-2222-4333-8444-555555555555";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
    process.env.AFFILIATE_COOKIE_SECRET = "unit-test-secret-32-bytes-long!!";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AFFILIATE_COOKIE_SECRET;
  });

  it("érvényes cookie: aláírás + lejárat → a link ID visszaáll", () => {
    const value = signAffiliateCookie(LINK);
    expect(value).not.toBeNull();
    expect(verifyAffiliateCookie(value)).toBe(LINK);
  });

  it("módosított link ID (hamisított affiliate UUID) → null", () => {
    const value = signAffiliateCookie(LINK)!;
    const [_, expires, sig] = value.split(".");
    const forged = `99999999-8888-4777-8666-777777777777.${expires}.${sig}`;
    expect(verifyAffiliateCookie(forged)).toBeNull();
  });

  it("módosított lejárat (aláírás már nem egyezik) → null", () => {
    const value = signAffiliateCookie(LINK)!;
    const [linkId, , sig] = value.split(".");
    expect(verifyAffiliateCookie(`${linkId}.9999999999.${sig}`)).toBeNull();
  });

  it("módosított/truncált aláírás → null", () => {
    const value = signAffiliateCookie(LINK)!;
    const [linkId, expires] = value.split(".");
    expect(verifyAffiliateCookie(`${linkId}.${expires}.${"ab".repeat(32)}`)).toBeNull();
  });

  it("másik titokkal aláírt cookie → null (kliens nem tud érvényeset gyártani)", () => {
    const value = signAffiliateCookie(LINK)!;
    process.env.AFFILIATE_COOKIE_SECRET = "different-secret-also-long-enough!";
    expect(verifyAffiliateCookie(value)).toBeNull();
  });

  it("lejárt cookie → null", () => {
    const value = signAffiliateCookie(LINK)!;
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z")); // 30+ nappal később
    expect(verifyAffiliateCookie(value)).toBeNull();
  });

  it("hiányzó AFFILIATE_COOKIE_SECRET: NEM állít be cookie-t, minden feloldás null", () => {
    delete process.env.AFFILIATE_COOKIE_SECRET;
    expect(signAffiliateCookie(LINK)).toBeNull();
    // egy korábbi, érvényes cookie is érvénytelen, ha a titok eltűnik
    process.env.AFFILIATE_COOKIE_SECRET = "unit-test-secret-32-bytes-long!!";
    const value = signAffiliateCookie(LINK)!;
    delete process.env.AFFILIATE_COOKIE_SECRET;
    expect(verifyAffiliateCookie(value)).toBeNull();
  });

  it("rövid (gyenge) titok → ugyanúgy tiltott, mint a hiányzó", () => {
    process.env.AFFILIATE_COOKIE_SECRET = "short";
    expect(signAffiliateCookie(LINK)).toBeNull();
  });

  it("kliens által body/URL-ben küldött nyers UUID NEM elfogadható cookie-értékként", () => {
    // a nyers UUID-t (amit korábban a bodyban lehetett hamisítani) a verify
    // formátum-ellenőrzése eldobja – csak a <id>.<exp>.<hmac> forma érvényes
    expect(verifyAffiliateCookie(LINK)).toBeNull();
    expect(verifyAffiliateCookie("")).toBeNull();
    expect(verifyAffiliateCookie(null)).toBeNull();
    expect(verifyAffiliateCookie(`${LINK}..${"ab".repeat(32)}`)).toBeNull();
  });
});
