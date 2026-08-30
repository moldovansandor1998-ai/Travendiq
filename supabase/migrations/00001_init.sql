-- Travendiq – 00001: enumok és táblák
-- Minden pénzösszeg a legkisebb pénzegységben (cent), integer.

-- ============ ENUMOK ============
create type user_role as enum
  ('customer','provider','provider_staff','promoter','support','admin','superadmin');

create type provider_status as enum
  ('incomplete','under_review','docs_required','approved','restricted','suspended','rejected');

create type listing_status as enum
  ('draft','pending_review','changes_requested','published','paused','rejected','archived');

create type booking_status as enum
  ('pending_payment','pending_confirmation','confirmed','modification_requested',
   'cancelled','refunded','partially_refunded','attended','no_show','completed','disputed');

create type payment_status as enum
  ('requires_payment','authorized','captured','failed','refunded','partially_refunded','chargeback');

create type payout_status as enum ('pending','scheduled','held','paid','failed');

create type affiliate_commission_status as enum ('pending','approved','paid','reversed');

create type review_status as enum ('pending','published','hidden','flagged');

create type participant_type as enum ('adult','child','infant','group');

create type confirmation_mode as enum ('instant','manual');

create type cancellation_policy_type as enum
  ('full_until_hours','percent_refund','non_refundable');

create type media_kind as enum ('image','video');

create type commission_scope as enum ('global','country','provider','listing');

create type gdpr_request_type as enum ('export','erasure');

create type gdpr_request_status as enum ('pending','in_progress','done','rejected');

-- ============ FELHASZNÁLÓK / SZEREPKÖRÖK ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  avatar_url text,
  locale text not null default 'en',
  currency text not null default 'EUR',
  country_code text,
  is_suspended boolean not null default false,
  marketing_consent boolean not null default false,
  two_factor_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles (                       -- több szerepkör / személy
  user_id uuid not null references profiles(id) on delete cascade,
  role user_role not null,
  granted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ============ SZOLGÁLTATÓK ============
create table providers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  legal_name text not null,
  display_name text not null,
  is_company boolean not null default true,
  country_code text not null,
  city text,
  address text,
  tax_id text,
  contact_name text,
  contact_email text,
  contact_phone text,
  payout_iban text,                             -- titkosítva tárolandó élesben (pgcrypto / vault)
  payout_currency text not null default 'EUR',
  stripe_account_id text,                       -- Stripe Connect acct_...
  stripe_onboarding_complete boolean not null default false,
  status provider_status not null default 'incomplete',
  status_reason text,
  service_areas text[] not null default '{}',   -- ország/város kódok
  languages text[] not null default '{en}',
  commission_override numeric(5,2),             -- szolgáltatói egyedi jutalék %
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id)
);

create table provider_members (                 -- szolgáltatói munkatársak
  provider_id uuid not null references providers(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  permissions text[] not null default '{bookings.read}', -- pl. listings.write, checkin, finance.read
  invited_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (provider_id, user_id)
);

create table provider_documents (               -- KYC dokumentumok
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id) on delete cascade,
  kind text not null,                           -- id_card, company_reg, license, insurance, tax
  file_path text not null,                      -- Supabase Storage privát bucket
  expires_at date,
  status text not null default 'uploaded',      -- uploaded | verified | rejected
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

-- ============ FÖLDRAJZ / KATEGÓRIA / PÉNZNEM ============
create table countries (
  code text primary key,                        -- ISO 3166-1 alpha-2
  name text not null,
  default_currency text not null default 'EUR',
  is_active boolean not null default true
);

create table cities (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references countries(code),
  slug text not null,
  name text not null,
  lat numeric(9,6), lng numeric(9,6),
  is_popular boolean not null default false,
  is_active boolean not null default true,
  unique (country_code, slug)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id) on delete set null,
  slug text not null unique,
  icon text,                                    -- ikonrendszer kulcs
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table category_translations (
  category_id uuid not null references categories(id) on delete cascade,
  locale text not null,
  name text not null,
  primary key (category_id, locale)
);

create table currencies (
  code text primary key,
  symbol text not null,
  rate_to_eur numeric(12,6) not null default 1, -- egyszerű statikus árfolyam; élesben feed
  is_active boolean not null default true
);

-- ============ PROGRAMOK ============
create table listings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id) on delete cascade,
  category_id uuid not null references categories(id),
  country_code text not null references countries(code),
  city_id uuid not null references cities(id),
  slug text not null unique,
  status listing_status not null default 'draft',
  is_test boolean not null default false,       -- demo/teszt jelölés
  confirmation confirmation_mode not null default 'instant',
  duration_minutes int,
  min_participants int not null default 1,
  max_participants int not null default 50,
  min_age int, max_age int,
  is_private_available boolean not null default false,
  is_family_friendly boolean not null default false,
  is_wheelchair_accessible boolean not null default false,
  has_transfer boolean not null default false,
  languages text[] not null default '{en}',
  meeting_point text,
  meeting_lat numeric(9,6), meeting_lng numeric(9,6),
  base_price_adult int not null default 0,      -- cent
  base_price_child int,
  currency text not null default 'EUR',
  cancellation_policy cancellation_policy_type not null default 'full_until_hours',
  cancel_full_hours int not null default 24,    -- teljes visszatérítés határideje (óra)
  cancel_percent int,                           -- százalékos visszatérítésnél
  free_cancellation boolean not null default true,
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  booking_count int not null default 0,
  is_featured boolean not null default false,
  is_last_minute boolean not null default false,
  recommendation_score numeric(6,2) not null default 0,
  admin_note text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_search_idx on listings (status, country_code, city_id, category_id);
create index listings_provider_idx on listings (provider_id, status);

create table listing_translations (
  listing_id uuid not null references listings(id) on delete cascade,
  locale text not null,
  title text not null,
  short_description text,
  description text,
  includes text,                                -- mit tartalmaz
  excludes text,                                -- mit nem
  bring_with text,                              -- mit kell vinni
  important_info text,                          -- fontos tudnivalók
  accessibility_info text,
  translated_by text not null default 'manual', -- manual | ai
  primary key (listing_id, locale)
);

create table listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  kind media_kind not null default 'image',
  url text not null,
  alt text,
  sort_order int not null default 0
);

create table listing_options (                  -- opciók: normál/VIP, közös/privát, transzfer
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  code text not null,                           -- pl. standard, vip, private, with_transfer
  price_delta_adult int not null default 0,     -- felár centben
  price_delta_child int,
  max_participants int,
  is_active boolean not null default true,
  unique (listing_id, code)
);

create table listing_option_translations (
  option_id uuid not null references listing_options(id) on delete cascade,
  locale text not null,
  name text not null,
  description text,
  primary key (option_id, locale)
);

create table listing_extras (                   -- extra szolgáltatások
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  name text not null,
  price int not null default 0,
  currency text not null default 'EUR',
  per_person boolean not null default false,
  is_active boolean not null default true
);

create table listing_transfer_zones (           -- hotel pickup zónák
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  zone_name text not null,
  pickup_fee int not null default 0,
  note text
);

create table availability (                     -- dátum + turnus kapacitás
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  option_id uuid references listing_options(id) on delete cascade, -- null = alap turnus
  date date not null,
  start_time time not null default '09:00',
  capacity int not null,
  booked_count int not null default 0 check (booked_count >= 0),
  price_adult int,                              -- szezonális felülírás (cent)
  price_child int,
  is_blocked boolean not null default false,
  unique (listing_id, option_id, date, start_time)
);
create index availability_idx on availability (listing_id, date);

-- ============ KUPONOK ============
create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null default 'percent',         -- percent | fixed
  value numeric(10,2) not null,
  currency text,
  valid_from timestamptz, valid_to timestamptz,
  max_redemptions int, redeemed_count int not null default 0,
  listing_id uuid references listings(id) on delete cascade,
  provider_id uuid references providers(id) on delete cascade,
  min_order_total int,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============ FOGLALÁSOK ============
create table bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                    -- pl. TRV-2026-8F3K2Q
  listing_id uuid not null references listings(id),
  option_id uuid references listing_options(id),
  provider_id uuid not null references providers(id),
  availability_id uuid references availability(id),
  user_id uuid references profiles(id),         -- null = vendég
  guest_email text,
  guest_access_token uuid not null default gen_random_uuid(), -- vendég voucher hozzáférés
  date date not null,
  start_time time not null default '09:00',
  status booking_status not null default 'pending_payment',
  currency text not null default 'EUR',
  adults int not null default 1,
  children int not null default 0,
  infants int not null default 0,
  total_participants int generated always as (adults + children + infants) stored,
  items_total int not null,                     -- résztvevők + opciók, cent
  extras_total int not null default 0,
  discount_total int not null default 0,
  grand_total int not null,
  commission_rate numeric(5,2) not null,        -- rögzítés a foglaláskor
  commission_amount int not null,
  provider_amount int not null,                 -- grand_total - jutalék
  coupon_id uuid references coupons(id),
  affiliate_id uuid,                            -- promoter_links.id (kör elkerülése miatt FK később)
  lead_name text, lead_email text, lead_phone text,
  hotel_name text, pickup_address text, pickup_notes text,
  special_requests text,
  customer_locale text not null default 'en',
  paid_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  affiliate_click_id uuid,
  idempotency_key text unique,                  -- duplikált foglalás ellen
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or guest_email is not null)
);
create index bookings_customer_idx on bookings (user_id, created_at desc);
create index bookings_provider_idx on bookings (provider_id, date);
create index bookings_listing_idx on bookings (listing_id, date);

create table booking_extras (
  booking_id uuid not null references bookings(id) on delete cascade,
  extra_id uuid not null references listing_extras(id),
  quantity int not null default 1,
  unit_price int not null,
  primary key (booking_id, extra_id)
);

create table booking_status_log (               -- státusznapló
  id bigint generated always as identity primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  from_status booking_status,
  to_status booking_status not null,
  actor_id uuid references profiles(id),
  actor_role user_role,
  note text,
  created_at timestamptz not null default now()
);

-- ============ FIZETÉS / PÉNZÜGY ============
create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  provider text not null default 'stripe',      -- payment provider kulcs
  provider_payment_id text,                     -- pl. pi_...
  status payment_status not null default 'requires_payment',
  amount int not null,
  currency text not null,
  application_fee int,                          -- platformjutalék
  transfer_id text,                             -- Connect transfer
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table payment_events (                   -- webhook idempotencia + audit
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  payment_id uuid references payments(id),
  amount int not null,
  currency text not null,
  reason text,
  calculated_amount int,                        -- automatikusan számolt
  is_admin_override boolean not null default false,
  provider_refund_id text,
  status text not null default 'pending',       -- pending | processed | failed
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table commission_rules (                 -- jutalék-szabályok
  id uuid primary key default gen_random_uuid(),
  scope commission_scope not null,
  country_code text references countries(code),
  provider_id uuid references providers(id) on delete cascade,
  listing_id uuid references listings(id) on delete cascade,
  rate numeric(5,2) not null,                   -- %
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table payouts (                          -- szolgáltatói kifizetések
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id),
  booking_id uuid references bookings(id),
  amount int not null,
  currency text not null,
  status payout_status not null default 'pending',
  scheduled_for date,                           -- ütemezett kifizetés
  hold_reason text,                             -- pl. program teljesüléséig visszatartva
  provider_payout_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table ledger_entries (                   -- megváltoztathatatlan pénzügyi főkönyv
  id bigint generated always as identity primary key,
  provider_id uuid references providers(id),
  booking_id uuid references bookings(id),
  kind text not null,    -- booking_revenue | commission | refund | payout | affiliate | adjustment | reserve
  amount int not null,   -- előjeles, cent
  currency text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- Nincs update/delete policy → append-only.

-- ============ BELÉPTETÉS ============
create table checkins (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  scanned_by uuid references profiles(id),
  method text not null default 'qr',            -- qr | manual
  result text not null,                         -- valid | already_used | invalid | partial
  participants_admitted int not null default 0,
  device_info text,
  is_offline_sync boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ ÉRTÉKELÉSEK ============
create table reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  user_id uuid references profiles(id),
  rating int not null check (rating between 1 and 5),
  rating_organization int check (rating_organization between 1 and 5),
  rating_value int check (rating_value between 1 and 5),
  rating_guide int check (rating_guide between 1 and 5),
  comment text,
  photos text[] not null default '{}',
  is_verified_booking boolean not null default true,
  status review_status not null default 'pending',
  provider_reply text,
  provider_replied_at timestamptz,
  moderated_by uuid references profiles(id),
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

create table review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,
  reporter_id uuid references profiles(id),
  reason text not null,
  created_at timestamptz not null default now()
);

-- ============ AFFILIATE / PROMÓTER ============
create table promoter_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider_id uuid references providers(id),    -- szolgáltató saját promótere, null = platform
  code text not null unique,
  listing_id uuid references listings(id) on delete cascade, -- null = általános link
  commission_rate numeric(5,2),                 -- egyedi jutalék %
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references promoter_links(id) on delete cascade,
  ip_hash text,                                 -- hash-elt IP (GDPR)
  user_agent text,
  created_at timestamptz not null default now()
);

create table affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references promoter_links(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  amount int not null,
  currency text not null,
  status affiliate_commission_status not null default 'pending',
  fraud_flag boolean not null default false,
  fraud_reason text,
  created_at timestamptz not null default now()
);

-- ============ ÜZENETEK ============
create table conversations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete set null,
  customer_id uuid not null references profiles(id),
  provider_id uuid not null references providers(id),
  created_at timestamptz not null default now()
);

create table messages (                         -- elérhetőségek maszkolva a UI rétegben
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null,
  is_masked boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ EGYÉB ============
create table favorites (
  user_id uuid not null references profiles(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table pages (                            -- CMS: jogi + statikus oldalak
  id uuid primary key default gen_random_uuid(),
  slug text not null,                           -- terms, privacy, cookies, provider-terms...
  locale text not null default 'en',
  title text not null,
  body_md text not null,
  is_published boolean not null default true,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (slug, locale)
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  locale text not null default 'en',
  provider_message_id text,
  status text not null default 'queued',        -- queued | sent | failed
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  locale text not null default 'en',
  consented_at timestamptz not null default now()
);

create table gdpr_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  email text not null,
  kind gdpr_request_type not null,
  status gdpr_request_status not null default 'pending',
  processed_by uuid references profiles(id),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (                        -- admin + érzékeny műveletek
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  actor_role user_role,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

-- ============ ÚJ USER TRIGGER ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  insert into public.user_roles (user_id, role) values (new.id, 'customer');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
