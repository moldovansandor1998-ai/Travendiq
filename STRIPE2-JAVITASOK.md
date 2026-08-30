# Stripe (2) javítási csomag – átadási jegyzék

Dátum: 2026-08-30. A 00001–00015 migrációk érintetlenek maradtak; minden javítás
új migrációban (00016–00019) vagy alkalmazáskódban történt.

## A legkritikusabb hiba javítása

Sikeres refund után a `held` payout eredeti összege változatlan maradt, és a
refund lezárása után újra felszabadíthatóvá vált. Javítás (00016):

- `settle_refund` v3: a refund rendezésével **ugyanabban a tranzakcióban** a ki
  nem fizetett payout sorát zárolja (`FOR UPDATE`), és a sikeres refundok
  szolgáltatói részének ÖSSZEGÉVEL számolva csökkenti az összeget
  (`amount = provider_amount − Σ provider_share`). Kumulatív alapú → az
  újrapróbálkozás/webhook-duplikáció nem vonhat le kétszer.
- Ha a visszatérített szolgáltatói rész eléri a `provider_amount`-ot →
  `payouts.status = 'cancelled'`, `hold_reason = 'cancelled_after_full_refund'`.
  A `cancelled` nincs az `acquire_payout_release` engedélyezett státuszai közt,
  az acquire ráadásul `p.amount > 0`-t is megkövetel → az összeg soha nem
  szabadítható fel újra.
- `payout_blocked` v2: blokkol, ha a booking `refunded`, VAGY a sikeres refundok
  összege eléri a `grand_total`-t (a lezárt refund után is blokkolva marad).

## Új migrációk (telepítési sorrend: 00016 → 00017 → 00018 → 00019)

| Fájl | Tartalom |
|---|---|
| `supabase/migrations/00016_payout_refund_adjustment.sql` | `payout_status` + `'cancelled'`; `payout_blocked` v2 (teljes sikeres refund is blokkol); `settle_refund` v3 (atomikus payout-csökkentés / teljes refundnál cancelled); `acquire_payout_release` v2 (`amount > 0`) |
| `supabase/migrations/00017_payout_reversals.sql` | `payout_reversals` tábla (payout_id, refund_id, dispute_id, requested_amount, stripe_reversal_id, idempotency_key, status, failure) + RLS; `request_payout_reversal` (sorzár + committed = requested+succeeded korlát, `REVERSAL_EXCEEDS_PAYOUT`); `record_reversal_sent`; `settle_payout_reversal` (trr_-szerinti, idempotens); `settle_transfer_reversed_aggregate` (csak delta könyvelés, `agg_*` kulccsal); `fail_payout_reversal_row` |
| `supabase/migrations/00018_late_payment_and_chargeback_won.sql` | `payouts.origin_payout_id` + az egyedi index szűkítése az eredeti payoutokra; `settle_payment_success` v2 (késői fizetés: NINCS payout, booking → `disputed`, automatikus teljes refund-kérelem, kapacitás NEM foglalódik vissza); `resolve_chargeback_won` (kontrollált új `scheduled` payout a visszavont összegre, idempotens) |
| `supabase/migrations/00019_webhook_claim_hardening.sql` | 00010 inkonzisztens sorainak javítása (`processed` + `processed_at IS NULL` → `failed`, újra claimelhető); `finish_payment_event` v2: boolean, CSAK `locked_by = p_worker` ÉS `status = 'processing'` esetén zár |

## Módosított alkalmazásfájlok

| Fájl | Változás |
|---|---|
| `src/lib/webhooks/stripe-handlers.ts` | `reversePaidPayout` átírva a `payout_reversals`-folyamatra (refund_id/dispute_id + idempotencia-kulcs, REVERSAL_EXCEEDS_PAYOUT tűrés, record/fail + admin-riasztás); `handlePaymentSucceeded` késői-fizetés ág (riasztás + automatikus valódi Stripe-refund, korai return – nincs confirmation-email); `handleChargeRefunded` refund_id-t ad át; `handleDisputeCreated` dispute_id-t ad át; `handleDisputeClosed` 'won' → `resolve_chargeback_won`; `handleTransferReversed` trr_-enkénti settle + aggregált delta-fallback |
| `src/app/api/webhooks/stripe/route.ts` | `finish_payment_event` boolean-kezelés: `false` (lock elveszett / stale worker) → 500, a Stripe újraküldi |
| `src/app/api/bookings/manage/route.ts` | a duplikált inline Stripe-refund logika TÖRÖLVE; kizárólag a központi `requestRefund()`; sikertelen refund-indításnál 502 + valódi hiba (`cancelled: true`), sosem `ok:true` |
| `src/app/api/admin/payouts/route.ts` | MINDEN kritikus Supabase-hívás hibája ellenőrzött: hold update (sor-egyezés is), audit insert, abort (hibája a válaszban), Connect-szinkron, charge-ID backfill, transfer-failed audit, finalize-abort, email enqueue (emailQueued/emailError a válaszban) |
| `src/lib/payments/stripe.ts` | dokumentáció: a `SUPPORTED_CONNECT_COUNTRIES` kizárólag előzetes UI-validáció; a cross-border transzfer végső elbírálása Stripe-side (friss capability-ellenőrzés) |
| `package.json` | `test:stripe` (REQUIRE_STRIPE_IT=1, kötelező), `test:integration` |
| `tests/integration/stripe-env.ts` | ÚJ: hiányzó/érvénytelen env esetén importáláskor dob → a futás hibával áll le, nincs csendes skip |
| `tests/integration/stripe-flows.test.ts` | 10 → 17 forgatókönyv; a 4-es teszt az új viselkedést várja (`cancelled`); újak: 11) részleges refund payout előtt → release a korrigált összeggel, 12) két refund a reversal webhook előtt (committed-cap), 13) refund + azonnali chargeback, 14) késői PI lejárt foglaláshoz (nincs payout, auto refund, disputed), 15) lock-timeout + stale worker finish, 16) chargeback won reversal után (új scheduled payout, idempotens), 17) ismételt aggregált amount_reversed (delta-könyvelés) |
| `README.md`, `docs/SECURITY.md`, `docs/TEST-ACCOUNTS.md` | a `test:stripe` kötelező parancs + 17 forgatókönyv dokumentálva |
| `docs/EXTERNAL-APPROVALS.md` | cross-border megjegyzés (a lista előzetes UI-validáció; a megvalósíthatóság a platform országától függ, Stripe-side dől el); tesztstátusz tábla aktualizálva (E2E + RLS tesztek léteznek) |

## Valódi parancs-kimenetek (ez a csomag állapotán)

| Parancs | Eredmény |
|---|---|
| `npm ci` | sikeres (csak install-script figyelmeztetések: esbuild, unrs-resolver) |
| `npm run typecheck` | exit 0, hiba nélkül |
| `npm run lint` | exit 0, 0 warning |
| `npm test` | exit 0 – **58 teszt futott, 58 sikeres; 22 kihagyva** (17 stripe-flows + 5 capacity-race: élő Stripe/Supabase env nélkül szándékosan skip) |
| `npm run build` | exit 0, `Compiled successfully` |
| `npm run test:stripe` (env NÉLKÜL) | exit 1 – szándékos, hangos hiba: „A Stripe integrációs tesztek NEM lettek kihagyva – a futtatás kötelező környezeti változói hiányoznak…" |
| pglast SQL-parse (00016–00019) | mind a 4 migráció parse-olható |

A 17 Stripe-forgatókönyv tényleges zöld lefutásához valódi `sk_test_` kulcs +
Supabase service key kell (`npm run test:stripe`) – ezek a sandboxból nem
érhetők el, ezért a csomagban a tesztek elkészítve és bekötve vannak, de a
test-mode bizonyítás nálatok futtatandó.

## Nem production-ready

A korábbi kitétel érvényben marad: **production-ready állapot csak akkor
jelenthető ki, ha a payment, refund, Transfer Reversal, chargeback és webhook
retry folyamatok a `npm run test:stripe` segítségével Stripe test módban zölden
lefutottak.**
