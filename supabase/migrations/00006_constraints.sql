-- Travendiq – 00006: idempotencia-megszorítások és kiegészítő indexek

-- egy foglaláshoz egy kifizetés (upsert onConflict booking_id alapja)
create unique index if not exists payouts_booking_uidx on payouts (booking_id) where booking_id is not null;

-- affiliate: ugyanarra a foglalásra csak egyszer jár jutalék
create unique index if not exists affiliate_booking_uidx on affiliate_commissions (booking_id);

-- beszélgetés: bookingonként egy customer-provider szál
create unique index if not exists conversations_booking_uidx on conversations (booking_id) where booking_id is not null;

-- kedvencek/kattintások gyorsítása
create index if not exists affiliate_clicks_link_idx on affiliate_clicks (link_id, created_at desc);
create index if not exists messages_conv_idx on messages (conversation_id, created_at);
create index if not exists email_log_status_idx on email_log (status, created_at desc);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_id);

-- alapturnus (option_id null) egyedisége: postgres unique NULL-t nem egyeztet,
-- ezért rész-index kell a CalendarManager upsert/ignoreDuplicates működéséhez
create unique index if not exists availability_base_slot_uidx
  on availability (listing_id, date, start_time) where option_id is null;
