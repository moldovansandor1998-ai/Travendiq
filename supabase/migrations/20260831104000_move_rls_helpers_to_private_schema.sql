-- Keep privileged RLS implementation outside the exposed Data API schema.
-- Public functions remain as SECURITY INVOKER compatibility wrappers because
-- existing policies and application RPC checks reference those names.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.has_role(r public.user_role)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = r);
$$;
create or replace function private.is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('support','admin','superadmin'));
$$;
create or replace function private.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','superadmin'));
$$;
create or replace function private.is_provider_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.providers where id = p and owner_id = auth.uid())
    or exists (select 1 from public.provider_members where provider_id = p and user_id = auth.uid());
$$;
create or replace function private.has_provider_permission(p uuid, perm text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.providers where id = p and owner_id = auth.uid())
    or exists (select 1 from public.provider_members where provider_id = p and user_id = auth.uid() and perm = any(permissions));
$$;
create or replace function private.storage_listing_owner(object_name text)
returns boolean language sql security definer stable set search_path = public, storage, private as $$
  select exists (
    select 1 from public.listings l
    where l.id::text = (string_to_array(object_name, '/'))[1]
      and (private.is_provider_member(l.provider_id) or private.is_admin())
  );
$$;
create or replace function private.storage_doc_owner(object_name text)
returns boolean language sql security definer stable set search_path = public, storage, private as $$
  select exists (
    select 1 from public.providers p
    where p.id::text = (string_to_array(object_name, '/'))[1]
      and (private.is_provider_member(p.id) or private.is_staff())
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

create or replace function public.has_role(r public.user_role)
returns boolean language sql security invoker stable set search_path = public, private as $$ select private.has_role(r) $$;
create or replace function public.is_staff()
returns boolean language sql security invoker stable set search_path = public, private as $$ select private.is_staff() $$;
create or replace function public.is_admin()
returns boolean language sql security invoker stable set search_path = public, private as $$ select private.is_admin() $$;
create or replace function public.is_provider_member(p uuid)
returns boolean language sql security invoker stable set search_path = public, private as $$ select private.is_provider_member(p) $$;
create or replace function public.has_provider_permission(p uuid, perm text)
returns boolean language sql security invoker stable set search_path = public, private as $$ select private.has_provider_permission(p, perm) $$;
create or replace function public.storage_listing_owner(object_name text)
returns boolean language sql security invoker stable set search_path = public, private as $$ select private.storage_listing_owner(object_name) $$;
create or replace function public.storage_doc_owner(object_name text)
returns boolean language sql security invoker stable set search_path = public, private as $$ select private.storage_doc_owner(object_name) $$;

revoke execute on function public.has_role(public.user_role) from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_provider_member(uuid) from public, anon;
revoke execute on function public.has_provider_permission(uuid,text) from public, anon;
revoke execute on function public.storage_listing_owner(text) from public, anon;
revoke execute on function public.storage_doc_owner(text) from public, anon;
grant execute on function public.has_role(public.user_role) to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_provider_member(uuid) to authenticated, service_role;
grant execute on function public.has_provider_permission(uuid,text) to authenticated, service_role;
grant execute on function public.storage_listing_owner(text) to authenticated, service_role;
grant execute on function public.storage_doc_owner(text) to authenticated, service_role;
