-- Travendiq – 00019: webhook claim/finish hardening
--  1) A 00010-ben a default 'processed' státusz miatt keletkezhetett
--     status='processed' ÉS processed_at IS NULL sorok – ezeket újra
--     claimelhetővé tesszük ('failed'), hogy a Stripe retry újrafuttassa őket.
--  2) finish_payment_event CSAK akkor zárhatja le az eseményt, ha a lockot
--     még az adott worker birtokolja (locked_by + status='processing').
--     Régi vagy lockját elvesztett worker nem írhatja felül az eseményt.
-- (A 00010-et nem módosítjuk – ez a migráció hozza a javítást.)

-- 1) inkonzisztens sorok rendezése: processed státusz + processed_at NULL → failed
update payment_events
set status = 'failed', processing_error = coalesce(processing_error, 'inconsistent_state_fix_00019')
where status = 'processed' and processed_at is null;

-- 2) finish_payment_event v2 – lock-ellenőrzéssel; visszatér a tényleges sikerrel
create or replace function public.finish_payment_event(
  p_provider text, p_event_id text, p_worker text,
  p_success boolean, p_error text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_updated int;
begin
  if p_success then
    update payment_events set
      status = 'processed', processed_at = now(),
      processing_error = null, locked_at = null, locked_by = null
    where provider = p_provider and provider_event_id = p_event_id
      and status = 'processing' and locked_by = p_worker;   -- csak a lock-tulajdonos zárhat
  else
    update payment_events set
      status = 'failed', processing_error = left(coalesce(p_error, 'unknown'), 500),
      locked_at = null, locked_by = null
    where provider = p_provider and provider_event_id = p_event_id
      and status = 'processing' and locked_by = p_worker;
  end if;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.finish_payment_event(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_payment_event(text, text, text, boolean, text) to service_role;
