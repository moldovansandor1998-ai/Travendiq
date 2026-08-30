alter table public.listing_transfer_zones
  add column if not exists pickup_from text,
  add column if not exists pickup_to text;

comment on column public.listing_transfer_zones.pickup_from is 'A transzfer felvételi területének kezdete vagy központja';
comment on column public.listing_transfer_zones.pickup_to is 'A transzferzóna külső határa vagy célterülete';
