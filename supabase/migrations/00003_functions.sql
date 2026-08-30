-- Travendiq – 00003: üzleti logika (SQL függvények, triggerek)

-- ============ FOGLALÁSI KÓD ============
create or replace function public.generate_booking_code()
returns text language plpgsql volatile as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- látásbiztos karakterkészlet
  code text;
begin
  loop
    code := 'TRV-' || to_char(now(),'YY') || '-';
    for i in 1..6 loop
      code := code || substr(chars, floor(random()*length(chars)+1)::int, 1);
    end loop;
    exit when not exists (select 1 from bookings where bookings.code = code);
  end loop;
  return code;
end;
$$;

-- ============ JUTALÉK FELOLDÁS (listing > provider > country > global) ============
create or replace function public.resolve_commission_rate(p_listing uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  l listings%rowtype;
  r numeric;
begin
  select * into l from listings where id = p_listing;

  select rate into r from commission_rules
    where is_active and scope = 'listing' and listing_id = p_listing
    order by priority desc limit 1;
  if r is not null then return r; end if;

  if l.provider_id is not null then
    select commission_override into r from providers where id = l.provider_id;
    if r is not null then return r; end if;
    select rate into r from commission_rules
      where is_active and scope = 'provider' and provider_id = l.provider_id
      order by priority desc limit 1;
    if r is not null then return r; end if;
  end if;

  select rate into r from commission_rules
    where is_active and scope = 'country' and country_code = l.country_code
    order by priority desc limit 1;
  if r is not null then return r; end if;

  select rate into r from commission_rules
    where is_active and scope = 'global' order by priority desc limit 1;
  return coalesce(r, 15);
end;
$$;

-- ============ VISSZATÉRÍTÉS SZÁMÍTÁS ============
create or replace function public.compute_refund_amount(p_booking uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  b bookings%rowtype;
  l listings%rowtype;
  hours_until numeric;
begin
  select * into b from bookings where id = p_booking;
  select * into l from listings where id = b.listing_id;

  if b.status in ('refunded','cancelled') then return 0; end if;

  -- szolgáltató / időjárás miatti lemondás → mindig 100%
  if b.cancel_reason in ('provider_cancelled','weather') then
    return b.grand_total;
  end if;

  hours_until := extract(epoch from ((b.date + b.start_time) - now())) / 3600.0;

  case l.cancellation_policy
    when 'non_refundable' then return 0;
    when 'percent_refund' then
      return round(b.grand_total * coalesce(l.cancel_percent,0) / 100.0)::int;
    else -- full_until_hours
      if hours_until >= l.cancel_full_hours then
        return b.grand_total;
      else
        return 0;
      end if;
  end case;
end;
$$;

-- ============ FOGLALÁS LÉTREHOZÁS (kapacitás tranzakciós zárolással) ============
create or replace function public.create_booking(
  p_listing uuid, p_option uuid, p_date date, p_start_time time,
  p_adults int, p_children int, p_infants int,
  p_user uuid, p_guest_email text, p_customer_locale text,
  p_lead_name text, p_lead_email text, p_lead_phone text,
  p_hotel text, p_pickup text, p_special text,
  p_coupon_code text, p_idempotency_key text, p_affiliate_link uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l listings%rowtype;
  a availability%rowtype;
  o listing_options%rowtype;
  c coupons%rowtype;
  v_avail_id uuid;
  v_items int; v_extras int := 0; v_discount int := 0; v_total int;
  v_rate numeric; v_booking uuid; v_qty int;
  v_price_adult int; v_price_child int;
begin
  -- idempotencia: ugyanazzal a kulccsal ne jöjjön létre duplikátum
  if p_idempotency_key is not null then
    select id into v_booking from bookings where idempotency_key = p_idempotency_key;
    if v_booking is not null then return v_booking; end if;
  end if;

  select * into l from listings where id = p_listing for share;
  if l.id is null or l.status <> 'published' then
    raise exception 'LISTING_NOT_BOOKABLE';
  end if;

  v_qty := p_adults + p_children + p_infants;
  if v_qty < l.min_participants or v_qty > l.max_participants then
    raise exception 'PARTICIPANT_LIMIT';
  end if;

  -- kapacitássor zárolása (férőhely-versenyhelyzet kizárása)
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
  v_price_adult := coalesce(a.price_adult, l.base_price_adult);
  v_price_child := coalesce(a.price_child, l.base_price_child, l.base_price_adult);

  -- opció felára
  if p_option is not null then
    select * into o from listing_options where id = p_option and is_active;
    if o.id is null then raise exception 'OPTION_INVALID'; end if;
    v_price_adult := v_price_adult + o.price_delta_adult;
    v_price_child := v_price_child + coalesce(o.price_delta_child, o.price_delta_adult);
  end if;

  v_items := p_adults * v_price_adult + p_children * v_price_child; -- infant: 0

  -- kupon
  if p_coupon_code is not null then
    select * into c from coupons where code = upper(p_coupon_code) and is_active
      and (valid_from is null or valid_from <= now())
      and (valid_to is null or valid_to >= now())
      and (max_redemptions is null or redeemed_count < max_redemptions)
      and (listing_id is null or listing_id = p_listing)
      and (provider_id is null or provider_id = l.provider_id);
    if c.id is not null and (c.min_order_total is null or v_items >= c.min_order_total) then
      if c.kind = 'percent' then
        v_discount := round(v_items * c.value / 100.0)::int;
      else
        v_discount := least(round(c.value)::int, v_items);
      end if;
      update coupons set redeemed_count = redeemed_count + 1 where id = c.id;
    end if;
  end if;

  v_total := v_items + v_extras - v_discount;
  if v_total < 0 then v_total := 0; end if;
  v_rate := resolve_commission_rate(p_listing);

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
    case when v_total = 0 then 'pending_confirmation'::booking_status
         else 'pending_payment'::booking_status end,
    l.currency, p_adults, p_children, p_infants,
    v_items, v_extras, v_discount, v_total,
    v_rate, round(v_total * v_rate / 100.0)::int,
    v_total - round(v_total * v_rate / 100.0)::int,
    c.id, p_lead_name, p_lead_email, p_lead_phone,
    p_hotel, p_pickup, p_special, coalesce(p_customer_locale,'en'),
    p_affiliate_link, p_idempotency_key
  ) returning id into v_booking;

  update availability set booked_count = booked_count + v_qty where id = v_avail_id;
  update listings set booking_count = booking_count + 1 where id = p_listing;

  -- affiliate jutalék (függő státuszban)
  if p_affiliate_link is not null then
    insert into affiliate_commissions (link_id, booking_id, amount, currency)
    select p_affiliate_link, v_booking,
           round(v_total * coalesce(pl.commission_rate, 5) / 100.0)::int, l.currency
    from promoter_links pl where pl.id = p_affiliate_link and pl.is_active;
  end if;

  return v_booking;
end;
$$;

-- ============ STÁTUSZNAPLÓ TRIGGER ============
create or replace function public.log_booking_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into booking_status_log (booking_id, from_status, to_status, actor_id)
    values (new.id,
            case when tg_op = 'INSERT' then null else old.status end,
            new.status, auth.uid());
  end if;
  return new;
end;
$$;
create trigger trg_booking_status
  after insert or update on bookings
  for each row execute function log_booking_status();

-- ============ ÉRTÉKELÉS → LISTING ÁTLAG ============
create or replace function public.refresh_listing_rating()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update listings l set
    rating_avg = coalesce((select round(avg(rating)::numeric,2) from reviews
      where listing_id = l.id and status = 'published'),0),
    rating_count = (select count(*) from reviews
      where listing_id = l.id and status = 'published')
  where l.id = coalesce(new.listing_id, old.listing_id);
  return coalesce(new, old);
end;
$$;
create trigger trg_review_rating
  after insert or update or delete on reviews
  for each row execute function refresh_listing_rating();
