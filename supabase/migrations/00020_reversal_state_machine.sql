-- Travendiq – 00020: reversal állapotgép + a releasing payout / refund
-- versenyhelyzet megszüntetése.
--
-- A legsúlyosabb korábbi hiba: settle_refund a 'releasing' állapotú (külső
-- Stripe Transfer alatt álló) payout összegét írhatta át → a Stripe-on
-- átutalt összeg eltérhetett az adatbázisban és a ledgerben szereplőtől.
--
-- Mostantól:
--  - settle_refund a 'releasing' payoutot SOHA nem módosítja; helyette tartós
--    reversal-KÖTELEZETTSÉG jön létre (payout_reversals, 'awaiting_transfer'),
--  - finalize_payout_release v3 a TÉNYLEGESEN átutalt összeget könyveli
--    (p_transferred_amount), majd a kötelezettségeket 'requested'-be váltja,
--    és visszaadja őket a hívónak az automatikus Stripe-reversalhoz,
--  - a reversal állapotgép egyértelmű: requested → submitting → submitted →
--    succeeded; Stripe-elutasítás: stripe_failed; DB-mentési hiba NEM failed,
--    hanem biztonságos újraegyeztetés azonos idempotencia-kulccsal;
--    reconciliation_required: emberi rendezést igénylő maradék,
--  - request_payout_reversal replay-nél is visszaadja a TELJES sort (row ID,
--    transfer ID, összeg, státusz, Stripe reversal ID) – nincs csendes kilépés,
--  - chargeback reversal összege DB-ben, sorzárral: available = amount −
--    (succeeded + requested/submitting/submitted + awaiting_transfer); a
--    kívántnál csak az elérhető különbözet kerül be (cap, nem elnyelt hiba),
--  - resolve_chargeback_won a KONKRÉT dispute-hoz tartozó succeeded reversalokat
--    teszi csak új payoutba – korábbi refund-reversal sosem kerül vissza.

-- ============ 0) régi, felülírt függvény-aláírások eltávolítása ============
drop function if exists public.request_payout_reversal(uuid, int, text);                 -- 00014
drop function if exists public.request_payout_reversal(uuid, int, text, uuid, text, text); -- 00017
drop function if exists public.settle_transfer_reversal(text, text, int);                -- 00014
drop function if exists public.fail_payout_reversal(uuid, text);                         -- 00014
drop function if exists public.settle_payout_reversal(text, int);                        -- 00017
drop function if exists public.fail_payout_reversal_row(uuid, text);                     -- 00017
drop function if exists public.finalize_payout_release(uuid, uuid, text, text, text);    -- 00015
drop function if exists public.resolve_chargeback_won(uuid);                             -- 00018
drop function if exists public.handle_chargeback(text, text, int, text);                 -- 00014

-- ============ 1) payout_reversals állapotgép ============
alter table payout_reversals drop constraint if exists payout_reversals_status_check;
-- a korábbi 'failed' CSAK Stripe-hívási hibát jelentett → stripe_failed
update payout_reversals set status = 'stripe_failed' where status = 'failed';
alter table payout_reversals add constraint payout_reversals_status_check
  check (status in ('requested','submitting','submitted','succeeded',
                    'stripe_failed','reconciliation_required','awaiting_transfer'));
alter table payout_reversals add column if not exists submitted_at timestamptz;
alter table payout_reversals add column if not exists locked_at timestamptz;
alter table payout_reversals add column if not exists locked_by text;
create index if not exists payout_reversals_retry_idx
  on payout_reversals (status, created_at)
  where status in ('requested','submitting') and stripe_reversal_id is null;

-- ============ 2) reversal-kérés v2 – teljes sor visszaadása + cap mód ============
-- Mindig visszaadja: reversal_row_id, transfer_id, requested_amount, status,
-- stripe_reversal_id, idempotency_key, idempotent_replay.
-- p_cap = true esetén (chargeback): a kívánt összeg helyett csak az ELÉRHETŐ
-- különbözet kerül be; ha 0, no-op válasz (nincs elnyelt kivétel).
create or replace function public.request_payout_reversal(
  p_payout uuid, p_amount int, p_reason text,
  p_refund uuid default null, p_dispute text default null,
  p_idempotency_key text default null, p_cap boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
  rr payout_reversals%rowtype;
  v_committed int;
  v_amount int;
  v_key text;
begin
  v_key := coalesce(p_idempotency_key,
    'revref_' || coalesce(p_refund::text, p_dispute, gen_random_uuid()::text));

  -- idempotens replay: a MEGLÉVŐ kérés teljes állapotát adjuk vissza
  select * into rr from payout_reversals where idempotency_key = v_key;
  if rr.id is not null then
    return jsonb_build_object('reversal_row_id', rr.id,
      'requested_amount', rr.requested_amount, 'status', rr.status,
      'stripe_reversal_id', rr.stripe_reversal_id,
      'idempotency_key', rr.idempotency_key, 'idempotent_replay', true,
      'transfer_id', (select provider_payout_id from payouts where id = rr.payout_id));
  end if;

  select * into v from payouts where id = p_payout for update;
  if v.id is null then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v.status <> 'paid' or v.provider_payout_id is null then
    raise exception 'PAYOUT_NOT_REVERSIBLE';
  end if;

  -- committed: minden reversal-felé tartó összeg (függő + beküldött + sikeres
  -- + transferre váró kötelezettség)
  select coalesce(sum(requested_amount), 0) into v_committed
  from payout_reversals
  where payout_id = p_payout
    and status in ('requested','submitting','submitted','succeeded','awaiting_transfer');

  v_amount := p_amount;
  if p_cap then
    v_amount := least(p_amount, greatest(v.amount - v_committed, 0));
    if v_amount <= 0 then
      return jsonb_build_object('capped_to_zero', true, 'committed', v_committed,
        'payout_amount', v.amount, 'idempotent_replay', false);
    end if;
  elsif v_committed + p_amount > v.amount then
    raise exception 'REVERSAL_EXCEEDS_PAYOUT: committed=%, requested=%, payout=%',
      v_committed, p_amount, v.amount;
  end if;

  insert into payout_reversals (payout_id, refund_id, dispute_id, requested_amount,
    currency, idempotency_key, status)
  values (p_payout, p_refund, p_dispute, v_amount, v.currency, v_key, 'requested')
  returning * into rr;

  update payouts set reversal_status = 'pending',
    reversal_reason = p_reason, version = version + 1
  where id = p_payout;

  return jsonb_build_object('reversal_row_id', rr.id,
    'requested_amount', rr.requested_amount, 'status', rr.status,
    'stripe_reversal_id', rr.stripe_reversal_id,
    'idempotency_key', rr.idempotency_key, 'idempotent_replay', false,
    'transfer_id', v.provider_payout_id, 'currency', v.currency,
    'booking_id', v.booking_id, 'provider_id', v.provider_id);
end;
$$;

-- ============ 3) beküldés rögzítése – a Stripe-hívás UTÁN ============
-- Csak requested/submitting → submitted. A Stripe-hiba NEM ide tartozik
-- (az stripe_failed), a DB-hiba esetén a sor 'requested' marad, és azonos
-- idempotencia-kulccsal biztonságosan újrafuttatható.
create or replace function public.record_reversal_sent(
  p_reversal_row uuid, p_stripe_reversal_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update payout_reversals set stripe_reversal_id = p_stripe_reversal_id,
    status = 'submitted', submitted_at = now(), locked_at = null, locked_by = null
  where id = p_reversal_row and status in ('requested','submitting');
end;
$$;

-- ============ 4) reversal settle v2 – trr_ egyezés, transfer-fallback ============
-- Ha a sor még nem kapta meg a trr_ ID-t (pl. a record_reversal_sent DB-hibája
-- után a webhook érkezett előbb), a transfer + függő sor alapján párosítunk.
create or replace function public.settle_payout_reversal(
  p_stripe_reversal_id text, p_amount int, p_transfer_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rr payout_reversals%rowtype;
  v payouts%rowtype;
begin
  select * into rr from payout_reversals
    where stripe_reversal_id = p_stripe_reversal_id for update;

  if rr.id is null and p_transfer_id is not null then
    -- a trr_ ismeretlen: párosítás a transferhez tartozó, még ID nélküli sorhoz
    select * into v from payouts where provider_payout_id = p_transfer_id for update;
    if v.id is not null then
      select * into rr from payout_reversals
        where payout_id = v.id and stripe_reversal_id is null
          and status in ('requested','submitting','submitted')
        order by created_at limit 1 for update;
      if rr.id is not null then
        update payout_reversals set stripe_reversal_id = p_stripe_reversal_id,
          status = 'submitted', submitted_at = coalesce(submitted_at, now())
        where id = rr.id;
      else
        -- árva reversal (pl. Dashboardon indított): önálló, azonnal sikeres sor
        insert into payout_reversals (payout_id, requested_amount, currency,
          stripe_reversal_id, idempotency_key, status, settled_at)
        values (v.id, p_amount, v.currency, p_stripe_reversal_id,
          'wh_' || p_stripe_reversal_id, 'succeeded', now())
        on conflict (idempotency_key) do nothing;
        if found then
          update payouts set
            reversed_amount = least(v.amount, reversed_amount + p_amount),
            reversal_status = case
              when least(v.amount, reversed_amount + p_amount) >= v.amount then 'reversed'
              else 'partial' end,
            version = version + 1
          where id = v.id;
          insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
          values (v.provider_id, v.booking_id, 'adjustment', p_amount, v.currency,
            jsonb_build_object('note', 'transfer_reversed', 'reversal', p_stripe_reversal_id,
              'payout_id', v.id, 'origin', 'webhook_orphan'));
        end if;
        return jsonb_build_object('found', true, 'orphan', true, 'payout_id', v.id);
      end if;
    else
      return jsonb_build_object('found', false);
    end if;
  elsif rr.id is null then
    return jsonb_build_object('found', false);
  end if;

  if rr.status = 'succeeded' then
    return jsonb_build_object('found', true, 'already', true, 'payout_id', rr.payout_id);
  end if;

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

-- ============ 5) reversal hiba v2 – Stripe-elutasítás vs DB-hiba szétválasztva ============
-- p_stripe_rejected = true: a Stripe API utasította el (pl. balance_insufficient)
--   → 'stripe_failed' (emberi/ütemezett újrapróbálkozás kell).
-- p_stripe_rejected = false: helyi hiba → a sor 'requested' marad (újrafuttatható
--   ugyanazzal az idempotencia-kulccsal), itt nincs teendő.
create or replace function public.fail_payout_reversal_row(
  p_reversal_row uuid, p_reason text, p_stripe_rejected boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_stripe_rejected then
    update payout_reversals set status = 'stripe_failed', failure = left(p_reason, 500),
      locked_at = null, locked_by = null
    where id = p_reversal_row and status in ('requested','submitting');
    update payouts set reversal_status = 'failed',
      reversal_reason = left(p_reason, 500), version = version + 1
    where id = (select payout_id from payout_reversals where id = p_reversal_row)
      and reversal_status in ('pending','partial');
  else
    -- DB-oldali hiba: csak a zár oldása, a sor újrafuttatható marad
    update payout_reversals set locked_at = null, locked_by = null
    where id = p_reversal_row and status = 'submitting';
  end if;
end;
$$;

-- ============ 6) settle_refund v4 – 'releasing' payout soha nem módosul ============
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

  -- legfrissebb releváns payout sorzárral
  select * into v_payout from payouts
    where booking_id = r.booking_id
      and status in ('held','pending','scheduled','releasing','paid')
      and origin_payout_id is null
    order by created_at desc limit 1 for update;

  if v_payout.id is null then
    perform sync_booking_refund_status(r.booking_id);
    return;
  end if;

  if v_payout.status in ('held','pending','scheduled') then
    -- ki nem fizetett payout: atomikus csökkentés / teljes refundnál cancelled
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

  elsif v_payout.status = 'releasing' then
    -- >>> VERSENYHELYZET-JAVÍTÁS: a külső Stripe Transfer alatt álló payout
    -- összege ÉRINTETLEN marad. Tartós kötelezettség jön létre, amelyet a
    -- finalize_payout_release v3 a tényleges transzfer után 'requested'-be
    -- vált → automatikus reversal. <<<
    insert into payout_reversals (payout_id, refund_id, requested_amount, currency,
      idempotency_key, status)
    values (v_payout.id, r.id, v_provider_share, r.currency,
      'oblref_' || r.id::text, 'awaiting_transfer')
    on conflict (idempotency_key) do nothing;

  elsif v_payout.status = 'paid' then
    -- már kifizetett: reversal-kérés a rendelkezésre álló összegig (cap),
    -- a maradék reconciliation_required → admin rendezi
    select coalesce(sum(requested_amount), 0) into v_committed
    from payout_reversals
    where payout_id = v_payout.id
      and status in ('requested','submitting','submitted','succeeded','awaiting_transfer');
    v_available := greatest(v_payout.amount - v_committed, 0);
    v_ins := least(v_provider_share, v_available);

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

  perform sync_booking_refund_status(r.booking_id);
end;
$$;

-- ============ 7) finalize_payout_release v3 – tényleges összeg + kötelezettségek ============
-- Visszatér: { ok, payout_id, transferred_amount, obligations: [...] }
-- A hívó (admin route) az obligations sorait AZONNAL beadja a Stripe-nak
-- (azonos idempotencia-kulccsal) → a releasing alatt keletkezett refund
-- automatikusan reversal-korrekcióként rendeződik.
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
begin
  v_proof := coalesce(nullif(p_transfer_id, ''), nullif(p_manual_reference, ''));
  if v_proof is null then
    raise exception 'PROOF_REQUIRED: transfer ID vagy manuális referencia kötelező';
  end if;

  select * into v from payouts where id = p_payout for update;
  if v.id is null or v.status <> 'releasing' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_state');
  end if;

  -- a DB-ben könyvelt összeg MINDIG a ténylegesen átutalt összeg
  v_amount := coalesce(p_transferred_amount, v.amount);
  if v_amount <= 0 then
    raise exception 'INVALID_TRANSFERRED_AMOUNT';
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

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, v.booking_id, 'payout', -v_amount, v.currency,
    jsonb_build_object('payout_id', p_payout, 'transfer_id', p_transfer_id,
      'manual_reference', p_manual_reference));

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
  values (p_actor, 'admin', 'payout.released', 'payouts', p_payout::text,
    jsonb_build_object('transferId', p_transfer_id, 'manualReference', p_manual_reference,
      'amount', v_amount, 'currency', v.currency));

  -- a releasing alatt keletkezett refund/chargeback kötelezettségek aktiválása
  update payout_reversals set status = 'requested'
  where payout_id = p_payout and status = 'awaiting_transfer';

  select coalesce(jsonb_agg(jsonb_build_object(
      'reversal_row_id', id, 'requested_amount', requested_amount,
      'idempotency_key', idempotency_key, 'transfer_id', p_transfer_id,
      'refund_id', refund_id, 'dispute_id', dispute_id)), '[]'::jsonb)
    into v_obligations
  from payout_reversals
  where payout_id = p_payout and status = 'requested' and stripe_reversal_id is null;

  if jsonb_array_length(v_obligations) > 0 then
    update payouts set reversal_status = 'pending', version = version + 1
    where id = p_payout;
  end if;

  return jsonb_build_object('ok', true, 'payout_id', p_payout,
    'transferred_amount', v_amount, 'obligations', v_obligations);
end;
$$;

-- ============ 8) handle_chargeback v2 – reversal-összeg DB-ben, sorzárral ============
-- available = payout amount − (succeeded + requested/submitting/submitted +
-- awaiting_transfer); csak az elérhető különbözet kerül be (NEM dob elnyelt
-- REVERSAL_EXCEEDS_PAYOUT hibát). 'releasing' payoutnál awaiting_transfer
-- kötelezettség; 'paid'-nél azonnal requested.
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

  -- idempotens: ehhez a dispute-hoz már létezik reversal-kérés?
  select * into rr from payout_reversals where idempotency_key = v_key;
  if rr.id is not null then
    return jsonb_build_object('found', true, 'booking_id', b.id, 'payment_id', p.id,
      'reversal_row_id', rr.id, 'requested_amount', rr.requested_amount,
      'reversal_status', rr.status, 'stripe_reversal_id', rr.stripe_reversal_id,
      'idempotent_replay', true,
      'transfer_id', (select provider_payout_id from payouts where id = rr.payout_id));
  end if;

  -- legfrissebb releváns payout (paid VAGY releasing), sorzárral
  select * into v_payout from payouts
    where booking_id = b.id and status in ('paid','releasing')
      and origin_payout_id is null
    order by created_at desc limit 1 for update;

  if v_payout.id is null then
    -- nincs kifizetett/folyamatban lévő payout → a blokkot a payout_blocked adja
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
    insert into payout_reversals (payout_id, dispute_id, requested_amount, currency,
      idempotency_key, status)
    values (v_payout.id, p_dispute_id, v_ins, v_payout.currency, v_key,
      case when v_payout.status = 'releasing' then 'awaiting_transfer' else 'requested' end)
    returning * into rr;

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

-- ============ 9) resolve_chargeback_won v2 – CSAK a konkrét dispute reversalja ============
create or replace function public.resolve_chargeback_won(
  p_booking uuid, p_dispute text
) returns jsonb
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

  -- KIZÁRÓLAG az ehhez a dispute-hoz tartozó sikeres reversalok –
  -- a korábbi refund-reversal összege sosem kerül vissza a szolgáltatónak.
  select coalesce(sum(requested_amount), 0) into v_reversed
  from payout_reversals
  where payout_id = v.id and status = 'succeeded' and dispute_id = p_dispute;

  if v_reversed <= 0 then
    return jsonb_build_object('found', true, 'reversed_amount', 0, 'action', 'none');
  end if;

  select id into v_new from payouts
    where booking_id = p_booking and status in ('scheduled','paid')
      and hold_reason = 'chargeback_won_retransfer:' || p_dispute
    limit 1;
  if v_new is not null then
    return jsonb_build_object('found', true, 'reversed_amount', v_reversed,
      'action', 'already_created', 'new_payout_id', v_new);
  end if;

  insert into payouts (provider_id, booking_id, amount, currency, status, hold_reason,
    origin_payout_id)
  values (v.provider_id, p_booking, v_reversed, v.currency, 'scheduled',
    'chargeback_won_retransfer:' || p_dispute, v.id)
  returning id into v_new;

  update payouts set reversal_reason = coalesce(reversal_reason, '') ||
      ' | won_back:' || v_new::text, version = version + 1
  where id = v.id;

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, p_booking, 'adjustment', 0, v.currency,
    jsonb_build_object('note', 'chargeback_won_retransfer_scheduled',
      'new_payout_id', v_new, 'amount', v_reversed, 'origin_payout', v.id,
      'dispute', p_dispute));

  return jsonb_build_object('found', true, 'reversed_amount', v_reversed,
    'action', 'new_payout_created', 'new_payout_id', v_new);
end;
$$;

-- ============ 10) jogosultságok ============
revoke all on function public.request_payout_reversal(uuid, int, text, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.record_reversal_sent(uuid, text) from public, anon, authenticated;
revoke all on function public.settle_payout_reversal(text, int, text) from public, anon, authenticated;
revoke all on function public.fail_payout_reversal_row(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.finalize_payout_release(uuid, uuid, text, text, text, int) from public, anon, authenticated;
revoke all on function public.handle_chargeback(text, text, int, text) from public, anon, authenticated;
revoke all on function public.resolve_chargeback_won(uuid, text) from public, anon, authenticated;
grant execute on function public.request_payout_reversal(uuid, int, text, uuid, text, text, boolean) to service_role;
grant execute on function public.record_reversal_sent(uuid, text) to service_role;
grant execute on function public.settle_payout_reversal(text, int, text) to service_role;
grant execute on function public.fail_payout_reversal_row(uuid, text, boolean) to service_role;
grant execute on function public.finalize_payout_release(uuid, uuid, text, text, text, int) to service_role;
grant execute on function public.handle_chargeback(text, text, int, text) to service_role;
grant execute on function public.resolve_chargeback_won(uuid, text) to service_role;
