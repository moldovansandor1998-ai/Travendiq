-- Travendiq – 00018: későn sikerült fizetés + chargeback-won rendezés

-- ============ 0) chargeback-won ÚJRATRANSZFER támogatása ============
-- A megnyert chargeback utáni kontrollált új payoutnak ugyanahhoz a bookinghoz
-- kell kapcsolódnia, miközben az eredeti 'paid' payout is megmarad – ez eddig
-- a payouts_booking_uidx (bookingonként egy payout) miatt lehetetlen volt.
-- Megoldás: origin_payout_id oszlop; az egyedi index csak az EREDETI
-- (origin_payout_id IS NULL) payoutokra vonatkozik, az újratranszferek kizárva.
alter table payouts add column if not exists origin_payout_id uuid references payouts(id);

drop index if exists payouts_booking_uidx;
create unique index payouts_booking_uidx on payouts (booking_id)
  where booking_id is not null and origin_payout_id is null;

-- ============ 1) settle_payment_success v2 ============
-- Későn beérkező sikeres fizetés (a booking közben lejárt/cancelled):
--  - NEM hoz létre payoutot és NEM aktiválja újra a bookingot,
--  - a kapacitás NEM foglalódik vissza automatikusan (lehet, hogy már másnak eladtuk),
--  - a payment 'captured' lesz (a pénz tényleg megérkezett), a booking 'disputed'-be megy,
--  - refund-kérelem jön létre a teljes összegre (a központi refund-folyamat
--    Stripe-hívást indít), és adminriasztás készül (late_payment alert).
create or replace function public.settle_payment_success(
  p_intent_id text, p_charge_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype;
  b bookings%rowtype;
  l listings%rowtype;
  v_target booking_status;
  v_refund_id uuid;
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

  -- payment mindenképp captured (a pénz megérkezett)
  update payments set status = 'captured',
    stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
    captured_at = now(), updated_at = now()
  where id = p.id;

  -- ===== késői fizetés: a booking már nem fizethető állapotban =====
  if b.status <> 'pending_payment' then
    -- NINCS automatikus újraaktiválás, NINCS payout, NINCS kapacitás-visszafoglalás
    update bookings set status = 'disputed' where id = b.id
      and status not in ('refunded', 'completed', 'attended');

    if not exists (select 1 from ledger_entries
      where booking_id = b.id and kind = 'adjustment' and meta->>'note' = 'late_payment') then
      insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
      values (b.provider_id, b.id, 'adjustment', 0, b.currency,
        jsonb_build_object('note', 'late_payment', 'intent', p_intent_id,
          'booking_status', b.status::text));
    end if;

    -- automatikus teljes refund-kérelem (a vásárló ne károsodjon)
    if p.status in ('requires_payment','authorized') and b.grand_total > 0
       and not exists (select 1 from refunds where booking_id = b.id
                       and status in ('pending','processing','succeeded')) then
      insert into refunds (booking_id, payment_id, amount, currency, reason,
        status, note)
      values (b.id, p.id, b.grand_total, b.currency, 'late_payment',
        'pending', 'Későn sikerült fizetés – automatikus visszatérítés')
      returning id into v_refund_id;
    end if;

    return jsonb_build_object('found', true, 'already', false, 'late', true,
      'payment_id', p.id, 'booking_id', b.id, 'booking_code', b.code,
      'booking_status', b.status, 'auto_refund_id', v_refund_id);
  end if;

  -- ===== normál út: pending_payment → megerősítés =====
  v_target := case when l.confirmation = 'manual'
    then 'pending_confirmation'::booking_status else 'confirmed'::booking_status end;

  update bookings set status = v_target, paid_at = now() where id = b.id;

  if not exists (select 1 from ledger_entries
    where booking_id = b.id and kind = 'booking_revenue') then
    insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta) values
      (b.provider_id, b.id, 'booking_revenue', b.grand_total, b.currency,
       jsonb_build_object('payment_id', p.id, 'intent', p_intent_id)),
      (b.provider_id, b.id, 'commission', -b.commission_amount, b.currency,
       jsonb_build_object('payment_id', p.id));
  end if;

  insert into payouts (provider_id, booking_id, amount, currency, status, hold_reason)
  values (b.provider_id, b.id, b.provider_amount, b.currency, 'held', 'until_service_completed')
  on conflict (booking_id) where booking_id is not null and origin_payout_id is null do nothing;

  return jsonb_build_object('found', true, 'already', false, 'late', false,
    'payment_id', p.id, 'booking_id', b.id, 'booking_code', b.code,
    'target_status', v_target);
end;
$$;

revoke all on function public.settle_payment_success(text, text) from public, anon, authenticated;
grant execute on function public.settle_payment_success(text, text) to service_role;

-- ============ 2) chargeback MEGNYERÉSE a reversal után ============
-- Ha a dispute-ot megnyertük, de a provider-pénz már visszavonódott
-- (transfer reversal), a szolgáltató ne maradjon pénz nélkül:
--  - új 'scheduled' payout jön létre a visszavont (még rendezetlen) összegre,
--  - admin jóváhagyással újratranszferálható,
--  - az eredeti payouton a reversal 'won_back' jelölést kap.
create or replace function public.resolve_chargeback_won(p_booking uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype;
  v payouts%rowtype;
  v_reversed int;
  v_new uuid;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then return jsonb_build_object('found', false); end if;

  select * into v from payouts
    where booking_id = p_booking and status = 'paid'
    order by created_at desc limit 1;

  if v.id is null then
    return jsonb_build_object('found', true, 'reversed_amount', 0, 'action', 'none');
  end if;

  -- sikeresen visszavont, még nem rendezett összeg
  select coalesce(sum(requested_amount), 0) into v_reversed
  from payout_reversals
  where payout_id = v.id and status = 'succeeded';

  if v_reversed <= 0 then
    return jsonb_build_object('found', true, 'reversed_amount', 0, 'action', 'none');
  end if;

  -- idempotens: ha már létezik won-back payout ehhez a bookinghoz, nem hozunk újat
  select id into v_new from payouts
    where booking_id = p_booking and status in ('scheduled','paid')
      and hold_reason like 'chargeback_won_retransfer%'
    limit 1;
  if v_new is not null then
    return jsonb_build_object('found', true, 'reversed_amount', v_reversed,
      'action', 'already_created', 'new_payout_id', v_new);
  end if;

  insert into payouts (provider_id, booking_id, amount, currency, status, hold_reason,
    origin_payout_id)
  values (v.provider_id, p_booking, v_reversed, v.currency, 'scheduled',
    'chargeback_won_retransfer: admin jóváhagyás szükséges az újratranszferhez',
    v.id)
  returning id into v_new;

  update payouts set reversal_reason = coalesce(reversal_reason, '') ||
      ' | won_back:' || v_new::text, version = version + 1
  where id = v.id;

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, p_booking, 'adjustment', 0, v.currency,
    jsonb_build_object('note', 'chargeback_won_retransfer_scheduled',
      'new_payout_id', v_new, 'amount', v_reversed, 'origin_payout', v.id));

  return jsonb_build_object('found', true, 'reversed_amount', v_reversed,
    'action', 'new_payout_created', 'new_payout_id', v_new);
end;
$$;

revoke all on function public.resolve_chargeback_won(uuid) from public, anon, authenticated;
grant execute on function public.resolve_chargeback_won(uuid) to service_role;
