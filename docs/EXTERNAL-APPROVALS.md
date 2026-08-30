# Külső jóváhagyást / beállítást igénylő funkciók

Ez a lista pontosan rögzíti, mi működik már kód szintjén, és mihez kell külső fiók,
API-kulcs, jogi döntés vagy pénzügyi szolgáltatói jóváhagyás. **Semmi nincs
működőnek jelölve, ami nincs összekötve.**

## A. Külső fiók / API-kulcs szükséges (technikailag előkészítve)

| Funkció | Állapot | Amit nektek kell megadni |
|---|---|---|
| Supabase (DB/Auth/Storage) | Séma + RLS + seed kész | Supabase projekt URL, anon key, service role key → `.env` |
| Stripe fizetés (kártya) | PaymentIntent + webhook kód kész; kulcsok nélkül **DEV szimuláció** fut (jelölve a UI-on) | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (test → live) |
| Stripe Connect (szolgáltatói kifizetések) | **Separate charges and transfers** modell implementálva: a vásárló a platformon fizet (nincs destination charge), a szolgáltató része a platformegyenlegen marad teljesülésig, a release egyszeri idempotens Transfer (`payout_<uuid>` kulccsal, `source_transaction`-nel). Refundnál a már kifizetett rész `transfers.createReversal`-lel vonódik vissza. Onboarding UI + requirements-követés kész. **A `SUPPORTED_CONNECT_COUNTRIES` lista kizárólag előzetes UI-validáció** – a cross-border transzfer tényleges megvalósíthatósága a platform országától függ, a végső elbírálás mindig Stripe-side történik (release előtti friss `capabilities.transfers` + `payouts_enabled` ellenőrzés) | Stripe Connect aktiválás (Express), platform profil jóváhagyása a Stripe-nál; marketplace holding-szabályok egyeztetése; **a cross-border payout-megvalósíthatóság ellenőrzése a platform országából a cél szolgáltatói országok felé** (a Stripe korlátozhatja a határokon átnyúló transzfereket) |
| Resend email | Küldő + 16 sablon váz kész; kulcs nélkül **naplózott szimuláció** | `RESEND_API_KEY` + `travendiq.com` domain verifikáció (SPF/DKIM) |
| Térképes keresés / program-térkép | MapLibre GL + OSM csempék működnek (API-kulcs nélkül) | Élesben saját tile-szerver vagy szerződött szolgáltató (OSM demo tile policy miatt) |
| Apple/Google Wallet voucher | Aláírt voucher payload struktúra kész (`lib/qr.ts`) | Apple Developer + Google Wallet API hozzáférés, tanúsítványok |
| AI-alapú fordítás | `listing_translations.translated_by` mező kész | Fordító API kulcs (pl. DeepL/OpenAI) + költségkeret-döntés |
| Objektumtár (kép/videó feltöltés) | Storage bucket-struktúra specifikálva | Supabase Storage bucketek létrehozása (`listing-media`, `provider-docs` privát) |
| Rate limiting élesben | In-memory limiter működik (single instance) | Upstash Redis vagy Supabase-alapú számláló serverlesshez |
| Analitika / elhagyott kosár | Eseménystruktúra terv (docs) | GA4 / Plausible választás + cookie-hozzájárulás bekötése |

## B. Pénzügyi / jogi jóváhagyás szükséges

| Funkció | Megjegyzés |
|---|---|
| Éles pénzforgalom (PSD2) | A platform mint marketplace: Stripe Connect **platform verification** kell; ezt a Stripe bírálja el |
| Ütemezett kifizetések | Kód: `payouts` tábla + `held` státusz kész; a tényleges utalás Connect aktiválás után |
| Tartalékképzés (reserve) | `ledger_entries.kind = 'reserve'` előkészítve; szabályzat + Stripe egyeztetés kell |
| Áfa-/adókezelés | Adómezők kész (tax_id, ledger); **adószakértő egyeztetés** szükséges országonként |
| Jogi oldalak | Mind a 9 oldal struktúra + helykitöltő kész (`pages` tábla); **ügyvéd által jóváhagyott szöveg** kell launch előtt |
| GDPR adattörlés | `gdpr_requests` tábla + folyamat kész; jogi eljárásrend egyeztetendő |

## C. Kód szintjén kész és a felületről is használható

- Szolgáltatói: médiafeltöltés (tömörítéssel), naptár/slot-kezelő (bulk), kupon UI,
  munkatárs-kezelés, dokumentumfeltöltés (privát bucket), Stripe Connect onboarding
  gomb + részletes requirements/capability státusz (currently_due, past_due,
  disabled_reason), pénzügyi oldal, foglaláskezelés (visszaigazolás/refund)
- Admin: felhasználók, KYC-átvilágítás (signed URL), foglalások + refund,
  payout-release (Stripe transfer VAGY manuális referencia – bizonyíték kötelező,
  friss Stripe capability-ellenőrzéssel), jutalékszabályok, taxonómia, vélemények,
  affiliate-kezelés, kuponok, CMS, naplók, MFA (TOTP), CSV-export
- Vásárlói: kedvencek, térképes keresés, teljes szűrőkészlet, üzenetrendszer
  (kontakt-maszkolással), értékelés csak teljesített foglalás után
- QR-beléptetés: kamerás PWA-szkenner + kézi kód + részleges csoportos beléptetés
- Email: 16 sablon, outbox-alapú kézbesítés (cron), vendég-tokenes linkek
- Refund work queue: `/api/cron/refund-queue` (cron) – késői fizetések és
  sikertelen Stripe-refundok idempotens újrapróbálása (attempts/backoff/
  manual_review + adminriasztás), beadatlan reversalok crash-recovery-je
- Affiliate: `/r/[code]` kattintáskövetés + cookie-attribúció + jutalék-visszavonás

## D. Élesítés előtt bizonyítandó (Stripe test mód)

A payment / refund / Transfer Reversal / chargeback / webhook-retry folyamatokra
léteznek valódi test-mode integrációs tesztek (`tests/integration/stripe-flows.test.ts`),
amelyek a **`npm run test:stripe`** paranccsal futnak. A parancs KÖTELEZŐEN
megköveteli a `STRIPE_SECRET_KEY=sk_test_...` + `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` környezeti változókat – hiányukban **hibával áll le**
(nem csendben skippeli a teszteket).
**Production-ready állapot csak ezek sikeres lefutása után jelenthető ki.**

## E. Tesztelési státusz

| Terület | Állapot |
|---|---|
| Egységtesztek (jutalék, visszatérítés, státuszgép, pénz-integritás, biztonsági segédek, validáció) | ✅ vitest – `npm run test` |
| Typecheck / lint / build | ✅ CI-ban is futtatható |
| Stripe test-mode pénzügyi integrációs tesztek (payment, refund, reversal, chargeback, webhook-retry, késői fizetés) | ✅ elkészítve – `npm run test:stripe` (élő kulcsokkal; hiányzó env → hiba, nem skip) |
| Kapacitás-/versenyhelyzet-tesztek (DB-szintű, Supabase local vagy távoli) | ✅ `tests/integration/capacity-race.test.ts` |
| E2E (Playwright, desktop + mobil) | ✅ `tests/e2e/` – `npm run test:e2e` |
| RLS integrációs tesztek (Supabase) | ✅ `tests/integration/` (service- + anon-klienssel) |
