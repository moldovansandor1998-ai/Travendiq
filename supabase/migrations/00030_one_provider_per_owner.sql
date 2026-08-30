-- Egy felhasználóhoz pontosan egy szolgáltatói profil tartozhat.
-- Ez teszi idempotenssé a szolgáltatói jelentkezés upsert műveletét.
create unique index if not exists providers_one_per_owner_idx
  on public.providers(owner_id);
