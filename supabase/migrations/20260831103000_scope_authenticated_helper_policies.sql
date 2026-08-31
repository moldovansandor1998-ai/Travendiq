-- Policies that call authenticated SECURITY DEFINER helpers must never run for
-- anon. Scope every legacy helper-based policy to authenticated users.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in ('public', 'storage')
      and roles @> array['public']::name[]
      and concat(coalesce(qual, ''), ' ', coalesce(with_check, '')) ilike any (array[
        '%is_admin(%', '%is_staff(%', '%is_provider_member(%',
        '%has_provider_permission(%', '%storage_listing_owner(%',
        '%storage_doc_owner(%'
      ])
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      p.policyname, p.schemaname, p.tablename
    );
  end loop;
end
$$;

-- Published and legally approved CMS pages remain readable before launch.
drop policy if exists pages_anon_read on public.pages;
create policy pages_anon_read on public.pages for select to anon
using (
  is_published
  and (
    slug <> all (array[
      'terms', 'privacy', 'cookies', 'provider-terms', 'refund-policy',
      'prohibited', 'complaints', 'imprint'
    ]::text[])
    or legal_approved
  )
);
