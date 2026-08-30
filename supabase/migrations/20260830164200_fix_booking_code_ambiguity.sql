-- A PL/pgSQL-változó neve ütközött a bookings.code oszloppal, ezért a
-- foglalás létrehozása "column reference code is ambiguous" hibával leállt.
create or replace function public.generate_booking_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_booking_code text;
begin
  loop
    v_booking_code := 'TRV-' || to_char(now(), 'YY') || '-';
    for i in 1..6 loop
      v_booking_code := v_booking_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.bookings b where b.code = v_booking_code
    );
  end loop;
  return v_booking_code;
end;
$$;

