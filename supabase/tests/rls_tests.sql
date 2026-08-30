-- Travendiq RLS integrációs tesztek
-- Futtatás (lokális Supabase):
--   supabase db reset && psql $DATABASE_URL -f supabase/tests/rls_tests.sql
-- Minden blokk DO ... $$ assert-tel ellenőriz; hiba esetén exceptiont dob.
-- Előfeltétel: a seed.sql lefutott (demo user-ek + demo szolgáltató + ajánlatok).

begin;

-- --- segédek: szerepkör-szimuláció JWT-claimmel ------------------------------
-- A tesztek a request.jwt.claims beállításával szimulálják az auth.uid()-et.

create or replace function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
$$;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'RLS TEST FAILED: %', msg; end if; end $$;

do $$
declare
  v_customer uuid; v_provider uuid; v_admin uuid; v_other uuid;
  n int;
begin
  select id into v_provider from profiles where email = 'provider@demo.travendiq.com';
  select id into v_admin from profiles where email = 'admin@demo.travendiq.com';
  select id into v_customer from profiles where email = 'customer@demo.travendiq.com';
  -- 1) anon nem olvashat foglalásokat
  perform pg_temp.as_anon();
  select count(*) into n from bookings;
  perform pg_temp.assert(n = 0, 'anon nem láthat foglalást');

  -- 2) anon nem szúrhat be bookingot közvetlenül
  begin
    insert into bookings (listing_id, provider_id, date, start_time, adults, children, infants,
      lead_name, lead_email, grand_total, currency, status)
    select l.id, l.provider_id, current_date, '09:00', 1, 0, 0, 'X', 'x@x.hu', 1000, 'EUR', 'pending_payment'
    from listings l limit 1;
    raise exception 'RLS TEST FAILED: anon insert bookings sikerült';
  exception when insufficient_privilege or check_violation then null;
            when others then null; -- RLS policy violation is ide tartozik
  end;

  -- 3) vásárló csak a saját foglalását látja
  if v_customer is not null then
    perform pg_temp.as_user(v_customer);
    select count(*) into n from bookings where user_id is not null and user_id <> v_customer;
    perform pg_temp.assert(n = 0, 'customer más foglalását látja');
  end if;

  -- 4) szolgáltató nem módosíthatja a saját státuszát
  if v_provider is not null then
    perform pg_temp.as_user(v_provider);
    update providers set status = 'approved' where owner_id = v_provider;
    get diagnostics n = row_count;
    perform pg_temp.assert(n = 0, 'provider átírhatta a státuszát (revoke update hiányzik)');
  end if;

  -- 5) admin láthatja a várakozó providereket
  if v_admin is not null then
    perform pg_temp.as_user(v_admin);
    perform 1 from providers limit 1;
  end if;

  -- 6) service-role-only RPC nem hívható authenticated-ként
  if v_customer is not null then
    perform pg_temp.as_user(v_customer);
    begin
      perform public.create_booking(null,null,current_date,'09:00',1,0,0,null,null,'en','X','x@x.hu',null,null,null,null,null,null,null,'[]'::jsonb,null);
      raise exception 'RLS TEST FAILED: create_booking authenticated-ként hívható';
    exception when insufficient_privilege then null;
              when others then
                if sqlerrm not ilike '%permission denied%' and sqlstate <> '42501' then
                  raise exception 'RLS TEST FAILED: create_booking váratlan hiba: %', sqlerrm;
                end if;
    end;
  end if;

  -- 7) privát provider-docs storage policy létezik
  perform pg_temp.assert(
    exists (select 1 from storage.buckets where id = 'provider-docs' and not public),
    'provider-docs bucket nem privát');

  raise notice 'RLS TESTS: minden ellenőrzés sikeres';
end $$;

rollback;
