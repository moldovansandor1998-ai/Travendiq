-- 00025: megosztott, atomikus rate limiting (serverless/Vercel-biztos)
-- Az in-memory Map instance-enként élt – serverlessen gyakorlatilag
-- védelem nélküli. Az új limiter egy DB-tábla + atomikus RPC:
-- egyetlen INSERT .. ON CONFLICT tranzakcióban nő a számláló, így több
-- párhuzamos instance/common cold start esetén is pontos.

create table if not exists public.rate_limit_buckets (
  key text primary key,               -- pl. "booking:203.0.113.7" (max 120 kar.)
  count int not null default 0,
  reset_at timestamptz not null
);

create index if not exists rate_limit_buckets_reset_idx
  on public.rate_limit_buckets (reset_at);

alter table public.rate_limit_buckets enable row level security;
-- NINCS anon/authenticated policy: a tábla csak service_role-ból érhető el.

/**
 * Atomikus ablak-számláló. true = kérés engedélyezett, false = limit túl lépve.
 * A kulcs hossza a DB-ben is korlátozott (120 kar.) – a hívó normalizálja az
 * IP-t (első x-forwarded-for cím), itt csak a biztonsági vágás marad.
 */
create or replace function public.check_rate_limit(
  p_key text, p_limit int, p_window_seconds int default 60
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_key text := left(coalesce(p_key, ''), 120);
  v_now timestamptz := now();
  v_count int;
begin
  if p_limit is null or p_limit <= 0 then return false; end if;

  insert into public.rate_limit_buckets (key, count, reset_at)
  values (v_key, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count = case
      when rate_limit_buckets.reset_at < v_now then 1
      else rate_limit_buckets.count + 1 end,
    reset_at = case
      when rate_limit_buckets.reset_at < v_now
        then v_now + make_interval(secs => p_window_seconds)
      else rate_limit_buckets.reset_at end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Takarító: lejárt ablakok törlése (cron hívja; sikertelen futás sem kritikus)
create or replace function public.prune_rate_limit_buckets() returns int
language plpgsql security definer set search_path = public as $$
declare v_deleted int;
begin
  delete from public.rate_limit_buckets where reset_at < now() - interval '1 hour';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on table public.rate_limit_buckets from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function public.prune_rate_limit_buckets() from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
grant execute on function public.prune_rate_limit_buckets() to service_role;
