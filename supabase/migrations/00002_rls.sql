-- Travendiq – 00002: RLS helper függvények és szabályok

-- ============ HELPER FÜGGVÉNYEK (security definer, RLS-rekurzió elkerülésére) ============
create or replace function public.has_role(r user_role)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = r);
$$;

create or replace function public.is_staff()       -- support/admin/superadmin
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from user_roles
    where user_id = auth.uid() and role in ('support','admin','superadmin'));
$$;

create or replace function public.is_admin()       -- admin/superadmin
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from user_roles
    where user_id = auth.uid() and role in ('admin','superadmin'));
$$;

create or replace function public.is_provider_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from providers where id = p and owner_id = auth.uid())
    or exists (select 1 from provider_members where provider_id = p and user_id = auth.uid());
$$;

create or replace function public.has_provider_permission(p uuid, perm text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from providers where id = p and owner_id = auth.uid())
    or exists (select 1 from provider_members
        where provider_id = p and user_id = auth.uid() and perm = any(permissions));
$$;

-- ============ RLS BEKAPCSOLÁSA MINDEN TÁBLÁN ============
alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table providers enable row level security;
alter table provider_members enable row level security;
alter table provider_documents enable row level security;
alter table countries enable row level security;
alter table cities enable row level security;
alter table categories enable row level security;
alter table category_translations enable row level security;
alter table currencies enable row level security;
alter table listings enable row level security;
alter table listing_translations enable row level security;
alter table listing_media enable row level security;
alter table listing_options enable row level security;
alter table listing_option_translations enable row level security;
alter table listing_extras enable row level security;
alter table listing_transfer_zones enable row level security;
alter table availability enable row level security;
alter table coupons enable row level security;
alter table bookings enable row level security;
alter table booking_extras enable row level security;
alter table booking_status_log enable row level security;
alter table payments enable row level security;
alter table payment_events enable row level security;
alter table refunds enable row level security;
alter table commission_rules enable row level security;
alter table payouts enable row level security;
alter table ledger_entries enable row level security;
alter table checkins enable row level security;
alter table reviews enable row level security;
alter table review_reports enable row level security;
alter table promoter_links enable row level security;
alter table affiliate_clicks enable row level security;
alter table affiliate_commissions enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table favorites enable row level security;
alter table pages enable row level security;
alter table email_log enable row level security;
alter table newsletter_subscribers enable row level security;
alter table gdpr_requests enable row level security;
alter table audit_log enable row level security;

-- ============ PROFILES / ROLES ============
create policy profiles_select_own on profiles for select
  using (id = auth.uid() or is_staff());
create policy profiles_update_own on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on profiles for update
  using (is_admin());

create policy roles_read on user_roles for select
  using (user_id = auth.uid() or is_admin());
create policy roles_admin_write on user_roles for all
  using (is_admin()) with check (is_admin());

-- ============ PROVIDERS ============
create policy providers_public_read on providers for select
  using (status = 'approved' or is_provider_member(id) or is_staff());
create policy providers_insert on providers for insert
  with check (owner_id = auth.uid());
create policy providers_update on providers for update
  using (owner_id = auth.uid() or is_admin());
-- Stripe/bank adatok update csak service role-lel (szerver), RLS tiltja kliensről:
revoke update (stripe_account_id, stripe_onboarding_complete, status, reviewed_by, reviewed_at, commission_override)
  on providers from authenticated;

create policy provider_members_read on provider_members for select
  using (is_provider_member(provider_id) or is_admin());
create policy provider_members_write on provider_members for all
  using (exists (select 1 from providers p where p.id = provider_id and p.owner_id = auth.uid()) or is_admin());

create policy provider_docs_read on provider_documents for select
  using (is_provider_member(provider_id) or is_staff());
create policy provider_docs_insert on provider_documents for insert
  with check (is_provider_member(provider_id));
create policy provider_docs_admin on provider_documents for update
  using (is_staff());

-- ============ NYILVÁNOS TÁRKÖZI TÁBLÁK ============
create policy countries_read on countries for select using (is_active);
create policy cities_read on cities for select using (is_active);
create policy categories_read on categories for select using (is_active);
create policy cat_trans_read on category_translations for select using (true);
create policy currencies_read on currencies for select using (is_active);
create policy pages_read on pages for select using (is_published or is_admin());
create policy pages_admin on pages for all using (is_admin()) with check (is_admin());

create policy ref_admin_countries on countries for all using (is_admin()) with check (is_admin());
create policy ref_admin_cities on cities for all using (is_admin()) with check (is_admin());
create policy ref_admin_categories on categories for all using (is_admin()) with check (is_admin());
create policy ref_admin_cat_tr on category_translations for all using (is_admin()) with check (is_admin());
create policy ref_admin_currencies on currencies for all using (is_admin()) with check (is_admin());

-- ============ LISTINGS ============
create policy listings_public_read on listings for select
  using ((status = 'published' and not is_test) or is_provider_member(provider_id) or is_staff());
create policy listings_provider_insert on listings for insert
  with check (is_provider_member(provider_id)
    and exists (select 1 from providers p where p.id = provider_id and p.status = 'approved'));
create policy listings_provider_update on listings for update
  using (is_provider_member(provider_id) or is_admin());
create policy listings_admin_all on listings for all
  using (is_admin()) with check (is_admin());
-- státusz, featured, jutalék stb. csak admin:
revoke update (status, is_featured, recommendation_score, admin_note, rating_avg, rating_count, booking_count)
  on listings from authenticated;

create policy lt_read on listing_translations for select using (
  exists (select 1 from listings l where l.id = listing_id
    and ((l.status='published' and not l.is_test) or is_provider_member(l.provider_id) or is_staff())));
create policy lt_write on listing_translations for all using (
  exists (select 1 from listings l where l.id = listing_id and (is_provider_member(l.provider_id) or is_admin())));

create policy lm_read on listing_media for select using (true);
create policy lm_write on listing_media for all using (
  exists (select 1 from listings l where l.id = listing_id and (is_provider_member(l.provider_id) or is_admin())));

create policy lo_read on listing_options for select using (true);
create policy lo_write on listing_options for all using (
  exists (select 1 from listings l where l.id = listing_id and (is_provider_member(l.provider_id) or is_admin())));

create policy lot_read on listing_option_translations for select using (true);
create policy lot_write on listing_option_translations for all using (
  exists (select 1 from listing_options o join listings l on l.id=o.listing_id
    where o.id = option_id and (is_provider_member(l.provider_id) or is_admin())));

create policy le_read on listing_extras for select using (true);
create policy le_write on listing_extras for all using (
  exists (select 1 from listings l where l.id = listing_id and (is_provider_member(l.provider_id) or is_admin())));

create policy ltz_read on listing_transfer_zones for select using (true);
create policy ltz_write on listing_transfer_zones for all using (
  exists (select 1 from listings l where l.id = listing_id and (is_provider_member(l.provider_id) or is_admin())));

create policy avail_read on availability for select using (true);
create policy avail_write on availability for all using (
  exists (select 1 from listings l where l.id = listing_id and (is_provider_member(l.provider_id) or is_admin())));

-- ============ KUPONOK ============
create policy coupons_validate_read on coupons for select
  using (is_active or is_admin()
    or (provider_id is not null and is_provider_member(provider_id)));
create policy coupons_write on coupons for all using (
  is_admin() or (provider_id is not null and
    exists (select 1 from providers p where p.id = provider_id and p.owner_id = auth.uid())));

-- ============ FOGLALÁSOK ============
-- INSERT csak szerverről (service role) történik a create_booking RPC-n keresztül;
-- közvetlen kliens-insert tiltott → nincs insert policy authenticated számára.
create policy bookings_customer_read on bookings for select
  using (user_id = auth.uid() or is_provider_member(provider_id) or is_staff());
create policy bookings_provider_update on bookings for update
  using (is_provider_member(provider_id) or is_staff());
create policy bookings_customer_limited_update on bookings for update
  using (user_id = auth.uid() and status in ('pending_payment','confirmed','pending_confirmation'));
-- pénzügyi mezőket kliens nem írhat:
revoke update (commission_rate, commission_amount, provider_amount, grand_total, items_total,
  extras_total, discount_total, paid_at, confirmed_at, completed_at, coupon_id, affiliate_id)
  on bookings from authenticated;

create policy bex_read on booking_extras for select using (
  exists (select 1 from bookings b where b.id = booking_id
    and (b.user_id = auth.uid() or is_provider_member(b.provider_id) or is_staff())));

create policy bsl_read on booking_status_log for select using (
  exists (select 1 from bookings b where b.id = booking_id
    and (b.user_id = auth.uid() or is_provider_member(b.provider_id) or is_staff())));

-- ============ PÉNZÜGY ============
create policy payments_read on payments for select using (
  is_admin() or exists (select 1 from bookings b
    where b.id = booking_id and (b.user_id = auth.uid() or is_provider_member(b.provider_id))));

create policy refunds_read on refunds for select using (
  is_admin() or exists (select 1 from bookings b
    where b.id = booking_id and (b.user_id = auth.uid() or is_provider_member(b.provider_id))));

create policy commission_rules_admin on commission_rules for all
  using (is_admin()) with check (is_admin());
create policy commission_rules_provider_read on commission_rules for select
  using (provider_id is not null and is_provider_member(provider_id));

create policy payouts_read on payouts for select
  using (is_provider_member(provider_id) or is_admin());

create policy ledger_read on ledger_entries for select
  using (is_provider_member(provider_id) or is_admin());
-- append-only: nincs update/delete policy senkinek.

create policy payment_events_admin on payment_events for select using (is_admin());

-- ============ BELÉPTETÉS ============
create policy checkins_insert on checkins for insert with check (
  exists (select 1 from bookings b where b.id = booking_id
    and (has_provider_permission(b.provider_id,'checkin') or is_staff())));
create policy checkins_read on checkins for select using (
  exists (select 1 from bookings b where b.id = booking_id
    and (is_provider_member(b.provider_id) or is_staff())));

-- ============ ÉRTÉKELÉSEK ============
create policy reviews_public_read on reviews for select
  using (status = 'published' or user_id = auth.uid() or is_staff()
    or exists (select 1 from listings l where l.id = listing_id and is_provider_member(l.provider_id)));
create policy reviews_insert on reviews for insert with check (
  user_id = auth.uid() and exists (
    select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()
      and b.status in ('completed','attended')));
create policy reviews_provider_reply on reviews for update using (
  exists (select 1 from listings l where l.id = listing_id and is_provider_member(l.provider_id))
  or is_staff());

create policy review_reports_insert on review_reports for insert with check (auth.uid() is not null);
create policy review_reports_admin on review_reports for select using (is_staff());

-- ============ AFFILIATE ============
create policy promoter_links_owner on promoter_links for all
  using (user_id = auth.uid() or is_admin()
    or (provider_id is not null and is_provider_member(provider_id)));
create policy promoter_links_public_code on promoter_links for select
  using (is_active);

create policy affiliate_clicks_owner on affiliate_clicks for select using (
  is_admin() or exists (select 1 from promoter_links pl where pl.id = link_id
    and (pl.user_id = auth.uid() or (pl.provider_id is not null and is_provider_member(pl.provider_id)))));

create policy affiliate_comm_owner on affiliate_commissions for select using (
  is_admin() or exists (select 1 from promoter_links pl where pl.id = link_id
    and (pl.user_id = auth.uid() or (pl.provider_id is not null and is_provider_member(pl.provider_id)))));

-- ============ ÜZENETEK ============
create policy conversations_read on conversations for select
  using (customer_id = auth.uid() or is_provider_member(provider_id) or is_staff());
create policy conversations_insert on conversations for insert
  with check (customer_id = auth.uid() or is_staff());

create policy messages_read on messages for select using (
  exists (select 1 from conversations c where c.id = conversation_id
    and (c.customer_id = auth.uid() or is_provider_member(c.provider_id) or is_staff())));
create policy messages_insert on messages for insert with check (
  sender_id = auth.uid() and exists (select 1 from conversations c
    where c.id = conversation_id and (c.customer_id = auth.uid() or is_provider_member(c.provider_id))));

-- ============ KEDVENCEK ============
create policy favorites_own on favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ GDPR / AUDIT / EMAIL ============
create policy gdpr_insert on gdpr_requests for insert with check (true);
create policy gdpr_read on gdpr_requests for select using (user_id = auth.uid() or is_staff());
create policy gdpr_admin on gdpr_requests for update using (is_staff());

create policy audit_admin_read on audit_log for select using (is_admin());
create policy email_log_admin on email_log for select using (is_staff());

create policy newsletter_insert on newsletter_subscribers for insert with check (true);
create policy newsletter_admin on newsletter_subscribers for select using (is_admin());
