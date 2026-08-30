-- Travendiq – 00023: refund/chargeback rendezés az attempt-alapú
-- állapotgéphez + metadata-alapú reversal-párosítás + manuális rendezés.

-- ============ 1) settle_refund v5 ============
-- Változás a v4-hez képest:
--  - 'transfer_submitted' és 'reconciliation_required' payoutra is
--    awaiting_transfer kötelezettség jön létre (a Transfer-összeg ettől már
--    rögzített, a refund azt SOHA nem módosítja),
--  - 'paid' payoutnál MANUÁLIS kifizetés esetén (nincs tr_ Transfer ID) a
--    kötelezettség NEM 'requested', hanem 'reconciliation_required' +
--    audit-riasztás (manuális rendezés kell).
drop function if exists public.settle_refund(uuid, text, text, boolean);
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
  v_committed int; v_available int; v_ins int;
begin
  update refunds set status = 'succeeded', provider_refund_id = p_provider_refund_id,
    transfer_reversal_id = p_transfer_reversal_id, application_fee_reversed = p_fee_reversed,
    locked_at = null, locked_by = null
  where id = p_refund and status in ('pending','processing')
  returning * into r;
  if r.id is null then return; end if;  -- idempotens

  select * into b from bookings where id = r.booking_id;

  v_platform_share := case when b.grand_total > 0
    then round(r.amount * b.commission_amount::numeric / b.grand_total) else 0 end;
  v_provider_share := r.amount - v_platform_share;

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta) values
    (b.provider_id, r.booking_id, 'refund', -v_provider_share, r.currency,
     jsonb_build_object('refund_id', r.id, 'part', 'provider_share')),
    (b.provider_id, r.booking_id, 'commission', v_platform_share, r.currency,
     jsonb_build_object('refund_id', r.id, 'part', 'commission_reversal'));

  update affiliate_commissions set status = 'reversed'
    where booking_id = r.booking_id and status in ('pending','approved');

  select * into v_payout from payouts
    where booking_id = r.booking_id
      and status in ('held','pending','scheduled','releasing',
                     'transfer_submitted','reconciliation_required','paid')
      and origin_payout_id is null
    order by created_at desc limit 1 for update;

  if v_payout.id is null then
    perform sync_booking_refund_status(r.booking_id);
    return;
  end if;

  if v_payout.status in ('held','pending','scheduled') then
    -- ki nem fizetett, Transfer-attempt MÉG NINCS: atomikus csökkentés
    select coalesce(sum(rf.amount - case when b.grand_total > 0
        then round(rf.amount * b.commission_amount::numeric / b.grand_total) else 0 end), 0)
      into v_total_refunded
    from refunds rf
    where rf.booking_id = r.booking_id and rf.status = 'succeeded';

    if v_total_refunded >= b.provider_amount then
      update payouts set status = 'cancelled',
        hold_reason = 'cancelled_after_full_refund', version = version + 1
      where id = v_payout.id;
    else
      update payouts set
        amount = b.provider_amount - v_total_refunded,
        hold_reason = coalesce(hold_reason, 'until_service_completed') || ' | refund_adjusted',
        version = version + 1
      where id = v_payout.id;
    end if;

  elsif v_payout.status in ('releasing','transfer_submitted','reconciliation_required') then
    -- a Transfer-összeg már rögzített (attempt) → a payout összege ÉRINTETLEN,
    -- tartós kötelezettség jön létre (a finalize/abort rendezi)
    insert into payout_reversals (payout_id, refund_id, requested_amount, currency,
      idempotency_key, status)
    values (v_payout.id, r.id, v_provider_share, r.currency,
      'oblref_' || r.id::text, 'awaiting_transfer')
    on conflict (idempotency_key) do nothing;

  elsif v_payout.status = 'paid' then
    select coalesce(sum(requested_amount), 0) into v_committed
    from payout_reversals
    where payout_id = v_payout.id
      and status in ('requested','submitting','submitted','succeeded','awaiting_transfer');
    v_available := greatest(v_payout.amount - v_committed, 0);
    v_ins := least(v_provider_share, v_available);

    if v_payout.provider_payout_id is null then
      -- MANUÁLIS kifizetés: nincs tr_ Transfer ID → nincs automatikus reversal,
      -- manuális rendezés kell (banki referencia + dátum + összeg + admin)
      insert into payout_reversals (payout_id, refund_id, requested_amount, currency,
        idempotency_key, status, failure)
      values (v_payout.id, r.id, v_provider_share, r.currency,
        'revref_' || r.id::text, 'reconciliation_required',
        'manual_payout: nincs tr_ Transfer ID – manuális rendezés szükséges')
      on conflict (idempotency_key) do nothing;
      insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
      values (null, 'admin', 'manual_payout_reversal_reconciliation_required',
        'payouts', v_payout.id::text,
        jsonb_build_object('refund_id', r.id, 'amount', v_provider_share,
          'manual_reference', v_payout.manual_reference));
    else
      if v_ins > 0 then
        insert into payout_reversals (payout_id, refund_id, requested_amount, currency,
          idempotency_key, status)
        values (v_payout.id, r.id, v_ins, r.currency,
          'revref_' || r.id::text, 'requested')
        on conflict (idempotency_key) do nothing;
        update payouts set reversal_status = 'pending',
          reversal_reason = 'refund:' || r.id::text, version = version + 1
        where id = v_payout.id and reversal_status in ('none','partial');
      end if;
      if v_provider_share > v_ins then
        insert into payout_reversals (payout_id, refund_id, requested_amount, currency,
          idempotency_key, status, failure)
        values (v_payout.id, r.id, v_provider_share - v_ins, r.currency,
          'recref_' || r.id::text, 'reconciliation_required',
          'A refund szolgáltatói része meghaladta a még visszavonható összeget')
        on conflict (idempotency_key) do nothing;
        insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
        values (null, 'admin', 'reversal_reconciliation_required', 'payouts',
          v_payout.id::text, jsonb_build_object('refund_id', r.id,
            'missing_amount', v_provider_share - v_ins));
      end if;
    end if;
  end if;

  perform sync_booking_refund_status(r.booking_id);
end;
$$;

-- ============ 2) handle_chargeback v3 – manuális payout + új státuszok ============
drop function if exists public.handle_chargeback(text, text, int, text);
create or replace function public.handle_chargeback(
  p_intent_id text, p_dispute_id text, p_amount int, p_currency text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype;
  b bookings%rowtype;
  v_payout payouts%rowtype;
  v_committed int; v_available int; v_ins int;
  rr payout_reversals%rowtype;
  v_key text := 'revcb_' || p_dispute_id;
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

  select * into rr from payout_reversals where idempotency_key = v_key;
  if rr.id is not null then
    return jsonb_build_object('found', true, 'booking_id', b.id, 'payment_id', p.id,
      'reversal_row_id', rr.id, 'requested_amount', rr.requested_amount,
      'reversal_status', rr.status, 'stripe_reversal_id', rr.stripe_reversal_id,
      'idempotent_replay', true,
      'transfer_id', (select provider_payout_id from payouts where id = rr.payout_id));
  end if;

  select * into v_payout from payouts
    where booking_id = b.id and status in ('paid','releasing',
        'transfer_submitted','reconciliation_required')
      and origin_payout_id is null
    order by created_at desc limit 1 for update;

  if v_payout.id is null then
    return jsonb_build_object('found', true, 'booking_id', b.id, 'payment_id', p.id,
      'reversal_row_id', null, 'requested_amount', 0);
  end if;

  select coalesce(sum(requested_amount), 0) into v_committed
  from payout_reversals
  where payout_id = v_payout.id
    and status in ('requested','submitting','submitted','succeeded','awaiting_transfer');
  v_available := greatest(v_payout.amount - v_committed, 0);
  v_ins := least(v_payout.amount, v_available);

  if v_ins > 0 then
    if v_payout.status in ('releasing','transfer_submitted','reconciliation_required') then
      -- Transfer alatt / egyeztetés alatt → kötelezettség, a finalize/abort rendezi
      insert into payout_reversals (payout_id, dispute_id, requested_amount, currency,
        idempotency_key, status)
      values (v_payout.id, p_dispute_id, v_ins, v_payout.currency, v_key, 'awaiting_transfer')
      returning * into rr;
    elsif v_payout.provider_payout_id is null then
      -- MANUÁLIS kifizetés → manuális rendezés + riasztás
      insert into payout_reversals (payout_id, dispute_id, requested_amount, currency,
        idempotency_key, status, failure)
      values (v_payout.id, p_dispute_id, v_ins, v_payout.currency, v_key,
        'reconciliation_required',
        'manual_payout: nincs tr_ Transfer ID – manuális rendezés szükséges')
      returning * into rr;
      insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
      values (null, 'admin', 'manual_payout_reversal_reconciliation_required',
        'payouts', v_payout.id::text,
        jsonb_build_object('dispute', p_dispute_id, 'amount', v_ins));
    else
      insert into payout_reversals (payout_id, dispute_id, requested_amount, currency,
        idempotency_key, status)
      values (v_payout.id, p_dispute_id, v_ins, v_payout.currency, v_key, 'requested')
      returning * into rr;
    end if;

    update payouts set reversal_status = 'pending',
      reversal_reason = 'chargeback:' || p_dispute_id, version = version + 1
    where id = v_payout.id;
  end if;

  return jsonb_build_object('found', true, 'booking_id', b.id, 'payment_id', p.id,
    'reversal_row_id', rr.id, 'requested_amount', coalesce(rr.requested_amount, 0),
    'reversal_status', rr.status, 'stripe_reversal_id', rr.stripe_reversal_id,
    'idempotent_replay', false,
    'transfer_id', v_payout.provider_payout_id,
    'capped', v_ins < v_payout.amount, 'available', v_available);
end;
$$;

-- ============ 3) settle_payout_reversal v3 – METADATA-ELSŐ párosítás ============
-- A transfer.reversed webhook a reversal metadata.reversal_row_id mezője alapján
-- párosít. Metadata nélküli (régi/Dashboard) reversal CSAK biztonságos
-- egyezéssel (pontosan egy függő sor, azonos összeg) vagy
-- 'reconciliation_required' állapottal kezelhető – SOHA nem az "első NULL-os sor".
drop function if exists public.settle_payout_reversal(text, int, text);
create or replace function public.settle_payout_reversal(
  p_stripe_reversal_id text, p_amount int, p_transfer_id text default null,
  p_reversal_row uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rr payout_reversals%rowtype;
  v payouts%rowtype;
  v_candidates int;
begin
  -- 0) már settle-elve ez a trr_?
  select * into rr from payout_reversals
    where stripe_reversal_id = p_stripe_reversal_id for update;
  if rr.id is not null and rr.status = 'succeeded' then
    return jsonb_build_object('found', true, 'already', true, 'payout_id', rr.payout_id);
  end if;

  -- 1) METADATA-alapú párosítás (az elsődleges út)
  if rr.id is null and p_reversal_row is not null then
    select * into rr from payout_reversals where id = p_reversal_row for update;
    if rr.id is not null then
      if rr.status not in ('requested','submitting','submitted') then
        return jsonb_build_object('found', true, 'conflict', true,
          'payout_id', rr.payout_id, 'status', rr.status);
      end if;
      update payout_reversals set stripe_reversal_id = p_stripe_reversal_id,
        status = 'submitted', submitted_at = coalesce(submitted_at, now())
      where id = rr.id;
    end if;
  end if;

  -- 2) metadata nélküli régi/dashboard reversal: CSAK biztonságos egyezés
  if rr.id is null and p_transfer_id is not null then
    select * into v from payouts where provider_payout_id = p_transfer_id for update;
    if v.id is null then
      return jsonb_build_object('found', false);
    end if;

    select count(*) into v_candidates from payout_reversals
      where payout_id = v.id and stripe_reversal_id is null
        and status in ('requested','submitting','submitted')
        and requested_amount = p_amount;

    if v_candidates = 1 then
      -- pontosan egy, azonos összegű függő sor → biztonságos egyezés
      select * into rr from payout_reversals
        where payout_id = v.id and stripe_reversal_id is null
          and status in ('requested','submitting','submitted')
          and requested_amount = p_amount
        limit 1 for update;
      update payout_reversals set stripe_reversal_id = p_stripe_reversal_id,
        status = 'submitted', submitted_at = coalesce(submitted_at, now())
      where id = rr.id;
    else
      -- NEM egyértelmű (0 vagy több jelölt) → emberi rendezés, a reversed_amount
      -- NEM nő automatikusan
      insert into payout_reversals (payout_id, requested_amount, currency,
        stripe_reversal_id, idempotency_key, status, failure)
      values (v.id, p_amount, v.currency, p_stripe_reversal_id,
        'wh_' || p_stripe_reversal_id, 'reconciliation_required',
        'metadata_nelkuli_reversal: ' || v_candidates || ' jelölt, osszeg=' || p_amount)
      on conflict (idempotency_key) do nothing;
      if found then
        insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
        values (null, 'admin', 'reversal_reconciliation_required', 'payouts',
          v.id::text, jsonb_build_object('stripe_reversal_id', p_stripe_reversal_id,
            'amount', p_amount, 'candidates', v_candidates, 'transfer', p_transfer_id));
      end if;
      return jsonb_build_object('found', true, 'reconciliation_required', true,
        'payout_id', v.id);
    end if;
  elsif rr.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- 3) lezárás
  update payout_reversals set status = 'succeeded', settled_at = now()
  where id = rr.id;

  select * into v from payouts where id = rr.payout_id for update;
  update payouts set
    reversed_amount = least(v.amount, reversed_amount + rr.requested_amount),
    reversal_status = case
      when least(v.amount, reversed_amount + rr.requested_amount) >= v.amount then 'reversed'
      else 'partial' end,
    version = version + 1
  where id = rr.payout_id;

  if not exists (select 1 from ledger_entries
    where kind = 'adjustment' and meta->>'note' = 'transfer_reversed'
      and meta->>'reversal' = p_stripe_reversal_id) then
    insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
    values (v.provider_id, v.booking_id, 'adjustment', rr.requested_amount, v.currency,
      jsonb_build_object('note', 'transfer_reversed', 'reversal', p_stripe_reversal_id,
        'payout_id', rr.payout_id, 'refund_id', rr.refund_id, 'dispute_id', rr.dispute_id));
  end if;

  return jsonb_build_object('found', true, 'already', false, 'payout_id', rr.payout_id);
end;
$$;

-- ============ 4) manuális reversal-rendezés ============
-- Kötelező: banki referencia + dátum + rendezett összeg + admin + megjegyzés,
-- mindegyik az audit logban.
create or replace function public.resolve_reversal_manually(
  p_reversal_row uuid, p_admin uuid,
  p_reference text, p_resolved_date date, p_amount int, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rr payout_reversals%rowtype;
  v payouts%rowtype;
begin
  if p_admin is null then raise exception 'ADMIN_REQUIRED'; end if;
  if p_reference is null or length(trim(p_reference)) < 3 then
    raise exception 'REFERENCE_REQUIRED'; end if;
  if p_resolved_date is null then raise exception 'DATE_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'AMOUNT_REQUIRED'; end if;
  if p_note is null or length(trim(p_note)) < 3 then
    raise exception 'NOTE_REQUIRED'; end if;

  select * into rr from payout_reversals where id = p_reversal_row for update;
  if rr.id is null then raise exception 'REVERSAL_NOT_FOUND'; end if;
  if rr.status not in ('reconciliation_required','stripe_failed') then
    raise exception 'INVALID_STATE: csak reconciliation_required/stripe_failed sor rendezhető manuálisan (aktuális: %)', rr.status;
  end if;

  update payout_reversals set requested_amount = p_amount,
    status = 'succeeded', settled_at = now(),
    failure = 'manual_resolution: ' || left(p_reference, 120)
  where id = rr.id;

  select * into v from payouts where id = rr.payout_id for update;
  update payouts set
    reversed_amount = least(v.amount, reversed_amount + p_amount),
    reversal_status = case
      when least(v.amount, reversed_amount + p_amount) >= v.amount then 'reversed'
      else 'partial' end,
    version = version + 1
  where id = rr.payout_id;

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, v.booking_id, 'adjustment', p_amount, rr.currency,
    jsonb_build_object('note', 'transfer_reversed_manual',
      'reversal_row', rr.id, 'payout_id', rr.payout_id,
      'reference', p_reference, 'resolved_date', p_resolved_date));

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
  values (p_admin, 'admin', 'payout_reversal.manual_resolution', 'payout_reversals',
    rr.id::text, jsonb_build_object('reference', p_reference,
      'resolved_date', p_resolved_date, 'amount', p_amount, 'note', p_note,
      'payout_id', rr.payout_id, 'refund_id', rr.refund_id, 'dispute_id', rr.dispute_id));

  return jsonb_build_object('ok', true, 'reversal_row_id', rr.id,
    'payout_id', rr.payout_id, 'amount', p_amount);
end;
$$;

-- ============ 5) jogosultságok ============
revoke all on function public.settle_refund(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.handle_chargeback(text, text, int, text) from public, anon, authenticated;
revoke all on function public.settle_payout_reversal(text, int, text, uuid) from public, anon, authenticated;
revoke all on function public.resolve_reversal_manually(uuid, uuid, text, date, int, text) from public, anon, authenticated;
grant execute on function public.settle_refund(uuid, text, text, boolean) to service_role;
grant execute on function public.handle_chargeback(text, text, int, text) to service_role;
grant execute on function public.settle_payout_reversal(text, int, text, uuid) to service_role;
grant execute on function public.resolve_reversal_manually(uuid, uuid, text, date, int, text) to service_role;
