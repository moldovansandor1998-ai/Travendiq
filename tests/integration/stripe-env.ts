/**
 * Kötelező környezet-ellenőrzés a Stripe test-mode integrációs tesztekhez.
 *
 * - Normál `npm test` alatt a modul INERT: csak a LIVE jelzést exportálja,
 *   a tesztfájlok describe.skipIf-fel döntenek.
 * - `REQUIRE_STRIPE_IT=1` mellett (npm run test:stripe) hiányzó vagy érvénytelen
 *   környezeti változó esetén a modul IMPORTÁLÁSKOR HIBÁT DOB – a futás azonnal
 *   leáll non-zero exittel. Nincs csendes skip.
 */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const STRIPE_TEST_ENV = {
  STRIPE_SECRET_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
};

export const STRIPE_IT_LIVE =
  STRIPE_SECRET_KEY.startsWith("sk_test_") &&
  SUPABASE_URL.startsWith("http") &&
  !SUPABASE_URL.includes("placeholder") &&
  SUPABASE_SERVICE_ROLE_KEY.length > 20;

if (process.env.REQUIRE_STRIPE_IT === "1" && !STRIPE_IT_LIVE) {
  const missing: string[] = [];
  if (!STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY (nincs megadva)");
  else if (!STRIPE_SECRET_KEY.startsWith("sk_test_")) {
    missing.push("STRIPE_SECRET_KEY (csak sk_test_ kulccsal futtatható – éles kulccsal TILOS)");
  }
  if (!SUPABASE_URL.startsWith("http") || SUPABASE_URL.includes("placeholder")) {
    missing.push("SUPABASE_URL vagy NEXT_PUBLIC_SUPABASE_URL (valódi projekt URL kell)");
  }
  if (SUPABASE_SERVICE_ROLE_KEY.length <= 20) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY (service role kulcs kell)");
  }
  throw new Error(
    `[test:stripe] A Stripe integrációs tesztek NEM lettek kihagyva – ` +
    `a futtatás kötelező környezeti változói hiányoznak vagy érvénytelenek:\n  - ` +
    missing.join("\n  - ") +
    `\nPélda:\n  STRIPE_SECRET_KEY=sk_test_... SUPABASE_URL=https://<proj>.supabase.co ` +
    `SUPABASE_SERVICE_ROLE_KEY=... npm run test:stripe`
  );
}
