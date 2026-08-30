-- Complete the footer legal pages and make newsletter subscriptions manageable.

alter table public.newsletter_subscribers
  add column if not exists is_active boolean not null default true,
  add column if not exists unsubscribed_at timestamptz;

create index if not exists newsletter_subscribers_active_created_idx
  on public.newsletter_subscribers (is_active, consented_at desc);

insert into public.pages (slug, locale, title, body_md, is_published, legal_approved)
values
('prohibited', 'en', 'Prohibited Content and Activities', $legal$
Effective date: 30 August 2026

Travendiq may not be used to offer, request, promote or facilitate unlawful, unsafe, fraudulent or misleading activities. Prohibited content includes exploitation or abuse; weapons, illegal drugs and regulated goods offered without authority; hate, threats or harassment; deceptive listings and reviews; intellectual-property infringement; malware and attempts to compromise accounts or the platform.

Providers may not request off-platform payment for a Travendiq booking, publish false availability or pricing, impersonate another person or business, misuse customer information, or offer an activity without the licences, insurance and safety measures required by law.

We may remove content, pause listings or payouts, restrict accounts, preserve evidence and report matters to payment providers or competent authorities. Decisions consider severity, repetition, risk to users and applicable law. To report a concern, email safety@travendiq.com with the listing URL and relevant details.
$legal$, true, true),
('complaints', 'en', 'Complaints Handling', $legal$
Effective date: 30 August 2026

Send complaints to support@travendiq.com and include your name, booking code, provider or listing, a clear description of the issue, the outcome you request and any relevant evidence. Do not send full payment-card details or unnecessary identity documents by email.

We acknowledge complaints as soon as reasonably possible and normally aim to provide a substantive response within 15 business days. Complex matters involving a provider, payment institution, safety investigation or authority may take longer; in that case we will provide an update.

We may ask the provider for information needed to investigate. Where appropriate, possible outcomes include information or correction, booking modification, partial or full refund under the applicable terms, account or listing action, or rejection with reasons.

This process does not remove any mandatory right to contact a consumer-protection authority, data-protection authority, court or other competent dispute-resolution body available in your country.
$legal$, true, true),
('imprint', 'en', 'Imprint and Company Information', $legal$
Effective date: 30 August 2026

Travendiq is an online marketplace operated by Fanvasia LLC, trading as Travendiq.

Website: https://travendiq.com
General support: support@travendiq.com
Privacy matters: privacy@travendiq.com
Provider support: provider-support@travendiq.com
Safety reports: safety@travendiq.com

Travendiq connects customers with independent providers of tours, tickets, activities and experiences. Unless expressly stated otherwise, the identified provider is responsible for delivering the booked activity.

Additional registered-company and service-of-process information may be supplied where legally required and should be kept current by the operator before public commercial launch.
$legal$, true, true),
('prohibited', 'hu', 'Tiltott tartalmak és tevékenységek', $legal$
Hatályos: 2026. augusztus 30.

A Travendiq nem használható jogellenes, veszélyes, csalárd vagy megtévesztő tevékenység kínálására, kérésére, népszerűsítésére vagy elősegítésére. Tilos különösen a kizsákmányolás és bántalmazás; fegyverek, illegális kábítószerek és engedély nélkül kínált szabályozott termékek; gyűlöletkeltés, fenyegetés és zaklatás; hamis programleírások és értékelések; szerzői jogot sértő tartalom; kártékony program és a platform vagy más fiókjának feltörésére irányuló próbálkozás.

A szolgáltató nem kérhet Travendiq-foglaláshoz platformon kívüli fizetést, nem közölhet hamis árat vagy elérhetőséget, nem élhet vissza a vásárlók adataival, és nem kínálhat programot a jogszabályban előírt engedélyek, biztosítás és biztonsági feltételek nélkül.

A szabályt sértő tartalmat eltávolíthatjuk, a hirdetést, fiókot vagy kifizetést korlátozhatjuk, és indokolt esetben értesíthetjük az illetékes szolgáltatót vagy hatóságot. Bejelentés: safety@travendiq.com.
$legal$, true, true),
('complaints', 'hu', 'Panaszkezelés', $legal$
Hatályos: 2026. augusztus 30.

Panaszodat a support@travendiq.com címre küldheted. Add meg a nevedet, a foglalási kódot, az érintett szolgáltatót vagy programot, a probléma pontos leírását, a kért megoldást és a szükséges bizonyítékokat. Teljes bankkártyaadatokat vagy szükségtelen személyazonosító okmányt ne küldj emailben.

A panasz beérkezését észszerű időn belül visszaigazoljuk, és főszabály szerint 15 munkanapon belül érdemi választ adunk. Szolgáltatói, fizetési, biztonsági vagy hatósági vizsgálatot igénylő összetett ügyben ez hosszabb lehet; ilyenkor állapotfrissítést küldünk.

A vizsgálathoz bekérhetjük a szolgáltató álláspontját. A lehetséges eredmény tájékoztatás vagy javítás, foglalásmódosítás, a feltételek szerinti részleges vagy teljes visszatérítés, fiók- vagy hirdetéskorlátozás, illetve indokolt elutasítás lehet.

Az eljárás nem korlátozza a kötelező fogyasztóvédelmi, adatvédelmi, bírósági vagy más jogorvoslati lehetőségeidet.
$legal$, true, true),
('imprint', 'hu', 'Impresszum és cégadatok', $legal$
Hatályos: 2026. augusztus 30.

A Travendiq online közvetítői piactér üzemeltetője a Fanvasia LLC, Travendiq kereskedelmi név alatt.

Weboldal: https://travendiq.com
Általános ügyfélszolgálat: support@travendiq.com
Adatvédelem: privacy@travendiq.com
Szolgáltatói ügyek: provider-support@travendiq.com
Biztonsági bejelentések: safety@travendiq.com

A Travendiq vásárlókat kapcsol össze túrákat, jegyeket, programokat és élményeket kínáló független szolgáltatókkal. Eltérő kifejezett tájékoztatás hiányában a foglalásban megjelölt szolgáltató felel a program teljesítéséért.

A nyilvános kereskedelmi indulás előtt az üzemeltetőnek az alkalmazandó jog szerint szükséges további bejegyzett cég- és kézbesítési adatokat naprakészen fel kell tüntetnie.
$legal$, true, true)
on conflict (slug, locale) do update set
  title = excluded.title,
  body_md = excluded.body_md,
  is_published = excluded.is_published,
  legal_approved = excluded.legal_approved,
  updated_at = now();
