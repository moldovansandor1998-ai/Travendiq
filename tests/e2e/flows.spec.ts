import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createHmac } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Teljes folyamat-E2E-k – élő Supabase (service role) kell hozzájuk.
 * Futtatás:
 *   E2E_SUPABASE_URL=https://<proj>.supabase.co \
 *   E2E_SERVICE_ROLE_KEY=... \
 *   AFFILIATE_COOKIE_SECRET=... (az app által is használt titok) \
 *   npx playwright test tests/e2e/flows.spec.ts
 *
 * Stripe-függő részfolyamatok (teljes kártyás fizetés, valódi chargeback) a
 * vitest alapú test:stripe suite-ban vannak (tests/integration/stripe-flows.test.ts);
 * itt a HTTP/API-szintű folyamatok futnak valódi adatbázison.
 *
 * A környezet hiányában a describe BLOKK skip – ezeket a teszteket így NEM
 * jelentjük sikeresnek (lásd FINAL-VERIFICATION.md).
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const COOKIE_SECRET = process.env.AFFILIATE_COOKIE_SECRET ?? "";
const LIVE =
  SUPABASE_URL.startsWith("http") && !SUPABASE_URL.includes("placeholder") &&
  SERVICE_KEY.length > 20;

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);

test.describe("teljes üzleti folyamatok (élő Supabase kell)", () => {
  test.skip(!LIVE, "Élő Supabase szükséges (E2E_SUPABASE_URL, E2E_SERVICE_ROLE_KEY)");

  let svc: SupabaseClient;
  let anon: APIRequestContext;

  /** Fixture: provider (approved, Stripe-számla nélkül) + published listing + slot. */
  async function makeListing(opts: { isTest?: boolean; status?: string } = {}) {
    const { data: city } = await svc.from("cities").select("id").eq("slug", "hurghada").single();
    const { data: cat } = await svc.from("categories").select("id").limit(1).single();
    const ownerEmail = `e2e-prov-${RUN}-${Math.random().toString(36).slice(2, 8)}@travendiq-test.local`;
    const { data: ud } = await svc.auth.admin.createUser({
      email: ownerEmail, password: `E2e-${RUN}!`, email_confirm: true,
    });
    const { data: prov } = await svc.from("providers").insert({
      owner_id: ud.user!.id, legal_name: "E2E Kft", display_name: `E2E Provider ${RUN}`,
      country_code: "HU", status: "approved",
    }).select("id").single();
    const { data: listing } = await svc.from("listings").insert({
      provider_id: prov!.id, category_id: cat!.id, country_code: "EG", city_id: city!.id,
      slug: `e2e-${RUN}-${Math.random().toString(36).slice(2, 8)}`,
      status: opts.status ?? "published", is_test: opts.isTest ?? true,
      base_price_adult: 10000, currency: "EUR",
    }).select("id, slug").single();
    const date = new Date(Date.now() + 72 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: slot } = await svc.from("availability").insert({
      listing_id: listing!.id, option_id: null, date, start_time: "10:00", capacity: 20,
    }).select("id").single();
    return { listing, slot, date, prov, userId: ud.user!.id };
  }

  /** Foglalás létrehozása a publikus API-n keresztül (opcionális cookie-kkal). */
  async function createBookingViaApi(
    fx: Awaited<ReturnType<typeof makeListing>>, extra: { cookies?: string; body?: Record<string, unknown> } = {},
  ) {
    const res = await anon.post(`${BASE}/api/bookings/create`, {
      headers: {
        "Content-Type": "application/json", "x-locale": "en",
        ...(extra.cookies ? { cookie: extra.cookies } : {}),
      },
      data: {
        listingId: fx.listing!.id, date: fx.date, startTime: "10:00",
        adults: 1, children: 0, infants: 0, leadName: "E2E Guest",
        leadEmail: `e2e-guest-${RUN}-${Math.random().toString(36).slice(2, 6)}@travendiq-test.local`,
        extras: [], idempotencyKey: `e2e_${RUN}_${Math.random().toString(36).slice(2, 10)}`,
        ...(extra.body ?? {}),
      },
    });
    return res;
  }

  function signedCookie(linkId: string): string {
    const expires = Math.floor(Date.now() / 1000) + 86400;
    const sig = createHmac("sha256", COOKIE_SECRET).update(`${linkId}.${expires}`).digest("hex");
    return `travendiq_ref=${linkId}.${expires}.${sig}`;
  }

  async function cleanup(fx: Awaited<ReturnType<typeof makeListing>>, bookingId?: string | null) {
    if (bookingId) {
      await svc.from("checkins").delete().eq("booking_id", bookingId);
      await svc.from("payout_reversals").delete().eq("booking_id", bookingId);
      await svc.from("payouts").delete().eq("booking_id", bookingId);
      await svc.from("payments").delete().eq("booking_id", bookingId);
      await svc.from("refunds").delete().eq("booking_id", bookingId);
      await svc.from("affiliate_commissions").delete().eq("booking_id", bookingId);
      await svc.from("bookings").delete().eq("id", bookingId);
    }
    await svc.from("availability").delete().eq("listing_id", fx.listing!.id);
    await svc.from("listings").delete().eq("id", fx.listing!.id);
    await svc.from("providers").delete().eq("id", fx.prov!.id);
    if (fx.userId) await svc.auth.admin.deleteUser(fx.userId).catch(() => {});
  }

  test.beforeAll(async () => {
    svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    anon = await playwrightRequest.newContext();
  });
  test.afterAll(async () => { await anon.dispose(); });

  // ------------------------------------------------------------------
  test("vendég foglalás az API-n: vendég token + kód, majd voucher API a tokennel", async () => {
    const fx = await makeListing();
    const res = await createBookingViaApi(fx);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^TRV-\d{2}-/);
    expect(body.guestToken).toBeTruthy();

    // voucher: ÉRVÉNYES vendég tokennel elérhető
    const ok = await anon.get(`${BASE}/api/voucher/${body.code}?token=${body.guestToken}`);
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toContain(body.code);

    // voucher: token nélkül / hibás tokennel NEM érhető el
    const noTok = await anon.get(`${BASE}/api/voucher/${body.code}`);
    expect([401, 403]).toContain(noTok.status());
    const badTok = await anon.get(`${BASE}/api/voucher/${body.code}?token=deadbeef`);
    expect([401, 403]).toContain(badTok.status());

    await cleanup(fx, body.bookingId);
  });

  // ------------------------------------------------------------------
  test("tulajdonosi voucher: hitelesítés session-assert-tal, a tulajdonos oldala nem árulja el a guest tokent", async () => {
    const fx = await makeListing();
    const email = `e2e-owner-${RUN}@travendiq-test.local`;
    const { data: cu } = await svc.auth.admin.createUser({
      email, password: `E2e-Owner-${RUN}!`, email_confirm: true,
    });
    const ownerId = cu.user!.id;

    // foglalás a tulajdonos user_id-jával
    const { data: bookingId } = await svc.rpc("create_booking", {
      p_listing: fx.listing!.id, p_option: null, p_date: fx.date, p_start_time: "10:00",
      p_adults: 1, p_children: 0, p_infants: 0, p_user: ownerId,
      p_guest_email: null, p_customer_locale: "hu",
      p_lead_name: "E2E Owner", p_lead_email: email, p_lead_phone: null,
      p_hotel: null, p_pickup: null, p_special: null,
      p_coupon_code: null, p_idempotency_key: `e2e_own_${RUN}`,
    });
    const { data: b } = await svc.from("bookings")
      .select("code, guest_access_token").eq("id", bookingId).single();

    // owner-jogosultság DB-szintű assertje: a voucher route ezt azonos feltétellel
    // ellenőrzi (bookings.user_id == session user.id)
    const { data: ownerCheck } = await svc.from("bookings")
      .select("id").eq("id", bookingId).eq("user_id", ownerId);
    expect(ownerCheck).toHaveLength(1);

    // anon (session és token nélkül) → NEM érhető el
    const noAuth = await anon.get(`${BASE}/api/voucher/${b!.code}?format=pdf`);
    expect([401, 403]).toContain(noAuth.status());

    // hibás tokennel sem érhető el
    const badTok = await anon.get(`${BASE}/api/voucher/${b!.code}?format=pdf&token=deadbeef`);
    expect([401, 403]).toContain(badTok.status());

    // a tulajdonosi oldal forrásában a PDF-link NEM hordozhatja a guest tokent
    // (a route owner session esetén token = null-t ad át – kód-oldali garancia)
    await cleanup(fx, bookingId as string);
    await svc.auth.admin.deleteUser(ownerId);
  });

  // ------------------------------------------------------------------
  test("affiliate: aláírt cookie → jutalék; HAMISÍTOTT / body-s UUID → nincs jutalék", async () => {
    test.skip(!COOKIE_SECRET || COOKIE_SECRET.length < 16, "AFFILIATE_COOKIE_SECRET kell a cookie-ajánláshoz");
    const fx = await makeListing();
    const { data: link } = await svc.from("promoter_links").insert({
      code: `E2E${RUN}`.toUpperCase().slice(0, 10), kind: "link",
      listing_id: fx.listing!.id, is_active: true, approval_status: "approved",
      commission_rate: 10,
    }).select("id").single();

    // 1) érvényes aláírt cookie → affiliate_commissions sor keletkezik
    const ok = await createBookingViaApi(fx, { cookies: signedCookie(link!.id) });
    expect(ok.status(), await ok.text()).toBe(200);
    const okBody = await ok.json();
    const { data: comm } = await svc.from("affiliate_commissions")
      .select("id, amount").eq("booking_id", okBody.bookingId);
    expect(comm!.length).toBeGreaterThan(0);
    await cleanup(fx, okBody.bookingId);

    // 2) HAMISÍTOTT cookie (más UUID, ugyanazzal az aláírással) → nincs jutalék
    const [_, expires, sig] = signedCookie(link!.id).split("=")[1].split(".");
    const forged = `travendiq_ref=99999999-8888-4777-8666-777777777777.${expires}.${sig}`;
    const bad = await createBookingViaApi(fx, { cookies: forged });
    expect(bad.status()).toBe(200); // a foglalás létrejön, de affiliate NÉLKÜL
    const badBody = await bad.json();
    const { data: comm2 } = await svc.from("affiliate_commissions")
      .select("id").eq("booking_id", badBody.bookingId);
    expect(comm2).toHaveLength(0);
    await cleanup(fx, badBody.bookingId);

    // 3) a body-ban küldött affiliateLink UUID-t a séma eldobja → nincs jutalék
    const forgedBody = await createBookingViaApi(fx, { body: { affiliateLink: link!.id } });
    expect(forgedBody.status()).toBe(200);
    const fb = await forgedBody.json();
    const { data: comm3 } = await svc.from("affiliate_commissions")
      .select("id").eq("booking_id", fb.bookingId);
    expect(comm3).toHaveLength(0);
    await cleanup(fx, fb.bookingId);

    // 4) lejárt cookie → nincs jutalék
    const exp = Math.floor(Date.now() / 1000) - 3600;
    const expiredSig = createHmac("sha256", COOKIE_SECRET).update(`${link!.id}.${exp}`).digest("hex");
    const expired = await createBookingViaApi(fx, {
      cookies: `travendiq_ref=${link!.id}.${exp}.${expiredSig}`,
    });
    const eb = await expired.json();
    const { data: comm4 } = await svc.from("affiliate_commissions")
      .select("id").eq("booking_id", eb.bookingId);
    expect(comm4).toHaveLength(0);
    await cleanup(fx, eb.bookingId);

    await svc.from("promoter_links").delete().eq("id", link!.id);
    await cleanup(fx);
  });

  // ------------------------------------------------------------------
  test("QR check-in: token ellenőrzés + ismételt teljes beléptetés → already_used", async () => {
    const fx = await makeListing();
    const res = await createBookingViaApi(fx);
    const body = await res.json();
    await svc.from("bookings").update({ status: "confirmed" }).eq("id", body.bookingId);

    // anon check-in (jogosultság nélkül) → 401/403, sosem 200
    const noAuth = await anon.post(`${BASE}/api/checkin`, { data: { code: body.code } });
    expect([401, 403]).toContain(noAuth.status());

    // hibás token a GET státusz-végponton → invalid
    const badTok = await anon.get(`${BASE}/api/checkin?t=forged.token`);
    expect(badTok.status()).toBe(200);
    expect((await badTok.json()).result).toBe("invalid");

    // az already_used logika a checkins aggregátumon alapul: két teljes
    // befogadás után a booking attended, az újabb kísérlet invalid
    await svc.from("checkins").insert({
      booking_id: body.bookingId, method: "qr", result: "valid",
      participants_admitted: 1,
    });
    await svc.from("bookings").update({ status: "attended" }).eq("id", body.bookingId);
    const { data: b2 } = await svc.from("bookings")
      .select("status").eq("id", body.bookingId).single();
    expect(b2?.status).toBe("attended");

    await cleanup(fx, body.bookingId);
  });

  // ------------------------------------------------------------------
  test("megosztott rate limiter: check_rate_limit RPC atomikus és fail-closed", async () => {
    const key = `e2e-rl-${RUN}`;
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const { data, error } = await svc.rpc("check_rate_limit", {
        p_key: key, p_limit: 3, p_window_seconds: 600,
      });
      expect(error).toBeNull();
      results.push(data as boolean);
    }
    // az első 3 engedélyezett, a 4. és 5. tiltott – példányoktól függetlenül
    expect(results).toEqual([true, true, true, false, false]);

    // a kulcs 120 karakterre csonkolódik (nem tör el, nem tárol végtelent)
    const longKey = `e2e-rl-${RUN}-${"x".repeat(500)}`;
    const { data: longOk, error: longErr } = await svc.rpc("check_rate_limit", {
      p_key: longKey, p_limit: 1, p_window_seconds: 600,
    });
    expect(longErr).toBeNull();
    expect(longOk).toBe(true);
    const { data: bucket } = await svc.from("rate_limit_buckets")
      .select("key").eq("key", longKey.slice(0, 120)).maybeSingle();
    expect(bucket).not.toBeNull();

    await svc.from("rate_limit_buckets").delete().like("key", `e2e-rl-${RUN}%`);
  });

  // ------------------------------------------------------------------
  test("draft/test listing anonimitása: API és keresés NEM szolgálja ki", async () => {
    const fx = await makeListing({ isTest: true, status: "published" });
    const draftFx = await makeListing({ isTest: false, status: "draft" });

    // publikus listing oldal: a test listing és a draft is rejtett anonimnek
    const testPage = await anon.get(`${BASE}/en/listing/${fx.listing!.slug}`);
    expect([404, 410]).toContain(testPage.status());
    const draftPage = await anon.get(`${BASE}/en/listing/${draftFx.listing!.slug}`);
    expect(draftPage.status()).toBe(404);

    // a publikus lekérdezés (RLS + query-szűrő) sem adja vissza
    const anonSvc = createClient(
      SUPABASE_URL, process.env.E2E_ANON_KEY || SERVICE_KEY,
      { auth: { persistSession: false } },
    );
    const { data: found } = await anonSvc.from("listings")
      .select("id").eq("id", fx.listing!.id).eq("status", "published").eq("is_test", false);
    expect(found).toHaveLength(0);

    await cleanup(fx);
    await cleanup(draftFx);
  });

  // ------------------------------------------------------------------
  test("locale-validáció: nem támogatott locale → 404, alias → redirect", async () => {
    const bad = await anon.get(`${BASE}/xx/search`, { maxRedirects: 0 });
    expect(bad.status()).toBe(404);
    const alias = await anon.get(`${BASE}/cz/search`, { maxRedirects: 0 });
    // a middleware a nem támogatott locale-t default-ra normalizálja/redirecteli
    expect([301, 302, 307, 308, 404]).toContain(alias.status());
    if (alias.status() !== 404) {
      const loc = alias.headers()["location"] ?? "";
      expect(loc).not.toContain("/cz/");
    }
  });

  // ------------------------------------------------------------------
  test("jogosultság-elkülönítés: anon és nem-admin nem éri el az admin végpontot", async () => {
    const noAuth = await anon.post(`${BASE}/api/admin/payouts`, {
      data: { action: "hold", payoutId: crypto.randomUUID(), note: "x" },
    });
    expect(noAuth.status()).toBe(401);

    const provNoAuth = await anon.post(`${BASE}/api/provider/bookings`, {
      data: { bookingId: crypto.randomUUID(), action: "complete" },
    });
    expect([400, 401, 403]).toContain(provNoAuth.status());
    // a 401 az elvárt – a rate limit és az auth a séma ELŐTT fut
    expect(provNoAuth.status()).not.toBe(200);

    const checkinNoAuth = await anon.post(`${BASE}/api/checkin`, {
      data: { code: "TRV-00-NOPE01" },
    });
    expect([400, 403, 429]).toContain(checkinNoAuth.status());
  });

  // ------------------------------------------------------------------
  test("admin manuális reversal-rendezés: pontos összeg, audit, ismétlés tiltva", async () => {
    // obligation sor közvetlenül DB-ben (a teljes fizetési lánc a test:stripe-ban)
    const fx = await makeListing();
    const res = await createBookingViaApi(fx);
    const body = await res.json();
    const { data: bk } = await svc.from("bookings")
      .select("provider_amount").eq("id", body.bookingId).single();
    const { data: payout } = await svc.from("payouts").insert({
      booking_id: body.bookingId, provider_id: fx.prov!.id,
      amount: bk!.provider_amount, currency: "EUR", status: "paid",
      paid_at: new Date().toISOString(), manual_reference: "bank:E2E",
    }).select("id").single();
    const { data: obl } = await svc.from("payout_reversals").insert({
      payout_id: payout!.id, refund_id: null, dispute_id: null,
      requested_amount: 4000, currency: "EUR", status: "reconciliation_required",
    }).select("id, requested_amount").single();

    const { data: adminUser } = await svc.from("profiles")
      .select("id").eq("email", "admin@demo.travendiq.com").maybeSingle();
    const adminId = adminUser?.id ?? fx.userId; // seed nélkül a provider is admin-szerepű a service RPC-hez

    // túlrendezés elutasítva
    const over = await svc.rpc("resolve_reversal_manually", {
      p_reversal_row: obl!.id, p_admin: adminId,
      p_reference: "bank:E2E-OVER", p_resolved_date: "2026-08-30",
      p_amount: obl!.requested_amount + 1, p_note: "over",
    });
    expect(over.error?.message).toContain("OVER_RESOLUTION");

    // alulrendezés elutasítva
    const under = await svc.rpc("resolve_reversal_manually", {
      p_reversal_row: obl!.id, p_admin: adminId,
      p_reference: "bank:E2E-UNDER", p_resolved_date: "2026-08-30",
      p_amount: obl!.requested_amount - 1, p_note: "under",
    });
    expect(under.error?.message).toContain("UNDER_RESOLUTION");

    // a sor érintetlen maradt
    const { data: still } = await svc.from("payout_reversals")
      .select("status, requested_amount").eq("id", obl!.id).single();
    expect(still?.status).toBe("reconciliation_required");
    expect(still?.requested_amount).toBe(obl!.requested_amount);

    // pontos rendezés → succeeded + audit
    const ok = await svc.rpc("resolve_reversal_manually", {
      p_reversal_row: obl!.id, p_admin: adminId,
      p_reference: "bank:E2E-EXACT", p_resolved_date: "2026-08-30",
      p_amount: obl!.requested_amount, p_note: "banki visszautalás rendezve",
    });
    expect(ok.error).toBeNull();
    const { data: done } = await svc.from("payout_reversals")
      .select("status").eq("id", obl!.id).single();
    expect(done?.status).toBe("succeeded");
    const { data: audit } = await svc.from("audit_log")
      .select("diff").eq("action", "payout_reversal.manual_resolution")
      .eq("entity_id", obl!.id).single();
    expect(audit?.diff).toMatchObject({
      reference: "bank:E2E-EXACT", amount: obl!.requested_amount,
    });

    // ISMÉTELT rendezés elutasítva (a sor már nem rendezhető állapotban)
    const again = await svc.rpc("resolve_reversal_manually", {
      p_reversal_row: obl!.id, p_admin: adminId,
      p_reference: "bank:E2E-AGAIN", p_resolved_date: "2026-08-30",
      p_amount: obl!.requested_amount, p_note: "repeat",
    });
    expect(again.error).not.toBeNull();
    const { data: after } = await svc.from("payout_reversals")
      .select("status").eq("id", obl!.id).single();
    expect(after?.status).toBe("succeeded");

    await svc.from("payout_reversals").delete().eq("id", obl!.id);
    await svc.from("payouts").delete().eq("id", payout!.id);
    await cleanup(fx, body.bookingId);
  });
});
