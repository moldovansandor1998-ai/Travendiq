/**
 * Kapacitás-versenyhelyzet és pénzügyi duplikáció elleni integrációs teszt.
 *
 * Valós Supabase példány kell hozzá (lokál: `supabase start`, vagy teszt projekt).
 * Futtatás:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run test
 *
 * Lefedett követelmények:
 *  1) Kapacitás-verseny: N fős slótra N+M párhuzamos create_booking → pontosan a
 *     kapacitásnak megfelelő számú sikeres foglalás, booked_count sosem megy capacity fölé.
 *  2) Idempotens create_booking: ugyanazzal az idempotencia-kulccsal nem jön létre duplikátum.
 *  3) Dupla fizetés elleni védelem: ugyanarra a bookingra nem hozható létre két aktív
 *     payments sor (payments_booking_uidx, 23505).
 *  4) Dupla kifizetés elleni védelem: két párhuzamos acquire_payout_release közül csak az
 *     egyik nyer; finalize csak 'releasing' állapotból, és csak bizonyítékkal (transfer ID
 *     vagy manuális referencia) engedélyezett.
 *  5) Kifizetés-blokkolás: aktív (pending) refund mellett az acquire PAYOUT_BLOCKED hibát dob.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const LIVE =
  URL.startsWith("http") && !URL.includes("placeholder") && SERVICE_KEY.length > 20;

interface Fixture {
  userId: string;
  providerId: string;
  listingId: string;
  availabilityId: string;
  date: string;
}

describe.skipIf(!LIVE)("integráció: kapacitás-verseny és duplikáció-védelem", () => {
  let svc: SupabaseClient;
  let fx: Fixture;
  const CAPACITY = 4;
  const PARALLEL = 8;

  beforeAll(async () => {
    svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

    // --- fixture: auth user + profil (trigger) ---
    const email = `race-${Date.now()}@travendiq-test.local`;
    const { data: userData, error: userErr } = await svc.auth.admin.createUser({
      email,
      password: `Race-${Date.now()}-Pass!`,
      email_confirm: true,
    });
    if (userErr || !userData.user) throw new Error(`fixture user: ${userErr?.message}`);
    const userId = userData.user.id;

    // --- fixture: provider ---
    const { data: provider, error: provErr } = await svc
      .from("providers")
      .insert({
        owner_id: userId,
        legal_name: "Race Test Kft.",
        display_name: "Race Test Provider",
        country_code: "EG",
        status: "approved",
      })
      .select("id")
      .single();
    if (provErr || !provider) throw new Error(`fixture provider: ${provErr?.message}`);

    // --- fixture: listing (seed által adott város + kategória) ---
    const { data: city } = await svc
      .from("cities")
      .select("id")
      .eq("country_code", "EG")
      .eq("slug", "hurghada")
      .single();
    const { data: category } = await svc.from("categories").select("id").limit(1).single();
    if (!city || !category) throw new Error("fixture: hiányzó seed (cities/categories)");

    const slug = `race-test-${Date.now()}`;
    const { data: listing, error: listErr } = await svc
      .from("listings")
      .insert({
        provider_id: provider.id,
        category_id: category.id,
        country_code: "EG",
        city_id: city.id,
        slug,
        status: "published",
        is_test: true,
        base_price_adult: 5000,
        currency: "EUR",
        min_participants: 1,
        max_participants: 50,
      })
      .select("id")
      .single();
    if (listErr || !listing) throw new Error(`fixture listing: ${listErr?.message}`);

    // --- fixture: 4 fős slót holnapra ---
    const date = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: slot, error: slotErr } = await svc
      .from("availability")
      .insert({
        listing_id: listing.id,
        option_id: null,
        date,
        start_time: "09:00",
        capacity: CAPACITY,
      })
      .select("id")
      .single();
    if (slotErr || !slot) throw new Error(`fixture slot: ${slotErr?.message}`);

    fx = { userId, providerId: provider.id, listingId: listing.id, availabilityId: slot.id, date };
  }, 60_000);

  afterAll(async () => {
    if (!svc || !fx) return;
    // törlési sorrend a FK-k miatt
    await svc.from("payouts").delete().eq("provider_id", fx.providerId);
    await svc.from("bookings").delete().eq("listing_id", fx.listingId);
    await svc.from("availability").delete().eq("listing_id", fx.listingId);
    await svc.from("listings").delete().eq("id", fx.listingId);
    await svc.from("providers").delete().eq("id", fx.providerId);
    await svc.auth.admin.deleteUser(fx.userId);
  }, 60_000);

  const bookOnce = (key: string) =>
    svc.rpc("create_booking", {
      p_listing: fx.listingId,
      p_option: null,
      p_date: fx.date,
      p_start_time: "09:00",
      p_adults: 1,
      p_children: 0,
      p_infants: 0,
      p_user: null,
      p_guest_email: `guest-${key}@example.com`,
      p_customer_locale: "en",
      p_lead_name: "Race Guest",
      p_lead_email: `guest-${key}@example.com`,
      p_lead_phone: null,
      p_hotel: null,
      p_pickup: null,
      p_special: null,
      p_coupon_code: null,
      p_idempotency_key: key,
    });

  it("1) kapacitás-verseny: 8 párhuzamos foglalásból pontosan 4 sikerül, túlfoglalás nélkül", async () => {
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) => bookOnce(`race-key-${i}-${Date.now()}`)),
    );

    const succeeded = results.filter((r) => !r.error && r.data);
    const failed = results.filter((r) => r.error);

    expect(succeeded.length).toBe(CAPACITY);
    expect(failed.length).toBe(PARALLEL - CAPACITY);
    for (const f of failed) {
      expect(f.error?.message ?? "").toContain("NOT_ENOUGH_CAPACITY");
    }

    // a végállapot sosem lépheti túl a kapacitást
    const { data: slot } = await svc
      .from("availability")
      .select("booked_count, capacity")
      .eq("id", fx.availabilityId)
      .single();
    expect(slot?.booked_count).toBe(CAPACITY);
    expect(slot?.booked_count ?? 0).toBeLessThanOrEqual(slot?.capacity ?? 0);
  }, 60_000);

  it("2) idempotencia: ugyanaz a kulcs kétszer → ugyanaz a booking, nincs duplikátum", async () => {
    // új slót, hogy az 1) teszt telítettsége ne zavarjon
    const { data: slot } = await svc
      .from("availability")
      .insert({
        listing_id: fx.listingId,
        option_id: null,
        date: fx.date,
        start_time: "14:00",
        capacity: 10,
      })
      .select("id")
      .single();

    const key = `idem-${Date.now()}`;
    const first = await svc.rpc("create_booking", {
      p_listing: fx.listingId,
      p_option: null,
      p_date: fx.date,
      p_start_time: "14:00",
      p_adults: 2,
      p_children: 0,
      p_infants: 0,
      p_user: null,
      p_guest_email: "idem@example.com",
      p_customer_locale: "en",
      p_lead_name: "Idem Guest",
      p_lead_email: "idem@example.com",
      p_lead_phone: null,
      p_hotel: null,
      p_pickup: null,
      p_special: null,
      p_coupon_code: null,
      p_idempotency_key: key,
    });
    const second = await svc.rpc("create_booking", {
      p_listing: fx.listingId,
      p_option: null,
      p_date: fx.date,
      p_start_time: "14:00",
      p_adults: 2,
      p_children: 0,
      p_infants: 0,
      p_user: null,
      p_guest_email: "idem@example.com",
      p_customer_locale: "en",
      p_lead_name: "Idem Guest",
      p_lead_email: "idem@example.com",
      p_lead_phone: null,
      p_hotel: null,
      p_pickup: null,
      p_special: null,
      p_coupon_code: null,
      p_idempotency_key: key,
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data); // ugyanaz a booking id

    const { data: slotAfter } = await svc
      .from("availability")
      .select("booked_count")
      .eq("id", slot!.id)
      .single();
    expect(slotAfter?.booked_count).toBe(2); // csak egyszer foglalt helyet
  }, 60_000);

  it("3) dupla fizetés: második aktív payments sort az unique index elutasítja", async () => {
    const { data: booking } = await svc
      .from("bookings")
      .select("id, grand_total, currency")
      .eq("listing_id", fx.listingId)
      .limit(1)
      .single();
    expect(booking).toBeTruthy();

    const first = await svc.from("payments").insert({
      booking_id: booking!.id,
      status: "captured",
      amount: booking!.grand_total,
      currency: booking!.currency,
      provider_payment_id: `pi_race_first_${Date.now()}`,
    });
    expect(first.error).toBeNull();

    const second = await svc.from("payments").insert({
      booking_id: booking!.id,
      status: "requires_payment",
      amount: booking!.grand_total,
      currency: booking!.currency,
      provider_payment_id: `pi_race_second_${Date.now()}`,
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505"); // unique violation
  }, 60_000);

  it("4) dupla kifizetés: párhuzamos acquire közül csak egy nyer, finalize csak bizonyítékkal", async () => {
    const { data: booking } = await svc
      .from("bookings")
      .select("id, provider_amount, currency")
      .eq("listing_id", fx.listingId)
      .limit(1)
      .single();

    const { data: payout, error: payoutErr } = await svc
      .from("payouts")
      .insert({
        provider_id: fx.providerId,
        booking_id: booking!.id,
        amount: booking!.provider_amount,
        currency: booking!.currency,
        status: "scheduled",
      })
      .select("id")
      .single();
    expect(payoutErr).toBeNull();

    // két párhuzamos acquire — csak az egyik kaphat sort vissza
    const [a, b] = await Promise.all([
      svc.rpc("acquire_payout_release", { p_payout: payout!.id, p_actor: fx.userId }),
      svc.rpc("acquire_payout_release", { p_payout: payout!.id, p_actor: fx.userId }),
    ]);
    const winners = [a, b].filter((r) => !r.error && Array.isArray(r.data) && r.data.length === 1);
    const losers = [a, b].filter((r) => !r.error && Array.isArray(r.data) && r.data.length === 0);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);

    // finalize bizonyíték nélkül → PROOF_REQUIRED
    const noProof = await svc.rpc("finalize_payout_release", {
      p_payout: payout!.id,
      p_actor: fx.userId,
      p_transfer_id: null,
      p_manual_reference: null,
      p_manual_note: null,
    });
    expect(noProof.error?.message ?? "").toContain("PROOF_REQUIRED");

    // finalize bizonyítékkal → ok, pontosan egyszer
    const fin = await svc.rpc("finalize_payout_release", {
      p_payout: payout!.id,
      p_actor: fx.userId,
      p_transfer_id: `tr_race_${Date.now()}`,
      p_manual_reference: null,
      p_manual_note: null,
    });
    expect(fin.error).toBeNull();

    const { data: payoutAfter } = await svc
      .from("payouts")
      .select("status")
      .eq("id", payout!.id)
      .single();
    expect(payoutAfter?.status).toBe("paid");

    // második finalize már nem lehet sikeres (nincs 'releasing' állapotban)
    const fin2 = await svc.rpc("finalize_payout_release", {
      p_payout: payout!.id,
      p_actor: fx.userId,
      p_transfer_id: `tr_race_dup_${Date.now()}`,
      p_manual_reference: null,
      p_manual_note: null,
    });
    expect(fin2.error).not.toBeNull();
  }, 60_000);

  it("5) kifizetés-blokkolás: aktív refund mellett az acquire PAYOUT_BLOCKED-et dob", async () => {
    const { data: booking } = await svc
      .from("bookings")
      .select("id, provider_amount, currency")
      .eq("listing_id", fx.listingId)
      .limit(1)
      .single();

    const { data: refund, error: refundErr } = await svc
      .from("refunds")
      .insert({
        booking_id: booking!.id,
        amount: 100,
        currency: booking!.currency,
        status: "pending",
        reason: "race-test",
      })
      .select("id")
      .single();
    expect(refundErr).toBeNull();

    const { data: payout } = await svc
      .from("payouts")
      .insert({
        provider_id: fx.providerId,
        booking_id: booking!.id,
        amount: booking!.provider_amount,
        currency: booking!.currency,
        status: "scheduled",
      })
      .select("id")
      .single();

    const blocked = await svc.rpc("acquire_payout_release", {
      p_payout: payout!.id,
      p_actor: fx.userId,
    });
    expect(blocked.error?.message ?? "").toContain("PAYOUT_BLOCKED");

    await svc.from("refunds").delete().eq("id", refund!.id);
    await svc.from("payouts").delete().eq("id", payout!.id);
  }, 60_000);
});
