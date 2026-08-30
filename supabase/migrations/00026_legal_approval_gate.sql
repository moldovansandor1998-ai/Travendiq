-- 00026: jogi oldalak jóváhagyási kapuja
-- A DRAFT/helykitöltő jogi szövegek addig NEM jelenhetnek meg a publikus
-- felületen, amíg jogász nem hagyta jóvá őket. A kapu DB-szintű:
-- legal_approved alapértelmezése FALSE → technikailag lehetetlen, hogy
-- jóváhagyatlan jogi oldal éles státuszt jelentsen.

alter table public.pages
  add column if not exists legal_approved boolean not null default false;

-- a meglévő (seed) jogi oldalak jóváhagyatlanok maradnak; az admin CMS-ben
-- állítható jóvá (service_role / admin policy). A publikus legal-oldal csak
-- is_published AND legal_approved sorokat szolgál ki.

comment on column public.pages.legal_approved is
  'Jogi szöveg jogász általi jóváhagyása. FALSE esetén a /legal/[slug] oldal 404.';

-- RLS-szintű kapu: a jogi slugok NEM olvashatók nyilvánosan jóváhagyás nélkül,
-- akár az alkalmazás, akár közvetlen PostgREST-lekérdezés érkezik.
drop policy if exists pages_read on public.pages;
create policy pages_read on public.pages for select using (
  is_admin()
  or (is_published and (
    slug not in ('terms','privacy','cookies','provider-terms','refund-policy',
                 'prohibited','complaints','imprint')
    or legal_approved
  ))
);
