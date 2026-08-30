-- Travendiq – 00021: tartós refund work queue (cron-feldolgozó)
--
-- Késői fizetések és minden sikertelen Stripe-refund számára: a pending
-- refundokat egy ütemezett feldolgozó próbálja újra, idempotensen
-- (az idempotencia-kulcs a belső refund UUID → a Stripe-hívás biztonságosan
-- ismételhető). Állapotkövetés: attempts, next_retry_at, locked_at,
-- locked_by, last_error; a próbálkozások kimerülése után VÉGLEGES
-- 'manual_review' státusz + admin riasztás (a refund nem tűnhet el csendben).

-- ============ 1) refunds queue-mezők ============
alter table refunds add column if not exists attempts int not null default 0;
alter table refunds add column if not exists next_retry_at timestamptz;
alter table refunds add column if not exists locked_at timestamptz;
alter table refunds add column if not exists locked_by text;
alter table refunds add column if not exists last_error text;

create index if not exists refunds_queue_idx on refunds (next_retry_at)
  where status = 'pending';

-- ============ 2) esedékes refundok claimelése (SKIP LOCKED) ============
-- Claim-elhető: 'pending' és esedékes, VAGY 'processing' de a zár lejárt
-- (a feldolgozó elszállt a Stripe-hívás körül – az idempotencia-kulcs miatt
-- az újrapróbálkozás biztonságos).
create or replace function public.claim_due_refunds(p_limit int, p_worker text)
returns setof refunds
language plpgsql security definer set search_path = public as $$
begin
  return query
  update refunds r set locked_at = now(), locked_by = p_worker
  where r.id in (
    select id from refunds
    where (
      (status = 'pending' and coalesce(next_retry_at, created_at) <= now())
      or (status = 'processing' and provider_refund_id is null
          and coalesce(locked_at, created_at) < now() - interval '10 minutes')
    )
    order by coalesce(next_retry_at, created_at)
    limit p_limit
    for update skip locked
  )
  returning r.*;
end;
$$;

-- ============ 3) sikertelen próbálkozás könyvelése (backoff + manual_review) ============
-- Visszatér az új státusszal: 'pending' (lesz még retry) vagy 'manual_review'.
create or replace function public.fail_refund_attempt(
  p_refund uuid, p_error text, p_max_attempts int default 8
) returns text
language plpgsql security definer set search_path = public as $$
declare
  r refunds%rowtype;
  v_backoff interval;
begin
  update refunds set
    attempts = attempts + 1,
    last_error = left(p_error, 500),
    locked_at = null, locked_by = null
  where id = p_refund and status in ('pending','processing')
  returning * into r;

  if r.id is null then return 'not_claimable'; end if;

  if r.attempts >= p_max_attempts then
    update refunds set status = 'manual_review', next_retry_at = null
    where id = p_refund;
    insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
    values (null, 'admin', 'refund_manual_review', 'refunds', p_refund::text,
      jsonb_build_object('booking_id', r.booking_id, 'amount', r.amount,
        'attempts', r.attempts, 'last_error', r.last_error));
    return 'manual_review';
  end if;

  -- exponenciális backoff: 1, 2, 4, 8... perc, 6 óránál levágva
  v_backoff := least(power(2, r.attempts) * interval '1 minute', interval '6 hours');
  update refunds set status = 'pending', next_retry_at = now() + v_backoff
  where id = p_refund;
  return 'pending';
end;
$$;

-- ============ 4) refund beküldésének sikere (Stripe-hívás után) ============
create or replace function public.mark_refund_submitted(
  p_refund uuid, p_provider_refund_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update refunds set provider_refund_id = p_provider_refund_id,
    status = 'processing', locked_at = null, locked_by = null,
    attempts = attempts + 1, last_error = null, next_retry_at = null
  where id = p_refund and status in ('pending','processing');
end;
$$;

-- ============ 5) beadatlan reversal-sorok claimelése (crash-recovery) ============
-- requested/submitting + nincs stripe_reversal_id → a Stripe-hívás elmaradt
-- vagy a mentés hibázott. Azonos idempotencia-kulccsal újrafuttatható.
create or replace function public.claim_due_reversals(p_limit int, p_worker text)
returns table(reversal_row_id uuid, payout_id uuid, transfer_id text,
  requested_amount int, currency text, idempotency_key text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update payout_reversals pr set status = 'submitting',
    locked_at = now(), locked_by = p_worker
  where pr.id in (
    select pr2.id from payout_reversals pr2
    join payouts po on po.id = pr2.payout_id
    where pr2.status in ('requested','submitting')
      and pr2.stripe_reversal_id is null
      and po.status = 'paid' and po.provider_payout_id is not null
      and coalesce(pr2.locked_at, pr2.created_at) < now() - interval '1 minute'
    order by pr2.created_at
    limit p_limit
    for update of pr2 skip locked
  )
  returning pr.id, pr.payout_id,
    (select po.provider_payout_id from payouts po where po.id = pr.payout_id),
    pr.requested_amount, pr.currency, pr.idempotency_key;
end;
$$;

-- ============ 6) jogosultságok ============
revoke all on function public.claim_due_refunds(int, text) from public, anon, authenticated;
revoke all on function public.fail_refund_attempt(uuid, text, int) from public, anon, authenticated;
revoke all on function public.mark_refund_submitted(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_due_reversals(int, text) from public, anon, authenticated;
grant execute on function public.claim_due_refunds(int, text) to service_role;
grant execute on function public.fail_refund_attempt(uuid, text, int) to service_role;
grant execute on function public.mark_refund_submitted(uuid, text) to service_role;
grant execute on function public.claim_due_reversals(int, text) to service_role;
