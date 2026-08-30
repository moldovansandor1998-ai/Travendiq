# Biztonsági és technikai ellenőrzési jelentés (Travendiq MVP)

## Megvalósított védelmek

### Jogosultság és adatelkülönítés
- **RLS minden táblán** (`00002_rls.sql`): 44 tábla, mindegyiken engedélyezve.
- Helper függvények `security definer` módban: `has_role`, `is_staff`, `is_admin`,
  `is_provider_member`, `has_provider_permission` – RLS-rekurzió nélkül.
- Kritikus mezők kliensoldali írása **`revoke update`-tel tiltva**:
  - `providers`: stripe_account_id, status, commission_override…
  - `listings`: status, is_featured, rating_avg, booking_count…
  - `bookings`: összes pénzügyi mező (grand_total, commission_amount…)
- Foglalás INSERT kizárólag a `create_booking` **security definer RPC**-n át –
  kliens nem írhat árakat/jutalékot.
- `ledger_entries` **append-only**: nincs update/delete policy.
- Service-role kulcs kizárólag szerveroldalon (`createServiceClient`).

### Pénzügyi integritás
- Kapacitás-zárolás: `SELECT … FOR UPDATE` az availability soron → túlfoglalás kizárva.
- Idempotencia: `bookings.idempotency_key`, `payments.idempotency_key`,
  `payment_events (provider, provider_event_id)` unique.
- **Connect-modell: separate charges and transfers** – a pénz a platform
  Stripe-egyenlegén marad a teljesülésig (valódi visszatartás, nem csak DB-jelölés);
  a kifizetés egyszeri idempotens Transfer (`payout_<uuid>`), `source_transaction`-nel.
- **Refund-egyeztetés**: minden Stripe refund a saját `provider_refund_id` (re_...)
  alapján zárul (`settle_refund_by_stripe_id`); a refund Stripe-idempotencia-kulcsa
  a belső refund UUID (`refund_<uuid>`) → két azonos összegű részleges refund is külön rekord.
- **Transfer Reversal**: már kifizetett transzfer refund/chargeback esetén
  `transfers.createReversal` (részleges is); elégtelen connected-account balance →
  `reversal_status='failed'` + admin riasztás (audit + outbox email).
- **Chargeback**: `handle_chargeback` egy tranzakcióban blokkol (payout_blocked),
  a paid payoutra reversal-folyamat indul; dispute lezárásakor won/lost könyvelés.
- **Payout**: `acquire_payout_release` (FOR UPDATE) → `finalize_payout_release`
  a payout + ledger + audit EGYETLEN tranzakcióban; 'paid' csak bizonyítékkal
  (tr_ transfer ID vagy manuális referencia+dátum+megjegyzés); release előtt friss
  Stripe capability-ellenőrzés (`accounts.retrieve`).
- **Transfer-attempt állapotgép** (`payout_transfer_attempts`): az acquire ATOMIKUSAN
  befagyasztja a kifizetés pontos összegét + idempotencia-kulcsát – ettől a refund
  már csak reversal-kötelezettséget hozhat létre, az összeget nem módosíthatja.
  Sikeres Transfer + hibás helyi finalize → 'transfer_submitted' (SOSEM vissza
  módosítható 'scheduled'-be); a cron az EREDETI összeggel/kulccsal fejezi be.
  Timeout/bizonytalan Stripe-hiba → 'ambiguous', azonos kulccsal újraegyeztethető
  (dupla Transfer nem keletkezhet); csak az egyértelmű Stripe-elutasítás végleges.
- **Reversal-párosítás**: a `createReversal` metadata-t küld (reversal_row_id,
  refund_id/dispute_id, idempotency_key, payout_id); a `transfer.reversed` webhook
  elsősorban ezzel párosít. Metadata nélküli reversal csak akkor settle-lődik, ha
  PONTOSAN EGY azonos összegű jelölt van – különben 'reconciliation_required'
  árva-sor + audit, a reversed_amount nem nő. Manuális kifizetésnél (nincs tr_) a
  kötelezettség automatikusan 'reconciliation_required' + admin riasztás; a
  rendezés kötelező mezőkkel (banki referencia, dátum, összeg, admin, jegyzet) és
  audit-tal történik (`resolve_reversal_manually`).
- **Webhook claim/lock**: `claim_payment_event` atomikus; egy eseményt egyszerre
  egy worker dolgoz fel; státusz: processing/processed/failed + attempts + lock
  timeout; hiba esetén 500 → Stripe retry; processed csak sikeres DB-műveletek után.
- **payment_intent.succeeded** teljes könyvelése egyetlen idempotens RPC-ben
  (`settle_payment_success`: payment + booking + ledger + payout).
- Fizetés indítása előtt `prepare_booking_payment`: lejárat-takarítás + sorzár +
  állapot-újraellenőrzés – lejárt/módosult foglaláshoz nem jön létre PaymentIntent.
- Email: `email_outbox` (dedupe_key) + cron-feldolgozó – emailhiba nem befolyásolja
  a fizetést.
- Webhook: Stripe aláírás-ellenőrzés (`constructEvent`).
- Jutalék a foglaláskor **rögzül** (későbbi szabálymódosítás nem érinti visszamenőleg).

### Egyéb
- Rate limiting a fizetésen, beléptetésen, hírlevélen (in-memory; élesben Redis javasolt).
- Voucher QR: HMAC-SHA256 aláírt payload – hamisíthatatlan szerver nélkül.
- Beléptetés minden eseménye naplózva (`checkins`).
- Biztonsági HTTP fejlécek (`next.config.mjs`): X-Frame-Options, nosniff, Referrer-Policy.
- Auditnapló: admin jóváhagyások/elutasítások (`audit_log`).
- GDPR: `gdpr_requests` (export/törlés), IP-k hash-elésre tervezve (affiliate_clicks).
- Seed jelszavak csak demó; `.env.example` tartalmaz valódi titkot.

## Ismert korlátok / hardening backlog (launch előtt)

| Tétel | Kockázat | Javaslat |
|---|---|---|
| In-memory rate limit | Serverless instance-enként gyenge | Upstash Redis limiter |
| Booking confirmation oldal a kód ismeretében olvasható (service client) | Kód kitalálhatósága alacsony (TRV-YY-XXXXXX), de erősíthető | Vendég access token kötelezővé tétele a lekérdezéshez |
| Fájlfeltöltés | Storage policy + MIME/méret ellenőrzés még nincs bekötve | Supabase Storage RLS + képfeldolgozás (clamav/sharp) |
| Botvédelem a keresésen/regisztráción | Nincs | Turnstile/reCAPTCHA |
| 2FA | Admin felületen TOTP enroll/challenge/verify működik (`/admin/security`) | Kötelező policy bevezetése staff szerepkörökre |
| Titkos mezők (IBAN) | Sima text oszlop | Supabase Vault / pgcrypto titkosítás |
| Email + SMS csalásjelzés | affiliate_commissions.fraud_flag mező kész | Szabálymotor későbbi sprint |

## Ellenőrzés menete

- `npm run test` – egységtesztek (jutalék, refund-splitek, validáció, security-helper, státuszgép)
- `npm run test:e2e` – Playwright UI-smoke desktop + mobil projekten
- `tests/integration/capacity-race.test.ts` – kapacitás-verseny, dupla fizetés,
  dupla kifizetés, payout-blokk (élő Supabase kell)
- `npm run test:stripe` – 30 Stripe test-mode forgatókönyv (élő sk_test_ kulcs
  kell; hiányzó env esetén hibával áll le, nem csendes skip)
- `supabase/tests/rls_tests.sql` – RLS integrációs tesztek (pgTAP-stílusú, psql)
- `npm run typecheck`, `npm run lint`, `npm run build`
- Manuális átnézés: RLS policy-k táblánként, pénzügyi útvonalak, webhook idempotencia

## Jelentendő biztonsági probléma

security@travendiq.com (a domain élesítése után; addig a projekt gazdájának).
