-- Külső szolgáltatási hiba esetén a lefoglalt rate-limit próbálkozás
-- biztonságosan visszavonható. Nulla alá nem csökkentjük a számlálót.
create or replace function public.release_rate_limit(p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_key text := left(coalesce(p_key, ''), 120);
begin
  update public.rate_limit_buckets
     set count = greatest(count - 1, 0)
   where key = v_key;
end;
$$;

revoke all on function public.release_rate_limit(text) from public, anon, authenticated;
grant execute on function public.release_rate_limit(text) to service_role;
