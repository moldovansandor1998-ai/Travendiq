create table if not exists public.provider_payout_accounts (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  account_holder_name text not null,
  bank_name text not null,
  iban text not null,
  swift_bic text not null,
  currency text not null default 'EUR',
  bank_country_code text not null,
  updated_at timestamptz not null default now()
);
alter table public.provider_payout_accounts enable row level security;
create policy provider_payout_owner_read on public.provider_payout_accounts for select
  using (exists (select 1 from public.providers p where p.id = provider_id and p.owner_id = auth.uid()) or is_staff());
revoke insert, update, delete on public.provider_payout_accounts from anon, authenticated;

create table if not exists public.provider_agreements (
  provider_id uuid not null references public.providers(id) on delete cascade,
  agreement_key text not null,
  agreement_version text not null,
  accepted_by uuid not null references public.profiles(id),
  accepted_name text not null,
  accepted_at timestamptz not null default now(),
  primary key (provider_id, agreement_key, agreement_version)
);
alter table public.provider_agreements enable row level security;
create policy provider_agreement_owner_read on public.provider_agreements for select
  using (exists (select 1 from public.providers p where p.id = provider_id and p.owner_id = auth.uid()) or is_staff());
revoke insert, update, delete on public.provider_agreements from anon, authenticated;
comment on table public.provider_payout_accounts is 'Private provider payout instructions. Never expose through public provider queries.';
comment on table public.provider_agreements is 'Versioned evidence of provider terms acceptance.';
