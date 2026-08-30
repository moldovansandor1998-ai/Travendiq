-- Travendiq – seed adatok (demo). A Hurghada programok DRAFT + is_test állapotúak,
-- amíg az árakat, napokat és leírásokat véglegesen nem ellenőriztük.

create extension if not exists pgcrypto;

-- ============ DEMO FELHASZNÁLÓK (jelszó mindenhol: TravendiqDemo1) ============
-- Szolgáltató
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
  'authenticated','authenticated','provider@demo.travendiq.com',
  crypt('TravendiqDemo1', gen_salt('bf')), now(), now(), now(), '{"full_name":"Demo Provider"}');
-- Admin
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222',
  'authenticated','authenticated','admin@demo.travendiq.com',
  crypt('TravendiqDemo1', gen_salt('bf')), now(), now(), now(), '{"full_name":"Demo Admin"}');

insert into user_roles (user_id, role) values
  ('11111111-1111-1111-1111-111111111111','provider'),
  ('22222222-2222-2222-2222-222222222222','admin');

update profiles set full_name = 'Demo Provider' where id = '11111111-1111-1111-1111-111111111111';
update profiles set full_name = 'Demo Admin' where id = '22222222-2222-2222-2222-222222222222';

-- ============ ORSZÁGOK / VÁROSOK / PÉNZNEMEK ============
insert into countries (code, name, default_currency) values
  ('EG','Egypt','EGP'), ('HU','Hungary','HUF'), ('DE','Germany','EUR'),
  ('AT','Austria','EUR'), ('FR','France','EUR'), ('ES','Spain','EUR'),
  ('IT','Italy','EUR'), ('RO','Romania','RON'), ('PL','Poland','PLN'),
  ('AE','United Arab Emirates','AED'), ('GB','United Kingdom','GBP'),
  ('US','United States','USD');

insert into cities (country_code, slug, name, lat, lng, is_popular) values
  ('EG','hurghada','Hurghada',27.2579,33.8116,true),
  ('EG','cairo','Cairo',30.0444,31.2357,true),
  ('EG','luxor','Luxor',25.6872,32.6396,true),
  ('EG','el-gouna','El Gouna',27.3933,33.6782,true),
  ('EG','sharm-el-sheikh','Sharm el Sheikh',27.9158,34.3300,true),
  ('HU','budapest','Budapest',47.4979,19.0402,true),
  ('AE','dubai','Dubai',25.2048,55.2708,true),
  ('ES','barcelona','Barcelona',41.3874,2.1686,true),
  ('IT','rome','Rome',41.9028,12.4964,true),
  ('FR','paris','Paris',48.8566,2.3522,true);

insert into currencies (code, symbol, rate_to_eur) values
  ('EUR','€',1), ('USD','$',1.08), ('GBP','£',0.85), ('HUF','Ft',395),
  ('EGP','E£',52.5), ('PLN','zł',4.3), ('RON','lei',4.97), ('AED','د.إ',3.97);

-- ============ KATEGÓRIÁK ============
insert into categories (slug, icon, sort_order) values
  ('city-tours','map',1), ('day-trips','sun',2), ('boat-trips','anchor',3),
  ('water-diving','waves',4), ('adventure-safari','compass',5),
  ('museums-attractions','landmark',6), ('entry-tickets','ticket',7),
  ('concerts-parties-festivals','music',8), ('theatre-cinema-shows','drama',9),
  ('sports-events','trophy',10), ('conferences-workshops','briefcase',11),
  ('food-gastronomy','utensils',12), ('wellness-spa','lotus',13),
  ('transfers','car',14), ('private-experiences','key',15),
  ('family','users',16), ('online-events','monitor',17),
  ('timed-experiences','clock',18), ('free-donation','heart',19);

insert into category_translations (category_id, locale, name)
select c.id, 'en', initcap(replace(c.slug,'-',' ')) from categories c;
insert into category_translations (category_id, locale, name) values
  ((select id from categories where slug='city-tours'),'hu','Városnézés és vezetett túrák'),
  ((select id from categories where slug='day-trips'),'hu','Egynapos kirándulások'),
  ((select id from categories where slug='boat-trips'),'hu','Hajókirándulások'),
  ((select id from categories where slug='water-diving'),'hu','Vízi programok és búvárkodás'),
  ((select id from categories where slug='adventure-safari'),'hu','Quad, szafari és kalandprogramok'),
  ((select id from categories where slug='museums-attractions'),'hu','Múzeumok és látványosságok'),
  ((select id from categories where slug='entry-tickets'),'hu','Belépőjegyek'),
  ((select id from categories where slug='concerts-parties-festivals'),'hu','Koncertek, bulik és fesztiválok'),
  ((select id from categories where slug='theatre-cinema-shows'),'hu','Színház, mozi és előadások'),
  ((select id from categories where slug='sports-events'),'hu','Sportesemények'),
  ((select id from categories where slug='conferences-workshops'),'hu','Konferenciák és workshopok'),
  ((select id from categories where slug='food-gastronomy'),'hu','Gasztronómiai programok'),
  ((select id from categories where slug='wellness-spa'),'hu','Wellness és spa'),
  ((select id from categories where slug='transfers'),'hu','Transzferek'),
  ((select id from categories where slug='private-experiences'),'hu','Privát programok'),
  ((select id from categories where slug='family'),'hu','Családi programok'),
  ((select id from categories where slug='online-events'),'hu','Online események'),
  ((select id from categories where slug='timed-experiences'),'hu','Időpontra foglalható élmények'),
  ((select id from categories where slug='free-donation'),'hu','Ingyenes és adományalapú események');

-- ============ GLOBÁLIS JUTALÉK ============
insert into commission_rules (scope, rate, priority) values ('global', 15, 0);

-- ============ DEMO SZOLGÁLTATÓ (jóváhagyva) ============
insert into providers (id, owner_id, legal_name, display_name, is_company, country_code, city,
  contact_name, contact_email, status, service_areas, languages)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'Hurghada Programs Demo Kft.','Hurghada Programok', true, 'EG', 'Hurghada',
  'Demo Provider','provider@demo.travendiq.com','approved',
  '{EG}','{en,hu,de}');

-- ============ HURGHADA DEMO PROGRAMOK (DRAFT + TESZT) ============
-- Árak: PÉLDA, ellenőrzés előtt ne legyenek publikálva.
insert into listings (id, provider_id, category_id, country_code, city_id, slug, status, is_test,
  confirmation, duration_minutes, min_participants, max_participants,
  is_family_friendly, has_transfer, languages, meeting_point,
  base_price_adult, base_price_child, currency, is_featured, rating_avg, rating_count)
values
 ('b0000001-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='day-trips'),'EG',
  (select id from cities where slug='cairo'),'hurghada-cairo-day-trip','draft',true,
  'manual',960,1,45,true,true,'{en,hu,de}','Hurghada hotel pickup',
  9500,6000,'EUR',true,0,0),
 ('b0000002-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='day-trips'),'EG',
  (select id from cities where slug='luxor'),'hurghada-luxor-day-trip','draft',true,
  'manual',840,1,45,true,true,'{en,hu,de}','Hurghada hotel pickup',
  8500,5500,'EUR',true,0,0),
 ('b0000003-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='boat-trips'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-orange-bay-island','draft',true,
  'instant',480,1,60,true,true,'{en,hu,de}','Hurghada Marina',
  3500,2000,'EUR',true,0,0),
 ('b0000004-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='boat-trips'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-megawish-cruise','draft',true,
  'instant',420,1,80,true,true,'{en,hu,de}','Hurghada Marina',
  3000,1800,'EUR',false,0,0),
 ('b0000005-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='water-diving'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-dolphin-house-snorkeling','draft',true,
  'instant',420,1,40,true,true,'{en,hu,de}','Hurghada Marina',
  3200,1900,'EUR',false,0,0),
 ('b0000006-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='city-tours'),'EG',
  (select id from cities where slug='el-gouna'),'hurghada-el-gouna-city-tour','draft',true,
  'instant',240,1,30,true,true,'{en,hu,de}','Hurghada hotel pickup',
  2500,1500,'EUR',false,0,0),
 ('b0000007-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='water-diving'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-parasailing','draft',true,
  'instant',90,1,10,false,false,'{en,de}','Hurghada Marina',
  2800,2800,'EUR',false,0,0),
 ('b0000008-0000-0000-0000-000000000008','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='adventure-safari'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-moto-safari','draft',true,
  'instant',180,2,20,false,true,'{en,hu,de}','Hurghada hotel pickup',
  3000,2000,'EUR',false,0,0),
 ('b0000009-0000-0000-0000-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='adventure-safari'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-jeep-safari','draft',true,
  'instant',360,2,30,true,true,'{en,hu,de}','Hurghada hotel pickup',
  4000,2500,'EUR',false,0,0),
 ('b0000010-0000-0000-0000-000000000010','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='adventure-safari'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-super-safari','draft',true,
  'instant',420,2,30,true,true,'{en,hu,de}','Hurghada hotel pickup',
  4500,2800,'EUR',true,0,0),
 ('b0000011-0000-0000-0000-000000000011','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from categories where slug='water-diving'),'EG',
  (select id from cities where slug='hurghada'),'hurghada-batiskaf-submarine','draft',true,
  'instant',150,1,44,true,true,'{en,hu,de}','Hurghada Marina',
  3800,2200,'EUR',false,0,0);

-- Fordítások (EN + HU) – rövid demo leírásokkal
insert into listing_translations (listing_id, locale, title, short_description, description, includes, excludes, bring_with, important_info)
values
 ('b0000001-0000-0000-0000-000000000001','en','Cairo Day Trip from Hurghada','Pyramids, Sphinx and Egyptian Museum in one day.','Full-day guided trip to Cairo by air-conditioned bus. Visit the Giza Pyramids, the Great Sphinx and the Egyptian Museum.','Hotel pickup, guide, entrance fees (basic), lunch','Drinks, optional Nile boat, personal expenses','Passport, comfortable shoes, sunscreen','DEMO listing – details pending verification.'),
 ('b0000001-0000-0000-0000-000000000001','hu','Kairói egynapos kirándulás Hurghadából','Piramisok, Szfinx és Egyiptomi Múzeum egy nap alatt.','Egész napos vezetett út Kairóba légkondicionált busszal. Gízai piramisok, Szfinx és az Egyiptomi Múzeum megtekintése.','Hotel pickup, idegenvezető, alap belépők, ebéd','Italok, fakultatív Nílus-hajó, személyes kiadások','Útlevél, kényelmes cipő, naptej','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000002-0000-0000-0000-000000000002','en','Luxor Day Trip from Hurghada','Valley of the Kings and Karnak Temple.','Full-day guided tour to Luxor, the world''s greatest open-air museum.','Hotel pickup, guide, entrance fees (basic), lunch','Drinks, personal expenses','Passport, sunscreen, hat','DEMO listing – details pending verification.'),
 ('b0000002-0000-0000-0000-000000000002','hu','Luxori egynapos kirándulás Hurghadából','A Királyok völgye és a Karnaki templom.','Egész napos vezetett túra Luxorba, a világ legnagyobb szabadtéri múzeumába.','Hotel pickup, idegenvezető, alap belépők, ebéd','Italok, személyes kiadások','Útlevél, naptej, kalap','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000003-0000-0000-0000-000000000003','en','Orange Bay Island Trip','White sandy beach and snorkeling in the Red Sea.','Boat trip to Orange Bay island with snorkeling stops and lunch on board.','Boat, snorkeling gear, lunch, soft drinks','Personal expenses','Swimwear, towel, sunscreen','DEMO listing – details pending verification.'),
 ('b0000003-0000-0000-0000-000000000003','hu','Orange Bay szigetkirándulás','Fehér homokos tengerpart és sznorkelezés.','Hajókirándulás az Orange Bay szigetre, sznorkelezési megállókkal és ebéddel a fedélzeten.','Hajó, sznorkelfelszerelés, ebéd, üdítők','Személyes kiadások','Fürdőruha, törölköző, naptej','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000004-0000-0000-0000-000000000004','en','MegaWish Boat Cruise','All-inclusive Red Sea boat day.','Relaxing boat cruise with swimming stops, lunch and entertainment.','Boat, lunch, drinks, animation','Personal expenses','Swimwear, towel','DEMO listing – details pending verification.'),
 ('b0000004-0000-0000-0000-000000000004','hu','MegaWish hajókirándulás','All-inclusive vörös-tengeri hajós nap.','Pihentető hajóút úszási megállókkal, ebéddel és animációval.','Hajó, ebéd, italok, animáció','Személyes kiadások','Fürdőruha, törölköző','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000005-0000-0000-0000-000000000005','en','Dolphin House Snorkeling','Snorkel with wild dolphins (encounter not guaranteed).','Boat trip to the Dolphin House reef with two snorkeling stops and lunch.','Boat, snorkeling gear, lunch','Personal expenses','Swimwear, towel, sunscreen','DEMO listing – details pending verification.'),
 ('b0000005-0000-0000-0000-000000000005','hu','Dolphin House sznorkelezés','Sznorkelezés vad delfinekkel (a találkozás nem garantált).','Hajóút a Dolphin House zátonyhoz, két sznorkelezési megállóval és ebéddel.','Hajó, sznorkelfelszerelés, ebéd','Személyes kiadások','Fürdőruha, törölköző, naptej','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000006-0000-0000-0000-000000000006','en','El Gouna City Tour','The "Venice of the Red Sea" by lagoon boat.','Half-day city tour in El Gouna with lagoon boat ride and free time.','Transfer, lagoon boat, guide','Food and drinks','Camera, sunscreen','DEMO listing – details pending verification.'),
 ('b0000006-0000-0000-0000-000000000006','hu','El Gouna városnézés','A „Vörös-tengeri Velence” lagúnahajóval.','Félnapos városnézés El Gounában, lagúnahajózással és szabadidővel.','Transzfer, lagúnahajó, idegenvezető','Étel és ital','Fényképezőgép, naptej','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000007-0000-0000-0000-000000000007','en','Parasailing over the Red Sea','Fly above Hurghada''s coastline.','Tandem parasailing experience above the Red Sea.','Equipment, boat, instructor','Photos, videos','Swimwear','DEMO listing – details pending verification.'),
 ('b0000007-0000-0000-0000-000000000007','hu','Parasailing a Vörös-tenger felett','Repülj Hurghada partvonala fölé.','Tandem parasailing élmény a Vörös-tenger felett.','Felszerelés, hajó, oktató','Fotók, videók','Fürdőruha','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000008-0000-0000-0000-000000000008','en','Moto Safari (Quad)','Desert quad adventure at sunset.','Guided quad tour in the Eastern Desert with Bedouin village visit.','Quad, helmet, guide, tea at Bedouin village','Scarf, goggles (rentable)','Closed shoes, sunglasses','DEMO listing – details pending verification.'),
 ('b0000008-0000-0000-0000-000000000008','hu','Moto Szafari (quad)','Sivatagi quad kaland naplementében.','Vezetett quadtúra a Keleti-sivatagban, beduin falu meglátogatásával.','Quad, sisak, vezető, tea a beduin faluban','Sál, szemüveg (bérelhető)','Zárt cipő, napszemüveg','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000009-0000-0000-0000-000000000009','en','Jeep Safari','Off-road desert adventure with BBQ dinner.','Jeep safari in the desert with camel ride, Bedouin village and BBQ dinner.','Jeep, guide, camel ride, BBQ dinner','Drinks, personal expenses','Comfortable clothes','DEMO listing – details pending verification.'),
 ('b0000009-0000-0000-0000-000000000009','hu','Jeep Szafari','Off-road sivatagi kaland BBQ-vacsorával.','Jeepszafari a sivatagban teveháttal, beduin faluval és BBQ-vacsorával.','Jeep, vezető, tevehát, BBQ-vacsora','Italok, személyes kiadások','Kényelmes ruha','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000010-0000-0000-0000-000000000010','en','Super Safari','Quad, jeep, camel and dinner show in one.','Full desert program: quad, jeep, spider buggy, Bedouin village, dinner and oriental show.','All activities, dinner, show','Drinks, personal expenses','Closed shoes, scarf','DEMO listing – details pending verification.'),
 ('b0000010-0000-0000-0000-000000000010','hu','Super Szafari','Quad, jeep, teve és vacsora-show egyben.','Teljes sivatagi program: quad, jeep, spider buggy, beduin falu, vacsora és orientális show.','Minden program, vacsora, show','Italok, személyes kiadások','Zárt cipő, sál','DEMO program – adatok ellenőrzés alatt.'),
 ('b0000011-0000-0000-0000-000000000011','en','Batiskaf Semi-Submarine','Underwater world without getting wet.','Semi-submarine trip with panoramic underwater windows – coral reefs for all ages.','Boat, underwater deck, soft drink','Personal expenses','Camera','DEMO listing – details pending verification.'),
 ('b0000011-0000-0000-0000-000000000011','hu','Batiskaf féltengeralattjáró','Víz alatti világ vízbe lépés nélkül.','Féltengeralattjárós út panorámaablakokkal – korallzátonyok minden korosztálynak.','Hajó, víz alatti fedélzet, üdítő','Személyes kiadások','Fényképezőgép','DEMO program – adatok ellenőrzés alatt.');

-- Demo képek (Unsplash) – később cserélhetők saját fotókra
insert into listing_media (listing_id, kind, url, alt, sort_order)
select l.id, 'image',
  'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=1200',
  (select title from listing_translations t where t.listing_id = l.id and t.locale='en'), 1
from listings l where l.provider_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Opciók példája: Orange Bay – standard / VIP / privát
insert into listing_options (listing_id, code, price_delta_adult, price_delta_child, max_participants) values
 ('b0000003-0000-0000-0000-000000000003','standard',0,0,60),
 ('b0000003-0000-0000-0000-000000000003','vip',1500,1000,20),
 ('b0000003-0000-0000-0000-000000000003','private',9000,9000,8);
insert into listing_option_translations (option_id, locale, name)
select o.id, 'en', initcap(o.code) from listing_options o;
insert into listing_option_translations (option_id, locale, name)
select o.id, 'hu', case o.code when 'standard' then 'Normál' when 'vip' then 'VIP' when 'private' then 'Privát' end
from listing_options o;

-- Elérhetőség: következő 90 nap, naponta 09:00, kapacitás 20
insert into availability (listing_id, option_id, date, start_time, capacity)
select l.id, null, d::date, '09:00', 20
from listings l
cross join generate_series(current_date, current_date + interval '90 days', interval '1 day') d
where l.provider_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ============ JOGI OLDALAK ============
-- NINCS helykitöltő/tervezet jogi szöveg a publikus felületen: a jogi oldalak
-- is_published=false + legal_approved=false állapotban kerülnek be, és csak a
-- jogász által jóváhagyott, végleges szöveg publikálható (admin CMS).
-- A végleges tartalmakat indulás előtt jogi szakember hagyja jóvá; addig a
-- /legal/[slug] útvonalak 404-et adnak (technikai garancia, nem ígéret).
