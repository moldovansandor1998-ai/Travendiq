-- Travendiq – 00013: refund-egyeztetés Stripe refund ID (re_...) alapján
-- Minden Stripe refund külön provider_refund_id-val egyezik. A charge.refunded
-- webhook a refunds.data rekordokat EGYENKÉNT dolgozza fel ezzel az RPC-vel;
-- Dashboardon indított refundhoz automatikusan belső rekord jön létre.

create unique index if not exists refunds_provider_refund_uidx
  on refunds (provider_refund_id) where provider_refund_id is not null;

-- Egy Stripe refund rekord feldolgozása (idempotens):
--  - meglévő belső refund egyeztetése provider_refund_id alapján,
--  - ha nincs belső rekord (Dashboard-refund): létrehozás + settle,
--  - Stripe-oldali failed/canceled státusz kezelése.
-- Visszatér: { refund_id, created, settled, failed }
create or replace function public.settle_refund_by_stripe_id(
  p_stripe_refund_id text,       -- re_...
  p_payment uuid,
  p_amount int,
  p_currency text,
  p_stripe_status text           -- succeeded | pending | failed | canceled
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r refunds%rowtype;
  b bookings%rowtype;
  v_created boolean := false;
begin
  -- 1) egyezés a tárolt Stripe refund ID-val
  select * into r from refunds where provider_refund_id = p_stripe_refund_id for update;

  -- 2) nincs belső rekord → Dashboard-refund.
  if r.id is null then
    select * into b from bookings
      where id = (select booking_id from payments where id = p_payment);
    if b.id is null then
      return jsonb_build_object('found', false, 'reason', 'payment_not_found');
    end if;

    -- 2a) ha van Stripe-ID nélküli nyitott belső refund UGYANAZZAL az összeggel,
    --     azt párosítjuk (az app indította, de a re_... ID még nem került tárolásra)
    select * into r from refunds
      where payment_id = p_payment and status in ('pending','processing')
        and provider_refund_id is null and amount = p_amount
      limit 1 for update;
    if r.id is not null then
      update refunds set provider_refund_id = p_stripe_refund_id where id = r.id;
    else
      -- 2b) tényleg új (Dashboardon indított) refund → belső rekord létrehozása
      begin
        insert into refunds (booking_id, payment_id, amount, currency, reason,
          status, provider_refund_id, note)
        values (b.id, p_payment, p_amount, p_currency,
          'stripe_dashboard', 'processing', p_stripe_refund_id,
          'Stripe Dashboardon indított refund – automatikusan egyeztetve')
        returning * into r;
        v_created := true;
      exception
        when unique_violation then
          -- versenyhelyzet: másik worker hozta létre, vagy aktív refund ütközés
          select * into r from refunds where provider_refund_id = p_stripe_refund_id for update;
          if r.id is null then
            return jsonb_build_object('found', false, 'reason', 'active_refund_conflict');
          end if;
      end;
    end if;
  end if;

  if r.id is null then
    return jsonb_build_object('found', false, 'reason', 'race_lost');
  end if;

  -- 3) Stripe-státusz szerinti lezárás
  if p_stripe_status = 'succeeded' then
    if r.status in ('pending','processing') then
      perform settle_refund(r.id, p_stripe_refund_id);
    end if;
    return jsonb_build_object('found', true, 'refund_id', r.id,
      'created', v_created, 'settled', true, 'amount', r.amount);
  elsif p_stripe_status in ('failed','canceled') then
    update refunds set status = 'failed', note = 'stripe_status: ' || p_stripe_status
    where id = r.id and status in ('pending','processing');
    return jsonb_build_object('found', true, 'refund_id', r.id,
      'created', v_created, 'settled', false, 'failed', true);
  else
    -- pending: még nem végleges – a sor marad nyitva, a következő webhook lezárja
    return jsonb_build_object('found', true, 'refund_id', r.id,
      'created', v_created, 'settled', false, 'pending', true);
  end if;
end;
$$;

revoke all on function public.settle_refund_by_stripe_id(text, uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.settle_refund_by_stripe_id(text, uuid, int, text, text) to service_role;
