-- Travendiq – 00016: refund rendezésekor a KI NEM FIZETETT payout atomikus
-- csökkentése a refund szolgáltatói részével. Teljes refundnál a payout
-- végleg 'cancelled' lesz, és az eredeti összeg soha nem szabadítható fel újra.
-- (A legkritikusabb korábbi hiba javítása: a held payout összege eddig
-- változatlan maradt refund után, és újra felszabadíthatóvá vált.)

-- ============ 0) új payout-státusz ============
alter type payout_status add value if not exists 'cancelled';

-- ============ 1) payout_blocked – sikeres TELJES refund is blokkol ============
-- A sikeres refund már nem 'pending/processing', ezért a régi payout_blocked
-- a refund lezárása UTÁN újra felszabadította volna az (eredeti összegű!)
-- payoutot. Mostantól: ha a booking 'refunded', vagy a sikeres refundok
-- összege eléri a grand_totalt, a kifizetés végleg blokkolt.
create or replace function public.payout_blocked(p_booking uuid)
returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from refunds r
    where r.booking_id = p_booking and r.status in ('pending','processing')
  ) or exists (
    select 1 from payments p
    where p.booking_id = p_booking and p.status = 'chargeback'
  ) or exists (
    -- sikeres TELJES refund (booking státusz VAGY összeg szerint is)
    select 1 from bookings b
    where b.id = p_booking and (
      b.status = 'refunded'
      or (select coalesce(sum(r2.amount), 0) from refunds r2
          where r2.booking_id = p_booking and r2.status = 'succeeded') >= b.grand_total
    )
  );
$$;

-- ============ 2) settle_refund v3 – payout-igazítás a tranzakción belül ============
-- A korábbi verzió csak a ledgert írta. Mostantól:
--  - ha van KI NEM FIZETETT payout (held/pending/scheduled/releasing):
--      amount := amount - provider_share; ha <= 0 → status 'cancelled'
--      (a sor megmarad az audit miatt, de sosem szabadítható fel újra,
--       mert 'cancelled' nincs az acquire engedélyezett státuszai közt)
--  - ha már KIFIZETETT: a külön reversal-folyamat (payout_reversals, 00017)
--    vonja vissza – itt csak jelöljük (a webhook handler indítja a Stripe-hívást)
create or replace function public.settle_refund(
  p_refund uuid, p_provider_refund_id text,
  p_transfer_reversal_id text default null, p_fee_reversed boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r refunds%rowtype; b bookings%rowtype;
  v_provider_share int; v_platform_share int;
  v_payout payouts%rowtype;
  v_total_refunded int;
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

  -- >>> KRITIKUS JAVÍTÁS: még ki nem fizetett payout atomikus csökkentése <<<
  select * into v_payout from payouts
    where booking_id = r.booking_id
      and status in ('held','pending','scheduled','releasing')
    order by created_at desc limit 1 for update;

  if v_payout.id is not null then
    -- összes sikeres refund szolgáltatói része (az aktuálissal együtt)
    select coalesce(sum(rf.amount - case when b.grand_total > 0
        then round(rf.amount * b.commission_amount::numeric / b.grand_total) else 0 end), 0)
      into v_total_refunded
    from refunds rf
    where rf.booking_id = r.booking_id and rf.status = 'succeeded';

    if v_total_refunded >= b.provider_amount then
      -- teljes refund a szolgáltatói részen → végleges törlés, sosem szabadítható fel
      update payouts set status = 'cancelled',
        hold_reason = 'cancelled_after_full_refund',
        version = version + 1
      where id = v_payout.id;
    else
      update payouts set
        amount = b.provider_amount - v_total_refunded,
        hold_reason = coalesce(hold_reason, 'until_service_completed')
          || ' | refund_adjusted',
        version = version + 1
      where id = v_payout.id;
    end if;
  end if;

  perform sync_booking_refund_status(r.booking_id);
end;
$$;

revoke all on function public.settle_refund(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.settle_refund(uuid, text, text, boolean) to service_role;

-- ============ 3) acquire: csak pozitív összegű payout szabadítható fel ============
-- (a 'cancelled' státusz eleve kizárt; itt plusz védelmi réteg a 0/negatív összegre)
create or replace function public.acquire_payout_release(p_payout uuid, p_actor uuid)
returns table(id uuid, provider_id uuid, amount int, currency text, booking_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_booking uuid;
begin
  select p.booking_id into v_booking from payouts p where p.id = p_payout for update;
  if v_booking is not null and payout_blocked(v_booking) then
    raise exception 'PAYOUT_BLOCKED: aktív/teljes refund vagy chargeback miatt a kifizetés zárolva';
  end if;
  return query
  update payouts p set status = 'releasing', version = p.version + 1
  where p.id = p_payout and p.status in ('held','pending','scheduled')
    and p.amount > 0
  returning p.id, p.provider_id, p.amount, p.currency, p.booking_id;
end $$;

revoke all on function public.acquire_payout_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_payout_release(uuid, uuid) to service_role;
