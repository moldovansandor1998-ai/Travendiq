-- Travendiq – 00017: dedikált payout_reversals tábla + versenyhelyzet-biztos
-- reversal-menedzsment. Minden reversal-kérés külön sor: a Stripe reversal ID,
-- a kért összeg, a státusz, a hiba és az idempotencia-kulcs.
-- Szabály: a teljesített + függő reversal összegek EGYÜTT sosem haladhatják
-- meg a payout összegét (párhuzamos eseményekkel sem).

create table if not exists payout_reversals (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references payouts(id) on delete cascade,
  refund_id uuid references refunds(id),           -- refund-trigger esetén
  dispute_id text,                                 -- chargeback-trigger esetén
  requested_amount int not null check (requested_amount > 0),
  currency text not null,
  stripe_reversal_id text unique,                  -- trr_...
  idempotency_key text not null unique,            -- pl. revref_<refundUuid> / revcb_<disputeId>
  status text not null default 'requested'         -- requested | succeeded | failed
    check (status in ('requested','succeeded','failed')),
  failure text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists payout_reversals_payout_idx on payout_reversals (payout_id, status);

alter table payout_reversals enable row level security;
revoke all on public.payout_reversals from public, anon, authenticated;
grant select on public.payout_reversals to authenticated; -- provider olvashatja a sajátját (policy lentebb)

create policy payout_reversals_provider_read on public.payout_reversals
  for select to authenticated using (
    exists (select 1 from payouts po
      where po.id = payout_reversals.payout_id
        and (is_provider_member(po.provider_id) or is_staff()))
  );

-- ============ 1) reversal-kérés – atomikus, összegkorláttal ============
-- A már SIKERES és a még FÜGGŐ (requested) reversal-összegeket egyaránt
-- beszámítja. Ha a kérés túllépné a payout összegét → REVERSAL_EXCEEDS_PAYOUT.
create or replace function public.request_payout_reversal(
  p_payout uuid, p_amount int, p_reason text,
  p_refund uuid default null, p_dispute text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
  v_committed int;
  v_id uuid;
  v_key text;
begin
  v_key := coalesce(p_idempotency_key,
    'revref_' || coalesce(p_refund::text, p_dispute, gen_random_uuid()::text));

  -- idempotencia: ugyanazzal a kulccsal a meglévő kérést adjuk vissza
  select id into v_id from payout_reversals where idempotency_key = v_key;
  if v_id is not null then
    return jsonb_build_object('reversal_row_id', v_id, 'idempotent_replay', true);
  end if;

  select * into v from payouts where id = p_payout for update;
  if v.id is null then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v.status <> 'paid' or v.provider_payout_id is null then
    raise exception 'PAYOUT_NOT_REVERSIBLE';
  end if;

  -- committed = sikeres + függő reversal-összegek
  select coalesce(sum(requested_amount), 0) into v_committed
  from payout_reversals
  where payout_id = p_payout and status in ('requested','succeeded');

  if v_committed + p_amount > v.amount then
    raise exception 'REVERSAL_EXCEEDS_PAYOUT: committed=%, requested=%, payout=%',
      v_committed, p_amount, v.amount;
  end if;

  insert into payout_reversals (payout_id, refund_id, dispute_id, requested_amount,
    currency, idempotency_key, status)
  values (p_payout, p_refund, p_dispute, p_amount, v.currency, v_key, 'requested')
  returning id into v_id;

  update payouts set reversal_status = 'pending',
    reversal_reason = p_reason, version = version + 1
  where id = p_payout;

  return jsonb_build_object('reversal_row_id', v_id,
    'transfer_id', v.provider_payout_id, 'amount', p_amount,
    'currency', v.currency, 'booking_id', v.booking_id,
    'provider_id', v.provider_id, 'idempotency_key', v_key);
end;
$$;

-- ============ 2) reversal sikeres rögzítése (a Stripe-hívás után) ============
create or replace function public.record_reversal_sent(
  p_reversal_row uuid, p_stripe_reversal_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update payout_reversals set stripe_reversal_id = p_stripe_reversal_id
  where id = p_reversal_row and status = 'requested';
end;
$$;

-- ============ 3) reversal settle – Stripe reversal ID szerint, idempotensen ============
-- A transfer.reversed webhook minden trr_... rekordot külön hív meg.
create or replace function public.settle_payout_reversal(
  p_stripe_reversal_id text, p_amount int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rr payout_reversals%rowtype;
  v payouts%rowtype;
begin
  select * into rr from payout_reversals
    where stripe_reversal_id = p_stripe_reversal_id for update;
  if rr.id is null then
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

  -- főkönyvi jóváírás (a pénz visszaáramlott a platformra)
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

-- ============ 4) aggregált fallback: csak a KÜLÖNBÖZET könyvelése ============
-- Ha a webhook csak az összesített amount_reversed-et hozza: a korábban
-- könyvelt (succeeded) reversal-összeghez képesti DELTA-t rögzítjük –
-- vagy ha nincs delta, a hívó lekéri a teljes Transfer objektumot.
create or replace function public.settle_transfer_reversed_aggregate(
  p_transfer_id text, p_amount_reversed_total int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
  v_known int;
  v_delta int;
begin
  select * into v from payouts where provider_payout_id = p_transfer_id for update;
  if v.id is null then
    return jsonb_build_object('found', false, 'action', 'retrieve_transfer');
  end if;

  select coalesce(sum(requested_amount), 0) into v_known
  from payout_reversals
  where payout_id = v.id and status = 'succeeded';

  v_delta := p_amount_reversed_total - v_known;
  if v_delta <= 0 then
    return jsonb_build_object('found', true, 'delta', 0, 'action', 'none');
  end if;

  -- ismeretlen forrású delta (pl. Dashboardon indított reversal) → önálló sor
  insert into payout_reversals (payout_id, requested_amount, currency,
    stripe_reversal_id, idempotency_key, status, settled_at)
  values (v.id, v_delta, v.currency,
    'agg_' || p_transfer_id || '_' || p_amount_reversed_total,
    'agg_' || p_transfer_id || '_' || p_amount_reversed_total,
    'succeeded', now())
  on conflict (idempotency_key) do nothing;

  if not found then
    return jsonb_build_object('found', true, 'delta', 0, 'action', 'duplicate');
  end if;

  update payouts set
    reversed_amount = least(v.amount, reversed_amount + v_delta),
    reversal_status = case
      when least(v.amount, reversed_amount + v_delta) >= v.amount then 'reversed'
      else 'partial' end,
    version = version + 1
  where id = v.id;

  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, v.booking_id, 'adjustment', v_delta, v.currency,
    jsonb_build_object('note', 'transfer_reversed_aggregate',
      'transfer', p_transfer_id, 'payout_id', v.id, 'delta', v_delta));

  return jsonb_build_object('found', true, 'delta', v_delta, 'action', 'settled_delta');
end;
$$;

-- ============ 5) reversal hiba ============
create or replace function public.fail_payout_reversal_row(
  p_reversal_row uuid, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update payout_reversals set status = 'failed', failure = left(p_reason, 500)
  where id = p_reversal_row and status = 'requested';
  update payouts set reversal_status = 'failed',
    reversal_reason = left(p_reason, 500), version = version + 1
  where id = (select payout_id from payout_reversals where id = p_reversal_row)
    and reversal_status in ('pending','partial');
end;
$$;

revoke all on function public.request_payout_reversal(uuid, int, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_reversal_sent(uuid, text) from public, anon, authenticated;
revoke all on function public.settle_payout_reversal(text, int) from public, anon, authenticated;
revoke all on function public.settle_transfer_reversed_aggregate(text, int) from public, anon, authenticated;
revoke all on function public.fail_payout_reversal_row(uuid, text) from public, anon, authenticated;
grant execute on function public.request_payout_reversal(uuid, int, text, uuid, text, text) to service_role;
grant execute on function public.record_reversal_sent(uuid, text) to service_role;
grant execute on function public.settle_payout_reversal(text, int) to service_role;
grant execute on function public.settle_transfer_reversed_aggregate(text, int) to service_role;
grant execute on function public.fail_payout_reversal_row(uuid, text) to service_role;
