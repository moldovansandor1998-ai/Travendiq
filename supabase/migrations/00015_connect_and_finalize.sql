-- Travendiq – 00015: Connect requirements tárolása + payout véglegesítés
-- EGYETLEN tranzakcióban (payout + ledger + audit – nincs paid payout ledger nélkül).

-- ============ 1) Connect részletes állapot ============
alter table providers add column if not exists stripe_charges_enabled boolean not null default false;
alter table providers add column if not exists stripe_payouts_enabled boolean not null default false;
alter table providers add column if not exists stripe_details_submitted boolean not null default false;
alter table providers add column if not exists stripe_requirements jsonb not null default '{}';
alter table providers add column if not exists stripe_capabilities jsonb not null default '{}';
alter table providers add column if not exists stripe_account_country text;
alter table providers add column if not exists stripe_account_synced_at timestamptz;

-- Teljes onboarding = charges + payouts + details + NINCS currently_due/past_due/disabled_reason.
create or replace function public.sync_connect_account(
  p_account_id text,
  p_charges boolean, p_payouts boolean, p_details boolean,
  p_requirements jsonb, p_capabilities jsonb, p_country text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_provider uuid;
  v_due boolean;
begin
  v_due := coalesce(jsonb_array_length(coalesce(p_requirements->'currently_due', '[]'::jsonb)), 0) > 0
        or coalesce(jsonb_array_length(coalesce(p_requirements->'past_due', '[]'::jsonb)), 0) > 0
        or nullif(p_requirements->>'disabled_reason', '') is not null;

  update providers set
    stripe_charges_enabled = p_charges,
    stripe_payouts_enabled = p_payouts,
    stripe_details_submitted = p_details,
    stripe_requirements = coalesce(p_requirements, '{}'::jsonb),
    stripe_capabilities = coalesce(p_capabilities, '{}'::jsonb),
    stripe_account_country = coalesce(p_country, stripe_account_country),
    stripe_account_synced_at = now(),
    stripe_onboarding_complete = p_charges and p_payouts and p_details and not v_due
  where stripe_account_id = p_account_id
  returning id into v_provider;

  return v_provider;
end;
$$;

revoke all on function public.sync_connect_account(text, boolean, boolean, boolean, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_connect_account(text, boolean, boolean, boolean, jsonb, jsonb, text) to service_role;

-- ============ 2) finalize_payout_release v2 – payout + ledger + audit egy tx-ben ============
-- (A korábbi, csak státuszt állító verziót felülírjuk: a 'paid' státusz és a
-- főkönyvi kifizetés-tétel ezentúl atomikusan, együtt jön létre.)
create or replace function public.finalize_payout_release(
  p_payout uuid, p_actor uuid,
  p_transfer_id text default null,
  p_manual_reference text default null,
  p_manual_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v payouts%rowtype;
  v_proof text;
begin
  v_proof := coalesce(nullif(p_transfer_id, ''), nullif(p_manual_reference, ''));
  if v_proof is null then
    raise exception 'PROOF_REQUIRED: transfer ID vagy manuális referencia kötelező';
  end if;

  select * into v from payouts where id = p_payout for update;
  if v.id is null or v.status <> 'releasing' then
    return false;
  end if;

  update payouts set
    status = 'paid',
    provider_payout_id = p_transfer_id,
    manual_reference = p_manual_reference,
    manual_note = p_manual_note,
    released_by = p_actor, released_at = now(), paid_at = now(),
    transfer_status = case when p_transfer_id is not null then 'created' else transfer_status end,
    version = version + 1
  where id = p_payout;

  -- főkönyvi kifizetés-tétel – ugyanebben a tranzakcióban
  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, v.booking_id, 'payout', -v.amount, v.currency,
    jsonb_build_object('payout_id', p_payout, 'transfer_id', p_transfer_id,
      'manual_reference', p_manual_reference));

  -- audit-bejegyzés – szintén a tranzakción belül
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
  values (p_actor, 'admin', 'payout.released', 'payouts', p_payout::text,
    jsonb_build_object('transferId', p_transfer_id, 'manualReference', p_manual_reference,
      'amount', v.amount, 'currency', v.currency));

  return true;
end;
$$;

revoke all on function public.finalize_payout_release(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_payout_release(uuid, uuid, text, text, text) to service_role;
