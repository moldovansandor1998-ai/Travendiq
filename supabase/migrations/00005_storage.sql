-- Travendiq – 00005: Storage bucketek és policy-k
-- listing-media: nyilvános olvasás, írás csak saját programhoz (provider member)
-- provider-docs: privát, signed URL-lel; írás saját providerhez, olvasás owner/staff

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-media', 'listing-media', true, 10485760,
   array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']),
  ('provider-docs', 'provider-docs', false, 15728640,
   array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- helper: a storage path első szegmense a provider/listing azonosító
-- listing-media path: <listing_id>/<fájlnév>
create or replace function public.storage_listing_owner(object_name text)
returns boolean language sql security definer stable set search_path = public, storage as $$
  select exists (
    select 1 from listings l
    where l.id::text = (string_to_array(object_name, '/'))[1]
      and (is_provider_member(l.provider_id) or is_admin()));
$$;

-- provider-docs path: <provider_id>/<user_id>/<fájlnév>
create or replace function public.storage_doc_owner(object_name text)
returns boolean language sql security definer stable set search_path = public, storage as $$
  select exists (
    select 1 from providers p
    where p.id::text = (string_to_array(object_name, '/'))[1]
      and (is_provider_member(p.id) or is_staff()));
$$;

-- listing-media policy-k
create policy listing_media_read on storage.objects for select
  using (bucket_id = 'listing-media');
create policy listing_media_insert on storage.objects for insert
  with check (bucket_id = 'listing-media' and storage_listing_owner(name));
create policy listing_media_update on storage.objects for update
  using (bucket_id = 'listing-media' and storage_listing_owner(name));
create policy listing_media_delete on storage.objects for delete
  using (bucket_id = 'listing-media' and storage_listing_owner(name));

-- provider-docs policy-k (privát)
create policy provider_docs_insert on storage.objects for insert
  with check (bucket_id = 'provider-docs' and storage_doc_owner(name));
create policy provider_docs_select on storage.objects for select
  using (bucket_id = 'provider-docs' and storage_doc_owner(name));
create policy provider_docs_delete on storage.objects for delete
  using (bucket_id = 'provider-docs' and storage_doc_owner(name));
