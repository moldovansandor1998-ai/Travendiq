-- Travendiq – 00009: webhook-feldolgozási integritás
-- A payment_events sor beillesztésekor még NEM processed – csak a kapcsolódó
-- adatbázis-műveletek sikeres lefutása után állítjuk processed_at-et.
-- Így Stripe-újraküldésnél (vagy hiba utáni retry-nál) az esemény újrafeldolgozható.

alter table payment_events alter column processed_at drop not null;
alter table payment_events alter column processed_at drop default;
alter table payment_events add column if not exists processing_error text;

-- payout események követése (transfer/payout webhookok)
alter table payouts add column if not exists transfer_status text; -- created|paid|failed|reversed
