-- Travendiq – 00007: pénzügyi integritás (separate charges and transfers modell)
--
-- PÉNZÁRAMLÁSI MODELL (dokumentált, Stripe által támogatott):
--   "Separate charges and transfers" – a vásárló MINDIG a platform számláján fizet
--   (PaymentIntent destination nélkül). A szolgáltató része a program teljesüléséig
--   a platform Stripe-egyenlegén marad (valódi visszatartás), és a payout release-kor
--   EGYSZERI, idempotens Stripe-transzferrel kerül a Connect-számlára
--   (source_transaction = charge, így a Stripe is köti a két oldalt).
--   Destination charges + application_fee NINCS használva – a korábbi kód ilyet nem
--   hozott létre (ha mégis, a refund logika reverse_transfer-rel kezeli).

-- ============ PAYMENTS BŐVÍTÉS ============
alter table payments
  add column if not exists stripe_charge_id text,        -- ch_... (a transzfer source_transaction-je)
  add column if not exists captured_at timestamptz,
  add column if not exists refunded_amount int not null default 0,  -- összesített refund (cent)
  add column if not exists transfer_amount int;                     -- chargeból származó transzfer

create unique index if not exists payments_booking_uidx
  on payments (booking_id) where status in ('requires_payment','authorized','captured','partially_refunded');

-- ============ REFUNDS BŐVÍTÉS ============
alter table refunds
  add column if not exists provider_refund_id text,
  add column if not exists transfer_reversal_id text,
  add column if not exists application_fee_reversed boolean not null default false;

-- egy bookingból egyszerre csak egy aktív (függő/feldolgozás alatti) refund lehet
create unique index if not exists refunds_active_uidx
  on refunds (booking_id) where status in ('pending','processing');

-- ============ PAYOUTS ZÁROLÁS + MANUÁLIS BIZONYÍTÉK ============
alter table payouts
  add column if not exists released_by uuid references profiles(id),
  add column if not exists released_at timestamptz,
  add column if not exists manual_reference text,        -- banki utalás referencia
  add column if not exists manual_note text,
  add column if not exists version int not null default 0;  -- optimista zárolás

-- ============ PAYOUT RELEASE RPC – sor-szintű zárral, egyszeri felszabadítás ============
-- A Stripe-transzfer maga a DB-tranzakción KÍVÜL történik (hálózati hívás);
-- ez a függvény gondoskodik róla, hogy a "release jogát" atomikusan csak egy
-- folyamat szerezze meg (hold/pending/scheduled → releasing), és a véglegesítés
-- (releasing → paid, transfer idővel) is sorzárral történjen.
alter type payout_status add value if not exists 'releasing';

create or replace function public.acquire_payout_release(p_payout uuid, p_actor uuid)
returns table(id uuid, provider_id uuid, amount int, currency text, booking_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update payouts p set status = 'releasing', version = p.version + 1
  where p.id = p_payout and p.status in ('held','pending','scheduled')
  returning p.id, p.provider_id, p.amount, p.currency, p.booking_id;
end $$;

-- véglegesítés: csak releasing állapotból, kötelező bizonyítékkal (transfer vagy manuális ref)
create or replace function public.finalize_payout_release(
  p_payout uuid, p_actor uuid, p_transfer_id text default null,
  p_manual_reference text default null, p_manual_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_transfer_id is null and (p_manual_reference is null or p_manual_note is null) then
    raise exception 'PROOF_REQUIRED: transfer_id vagy (manual_reference + manual_note) kötelező';
  end if;
  update payouts p set
    status = 'paid', paid_at = now(), released_by = p_actor, released_at = now(),
    provider_payout_id = coalesce(p_transfer_id, p.provider_payout_id),
    manual_reference = p_manual_reference, manual_note = p_manual_note,
    hold_reason = null, version = p.version + 1
  where p.id = p_payout and p.status = 'releasing';
  return found;
end $$;

-- sikertelen release visszaállítása (újrapróbálható maradjon)
create or replace function public.abort_payout_release(p_payout uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update payouts p set status = 'scheduled', hold_reason = coalesce(p_reason, p.hold_reason),
    version = p.version + 1
  where p.id = p_payout and p.status = 'releasing';
end $$;

-- ============ PAYOUT BLOKKOLÁS REFUND / CHARGEBACK ESETÉN ============
-- Ha a bookingon aktív refund van vagy chargeback, a kifizetés nem szabadítható fel.
create or replace function public.payout_blocked(p_booking uuid)
returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from refunds r
    where r.booking_id = p_booking and r.status in ('pending','processing')
  ) or exists (
    select 1 from payments p
    where p.booking_id = p_booking and p.status = 'chargeback'
  );
$$;

-- acquire figyeli a blokkolást is
create or replace function public.acquire_payout_release(p_payout uuid, p_actor uuid)
returns table(id uuid, provider_id uuid, amount int, currency text, booking_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_booking uuid;
begin
  select p.booking_id into v_booking from payouts p where p.id = p_payout for update;
  if v_booking is not null and payout_blocked(v_booking) then
    raise exception 'PAYOUT_BLOCKED: aktív refund vagy chargeback miatt a kifizetés zárolva';
  end if;
  return query
  update payouts p set status = 'releasing', version = p.version + 1
  where p.id = p_payout and p.status in ('held','pending','scheduled')
  returning p.id, p.provider_id, p.amount, p.currency, p.booking_id;
end $$;

-- ============ JOGOSULTSÁGOK ============
revoke all on function public.acquire_payout_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_payout_release(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.abort_payout_release(uuid, text) from public, anon, authenticated;
revoke all on function public.payout_blocked(uuid) from public, anon, authenticated;
grant execute on function public.acquire_payout_release(uuid, uuid) to service_role;
grant execute on function public.finalize_payout_release(uuid, uuid, text, text, text) to service_role;
grant execute on function public.abort_payout_release(uuid, text) to service_role;
grant execute on function public.payout_blocked(uuid) to service_role;

-- ============ BOOKING STÁTUSZ VÉDELEM: refund csak Stripe-megerősítés után ============
-- A bookings.status = 'refunded' értéket csak a webhook (charge.refunded / refund.succeeded
-- utáni szerverfolyamat) állíthatja; az admin/booking-manage route 'refund_pending'
-- helyett a payment.status vizsgálatával dolgozik. Ehhez segédfüggvény:
create or replace function public.sync_booking_refund_status(p_booking uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_refunded int;
begin
  select grand_total into v_total from bookings where id = p_booking;
  select coalesce(sum(amount), 0) into v_refunded from refunds
    where booking_id = p_booking and status = 'succeeded';
  if v_refunded >= v_total and v_total > 0 then
    update bookings set status = 'refunded' where id = p_booking
      and status not in ('refunded','disputed');
    update payments set status = 'refunded' where booking_id = p_booking and status in ('captured','partially_refunded');
  elsif v_refunded > 0 then
    update bookings set status = 'partially_refunded' where id = p_booking
      and status in ('confirmed','completed','attended','pending_confirmation','cancelled');
    update payments set status = 'partially_refunded', refunded_amount = v_refunded
      where booking_id = p_booking and status in ('captured','partially_refunded');
  end if;
end $$;

revoke all on function public.sync_booking_refund_status(uuid) from public, anon, authenticated;
grant execute on function public.sync_booking_refund_status(uuid) to service_role;
