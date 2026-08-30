-- Travendiq – 00010: atomikus webhook claim/lock
-- Egy eseményt egyszerre csak egy worker dolgozhat fel.
-- Státuszok: processing | processed | failed; próbálkozásszám + lock timeout.
-- (Új migráció – a korábbi fájlok változatlanok, telepített rendszeren is lefut.)

alter table payment_events add column if not exists status text not null default 'processed';
alter table payment_events add column if not exists attempts int not null default 0;
alter table payment_events add column if not exists locked_at timestamptz;
alter table payment_events add column if not exists locked_by text;

-- korábbi, már feldolgozott sorok visszamenőleges státusza
update payment_events set status = 'processed' where processed_at is not null and status <> 'failed';

alter table payment_events drop constraint if exists payment_events_status_check;
alter table payment_events add constraint payment_events_status_check
  check (status in ('processing','processed','failed'));

create index if not exists payment_events_status_idx on payment_events (status, created_at);

-- Atomikus claim: új esemény beszúrása VAGY meglévő (nem processed) esemény
-- lefoglalása lock-timeouttal. Visszatérés: 'claimed' | 'already_processed' | 'locked'.
create or replace function public.claim_payment_event(
  p_provider text, p_event_id text, p_type text, p_payload jsonb,
  p_worker text, p_lock_seconds int default 300
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_existing payment_events%rowtype;
  v_claimed int;
begin
  select * into v_existing from payment_events
    where provider = p_provider and provider_event_id = p_event_id;

  if v_existing.id is null then
    insert into payment_events (provider, provider_event_id, event_type, payload,
      status, attempts, locked_at, locked_by, processed_at)
    values (p_provider, p_event_id, p_type, p_payload,
      'processing', 1, now(), p_worker, null)
    on conflict (provider, provider_event_id) do nothing;
    if found then return 'claimed'; end if;
    select * into v_existing from payment_events
      where provider = p_provider and provider_event_id = p_event_id;
  end if;

  if v_existing.status = 'processed' and v_existing.processed_at is not null then
    return 'already_processed';
  end if;

  -- lejárt vagy szabad lock esetén átvesszük (párhuzamos workerek közül csak egy nyer)
  update payment_events set
    status = 'processing', attempts = attempts + 1,
    locked_at = now(), locked_by = p_worker
  where provider = p_provider and provider_event_id = p_event_id
    and status <> 'processed'
    and (locked_at is null or locked_at < now() - make_interval(secs => p_lock_seconds));
  get diagnostics v_claimed = row_count;

  return case when v_claimed = 1 then 'claimed' else 'locked' end;
end;
$$;

-- Feldolgozás lezárása: siker → processed, hiba → failed (lock feloldva, retry kész).
create or replace function public.finish_payment_event(
  p_provider text, p_event_id text, p_worker text,
  p_success boolean, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_success then
    update payment_events set
      status = 'processed', processed_at = now(),
      processing_error = null, locked_at = null, locked_by = null
    where provider = p_provider and provider_event_id = p_event_id;
  else
    update payment_events set
      status = 'failed', processing_error = left(coalesce(p_error, 'unknown'), 500),
      locked_at = null, locked_by = null
    where provider = p_provider and provider_event_id = p_event_id;
  end if;
end;
$$;

revoke all on function public.claim_payment_event(text, text, text, jsonb, text, int) from public, anon, authenticated;
revoke all on function public.finish_payment_event(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_payment_event(text, text, text, jsonb, text, int) to service_role;
grant execute on function public.finish_payment_event(text, text, text, boolean, text) to service_role;
