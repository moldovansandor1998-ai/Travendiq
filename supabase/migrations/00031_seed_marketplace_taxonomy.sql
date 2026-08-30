-- Alap piactéri törzsadatok. Idempotens: biztonságosan újrafuttatható.
insert into public.countries (code, name, default_currency, is_active) values
  ('EG','Egypt','EUR',true),('HU','Hungary','EUR',true),('GB','United Kingdom','GBP',true),
  ('US','United States','USD',true),('FR','France','EUR',true),('ES','Spain','EUR',true),
  ('IT','Italy','EUR',true),('DE','Germany','EUR',true),('AT','Austria','EUR',true),
  ('AE','United Arab Emirates','AED',true),('TR','Türkiye','EUR',true),('GR','Greece','EUR',true),
  ('PT','Portugal','EUR',true),('NL','Netherlands','EUR',true),('MY','Malaysia','MYR',true)
on conflict (code) do update set name=excluded.name, default_currency=excluded.default_currency, is_active=true;

insert into public.currencies (code, symbol, rate_to_eur, is_active) values
  ('EUR','€',1,true),('USD','$',1,true),('GBP','£',1,true),('AED','د.إ',1,true),('MYR','RM',1,true)
on conflict (code) do update set symbol=excluded.symbol, is_active=true;

insert into public.cities (country_code, slug, name, lat, lng, is_popular, is_active) values
  ('EG','hurghada','Hurghada',27.2579,33.8116,true,true),
  ('EG','cairo','Cairo',30.0444,31.2357,true,true),
  ('EG','luxor','Luxor',25.6872,32.6396,true,true),
  ('HU','budapest','Budapest',47.4979,19.0402,true,true),
  ('GB','london','London',51.5072,-0.1276,true,true),
  ('US','new-york-city','New York City',40.7128,-74.0060,true,true),
  ('FR','paris','Paris',48.8566,2.3522,true,true),
  ('ES','barcelona','Barcelona',41.3874,2.1686,true,true),
  ('IT','rome','Rome',41.9028,12.4964,true,true),
  ('AE','dubai','Dubai',25.2048,55.2708,true,true),
  ('TR','istanbul','Istanbul',41.0082,28.9784,true,true),
  ('GR','athens','Athens',37.9838,23.7275,true,true),
  ('PT','lisbon','Lisbon',38.7223,-9.1393,false,true),
  ('NL','amsterdam','Amsterdam',52.3676,4.9041,false,true),
  ('DE','berlin','Berlin',52.5200,13.4050,false,true),
  ('AT','vienna','Vienna',48.2082,16.3738,false,true),
  ('MY','kuala-lumpur','Kuala Lumpur',3.1390,101.6869,false,true)
on conflict (country_code, slug) do update set
  name=excluded.name, lat=excluded.lat, lng=excluded.lng,
  is_popular=excluded.is_popular, is_active=true;

insert into public.categories (slug, icon, sort_order, is_active) values
  ('sightseeing','landmark',10,true),('day-trips','map',20,true),
  ('boat-tours','ship',30,true),('museums','museum',40,true),
  ('food-drink','utensils',50,true),('nature-adventure','mountain',60,true),
  ('water-activities','waves',70,true),('shows-events','ticket',80,true),
  ('family','users',90,true),('wellness','sparkles',100,true),
  ('nightlife','moon',110,true),('transport','car',120,true)
on conflict (slug) do update set icon=excluded.icon, sort_order=excluded.sort_order, is_active=true;

insert into public.category_translations (category_id, locale, name)
select c.id, v.locale, v.name
from (values
  ('sightseeing','en','Sightseeing'),('sightseeing','hu','Városnézés'),
  ('day-trips','en','Day trips'),('day-trips','hu','Egynapos kirándulások'),
  ('boat-tours','en','Cruises & boat tours'),('boat-tours','hu','Hajóutak'),
  ('museums','en','Museums & exhibitions'),('museums','hu','Múzeumok és kiállítások'),
  ('food-drink','en','Food & drink'),('food-drink','hu','Ételek és italok'),
  ('nature-adventure','en','Nature & adventure'),('nature-adventure','hu','Természet és kaland'),
  ('water-activities','en','Water activities'),('water-activities','hu','Vízi programok'),
  ('shows-events','en','Shows & events'),('shows-events','hu','Műsorok és események'),
  ('family','en','Family-friendly'),('family','hu','Családi programok'),
  ('wellness','en','Wellness & relaxation'),('wellness','hu','Wellness és pihenés'),
  ('nightlife','en','Nightlife'),('nightlife','hu','Éjszakai élet'),
  ('transport','en','Transfers & transport'),('transport','hu','Transzfer és közlekedés')
) as v(slug, locale, name)
join public.categories c on c.slug=v.slug
on conflict (category_id, locale) do update set name=excluded.name;
