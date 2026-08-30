# Tesztfiókok és demo forgatókönyvek

## Fiókok (seed)

| Szerep | Email | Jelszó | Megjegyzés |
|---|---|---|---|
| Szolgáltató | provider@demo.travendiq.com | TravendiqDemo1 | „Hurghada Programok”, státusz: approved |
| Admin | admin@demo.travendiq.com | TravendiqDemo1 | Teljes admin hozzáférés |
| Vásárló | bármi | magic link | `/hu/auth/login` – vagy vendég foglalás |

> A seed `auth.users`-be ír, ezért csak egyszer futtatható (ismétlésnél töröld a demo sorokat).

## Demo forgatókönyvek

### 1. Program publikálása (admin)
1. Belépés adminként → `/hu/admin/listings`
2. A 11 Hurghada demo program `draft` + `demo` jelöléssel szerepel
3. „Jóváhagyás” → `published` (audit_log íródik)

### 2. Foglalás vendégként (fizetés DEV módban)
1. `/hu/search` → programadatlap → dátum + létszám → Foglalás
2. Kapcsolattartási adatok + opcionális kupon → Tovább a fizetéshez
3. Stripe kulcsok nélkül: „Sikeres fizetés szimulálása (csak dev)”
4. Visszaigazoló oldal: foglalási kód (TRV-…), QR-kód, voucher-link
5. Kapacitás ellenőrzése: `availability.booked_count` nőtt; túlfoglalás esetén hiba

### 3. Szolgáltatói nézet
1. Belépés providerként → `/hu/provider/dashboard`
2. Látható: foglalások, várható kifizetés (held), kifizetett összegek, programok

### 4. Beléptetés (API)
```
POST /api/checkin   { "code": "TRV-26-XXXXXX", "participants": 2 }
→ { "result": "valid" | "partial" | "already_used" | "invalid" }
```
Provider session vagy staff kell hozzá; minden esemény a `checkins` táblába kerül.

### 5. Stripe élesítés tesztelése
1. `.env.local`: Stripe **test** kulcsok
2. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → `STRIPE_WEBHOOK_SECRET`
3. Tesztkártya: 4242 4242 4242 4242

### 6. Stripe test-mode integrációs tesztek (30 forgatókönyv)

```bash
STRIPE_SECRET_KEY=sk_test_... \
SUPABASE_URL=https://<proj>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run test:stripe
```

A parancs kötelező jellegű: hiányzó környezeti változó esetén hibával áll le.

Forgatókönyvek: sikeres fizetés + ismételt webhook; párhuzamos azonos webhook
(claim); két azonos összegű részleges refund (külön re_ ID); teljes refund payout
előtt (payout végleg cancelled, release blokkolva); részleges refund payout előtt
(release csak a korrigált összeggel); refund payout után Transfer Reversallal;
két refund a reversal webhook előtt (committed-cap védelem); refund + azonnali
chargeback; chargeback payout előtt/után; chargeback megnyerve reversal után
(kontrollált új payout, kizárólag a dispute-hoz tartozó reversalösszeggel);
késői fizetés lejárt foglaláshoz (auto refund a refund work queue-ból, nincs
payout); refund RELEASING payout alatt (a payout összege érintetlen,
awaiting_transfer kötelezettség, finalize után automatikus reversal; a ledger
összeg == a tényleges Stripe Transfer összeg); crash a reversal DB-kérés után
(replay a teljes sort adja, azonos kulccsal folytatható); Stripe-siker +
record_reversal_sent DB-hiba (a sor NEM failed, újraegyeztetés); pending
refund-reversal + azonnali chargeback (cap, nincs elnyelt hiba); refund-cron
retry sikere + kimerülésnél manual_review; webhook lock-timeout + stale worker;
sikeres Transfer + ideiglenes DB-finalize hiba (abort→retry→paid); webhook
közbeni DB-hiba (failed→retry); sikertelen e-mail (outbox); ismételt aggregált
amount_reversed (delta-könyvelés); Connect disabled/past_due; Transfer sikeres
+ finalize DB-hiba → 'transfer_submitted' (NEM scheduled), refund közben →
awaiting_transfer kötelezettség, cron-retry az eredeti összeggel és tr_ ID-val;
Transfer hálózati timeout miközben a Stripe-on létrejött → azonos
idempotencia-kulcsú retry az EREDETI Transfert adja vissza; Reversal timeout
miközben létrejött → azonos kulcsú egyeztetés, nincs dupla reversal; két azonos
összegű, metadata nélküli reversal ugyanazon a Transferen → NINCS vak
párosítás, reconciliation_required árva-sorok, a reversed_amount nem nő;
metadata (reversal_row_id) alapú párosítás azonos összegű társ mellett;
manuális payout közben érkező refund → a kötelezettség reconciliation_required
(nincs tr_ → nincs automatikus 'requested'), manuális rendezés kötelező banki
referenciával/dátummal/összeggel/adminnal/jegyzettel + audit; a
payout_transfer_attempts-ben befagyasztott összeg a folyamat közben sosem
változik (AMOUNT_MISMATCH védelem).

### 7. Webhook triggerelés Stripe CLI-vel

```bash
stripe listen --forward-to <host>/api/webhooks/stripe
stripe trigger payment_intent.succeeded
stripe trigger charge.refunded
stripe trigger charge.dispute.created
stripe trigger account.updated
```

### 8. Kapacitás/duplikáció integrációs teszt

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npm run test -- tests/integration/capacity-race.test.ts
```
