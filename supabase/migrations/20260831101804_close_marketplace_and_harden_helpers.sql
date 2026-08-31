-- Keep the catalogue private while Travendiq is collecting provider content.
-- The website-level launch flag is not a security boundary: public Data API
-- access is gated here as well. At launch, change the singleton row to true.

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  marketplace_live boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

insert into public.platform_settings (id, marketplace_live)
values (true, false)
on conflict (id) do update set marketplace_live = false, updated_at = now();

drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings
  for select to anon, authenticated
  using (true);

revoke insert, update, delete on public.platform_settings from public, anon, authenticated;
grant select on public.platform_settings to anon, authenticated;

-- Anonymous callers do not need direct access to privileged RLS helpers.
-- Authenticated users retain EXECUTE because the ownership policies use them.
revoke execute on function public.has_role(user_role) from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_provider_member(uuid) from public, anon;
revoke execute on function public.has_provider_permission(uuid,text) from public, anon;
revoke execute on function public.storage_listing_owner(text) from public, anon;
revoke execute on function public.storage_doc_owner(text) from public, anon;
grant execute on function public.has_role(user_role) to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_provider_member(uuid) to authenticated, service_role;
grant execute on function public.has_provider_permission(uuid,text) to authenticated, service_role;
grant execute on function public.storage_listing_owner(text) to authenticated, service_role;
grant execute on function public.storage_doc_owner(text) to authenticated, service_role;

drop policy if exists providers_public_read on public.providers;
create policy providers_public_read on public.providers for select to anon
using (status = 'approved' and exists (
  select 1 from public.platform_settings s where s.id and s.marketplace_live
));
create policy providers_authenticated_read on public.providers for select to authenticated
using (
  (status = 'approved' and exists (
    select 1 from public.platform_settings s where s.id and s.marketplace_live
  ))
  or public.is_provider_member(id)
  or public.is_staff()
);

drop policy if exists listings_public_read on public.listings;
create policy listings_public_read on public.listings for select to anon
using (status = 'published' and not is_test and exists (
  select 1 from public.platform_settings s where s.id and s.marketplace_live
));
create policy listings_authenticated_read on public.listings for select to authenticated
using (
  (status = 'published' and not is_test and exists (
    select 1 from public.platform_settings s where s.id and s.marketplace_live
  ))
  or public.is_provider_member(provider_id)
  or public.is_staff()
);

drop policy if exists lt_read on public.listing_translations;
create policy lt_read on public.listing_translations for select
using (exists (
  select 1 from public.listings l
  where l.id = listing_id
));

drop policy if exists lm_read on public.listing_media;
create policy lm_read on public.listing_media for select
using (exists (
  select 1 from public.listings l
  where l.id = listing_id
));

drop policy if exists lo_read on public.listing_options;
create policy lo_read on public.listing_options for select
using (exists (select 1 from public.listings l where l.id = listing_id));

drop policy if exists lot_read on public.listing_option_translations;
create policy lot_read on public.listing_option_translations for select
using (exists (
  select 1 from public.listing_options o
  join public.listings l on l.id = o.listing_id
  where o.id = option_id
));

drop policy if exists le_read on public.listing_extras;
create policy le_read on public.listing_extras for select
using (exists (select 1 from public.listings l where l.id = listing_id));

drop policy if exists ltz_read on public.listing_transfer_zones;
create policy ltz_read on public.listing_transfer_zones for select
using (exists (select 1 from public.listings l where l.id = listing_id));

drop policy if exists avail_read on public.availability;
create policy avail_read on public.availability for select
using (exists (select 1 from public.listings l where l.id = listing_id));

drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews for select to anon
using (status = 'published' and exists (
  select 1 from public.listings l where l.id = listing_id
));
create policy reviews_authenticated_read on public.reviews for select to authenticated
using (
  (status = 'published' and exists (
    select 1
    from public.listings l
    where l.id = listing_id
  ))
  or user_id = auth.uid()
  or public.is_staff()
  or exists (
    select 1 from public.listings l
    where l.id = listing_id and public.is_provider_member(l.provider_id)
  )
);

-- Direct object listing is also gated. Public object URLs are unguessable and
-- remain usable for provider/admin previews while the catalogue is prepared.
drop policy if exists listing_media_read on storage.objects;
create policy listing_media_read on storage.objects for select
using (
  bucket_id = 'listing-media'
  and exists (
    select 1 from public.listings l
    where l.id::text = (string_to_array(name, '/'))[1]
  )
);
