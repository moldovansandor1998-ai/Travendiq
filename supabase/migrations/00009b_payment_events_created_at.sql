-- Travendiq – 00009b: payment_events.created_at pótlás (a 00010 ELŐTT fut)
--
-- A 00010_webhook_claim.sql indexe (payment_events_status_idx) a (status,
-- created_at) oszloppárra épül, de a created_at oszlopot egyik korábbi
-- migráció sem hozta létre – így a 00010 TISZTA adatbázison hibára fut.
-- (A fennálló teszt-DB-kben az oszlop már létezett, ezért a hiány eddig
--  nem derült ki.)
--
-- A fájlnév sorrendje miatt (00009b < 00010) ez a migráció a 00010 ELŐTT
-- fut le, és biztosítja a hiányzó oszlopot. Korábbi fájlokhoz NEM nyúlunk.

alter table payment_events add column if not exists created_at timestamptz not null default now();
