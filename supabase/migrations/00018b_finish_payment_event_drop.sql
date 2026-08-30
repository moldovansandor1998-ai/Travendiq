-- Travendiq – 00018b: finish_payment_event v1 (void) eldobása a v2 elé
--
-- A 00010 a finish_payment_event-et "returns void" típussal hozta létre,
-- a 00019 pedig "returns boolean" v2-re cseréli. A PostgreSQL a
-- create or replace function NEM engedi megváltoztatni a visszatérési
-- típust ("cannot change return type of existing function") – ezért a
-- v1-et előbb el kell dobni.
--
-- A függvényt kizárólag a service_role használja, és a 00019 azonnal
-- újra létrehozza a végleges, lock-ellenőrzős változatban – nincs
-- kimaradó ablak éles rendszeren sem (a migrációk egy tranzakciós
-- sorban futnak a deploy során).
--
-- Korábbi fájlokhoz NEM nyúlunk – ez a közbeiktatott migráció oldja fel.

drop function if exists public.finish_payment_event(text, text, text, boolean, text);
