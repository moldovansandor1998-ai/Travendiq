alter table public.providers
  add column if not exists review_note text;

comment on column public.providers.review_note is
  'Administrator-facing and provider-visible reason for document requests or rejection.';
