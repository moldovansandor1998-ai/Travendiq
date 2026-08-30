-- Travendiq – 00011: payment_intent.succeeded TELJES könyvelése egyetlen
-- idempotens tranzakcióban + atomikus fizetés-előkészítés (expiry + sorzár).

-- ============ 1) settle_payment_success ============
-- payment státusz + booking státusz + ledger + payout létrehozás EGY tranzakcióban.
-- Ha a payment már 'captured', azonnal visszatér (already=true), nem duplikál.
create or replace function public.settle_payment_success(
  p_intent_id text, p_charge_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype;
  b bookings%rowtype;
  l listings%rowtype;
  v_target booking_status;
begin
  select * into p from payments where provider_payment_id = p_intent_id for update;
  if p.id is null then
    return jsonb_build_object('found', false);
  end if;

  if p.status = 'captured' then
    return jsonb_build_object('found', true, 'already', true,
      'payment_id', p.id, 'booking_id', p.booking_id);
  end if;

  select * into b from bookings where id = p.booking_id for update;
  select * into l from listings where id = b.listing_id;

  update payments set status = 'captured',
    stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
    captured_at = now(), updated_at = now()
  where id = p.id;

  v_target := case when l.confirmation = 'manual'
    then 'pending_confirmation'::booking_status else 'confirmed'::booking_status end;

  if b.status = 'pending_payment' then
    update bookings set status = v_target, paid_at = now() where id = b.id;
  end if;

  -- ledger csak ha még nincs booking_revenue ehhez a foglaláshoz (idempotens)
  if not exists (select 1 from ledger_entries
    where booking_id = b.id and kind = 'booking_revenue') then
    insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta) values
      (b.provider_id, b.id, 'booking_revenue', b.grand_total, b.currency,
       jsonb_build_object('payment_id', p.id, 'intent', p_intent_id)),
      (b.provider_id, b.id, 'commission', -b.commission_amount, b.currency,
       jsonb_build_object('payment_id', p.id));
  end if;

  -- payout visszatartva a teljesülésig (a pénz a platformegyenlegen marad)
  insert into payouts (provider_id, booking_id, amount, currency, status, hold_reason)
  values (b.provider_id, b.id, b.provider_amount, b.currency, 'held', 'until_service_completed')
  on conflict (booking_id) where booking_id is not null do nothing;

  return jsonb_build_object('found', true, 'already', false,
    'payment_id', p.id, 'booking_id', b.id, 'booking_code', b.code,
    'target_status', v_target);
end;
$$;

revoke all on function public.settle_payment_success(text, text) from public, anon, authenticated;
grant execute on function public.settle_payment_success(text, text) to service_role;

-- ============ 2) prepare_booking_payment ============
-- Fizetés indítása ELŐTT: lejárat-takarítás erre a foglalásra, majd sorzárral
-- újraellenőrzés. Lejárt/módosult foglaláshoz nem ad vissza fizethető sort.
-- Visszatér: a fizetéshez szükséges mezők, vagy exception (BOOKING_NOT_PAYABLE).
create or replace function public.prepare_booking_payment(
  p_booking uuid, p_ttl_minutes int default 30
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype;
begin
  -- lejárat feldolgozása: ha a foglalás TTL-en túli, most járjuk le
  update bookings set status = 'cancelled', cancelled_at = now(),
    cancel_reason = 'payment_expired'
  where id = p_booking and status = 'pending_payment'
    and created_at < now() - make_interval(mins => p_ttl_minutes);
  if found then
    update availability a set booked_count = greatest(a.booked_count - b2.total_participants, 0)
    from bookings b2
    where b2.id = p_booking and a.id = b2.availability_id;
  end if;

  -- sorzár + állapot-újraellenőrzés
  select * into b from bookings where id = p_booking for update;
  if b.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if b.status <> 'pending_payment' then
    raise exception 'BOOKING_NOT_PAYABLE: %', b.status;
  end if;

  return jsonb_build_object(
    'id', b.id, 'code', b.code, 'grand_total', b.grand_total, 'currency', b.currency,
    'commission_amount', b.commission_amount, 'provider_amount', b.provider_amount,
    'provider_id', b.provider_id, 'listing_id', b.listing_id,
    'customer_locale', b.customer_locale, 'lead_email', b.lead_email,
    'guest_email', b.guest_email, 'user_id', b.user_id,
    'guest_access_token', b.guest_access_token, 'date', b.date);
end;
$$;

revoke all on function public.prepare_booking_payment(uuid, int) from public, anon, authenticated;
grant execute on function public.prepare_booking_payment(uuid, int) to service_role;
