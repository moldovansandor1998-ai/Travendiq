-- Travendiq – 00004: hardening, foglalási folyamat-függvények, affiliate visszavonás

-- ============ FÜGGVÉNY-JOGOSULTSÁGOK PONTOSÍTÁSA ============
-- Alapértelmezett EXECUTE visszavonása az érzékeny security definer függvényekről.
-- Ezeket kizárólag service_role (szerveroldali route/server action) hívhatja.
revoke execute on function public.create_booking(uuid,uuid,date,time,int,int,int,uuid,text,text,text,text,text,text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_booking(uuid,uuid,date,time,int,int,int,uuid,text,text,text,text,text,text,text,text,text,text,uuid) to service_role;

revoke execute on function public.resolve_commission_rate(uuid) from public, anon, authenticated;
grant execute on function public.resolve_commission_rate(uuid) to authenticated, service_role;

revoke execute on function public.compute_refund_amount(uuid) from public, anon, authenticated;
grant execute on function public.compute_refund_amount(uuid) to authenticated, service_role;

-- helper függvények: olvasó jellegűek, maradnak authenticated számára
grant execute on function public.has_role(user_role) to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_provider_member(uuid) to authenticated, service_role;
grant execute on function public.has_provider_permission(uuid,text) to authenticated, service_role;

-- ============ AFFILIATE PARTNER STÁTUSZ ============
alter table promoter_links
  add column if not exists approval_status text not null default 'pending', -- pending|approved|rejected
  add column if not exists payout_iban text,
  add column if not exists payout_email text,
  add column if not exists kind text not null default 'link';                -- link|coupon

-- csak jóváhagyott partnerlink hozhat létre jutalékot (create_booking frissítés)
create or replace function public.create_booking(
  p_listing uuid, p_option uuid, p_date date, p_start_time time,
  p_adults int, p_children int, p_infants int,
  p_user uuid, p_guest_email text, p_customer_locale text,
  p_lead_name text, p_lead_email text, p_lead_phone text,
  p_hotel text, p_pickup text, p_special text,
  p_coupon_code text, p_idempotency_key text, p_affiliate_link uuid default null,
  p_extras jsonb default '[]'::jsonb, p_zone uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l listings%rowtype;
  a availability%rowtype;
  o listing_options%rowtype;
  c coupons%rowtype;
  z listing_transfer_zones%rowtype;
  v_avail_id uuid;
  v_items int; v_extras int := 0; v_discount int := 0; v_total int;
  v_rate numeric; v_booking uuid; v_qty int;
  v_price_adult int; v_price_child int;
  v_link promoter_links%rowtype;
  v_extra record;
begin
  if p_idempotency_key is not null then
    select id into v_booking from bookings where idempotency_key = p_idempotency_key;
    if v_booking is not null then return v_booking; end if;
  end if;

  -- bejelentkezett felhasználó csak a saját nevében foglalhat
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'USER_MISMATCH';
  end if;

  select * into l from listings where id = p_listing for share;
  if l.id is null or l.status <> 'published' then
    raise exception 'LISTING_NOT_BOOKABLE';
  end if;

  v_qty := p_adults + p_children + p_infants;
  if v_qty < 1 then raise exception 'PARTICIPANT_LIMIT'; end if;
  if p_adults + p_children > l.max_participants then
    raise exception 'PARTICIPANT_LIMIT';
  end if;

  select * into a from availability
    where listing_id = p_listing
      and option_id is not distinct from p_option
      and date = p_date and start_time = p_start_time
    for update;

  if a.id is null or a.is_blocked then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  if a.capacity - a.booked_count < v_qty then
    raise exception 'NOT_ENOUGH_CAPACITY';
  end if;

  v_avail_id := a.id;
  -- szezonális/időpontfüggő ár: availability felülírás, különben alapár
  v_price_adult := coalesce(a.price_adult, l.base_price_adult);
  v_price_child := coalesce(a.price_child, l.base_price_child, l.base_price_adult);

  if p_option is not null then
    select * into o from listing_options where id = p_option and is_active and listing_id = p_listing;
    if o.id is null then raise exception 'OPTION_INVALID'; end if;
    v_price_adult := v_price_adult + o.price_delta_adult;
    v_price_child := v_price_child + coalesce(o.price_delta_child, o.price_delta_adult);
  end if;

  v_items := p_adults * v_price_adult + p_children * v_price_child; -- csecsemő: 0

  -- extrák (szerveroldali újraszámolás – kliens ár sosem mérvadó)
  if p_extras is not null then
    for v_extra in select * from jsonb_to_recordset(p_extras) as x(extra_id uuid, quantity int) loop
      v_extras := v_extras + coalesce((
        select case when e.per_person then e.price * greatest(v_extra.quantity,1) * v_qty
                    else e.price * greatest(v_extra.quantity,1) end
        from listing_extras e
        where e.id = v_extra.extra_id and e.listing_id = p_listing and e.is_active), 0);
    end loop;
  end if;

  -- transzferzóna felára
  if p_zone is not null then
    select * into z from listing_transfer_zones where id = p_zone and listing_id = p_listing;
    if z.id is not null then
      v_extras := v_extras + z.pickup_fee;
    end if;
  end if;

  -- kupon tranzakcióbiztos felhasználása
  if p_coupon_code is not null and p_coupon_code <> '' then
    select * into c from coupons where code = upper(p_coupon_code) and is_active
      and (valid_from is null or valid_from <= now())
      and (valid_to is null or valid_to >= now())
      and (max_redemptions is null or redeemed_count < max_redemptions)
      and (listing_id is null or listing_id = p_listing)
      and (provider_id is null or provider_id = l.provider_id)
    for update;
    if c.id is not null and (c.min_order_total is null or v_items + v_extras >= c.min_order_total) then
      if c.kind = 'percent' then
        v_discount := round((v_items + v_extras) * c.value / 100.0)::int;
      else
        v_discount := least(round(c.value)::int, v_items + v_extras);
      end if;
      update coupons set redeemed_count = redeemed_count + 1 where id = c.id;
    else
      c := null;
    end if;
  end if;

  v_total := greatest(v_items + v_extras - v_discount, 0);
  v_rate := resolve_commission_rate(p_listing);

  -- affiliate: csak aktív, admin által jóváhagyott link
  if p_affiliate_link is not null then
    select * into v_link from promoter_links
      where id = p_affiliate_link and is_active and approval_status = 'approved'
        and (listing_id is null or listing_id = p_listing);
    if v_link.id is null then
      p_affiliate_link := null;
    end if;
  end if;

  insert into bookings (
    code, listing_id, option_id, provider_id, availability_id,
    user_id, guest_email, date, start_time, status, currency,
    adults, children, infants,
    items_total, extras_total, discount_total, grand_total,
    commission_rate, commission_amount, provider_amount,
    coupon_id, lead_name, lead_email, lead_phone,
    hotel_name, pickup_address, special_requests, customer_locale,
    affiliate_id, idempotency_key
  ) values (
    generate_booking_code(), p_listing, p_option, l.provider_id, v_avail_id,
    p_user, p_guest_email, p_date, p_start_time,
    case when v_total = 0 then
      case when l.confirmation = 'instant' then 'confirmed'::booking_status
           else 'pending_confirmation'::booking_status end
    else 'pending_payment'::booking_status end,
    l.currency, p_adults, p_children, p_infants,
    v_items, v_extras, v_discount, v_total,
    v_rate, round(v_total * v_rate / 100.0)::int,
    v_total - round(v_total * v_rate / 100.0)::int,
    c.id, p_lead_name, p_lead_email, p_lead_phone,
    p_hotel, p_pickup, p_special, coalesce(p_customer_locale,'en'),
    p_affiliate_link, p_idempotency_key
  ) returning id into v_booking;

  -- extras sorok tényleges rögzítése (aktuális egységárral)
  if p_extras is not null then
    for v_extra in select * from jsonb_to_recordset(p_extras) as x(extra_id uuid, quantity int) loop
      insert into booking_extras (booking_id, extra_id, quantity, unit_price)
      select v_booking, e.id, greatest(v_extra.quantity,1), e.price
      from listing_extras e
      where e.id = v_extra.extra_id and e.listing_id = p_listing and e.is_active;
    end loop;
  end if;

  update availability set booked_count = booked_count + v_qty where id = v_avail_id;
  update listings set booking_count = booking_count + 1 where id = p_listing;

  if p_affiliate_link is not null and v_total > 0 then
    insert into affiliate_commissions (link_id, booking_id, amount, currency)
    values (p_affiliate_link, v_booking,
            round(v_total * coalesce(v_link.commission_rate, 5) / 100.0)::int, l.currency);
  end if;

  return v_booking;
end;
$$;

revoke execute on function public.create_booking(uuid,uuid,date,time,int,int,int,uuid,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.create_booking(uuid,uuid,date,time,int,int,int,uuid,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,uuid) to service_role;

-- ============ LEMONDÁS (kapacitás visszaadás + refund kalkuláció + affiliate visszavonás) ============
create or replace function public.cancel_booking(
  p_booking uuid, p_reason text, p_refund_amount int default null -- null = automatikus számítás
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

  update bookings set
    status = case
      when v_refund >= grand_total and grand_total > 0 then 'refunded'::booking_status
      when v_refund > 0 then 'partially_refunded'::booking_status
      else 'cancelled'::booking_status end,
    cancelled_at = now(), cancel_reason = p_reason
  where id = p_booking;

  -- férőhely visszaadása
  if b.availability_id is not null then
    update availability set booked_count = greatest(booked_count - b.total_participants, 0)
    where id = b.availability_id;
  end if;

  -- affiliate jutalék visszavonása
  update affiliate_commissions set status = 'reversed'
    where booking_id = p_booking and status in ('pending','approved');

  -- főkönyv: visszatérítés (előjeles)
  if v_refund > 0 then
    insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
    values (b.provider_id, p_booking, 'refund', -v_refund, b.currency,
            jsonb_build_object('reason', p_reason));
  end if;

  return v_refund;
end;
$$;
revoke execute on function public.cancel_booking(uuid,text,int) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid,text,int) to service_role;

-- ============ ÁTFOGLALÁS ============
create or replace function public.reschedule_booking(
  p_booking uuid, p_new_date date, p_new_time time
) returns void
language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype;
  a availability%rowtype;
begin
  select * into b from bookings where id = p_booking for update;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if b.status not in ('confirmed','pending_confirmation') then
    raise exception 'INVALID_STATE';
  end if;

  select * into a from availability
    where listing_id = b.listing_id
      and option_id is not distinct from b.option_id
      and date = p_new_date and start_time = p_new_time
    for update;
  if a.id is null or a.is_blocked then raise exception 'SLOT_UNAVAILABLE'; end if;
  if a.capacity - a.booked_count < b.total_participants then
    raise exception 'NOT_ENOUGH_CAPACITY';
  end if;

  if b.availability_id is not null then
    update availability set booked_count = greatest(booked_count - b.total_participants, 0)
    where id = b.availability_id;
  end if;
  update availability set booked_count = booked_count + b.total_participants where id = a.id;

  update bookings set date = p_new_date, start_time = p_new_time,
    availability_id = a.id, status = 'confirmed'
  where id = p_booking;
end;
$$;
revoke execute on function public.reschedule_booking(uuid,date,time) from public, anon, authenticated;
grant execute on function public.reschedule_booking(uuid,date,time) to service_role;

-- ============ LEJÁRT PENDING FOGLALÁSOK FELSZABADÍTÁSA ============
create or replace function public.expire_pending_bookings(p_minutes int default 30)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; n int := 0;
begin
  for r in select id, availability_id, total_participants from bookings
    where status = 'pending_payment' and created_at < now() - make_interval(mins => p_minutes)
  loop
    update bookings set status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'payment_expired' where id = r.id;
    if r.availability_id is not null then
      update availability set booked_count = greatest(booked_count - r.total_participants, 0)
      where id = r.availability_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.expire_pending_bookings(int) from public, anon, authenticated;
grant execute on function public.expire_pending_bookings(int) to service_role;

-- ============ SZOLGÁLTATÓI VISSZAIGAZOLÁS / ELUTASÍTÁS ============
create or replace function public.provider_respond_booking(p_booking uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype;
begin
  select * into b from bookings where id = p_booking for update;
  if b.status <> 'pending_confirmation' then raise exception 'INVALID_STATE'; end if;
  if p_accept then
    update bookings set status = 'confirmed', confirmed_at = now() where id = p_booking;
  else
    perform cancel_booking(p_booking, coalesce(p_note,'provider_cancelled'), b.grand_total);
  end if;
end;
$$;
revoke execute on function public.provider_respond_booking(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.provider_respond_booking(uuid,boolean,text) to service_role;

-- ============ TELJESÍTÉS + KIFIZETÉS ÜTEMEZÉSE ============
create or replace function public.complete_booking(p_booking uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update bookings set status = 'completed', completed_at = now()
    where id = p_booking and status in ('attended','confirmed');
  -- visszatartott kifizetés ütemezése (T+3 nap)
  update payouts set status = 'scheduled', scheduled_for = current_date + 3, hold_reason = null
    where booking_id = p_booking and status = 'held';
end;
$$;
revoke execute on function public.complete_booking(uuid) from public, anon, authenticated;
grant execute on function public.complete_booking(uuid) to service_role;

-- ============ CHARGEBACK → AFFILIATE VISSZAVONÁS ============
create or replace function public.reverse_affiliate_on_dispute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'disputed' and old.status is distinct from 'disputed' then
    update affiliate_commissions set status = 'reversed'
      where booking_id = new.id and status in ('pending','approved');
  end if;
  return new;
end;
$$;
create trigger trg_affiliate_reverse
  after update on bookings
  for each row execute function reverse_affiliate_on_dispute();
