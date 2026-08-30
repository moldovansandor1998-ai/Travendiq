-- 00024: manuális reversal-rendezés – pontos összeg-kényszer
-- A v1 tetszőleges pozitív összeget elfogadott és még a requested_amountot is
-- FELÜLÍRTA vele. A v2:
--  - sorzár (FOR UPDATE) alatt kiszámítja a fennálló, még nem rendezett összeget
--    (requested_amount - már rendezett rész), és CSAK PONTOSAN ezt fogadja el,
--  - túlrendezés (OVER_RESOLUTION), alulrendezés (UNDER_RESOLUTION) és ismételt
--    rendezés (INVALID_STATE, mert a sor már 'succeeded') tiltva,
--  - a requested_amount NEM módosul – a ledger-be kizárólag az ellenőrzött
--    összeg kerül,
--  - teljes audit marad: admin, referencia, dátum, összeg, megjegyzés.

create or replace function public.resolve_reversal_manually(
  p_reversal_row uuid, p_admin uuid,
  p_reference text, p_resolved_date date, p_amount int, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rr payout_reversals%rowtype;
  v payouts%rowtype;
  v_outstanding int;
begin
  if p_admin is null then raise exception 'ADMIN_REQUIRED'; end if;
  if p_reference is null or length(trim(p_reference)) < 3 then
    raise exception 'REFERENCE_REQUIRED'; end if;
  if p_resolved_date is null then raise exception 'DATE_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'AMOUNT_REQUIRED'; end if;
  if p_note is null or length(trim(p_note)) < 3 then
    raise exception 'NOTE_REQUIRED'; end if;

  -- sorzár: a fennálló összeg és a státusz nem csúszhat el a rendezés közben
  select * into rr from payout_reversals where id = p_reversal_row for update;
  if rr.id is null then raise exception 'REVERSAL_NOT_FOUND'; end if;

  -- ismételt rendezés tiltva: csak rendezetlen státuszú sor rendezhető
  if rr.status not in ('reconciliation_required','stripe_failed') then
    raise exception 'INVALID_STATE: csak reconciliation_required/stripe_failed sor rendezhető manuálisan (aktuális: %)', rr.status;
  end if;

  -- fennálló, még nem rendezett összeg: a sor requested_amountja (a sor
  -- létrejöttekor már a committed-cap alá volt szorítva). A rendezés
  -- minden-vagy-semmit jelent: a beküldött összegnek PONTOSAN ennyinek kell
  -- lennie.
  v_outstanding := rr.requested_amount;

  if p_amount > v_outstanding then
    raise exception 'OVER_RESOLUTION: a rendezett összeg (%) nagyobb a fennálló kötelezettségnél (%)',
      p_amount, v_outstanding;
  end if;
  if p_amount < v_outstanding then
    raise exception 'UNDER_RESOLUTION: a rendezett összeg (%) kisebb a fennálló kötelezettségnél (%); részrendezés nem támogatott',
      p_amount, v_outstanding;
  end if;

  -- a requested_amount NEM módosul – csak a státusz és a rendezési nyomvonal
  update payout_reversals set
    status = 'succeeded', settled_at = now(),
    failure = 'manual_resolution: ' || left(p_reference, 120)
  where id = rr.id;

  select * into v from payouts where id = rr.payout_id for update;
  update payouts set
    reversed_amount = least(v.amount, reversed_amount + v_outstanding),
    reversal_status = case
      when least(v.amount, reversed_amount + v_outstanding) >= v.amount then 'reversed'
      else 'partial' end,
    version = version + 1
  where id = rr.payout_id;

  -- a ledger-be KIZÁRÓLAG az ellenőrzött (v_outstanding == p_amount) összeg kerül
  insert into ledger_entries (provider_id, booking_id, kind, amount, currency, meta)
  values (v.provider_id, v.booking_id, 'adjustment', v_outstanding, rr.currency,
    jsonb_build_object('note', 'transfer_reversed_manual',
      'reversal_row', rr.id, 'payout_id', rr.payout_id,
      'reference', p_reference, 'resolved_date', p_resolved_date));

  -- teljes audit: admin, referencia, dátum, összeg, megjegyzés
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, diff)
  values (p_admin, 'admin', 'payout_reversal.manual_resolution', 'payout_reversals',
    rr.id::text, jsonb_build_object('reference', p_reference,
      'resolved_date', p_resolved_date, 'amount', v_outstanding, 'note', p_note,
      'payout_id', rr.payout_id, 'refund_id', rr.refund_id, 'dispute_id', rr.dispute_id));

  return jsonb_build_object('ok', true, 'reversal_row_id', rr.id,
    'payout_id', rr.payout_id, 'amount', v_outstanding);
end;
$$;

revoke all on function public.resolve_reversal_manually(uuid, uuid, text, date, int, text) from public, anon, authenticated;
grant execute on function public.resolve_reversal_manually(uuid, uuid, text, date, int, text) to service_role;
