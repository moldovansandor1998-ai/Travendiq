-- Travendiq – 00014: chargeback-védelem + Transfer Reversal állapotgép
-- Chargeback létrejöttekor minden ki nem fizetett payout blokkolva (payout_blocked);
-- a már KIFIZETETT (transzferes) payoutra biztonságos reversal-folyamat:
-- kérés → Stripe transfers.createReversal → transfer.reversed webhook settle.
-- Részleges visszavonás és elégtelen connected-account balance is kezelt.

alter table payouts add column if not exists reversal_status text not null default 'none';
alter table payouts add column if not exists reversed_amount int not null default 0;
alter table payouts add column if not exists reversal_reason text;

alter table payouts drop constraint if exists payouts_reversal_status_check;
alter table payouts add constraint payouts_reversal_status_check
  check (reversal_status in ('none','pending','partial','reversed','failed'));

-- ============ 1) chargeback kezelése (egy tranzakció) ============
-- payment → chargeback, booking → disputed, ledger-jelzés.
-- A nyitott payoutok blokkolását a payout_blocked() biztosítja (payment chargeback).
create or replace function public.handle_chargeback(
  p_intent_id text, p_dispute_id text, p_amount int, p_currency text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype;
  b bookings%rowtype;
  v_payout payouts%rowtype;
begin
  select * into p from payments where provider_payment_id = p_intent_id for update;
  if p.id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into b from bookings where id = p.booking_id;

  update payments set status = 'chargeback', updated_at = now() where id = p.id;
  update bookings set status = 'disputed' where id = b.id and status not in ('refunded');

  if not exists (select 1 from ledger_entries
    where booking_id = b.id and kind = 'adjustment'
      and meta->>'note' = 'chargeback_opened' and meta->>'dispute' = p_dispute_id) then
    insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
    values (b.provider_id, b.id, 'adjustment', 0, coalesce(p_currency, b.currency),
      jsonb_build_object('note', 'chargeback_opened', 'dispute', p_dispute_id, 'amount', p_amount));
  end if;

  -- már kifizetett payout azonosítása a reversal-hoz (az app végzi a Stripe-hívást)
  select * into v_payout from payouts
    where booking_id = b.id and status = 'paid' and provider_payout_id is not null
      and reversed_amount < amount
    order by created_at desc limit 1;

  return jsonb_build_object('found', true, 'booking_id', b.id, 'payment_id', p.id,
    'paid_payout_id', v_payout.id,
    'paid_transfer_id', v_payout.provider_payout_id,
    'paid_amount', v_payout.amount,
    'already_reversed', coalesce(v_payout.reversed_amount, 0));
end;
$$;

-- ============ 2) reversal kérés rögzítése (Stripe-hívás ELŐTT) ============
-- A Stripe transfers.createReversal után a webhook settle-el.
create or replace function public.request_payout_reversal(
  p_payout uuid, p_amount int, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
begin
  select * into v from payouts where id = p_payout for update;
  if v.id is null then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v.status <> 'paid' or v.provider_payout_id is null then
    raise exception 'PAYOUT_NOT_REVERSIBLE';
  end if;
  if v.reversed_amount + p_amount > v.amount then
    raise exception 'REVERSAL_EXCEEDS_PAYOUT';
  end if;

  update payouts set reversal_status = 'pending', reversal_reason = p_reason
  where id = p_payout;

  return jsonb_build_object('transfer_id', v.provider_payout_id,
    'amount', p_amount, 'currency', v.currency, 'booking_id', v.booking_id,
    'provider_id', v.provider_id);
end;
$$;

-- ============ 3) reversal settle (transfer.reversed webhookból) ============
-- Idempotens: a reversal Stripe-ID-t a ledger meta őrzi.
create or replace function public.settle_transfer_reversal(
  p_transfer_id text, p_reversal_id text, p_amount int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
begin
  select * into v from payouts where provider_payout_id = p_transfer_id for update;
  if v.id is null then
    return jsonb_build_object('found', false);
  end if;

  if exists (select 1 from ledger_entries
    where kind = 'adjustment' and meta->>'note' = 'transfer_reversed'
      and meta->>'reversal' = p_reversal_id) then
    return jsonb_build_object('found', true, 'already', true, 'payout_id', v.id);
  end if;

  update payouts set
    reversed_amount = least(v.amount, reversed_amount + p_amount),
    reversal_status = case
      when least(v.amount, reversed_amount + p_amount) >= v.amount then 'reversed'
      else 'partial' end
  where id = v.id;

  -- a pénz visszaáramlott a platformra → főkönyvi jóváírás a szolgáltató felé
  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, v.booking_id, 'adjustment', p_amount, v.currency,
    jsonb_build_object('note', 'transfer_reversed', 'transfer', p_transfer_id,
      'reversal', p_reversal_id, 'payout_id', v.id));

  return jsonb_build_object('found', true, 'already', false, 'payout_id', v.id);
end;
$$;

-- ============ 4) reversal hiba (pl. elégtelen connected-account balance) ============
create or replace function public.fail_payout_reversal(
  p_payout uuid, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update payouts set reversal_status = 'failed',
    reversal_reason = left(p_reason, 500)
  where id = p_payout and reversal_status in ('pending','partial');
end;
$$;

revoke all on function public.handle_chargeback(text, text, int, text) from public, anon, authenticated;
revoke all on function public.request_payout_reversal(uuid, int, text) from public, anon, authenticated;
revoke all on function public.settle_transfer_reversal(text, text, int) from public, anon, authenticated;
revoke all on function public.fail_payout_reversal(uuid, text) from public, anon, authenticated;
grant execute on function public.handle_chargeback(text, text, int, text) to service_role;
grant execute on function public.request_payout_reversal(uuid, int, text) to service_role;
grant execute on function public.settle_transfer_reversal(text, text, int) to service_role;
grant execute on function public.fail_payout_reversal(uuid, text) to service_role;
