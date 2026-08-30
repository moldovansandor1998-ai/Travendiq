-- Travendiq – 00008: refund-folyamat újraépítése
-- A lemondás a foglalást 'cancelled'-re állítja (kapacitás vissza, affiliate visszavonva);
-- a 'refunded'/'partially_refunded' státuszt KIZÁRÓLAG a Stripe által megerősített
-- (succeeded) refund alapján állítja a sync_booking_refund_status() – ld. webhook.
-- A refunds státuszszótára: pending | processing | succeeded | failed | canceled.

alter table refunds add column if not exists note text;

-- lemondás új változata: nem állít refunded státuszt, refund-sort sem hoz létre
create or replace function public.cancel_booking(
  p_booking uuid, p_reason text, p_refund_amount int default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype;
  v_refund int;
begin
  select * into b from bookings where id = p_booking for update;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if b.status in ('cancelled','refunded','partially_refunded','completed') then
    raise exception 'INVALID_STATE';
  end if;

  v_refund := coalesce(p_refund_amount, compute_refund_amount(p_booking));

  -- a pénzügyi státusz a Stripe-megerősítésig NEM változik refunded-re
  update bookings set status = 'cancelled'::booking_status,
    cancelled_at = now(), cancel_reason = p_reason
  where id = p_booking;

  if b.availability_id is not null then
    update availability set booked_count = greatest(booked_count - b.total_participants, 0)
    where id = b.availability_id;
  end if;

  update affiliate_commissions set status = 'reversed'
    where booking_id = p_booking and status in ('pending','approved');

  -- refund kintlévőség jelölése a főkönyvben (még nem pénzmozgás)
  if v_refund > 0 then
    insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
    values (b.provider_id, p_booking, 'adjustment', 0, b.currency,
            jsonb_build_object('note', 'refund_due', 'amount', v_refund, 'reason', p_reason));
  end if;

  return v_refund;
end;
$$;
revoke execute on function public.cancel_booking(uuid,text,int) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid,text,int) to service_role;

-- refund-sor létrehozása atomikusan: duplikáció és túlrefundálás ellen
create or replace function public.create_refund_request(
  p_booking uuid, p_payment uuid, p_amount int, p_currency text,
  p_reason text, p_admin_override boolean default false, p_actor uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_done int; v_id uuid;
begin
  select grand_total into v_total from bookings where id = p_booking for update;
  if v_total is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(sum(amount),0) into v_done from refunds
    where booking_id = p_booking and status in ('pending','processing','succeeded');
  if v_done + p_amount > v_total then
    raise exception 'REFUND_EXCEEDS_TOTAL: már kért/fizetett % , összesen %', v_done, v_total;
  end if;
  insert into refunds (booking_id, payment_id, amount, currency, reason, calculated_amount,
                       is_admin_override, created_by, status)
  values (p_booking, p_payment, p_amount, p_currency, p_reason, p_amount,
          p_admin_override, p_actor, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_refund_request(uuid,uuid,int,text,text,boolean,uuid) from public, anon, authenticated;
grant execute on function public.create_refund_request(uuid,uuid,int,text,text,boolean,uuid) to service_role;

-- refund megjelölése feldolgozás alatt (Stripe hívás előtt) – sorzárral
create or replace function public.mark_refund_processing(p_refund uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update refunds set status = 'processing' where id = p_refund and status = 'pending';
  return found;
end;
$$;

-- Stripe-sikeres refund rögzítése + főkönyvi korrekció + booking szinkron
create or replace function public.settle_refund(
  p_refund uuid, p_provider_refund_id text,
  p_transfer_reversal_id text default null, p_fee_reversed boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r refunds%rowtype; b bookings%rowtype;
  v_provider_share int; v_platform_share int;
begin
  update refunds set status = 'succeeded', provider_refund_id = p_provider_refund_id,
    transfer_reversal_id = p_transfer_reversal_id, application_fee_reversed = p_fee_reversed
  where id = p_refund and status in ('pending','processing')
  returning * into r;
  if r.id is null then return; end if;  -- idempotens

  select * into b from bookings where id = r.booking_id;

  -- arányos felosztás a főkönyvhez: a platformjutalék-arány szerint
  v_platform_share := case when b.grand_total > 0
    then round(r.amount * b.commission_amount::numeric / b.grand_total) else 0 end;
  v_provider_share := r.amount - v_platform_share;

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta) values
    (b.provider_id, r.booking_id, 'refund', -v_provider_share, r.currency,
     jsonb_build_object('refund_id', r.id, 'part', 'provider_share')),
    (b.provider_id, r.booking_id, 'commission', v_platform_share, r.currency,
     jsonb_build_object('refund_id', r.id, 'part', 'commission_reversal'));

  -- affiliate jutalék visszavonása (ha még nem történt)
  update affiliate_commissions set status = 'reversed'
    where booking_id = r.booking_id and status in ('pending','approved');

  perform sync_booking_refund_status(r.booking_id);
end;
$$;

-- sikertelen refund: újra függőbe (retry) vagy failed
create or replace function public.fail_refund(p_refund uuid, p_reason text, p_retry boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update refunds set status = case when p_retry then 'pending' else 'failed' end,
    note = p_reason
  where id = p_refund and status = 'processing';
end;
$$;

revoke execute on function public.mark_refund_processing(uuid) from public, anon, authenticated;
revoke execute on function public.settle_refund(uuid,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.fail_refund(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.mark_refund_processing(uuid) to service_role;
grant execute on function public.settle_refund(uuid,text,text,boolean) to service_role;
grant execute on function public.fail_refund(uuid,text,boolean) to service_role;

-- charge.refunded webhook-hoz: payment alapján nyitott refund lezárása
create or replace function public.settle_refunds_for_payment(
  p_payment uuid, p_provider_refund_id text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; n int := 0;
begin
  for r in select id from refunds where payment_id = p_payment and status in ('pending','processing')
  loop
    perform settle_refund(r.id, p_provider_refund_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.settle_refunds_for_payment(uuid,text) from public, anon, authenticated;
grant execute on function public.settle_refunds_for_payment(uuid,text) to service_role;
