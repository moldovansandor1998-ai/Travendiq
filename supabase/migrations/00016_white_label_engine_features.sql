create table if not exists public.engine_features (
  feature_key text primary key,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.engine_features enable row level security;
revoke all on table public.engine_features from anon, authenticated;
grant select on table public.engine_features to anon, authenticated;
drop policy if exists engine_features_public_read on public.engine_features;
create policy engine_features_public_read on public.engine_features for select to anon, authenticated using (true);
insert into public.engine_features(feature_key,enabled,config) values
 ('extra-language',true,'{}'::jsonb),('extra-payment',true,'{}'::jsonb),('email-automation',true,'{}'::jsonb),('api-webhook',true,'{}'::jsonb),
 ('google-apple-login',false,'{}'::jsonb),('push',false,'{}'::jsonb),('ai-support',false,'{}'::jsonb),('pwa',false,'{}'::jsonb)
on conflict(feature_key) do nothing;
