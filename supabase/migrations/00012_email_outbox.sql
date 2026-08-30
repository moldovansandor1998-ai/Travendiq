-- Travendiq – 00012: idempotens email outbox
-- A pénzügyi webhook-tranzakciókból kikerül az email-küldés: a webhook csak
-- sorba állít (dedupe_key alapján idempotensen), egy külön cron-feldolgozó
-- küldi ki a leveleket. Egy emailhiba így nem teheti bizonytalanná a fizetést.

create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,          -- pl. booking_confirmation:<bookingId>
  to_email text not null,
  template text not null,
  locale text not null default 'en',
  vars jsonb not null default '{}',
  status text not null default 'pending'    -- pending | processing | sent | failed
    check (status in ('pending','processing','sent','failed')),
  attempts int not null default 0,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists email_outbox_status_idx on email_outbox (status, created_at);

-- RLS: senki közvetlenül, csak service_role
alter table email_outbox enable row level security;

-- Sorba állítás – duplikátum esetén csendes no-op (idempotens).
create or replace function public.enqueue_email(
  p_dedupe_key text, p_to text, p_template text, p_locale text, p_vars jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into email_outbox (dedupe_key, to_email, template, locale, vars)
  values (p_dedupe_key, p_to, p_template, coalesce(p_locale, 'en'), coalesce(p_vars, '{}'::jsonb))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Batch claim a cron-feldolgozónak (FOR UPDATE SKIP LOCKED + lock timeout).
create or replace function public.claim_pending_emails(
  p_limit int, p_worker text, p_lock_seconds int default 300
) returns setof email_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  update email_outbox e set
    status = 'processing', attempts = e.attempts + 1,
    locked_at = now(), locked_by = p_worker
  where e.id in (
    select id from email_outbox
    where (status = 'pending'
           or (status = 'processing' and locked_at < now() - make_interval(secs => p_lock_seconds))
           or (status = 'failed' and attempts < 5))
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning e.*;
end;
$$;

create or replace function public.mark_email_sent(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update email_outbox set status = 'sent', sent_at = now(),
    locked_at = null, locked_by = null, last_error = null
  where id = p_id;
end;
$$;

create or replace function public.mark_email_failed(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update email_outbox set
    status = case when attempts >= 5 then 'failed' else 'pending' end,
    last_error = left(coalesce(p_error, 'unknown'), 500),
    locked_at = null, locked_by = null
  where id = p_id;
end;
$$;

revoke all on function public.enqueue_email(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_pending_emails(int, text, int) from public, anon, authenticated;
revoke all on function public.mark_email_sent(uuid) from public, anon, authenticated;
revoke all on function public.mark_email_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_email(text, text, text, text, jsonb) to service_role;
grant execute on function public.claim_pending_emails(int, text, int) to service_role;
grant execute on function public.mark_email_sent(uuid) to service_role;
grant execute on function public.mark_email_failed(uuid, text) to service_role;
