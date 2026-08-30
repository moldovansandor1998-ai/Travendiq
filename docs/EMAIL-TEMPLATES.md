# Automatikus emailek – sablonterv

A küldőmotor: `src/lib/email.ts` (Resend; kulcs nélkül szimulált, naplózott küldés).
Minden levél reszponzív HTML (`baseLayout`), nyelve: a foglalás/profil `locale` mezője.

| # | Sablon kulcs | Kiváltó esemény | Fő változók |
|---|---|---|---|
| 1 | registration | auth signup | name |
| 2 | email_confirmation | Supabase confirm (beépített, brandelhető) | link |
| 3 | provider_application | szolgáltatói regisztráció | legal_name |
| 4 | provider_docs_required | admin „docs” döntés | missing_docs |
| 5 | provider_approved | admin jóváhagyás | display_name |
| 6 | provider_rejected | admin elutasítás | reason |
| 7 | booking_confirmation | fizetés siker / provider confirm | code, title, date, time |
| 8 | payment_receipt | fizetés captured | code, amount, currency |
| 9 | trip_reminder | cron: T-24h | code, meeting_point |
| 10 | pickup_info | szolgáltató pickup infót küld | code, pickup_time, pickup_address |
| 11 | booking_modified | státusz modification | code, diff |
| 12 | booking_cancelled | lemondás | code, reason |
| 13 | refund_processed | visszatérítés feldolgozva | code, amount |
| 14 | review_request | completed + 24h | code, review_link |
| 15 | payout_notification | payout paid | amount, period |
| 16 | security_alert | gyanús belépés / jogosultságváltozás | event, ip |

**Tennivalók:** a sablonok jelenleg egyszerű szöveges törzzsel rendelkeznek –
a végső arculathoz igazított dizájn + a 9 nyelv szövegei a launch előtt készülnek.
A trip_reminder és review_request ütemezéséhez cron kell (Vercel Cron vagy pg_cron).
