-- Travendiq – 00022: tartós payout_transfer_attempts állapotgép.
--
-- A legsúlyosabb megmaradt eset javítása: a Stripe Transfer már sikerült, de a
-- helyi finalize hibázik. Ettől kezdve a rendszer TARTÓSAN megőrzi az eredeti
-- Transfer összegét és azonosítóját – a payout NEM áll vissza egyszerűen
-- módosítható 'scheduled' állapotba, hanem 'transfer_submitted' /
-- 'reconciliation_required' lesz, és a cron ugyanazzal az eredeti összeggel és
-- idempotencia-kulccsal egyezteti újra.
--
-- Szabályok:
--  - a Transfer ELŐTT atomikusan rögzítjük a payout pontos összegét és
--    idempotencia-kulcsát (acquire v3 hozza létre az attemptet); ettől kezdve
--    refund az összeget nem módosíthatja – csak reversal-kötelezettséget
--    hozhat létre (settle_refund v5, 00023),
--  - hálózati timeout / bizonytalan API-hiba NEM biztos sikertelenség:
--    'ambiguous' → azonos idempotencia-kulccsal újrapróbálás (a Stripe
--    idempotencia-rendszeren keresztül az eredeti Transfer kerül vissza),
--  - csak egyértelmű Stripe-elutasítás (invalid_request stb.) → 'failed',
--  - az attempt összege a folyamat közben SOHA nem változik.

-- ============ 0) új payout-státuszok ============
alter type payout_status add value if not exists 'transfer_submitted';
alter type payout_status add value if not exists 'reconciliation_required';

-- a visszamondott Transfer esetén "összegcsökkentésként érvényesült"
-- kötelezettség jelölése
alter table payout_reversals drop constraint if exists payout_reversals_status_check;
alter table payout_reversals add constraint payout_reversals_status_check
  check (status in ('requested','submitting','submitted','succeeded',
                    'stripe_failed','reconciliation_required','awaiting_transfer',
                    'applied'));

-- ============ 1) payout_transfer_attempts tábla ============
create table if not exists payout_transfer_attempts (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references payouts(id) on delete cascade,
  amount int not null check (amount > 0),
  currency text not null,
  destination_account text,
  source_charge_id text,
  idempotency_key text not null,
  stripe_transfer_id text,
  status text not null default 'prepared'
    check (status in ('prepared','submitting','submitted','finalized',
                      'ambiguous','failed','reconciliation_required')),
  attempts int not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  finalized_at timestamptz
);
-- egyszerre csak egy AKTÍV attempt lehet payoutonként
create unique index if not exists payout_transfer_attempts_active_uidx
  on payout_transfer_attempts (payout_id)
  where status not in ('failed','finalized');
-- az idempotencia-kulcs csak aktív attemptre egyedi (a failed felszabadítja)
create unique index if not exists payout_transfer_attempts_key_uidx
  on payout_transfer_attempts (idempotency_key)
  where status not in ('failed');
create index if not exists payout_transfer_attempts_retry_idx
  on payout_transfer_attempts (status, created_at)
  where status in ('prepared','submitting','submitted','ambiguous');

alter table payout_transfer_attempts enable row level security;
revoke all on public.payout_transfer_attempts from public, anon, authenticated;
grant select on public.payout_transfer_attempts to authenticated;

create policy payout_transfer_attempts_provider_read on public.payout_transfer_attempts
  for select to authenticated using (
    exists (select 1 from payouts po
      where po.id = payout_transfer_attempts.payout_id
        and (is_provider_member(po.provider_id) or is_staff()))
  );

-- ============ 2) acquire v3 – payout zárolás + attempt-snapshot EGY tranzakcióban ============
drop function if exists public.acquire_payout_release(uuid, uuid);
create or replace function public.acquire_payout_release(p_payout uuid, p_actor uuid)
returns table(id uuid, provider_id uuid, amount int, currency text,
  booking_id uuid, attempt_id uuid, idempotency_key text)
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
  v_booking uuid;
  v_attempt uuid;
  v_key text;
  v_dest text;
begin
  select * into v from payouts p where p.id = p_payout for update;
  if v.id is null then return; end if;
  v_booking := v.booking_id;
  if v_booking is not null and payout_blocked(v_booking) then
    raise exception 'PAYOUT_BLOCKED: aktív/teljes refund vagy chargeback miatt a kifizetés zárolva';
  end if;
  if v.status not in ('held','pending','scheduled') or v.amount <= 0 then
    return; -- invalid_state_or_already_processing
  end if;

  -- Transfer ELŐTT: a pontos összeg + idempotencia-kulcs atomikus rögzítése.
  -- Ettől a pillanattól a payout 'releasing': a refund már NEM módosíthatja
  -- az összeget (settle_refund v5 csak kötelezettséget hoz létre).
  update payouts set status = 'releasing', version = version + 1
  where id = p_payout;

  v_key := 'payout_' || p_payout::text;
  select stripe_account_id into v_dest from providers where id = v.provider_id;

  insert into payout_transfer_attempts (payout_id, amount, currency,
    destination_account, idempotency_key, status)
  values (p_payout, v.amount, v.currency, v_dest, v_key, 'prepared')
  returning payout_transfer_attempts.id into v_attempt;

  return query select v.id, v.provider_id, v.amount, v.currency,
    v.booking_id, v_attempt, v_key;
end $$;

-- ============ 3) attempt cél/forrás frissítése (a Stripe-hívás előtt) ============
create or replace function public.update_transfer_attempt_target(
  p_attempt uuid, p_destination text, p_source_charge text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update payout_transfer_attempts set
    destination_account = coalesce(p_destination, destination_account),
    source_charge_id = coalesce(p_source_charge, source_charge_id),
    status = 'submitting',
    attempts = attempts + 1
  where id = p_attempt and status in ('prepared','ambiguous');
end;
$$;

-- ============ 4) Transfer sikeres beküldése (Stripe tr_ ID ismert) ============
create or replace function public.mark_transfer_submitted(
  p_attempt uuid, p_stripe_transfer_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update payout_transfer_attempts set
    stripe_transfer_id = p_stripe_transfer_id,
    status = 'submitted', submitted_at = now(),
    locked_at = null, locked_by = null
  where id = p_attempt and status in ('submitting','ambiguous','submitted');
end;
$$;

-- ============ 5) BIZONYTALAN eredmény (timeout / kapcsolat / 5xx) ============
-- NEM végleges hiba: az attempt újraegyeztethető marad, a payout 'releasing'-ben
-- marad, a cron ugyanazzal a kulccsal folytatja.
create or replace function public.mark_transfer_ambiguous(
  p_attempt uuid, p_error text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update payout_transfer_attempts set
    status = 'ambiguous', last_error = left(p_error, 500),
    locked_at = null, locked_by = null
  where id = p_attempt and status in ('submitting','ambiguous');
end;
$$;

-- ============ 6) finalize függőben: Transfer SIKERES, helyi finalize hibázott ============
-- A payout NEM megy vissza 'scheduled'-be (az összeg ott módosítható lenne):
-- 'transfer_submitted' – a cron ugyanazzal az összeggel/kulccsal fejezi be.
create or replace function public.mark_finalize_pending(p_payout uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update payouts set status = 'transfer_submitted', version = version + 1
  where id = p_payout and status = 'releasing';
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
  values (null, 'admin', 'payout.transfer_submitted_finalize_pending',
    'payouts', p_payout::text,
    jsonb_build_object('note', 'A Stripe Transfer sikerült, a helyi finalize függőben – cron egyezteti'));
end;
$$;

-- ============ 7) abort v2 – attempt-tudatos visszaállítás ============
--  - submitted attempt (tr_ ismert) → 'transfer_submitted' (NEM scheduled!),
--  - ambiguous attempt → 'reconciliation_required' + admin audit,
--  - egyébként (a Transfer el sem indult / véglegesen elutasítva) → vissza
--    'scheduled'-be, és a releasing alatt keletkezett refund-kötelezettségek
--    ÖSSZEGCSÖKKENTÉSként érvényesülnek (a Transfer sosem történt meg).
drop function if exists public.abort_payout_release(uuid, text);
create or replace function public.abort_payout_release(p_payout uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
  a payout_transfer_attempts%rowtype;
  v_obl int;
begin
  select * into v from payouts where id = p_payout for update;
  if v.id is null or v.status not in ('releasing','transfer_submitted') then
    return;
  end if;

  select * into a from payout_transfer_attempts
    where payout_id = p_payout
      and status not in ('failed','finalized')
    order by created_at desc limit 1 for update;

  if a.id is not null and (a.stripe_transfer_id is not null or a.status = 'submitted') then
    -- a Transfer a Stripe-on létezik → TILOS módosítható scheduled-ba tenni
    update payouts set status = 'transfer_submitted', version = version + 1
    where id = p_payout;
    insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
    values (null, 'admin', 'payout.transfer_submitted_kept', 'payouts', p_payout::text,
      jsonb_build_object('attempt', a.id, 'transfer', a.stripe_transfer_id,
        'reason', p_reason));
    return;
  end if;

  if a.id is not null and a.status = 'ambiguous' then
    -- bizonytalan Transfer-eredmény → emberi/cron egyeztetés kell
    update payout_transfer_attempts set status = 'reconciliation_required',
      last_error = left(coalesce(p_reason, 'ambiguous_abort'), 500)
    where id = a.id;
    update payouts set status = 'reconciliation_required',
      hold_reason = coalesce(p_reason, hold_reason), version = version + 1
    where id = p_payout;
    insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
    values (null, 'admin', 'payout.reconciliation_required', 'payouts', p_payout::text,
      jsonb_build_object('attempt', a.id, 'reason', p_reason,
        'idempotency_key', a.idempotency_key, 'amount', a.amount));
    return;
  end if;

  -- a Transfer nem jött létre (vagy véglegesen elutasítva): az attempt lezárható,
  -- a payout visszamegy 'scheduled'-be. A releasing alatt keletkezett
  -- kötelezettségek NEM reversalként, hanem ÖSSZEGCSÖKKENTÉSként érvényesülnek.
  if a.id is not null then
    update payout_transfer_attempts set status = 'failed',
      last_error = left(coalesce(p_reason, 'aborted'), 500)
    where id = a.id and status not in ('failed','finalized');
  end if;

  select coalesce(sum(requested_amount), 0) into v_obl
  from payout_reversals
  where payout_id = p_payout and status = 'awaiting_transfer';
  update payout_reversals set status = 'applied', settled_at = now()
  where payout_id = p_payout and status = 'awaiting_transfer';

  if v_obl > 0 and v.amount - v_obl <= 0 then
    update payouts set status = 'cancelled',
      hold_reason = 'cancelled_after_full_refund', version = version + 1
    where id = p_payout;
  else
    update payouts set status = 'scheduled',
      amount = v.amount - v_obl,
      hold_reason = coalesce(p_reason, v.hold_reason)
        || case when v_obl > 0 then ' | refund_adjusted' else '' end,
      version = version + 1
    where id = p_payout;
  end if;
end;
$$;

-- ============ 8) finalize v4 – attempt-lezárás + manuális payout kötelezettségei ============
-- Elfogadott kiinduló státusz: 'releasing' VAGY 'transfer_submitted' (cron-retry).
-- Manuális kifizetésnél (nincs tr_ Transfer ID) a kötelezettségek NEM
-- 'requested'-be mennek (nincs mit visszavonni a Stripe-on), hanem
-- 'reconciliation_required'-be + audit riasztás.
drop function if exists public.finalize_payout_release(uuid, uuid, text, text, text, int);
create or replace function public.finalize_payout_release(
  p_payout uuid, p_actor uuid,
  p_transfer_id text default null,
  p_manual_reference text default null,
  p_manual_note text default null,
  p_transferred_amount int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
  v_proof text;
  v_amount int;
  v_obligations jsonb;
  a payout_transfer_attempts%rowtype;
begin
  v_proof := coalesce(nullif(p_transfer_id, ''), nullif(p_manual_reference, ''));
  if v_proof is null then
    raise exception 'PROOF_REQUIRED: transfer ID vagy manuális referencia kötelező';
  end if;

  select * into v from payouts where id = p_payout for update;
  if v.id is null or v.status not in ('releasing','transfer_submitted') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_state');
  end if;

  v_amount := coalesce(p_transferred_amount, v.amount);
  if v_amount <= 0 then
    raise exception 'INVALID_TRANSFERRED_AMOUNT';
  end if;

  -- ha van aktív attempt: a tr_ ID-t CSAK az attempt eredeti összegéhez
  -- tartozó Transferből fogadjuk el (összeg-egyezés védelem)
  select * into a from payout_transfer_attempts
    where payout_id = p_payout and status not in ('failed','finalized')
    order by created_at desc limit 1 for update;
  if a.id is not null and p_transfer_id is not null then
    if a.stripe_transfer_id is not null and a.stripe_transfer_id <> p_transfer_id then
      raise exception 'TRANSFER_MISMATCH: az attempthez már más Transfer tartozik';
    end if;
    if a.amount <> v_amount then
      raise exception 'AMOUNT_MISMATCH: attempt=%, finalize=%', a.amount, v_amount;
    end if;
  end if;

  update payouts set
    status = 'paid',
    amount = v_amount,
    provider_payout_id = p_transfer_id,
    manual_reference = p_manual_reference,
    manual_note = p_manual_note,
    released_by = p_actor, released_at = now(), paid_at = now(),
    transfer_status = case when p_transfer_id is not null then 'created' else transfer_status end,
    version = version + 1
  where id = p_payout;

  if a.id is not null then
    update payout_transfer_attempts set status = 'finalized',
      stripe_transfer_id = coalesce(p_transfer_id, a.stripe_transfer_id),
      finalized_at = now(), locked_at = null, locked_by = null
    where id = a.id;
  end if;

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, v.booking_id, 'payout', -v_amount, v.currency,
    jsonb_build_object('payout_id', p_payout, 'transfer_id', p_transfer_id,
      'manual_reference', p_manual_reference));

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
  values (p_actor, 'admin', 'payout.released', 'payouts', p_payout::text,
    jsonb_build_object('transferId', p_transfer_id, 'manualReference', p_manual_reference,
      'amount', v_amount, 'currency', v.currency));

  -- kötelezettségek aktiválása: Stripe-transzfernél 'requested' (automatikus
  -- reversal), MANUÁLIS kifizetésnél 'reconciliation_required' + riasztás
  if p_transfer_id is not null then
    update payout_reversals set status = 'requested'
    where payout_id = p_payout and status = 'awaiting_transfer';
  else
    update payout_reversals set status = 'reconciliation_required',
      failure = 'manual_payout: nincs tr_ Transfer ID – manuális rendezés szükséges'
    where payout_id = p_payout and status = 'awaiting_transfer';
    if exists (select 1 from payout_reversals
      where payout_id = p_payout and status = 'reconciliation_required'
        and failure like 'manual_payout%') then
      insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
      values (p_actor, 'admin', 'manual_payout_reversal_reconciliation_required',
        'payouts', p_payout::text,
        jsonb_build_object('note', 'Manuális kifizetés mellett refund/chargeback kötelezettség – manuális rendezés kell'));
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'reversal_row_id', id, 'requested_amount', requested_amount,
      'idempotency_key', idempotency_key, 'transfer_id', p_transfer_id,
      'refund_id', refund_id, 'dispute_id', dispute_id,
      'status', status)), '[]'::jsonb)
    into v_obligations
  from payout_reversals
  where payout_id = p_payout and status in ('requested','reconciliation_required')
    and stripe_reversal_id is null;

  if exists (select 1 from payout_reversals where payout_id = p_payout
             and status = 'requested') then
    update payouts set reversal_status = 'pending', version = version + 1
    where id = p_payout;
  end if;

  return jsonb_build_object('ok', true, 'payout_id', p_payout,
    'transferred_amount', v_amount, 'obligations', v_obligations);
end;
$$;

-- ============ 9) feldolgozásra váró attemptek claimelése (cron) ============
-- 'prepared/submitting/ambiguous' → a Transfer-hívás újrafuttatható azonos
-- kulccsal; 'submitted' → csak a finalize hiányzik.
create or replace function public.claim_due_transfer_attempts(p_limit int, p_worker text)
returns table(attempt_id uuid, payout_id uuid, amount int, currency text,
  destination_account text, source_charge_id text, idempotency_key text,
  stripe_transfer_id text, status text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update payout_transfer_attempts a set locked_at = now(), locked_by = p_worker
  where a.id in (
    select a2.id from payout_transfer_attempts a2
    join payouts po on po.id = a2.payout_id
    where a2.status in ('prepared','submitting','ambiguous','submitted')
      and po.status in ('releasing','transfer_submitted')
      and coalesce(a2.locked_at, a2.created_at) < now() - interval '1 minute'
    order by a2.created_at
    limit p_limit
    for update of a2 skip locked
  )
  returning a.id, a.payout_id, a.amount, a.currency, a.destination_account,
    a.source_charge_id, a.idempotency_key, a.stripe_transfer_id, a.status;
end;
$$;

-- ============ 10) jogosultságok ============
revoke all on function public.acquire_payout_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_transfer_attempt_target(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_transfer_submitted(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_transfer_ambiguous(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_finalize_pending(uuid) from public, anon, authenticated;
revoke all on function public.abort_payout_release(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_payout_release(uuid, uuid, text, text, text, int) from public, anon, authenticated;
revoke all on function public.claim_due_transfer_attempts(int, text) from public, anon, authenticated;
grant execute on function public.acquire_payout_release(uuid, uuid) to service_role;
grant execute on function public.update_transfer_attempt_target(uuid, text, text) to service_role;
grant execute on function public.mark_transfer_submitted(uuid, text) to service_role;
grant execute on function public.mark_transfer_ambiguous(uuid, text) to service_role;
grant execute on function public.mark_finalize_pending(uuid) to service_role;
grant execute on function public.abort_payout_release(uuid, text) to service_role;
grant execute on function public.finalize_payout_release(uuid, uuid, text, text, text, int) to service_role;
grant execute on function public.claim_due_transfer_attempts(int, text) to service_role;
