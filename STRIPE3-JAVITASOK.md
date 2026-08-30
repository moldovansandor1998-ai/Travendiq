# Stripe (3) javítási csomag – átadási jegyzék

Dátum: 2026-08-30. A 00001–00019 migrációk érintetlenek; minden javítás új
migrációban (00020, 00021) vagy alkalmazáskódban történt.
**Telepítési sorrend: …00019 → 00020 → 00021.**

## A legsúlyosabb hiba: releasing payout × refund ütközés

A `settle_refund` eddig a 'releasing' (külső Stripe Transfer alatt álló) payout
összegét is átírhatta → a Stripe-on átutalt összeg eltérhetett a DB-ben és a
ledgerben könyvelttől. Javítás (00020):

- `settle_refund` v4 a **'releasing' payoutot soha nem módosítja**. Helyette
  tartós kötelezettség jön létre: `payout_reversals` sor,
  `status='awaiting_transfer'`, idempotencia-kulcs `oblref_<refundUuid>`.
- `finalize_payout_release` v3 a **ténylegesen átutalt összeget** könyveli
  (`p_transferred_amount` – a Stripe transfer válaszából), a ledger 'payout'
  tétel ezzel egyezik, majd az `awaiting_transfer` kötelezettségeket
  **'requested'-be váltja és visszaadja** a hívónak.
- Az admin payout route a finalize által visszaadott kötelezettségeket
  **azonnal beküldi a Stripe-nak** (automatikus reversal-korrekció).
- A release-folyamat a Transfer **előtt** (acquire: payout_blocked + friss
  Connect-capability) és **után** (finalize: közben keletkezett kötelezettségek
  aktiválása) is kezeli a refund/chargeback hatásokat.

## Reversal állapotgép (00020)

`requested → submitting → submitted → succeeded`, mellette `stripe_failed`
(Stripe API elutasítás), `reconciliation_required` (emberi rendezés),
`awaiting_transfer` (releasing alatti kötelezettség). A korábbi `failed` sorok
`stripe_failed`-re migrálódnak. A `failed` többé NEM jelentheti egyszerre a
Stripe-elutasítást és a helyi DB-hibát:

- **Stripe-hiba** → `stripe_failed` + admin riasztás.
- **Stripe-siker + `record_reversal_sent` DB-hiba** → a sor `requested` marad
  (TILOS failed-re tenni); a webhook kivételt dob → az esemény failed → a
  Stripe újraküldi → a replay **ugyanazzal az idempotencia-kulccsal** egyezteti
  a már létező reversalt (a Stripe oldalán sem jön létre duplikáció).

## request_payout_reversal v2 – nincs csendes kilépés

Replay esetén is visszaadja: `reversal_row_id`, `transfer_id`,
`requested_amount`, `status`, `stripe_reversal_id`, `idempotency_key`. Ha a sor
`requested` és nincs `stripe_reversal_id`, a beküldés ugyanazzal a kulccsal
újrafuttatható (`submitPayoutReversal`). `p_cap=true` módban (chargeback) a
kívánt összeg helyett csak az **elérhető különbözet** kerül be:
`available = amount − (succeeded + requested/submitting/submitted +
awaiting_transfer)` – sorzár alatt, nincs elnyelt REVERSAL_EXCEEDS_PAYOUT.

## Chargeback

- `handle_chargeback` v2: a reversal-összeg az **adatbázisban, sorzárral** dől
  el (cap a fent szerint); 'releasing' payoutnál `awaiting_transfer`
  kötelezettség keletkezik.
- `resolve_chargeback_won(p_booking, p_dispute)` v2: **kizárólag a konkrét
  dispute-hoz tartozó** succeeded reversalok összege kerül az új 'scheduled'
  payoutba (`hold_reason = 'chargeback_won_retransfer:<dispute>'`,
  `origin_payout_id`). Korábbi refund-reversal sosem tér vissza a
  szolgáltatónak chargeback-won miatt.

## Refund work queue (00021 + `/api/cron/refund-queue`)

- `refunds` új mezők: `attempts`, `next_retry_at`, `locked_at`, `locked_by`,
  `last_error`; végleges státusz: `manual_review`.
- RPC-k: `claim_due_refunds` (SKIP LOCKED, lejárt processing-zárakkal együtt),
  `fail_refund_attempt` (exponenciális backoff, 8 próbálkozás után
  manual_review + audit + admin email), `mark_refund_submitted`,
  `claim_due_reversals` (beadatlan reversalok crash-recovery-je).
- A késői fizetés webhookja **nem tekinti rendezettnek** a pending refundot:
  csak sorba állítja (`next_retry_at = now()`) + kötelező adminriasztás; a
  tényleges Stripe-hívást a cron végzi, idempotens kulccsal.
- `vercel.json`: a `/api/cron/refund-queue` percenként fut.

## Egyéb

- Az `src/app/api/admin/payouts/route.ts` végéről törölve a duplikált,
  elérhetetlen `return NextResponse.json(...)`.

## Módosított fájlok

| Fájl | Változás |
|---|---|
| `supabase/migrations/00020_reversal_state_machine.sql` | ÚJ – lásd fent (régi aláírások drop + v2/v3/v4 RPC-k) |
| `supabase/migrations/00021_refund_work_queue.sql` | ÚJ – refund queue mezők + claim/fail/mark RPC-k |
| `src/lib/payments/reversals.ts` | ÚJ – `submitPayoutReversal` (Stripe/DB-hiba szétválasztás, idempotens replay) |
| `src/lib/refunds/queue.ts` | ÚJ – `processDueRefunds`, `processDueReversals` |
| `src/app/api/cron/refund-queue/route.ts` | ÚJ – CRON_SECRET-es cron végpont |
| `src/lib/webhooks/stripe-handlers.ts` | reversePaidPayout törölve; charge.refunded a DB-ben létrejött reversal-sorokat küldi be; dispute.created a v2 cap-elt sort; dispute.closed dispute-ID-val; késői fizetés queue-ba állítás + riasztás; transfer.reversed transfer-ID fallback |
| `src/lib/payments/stripe.ts` | `transferToProvider` visszaadja a tényleges összeget |
| `src/app/api/admin/payouts/route.ts` | finalize v3 + kötelezettség-beküldés + duplikált return törlése |
| `vercel.json` | refund-queue cron |
| `tests/integration/stripe-flows.test.ts` | 17 → **23** forgatókönyv (újak: 18–23) |
| `README.md`, `docs/SECURITY.md`, `docs/TEST-ACCOUNTS.md`, `docs/EXTERNAL-APPROVALS.md` | dokumentáció igazítva |

## Valódi parancs-kimenetek (ez a csomag állapotán)

| Parancs | Eredmény |
|---|---|
| `npm ci` | sikeres |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 warning |
| `npm test` | exit 0 – **58 futott / 58 sikeres, 28 kihagyva** (23 stripe-flows + 5 capacity-race: élő env nélkül szándékosan skip) |
| `npm run build` | exit 0, Compiled successfully |
| `npm run test:stripe` (env nélkül) | exit 1 – szándékos hangos hiba |
| pglast SQL-parse (00020, 00021) | mindkettő OK |

## Fontos: a test:stripe zöld futása nem a sandboxban történt

A kérésnek megfelelően a 23 forgatókönyv **bekötve elkészült** és hiányzó env
esetén a parancs hibával áll le. A sandboxban azonban **nem áll rendelkezésre
valódi `sk_test_` kulcs és teszt Supabase-projekt**, ezért a tényleges zöld
lefutást nem tudom bemutatni – a dokumentációban szereplő állítás ezt nem
pótolja. Futtatás:

```bash
STRIPE_SECRET_KEY=sk_test_... \
SUPABASE_URL=https://<teszt-proj>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run test:stripe
```

**Production-ready állapot továbbra sem jelenthető ki** addig, amíg ez a futás
zölden le nem ment a ti környezetekben.
