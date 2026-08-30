create table if not exists public.provider_team_invitations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  email text not null,
  permissions text[] not null,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists provider_team_invite_pending_uidx
  on public.provider_team_invitations(provider_id, lower(email)) where accepted_at is null;
alter table public.provider_team_invitations enable row level security;
create policy provider_team_invite_owner_read on public.provider_team_invitations for select
  using (exists (select 1 from public.providers p where p.id=provider_id and p.owner_id=auth.uid()) or is_staff());
revoke insert, update, delete on public.provider_team_invitations from anon, authenticated;
