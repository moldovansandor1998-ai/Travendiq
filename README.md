# Travendiq

Nemzetközi program-, élmény- és jegyfoglaló piactér (marketplace).
**Stack:** Next.js 14 (App Router) · TypeScript · Supabase (DB + Auth + Storage) · Stripe Connect · Resend · Tailwind CSS · Vercel.

> Demo/teszt állapot: a seed Hurghada programok `draft` + `is_test` állapotúak,
> amíg az árakat, napokat és leírásokat véglegesen nem ellenőriztétek.

---

## 1. Gyors indítás (helyi fejlesztés)

```bash
# 1) Függőségek
npm install

# 2) Supabase projekt létrehozása (supabase.com) vagy helyi: npx supabase start

# 3) Környezeti változók
cp .env.example .env.local   # töltsd ki a Supabase URL + kulcsokat

# 4) Adatbázis: migrációk + seed
#    Supabase Dashboard > SQL Editor-ben futtasd sorban (telepítési sorrend):
#    supabase/migrations/00001_init.sql
#    supabase/migrations/00002_rls.sql
#    supabase/migrations/00003_functions.sql
#    supabase/migrations/00004_hardening.sql
#    supabase/migrations/00005_storage.sql
#    supabase/migrations/00006_constraints.sql
#    supabase/migrations/00007_money_integrity.sql
#    supabase/migrations/00008_refund_flow.sql
#    supabase/migrations/00009_webhook_integrity.sql
#    supabase/migrations/00010_webhook_claim.sql
#    supabase/migrations/00011_settle_payment.sql
#    supabase/migrations/00012_email_outbox.sql
#    supabase/migrations/00013_refund_matching.sql
#    supabase/migrations/00014_chargeback_reversal.sql
#    supabase/migrations/00015_connect_and_finalize.sql
#    supabase/seed.sql
#    (vagy CLI-vel: npx supabase db push)

# 5) Indítás
npm run dev          # http://localhost:3000 → /en vagy /hu

# 6) Ellenőrzések
npm ci               # tiszta telepítés (lockfile-ból)
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run test         # vitest egységtesztek (+ env-gated integrációs tesztek)
npm run test:e2e     # Playwright UI-smoke (desktop + mobil)
npm run build        # production build
```

### Stripe test-mode integrációs tesztek

A `tests/integration/stripe-flows.test.ts` valós Stripe test-kulccsal fut
(30 forgatókönyv: sikeres fizetés + ismételt webhook, párhuzamos claim, két
azonos összegű részleges refund, teljes refund payout előtt → payout végleg
cancelled, részleges refund payout előtt → release csak a korrigált összeggel,
refund payout után Transfer Reversallal, két refund a reversal webhook előtt
(committed-cap), refund + azonnali chargeback, chargeback előtt/után,
chargeback megnyerve reversal után → kontrollált új payout CSAK a dispute
összegével, késői fizetés lejárt foglaláshoz → auto refund a refund work
queue-ból, refund RELEASING payout alatt → awaiting_transfer kötelezettség +
automatikus reversal a finalize után (ledger == tényleges Transfer), crash a
reversal-kérés után → teljes sorú replay azonos kulccsal, Stripe-siker +
DB-mentési hiba → sor NEM failed, pending refund-reversal + azonnali chargeback
(cap), refund-cron retry + manual_review, webhook lock-timeout + stale worker,
finalize-hiba retry, webhook DB-hiba, sikertelen e-mail outbox, ismételt
aggregált amount_reversed, Connect disabled/past_due, Transfer sikeres +
finalize DB-hiba → transfer_submitted + refund közben + cron-retry az EREDETI
összeggel/tr_ ID-val, Transfer hálózati timeout miközben létrejött → azonos
idempotencia-kulcsú retry az eredetit adja vissza, Reversal timeout miközben
létrejött → azonos kulcsú egyeztetés dupla reversal nélkül, két azonos összegű
azonosító nélküli reversal → NINCS vak párosítás, reconciliation_required
árva-sorok, metadata alapú refund/dispute párosítás azonos összegű társ
mellett, manuális payout közben érkező refund → reconciliation_required +
manuális rendezés banki referenciával/dátummal/összeggel/adminnal/jegyzettel +
audit, a transfer attempt összege a folyamat közben sosem változik):

```bash
STRIPE_SECRET_KEY=sk_test_... \
SUPABASE_URL=https://<proj>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run test:stripe
```

A `test:stripe` KÖTELEZŐ parancs: hiányzó/érvénytelen környezeti változó esetén
hibával áll le (nem skippeli csendben a teszteket).

### Webhook-ellenőrzés Stripe CLI-vel

```bash
stripe listen --forward-to https://<host>/api/webhooks/stripe
# a kapott whsec_... → STRIPE_WEBHOOK_SECRET
stripe trigger payment_intent.succeeded
stripe trigger charge.refunded
stripe trigger charge.dispute.created
stripe trigger account.updated
```
A végpont atomikusan claimeli az eseményt (`claim_payment_event`), hiba esetén
500-at ad (Stripe retry), és csak a DB-műveletek sikere után lesz `processed`.
Az emailek a webhookból az `email_outbox` táblába kerülnek, onnan küldi őket
a `/api/cron/email-outbox` (Vercel Cron, percenként, `CRON_SECRET` Bearer).

## 2. Tesztfiókok (seed)

| Szerepkör | Email | Jelszó |
|---|---|---|
| Szolgáltató (jóváhagyott, Hurghada Programok) | `provider@demo.travendiq.com` | `TravendiqDemo1` |
| Admin | `admin@demo.travendiq.com` | `TravendiqDemo1` |

Vásárlói fiók: bármilyen emaillel magic linkkel (`/hu/auth/login`) vagy vendégként foglalhatsz.

**Demo E2E folyamat kipróbálása:**
1. Jelentkezz be adminként → `/hu/admin/listings` → publikáld a demo programokat.
2. Látogass el egy programadatlapra → Foglalás → töltsd ki az űrlapot.
3. Stripe kulcsok nélkül a checkout **DEV módban** fut: „Sikeres fizetés szimulálása” gomb.
4. A visszaigazoló oldalon megjelenik a foglalási kód, QR-kód és a voucher-link.

## 3. Projektfelépítés

```
supabase/migrations/   DB séma, RLS, üzleti logika (SQL)
supabase/seed.sql      demo adatok
src/app/[locale]/      lokalizált oldalak (en/hu/de…)
src/app/api/           fizetés, webhook, voucher, beléptetés, hírlevél
src/lib/               supabase, i18n, booking, payments, email, qr, rate-limit
tests/                 vitest egységtesztek
docs/                  beállítási és státuszdokumentumok
```

## 4. Mi készült el / mi vár külső jóváhagyásra

Részletes, pontos lista: **[docs/EXTERNAL-APPROVALS.md](docs/EXTERNAL-APPROVALS.md)**

Röviden — **működik kód szintjén:**
- teljes DB-séma (40+ tábla), RLS minden táblán, audit + státusznapló
- 7 szerepkör, többszerep támogatás (`user_roles`)
- foglalási folyamat kapacitás-zárolással (`create_booking` RPC, `FOR UPDATE`)
- státuszgép, idempotens fizetés, webhook-aláírás ellenőrzés
- **separate charges and transfers** Connect-modell: a pénz a platformegyenlegen
  marad teljesülésig, a kifizetés egyszeri idempotens Transfer (sorzár + bizonyíték)
- refund: belső UUID-alapú Stripe-idempotencia, `provider_refund_id` szerinti
  egyenkénti egyeztetés, már kifizetett transzfernél `transfers.createReversal`
- chargeback: payout-blokk + paid transzfer reversal-folyamat (részleges is)
- webhook: atomikus claim/lock (processing/processed/failed + attempts + lock timeout)
- email outbox: a pénzügyi folyamatokból külön, idempotens, cron-feldolgozott küldés
- voucher + HMAC-aláírt QR, beléptető API (részleges csoportos beléptetés, offline flag)
- jutalékfeloldás (listing > provider > country > global), főkönyv, visszatartott kifizetés
- visszatérítés-kalkulátor (SQL + TS tükör, tesztelve)
- provider-független fizetési réteg (Stripe az első implementáció)
- Resend email-küldő + reszponzív sablonváz (kulcs nélkül szimulált küldés)
- i18n: 9 teljes szótár (en/hu/de/fr/es/it/ro/pl/ar), RTL támogatás (ar)
- admin jóváhagyási felületek, szolgáltatói regisztráció + dashboard

**Külső fiók/kulcs kell hozzá:** Supabase projekt, Stripe (Connect), Resend domain,
térkép-szolgáltató, Apple/Google Wallet, éles pénzügyi működéshez szolgáltatói jóváhagyások –
részletek a fenti dokumentumban.

## 5. Biztonság

Lásd **[docs/SECURITY.md](docs/SECURITY.md)** – RLS-mátrix, audit, rate limiting,
idempotencia, GDPR-funkciók és a még hátralévő hardening lista.

## 6. Deploy (Vercel)

1. GitHub repo → Vercel import.
2. Environment Variables: `.env.example` szerinti értékek (production Stripe/Resend kulcsok).
3. Supabase: production projekt, migrációk lefuttatása.
4. Stripe webhook URL: `https://travendiq.com/api/webhooks/stripe` → `STRIPE_WEBHOOK_SECRET`.
5. Resend: `travendiq.com` domain verifikálás (SPF/DKIM).
