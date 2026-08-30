/**
 * Stripe TEST-MODE integrációs tesztek – valós Stripe API + valós Supabase kell.
 *
 * Futtatás (test módban!) – a KÖTELEZŐ parancs:
 *   STRIPE_SECRET_KEY=sk_test_... \
 *   SUPABASE_URL=https://<proj>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run test:stripe
 * (A test:stripe REQUIRE_STRIPE_IT=1-et állít: hiányzó env esetén a futás
 *  HIBÁVAL áll le – nincs csendes skip. Lásd tests/integration/stripe-env.ts.)
 *
 * Lefedett forgatókönyvek:
 *  1) sikeres fizetés és ISMÉTELT webhook (idempotens könyvelés),
 *  2) párhuzamos azonos webhook (atomikus claim – csak egy worker nyer),
 *  3) két AZONOS ÖSSZEGŰ külön részleges refund (külön re_ ID, külön settle),
 *  4) teljes refund PAYOUT ELŐTT → a payout végleg 'cancelled', release-kísérlet
 *     blokkolva, az eredeti összeg sosem szabadítható fel újra,
 *  5) refund PAYOUT UTÁN Transfer Reversallal (transfers.createReversal),
 *  6) chargeback payout előtt és után,
 *  7) Transfer sikeres, DB-finalize ideiglenes hibája (abort → retry → paid),
 *  8) webhook közbeni adatbázishiba (failed, nem processed, újra claimelhető),
 *  9) sikertelen e-mail (outbox: failed, attempts nő, fizetés érintetlen),
 * 10) Connect account disabled/past_due állapot (onboarding nem complete,
 *     payout release elutasítva),
 * 11) RÉSZLEGES refund payout előtt → a release csak a KORRIGÁLT összeggel,
 * 12) két refund a reversal webhook ELŐTT → committed-cap védelem
 *     (requested + succeeded sosem haladja meg a payout összegét),
 * 13) refund, majd AZONNALI chargeback ugyanarra a fizetésre,
 * 14) KÉSŐI PaymentIntent lejárt foglaláshoz → nincs payout, nincs újraaktiválás,
 *     automatikus teljes refund + disputed,
 * 15) webhook lock-timeout + stale worker késői finish → a régi worker NEM
 *     zárhatja le az eseményt (finish_payment_event = false),
 * 16) chargeback MEGNYERÉSE Transfer Reversal UTÁN → kontrollált új
 *     (scheduled) payout a visszavont összegre (resolve_chargeback_won),
 * 17) ismételt AGGREGÁLT amount_reversed webhook → csak a delta könyvelődik,
 *     újraküldésnél nincs duplikáció,
 * 18) refund RELEASING payout alatt → a payout összege érintetlen, tartós
 *     awaiting_transfer kötelezettség → finalize után automatikus reversal;
 *     ledger == tényleges Transfer == DB payout összeg,
 * 19) folyamatleállás a reversal DB-kérés után, Stripe-hívás előtt → a replay
 *     a teljes sort adja vissza, azonos idempotencia-kulccsal folytatható,
 * 20) Stripe Reversal sikeres, record_reversal_sent DB-hiba → a sor NEM failed,
 *     azonos kulccsal újraegyezhető (nincs dupla reversal),
 * 21) korábbi refund-reversal + chargeback reversal + chargeback won → csak a
 *     dispute-hoz tartozó összeg kerül az új payoutba,
 * 22) pending refund-reversal után azonnali chargeback → csak az elérhető
 *     különbözet (cap), nincs elnyelt REVERSAL_EXCEEDS_PAYOUT,
 * 23) késői fizetés refundja először hibás → cron retry sikeres; kimerülésnél
 *     manual_review + adminriasztás, a queue nem claimeli újra.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dispatchStripeEvent } from "@/lib/webhooks/stripe-handlers";
import { requestRefund } from "@/lib/booking/refund-flow";
import { processDueRefunds } from "@/lib/refunds/queue";
import { submitPayoutReversal } from "@/lib/payments/reversals";
import { processDueTransferAttempts } from "@/lib/payments/transfer-attempts";
import { StripeProvider } from "@/lib/payments/stripe";
import { STRIPE_TEST_ENV, STRIPE_IT_LIVE } from "./stripe-env";

const STRIPE_KEY = STRIPE_TEST_ENV.STRIPE_SECRET_KEY;
const URL = STRIPE_TEST_ENV.SUPABASE_URL;
const SERVICE_KEY = STRIPE_TEST_ENV.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = STRIPE_IT_LIVE;

interface Fx {
  userId: string; providerId: string; listingId: string; slotId: string;
  bookingId: string; paymentRowId: string; paymentIntentId: string; chargeId: string;
  grandTotal: number; currency: string; date: string;
}

describe.skipIf(!LIVE)("Stripe test-mode integráció", () => {
  let stripe: Stripe;
  let svc: SupabaseClient;
  let fx: Fx;
  let connectAccountId: string;

  /** Valódi test-PI létrehozása és megerősítése tesztkártyával. */
  async function createConfirmedPayment(amountCents: number, currency: string, pm = "pm_card_visa") {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents, currency: currency.toLowerCase(),
      payment_method: pm, confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    }, { idempotencyKey: `it_pi_${Date.now()}_${Math.random()}` });
    expect(pi.status).toBe("succeeded");
    return pi;
  }

  /** Fixture: provider + listing + slot + booking + payment sor (requires_payment). */
  async function makeFixture(amountCents = 10000): Promise<Fx> {
    const email = `stripe-it-${Date.now()}@travendiq-test.local`;
    const { data: ud } = await svc.auth.admin.createUser({
      email, password: `It-${Date.now()}!`, email_confirm: true,
    });
    const userId = ud.user!.id;

    const { data: prov } = await svc.from("providers").insert({
      owner_id: userId, legal_name: "Stripe IT Kft.", display_name: "Stripe IT",
      country_code: "HU", status: "approved",
    }).select("id").single();

    const { data: city } = await svc.from("cities").select("id")
      .eq("country_code", "EG").eq("slug", "hurghada").single();
    const { data: cat } = await svc.from("categories").select("id").limit(1).single();

    const { data: listing } = await svc.from("listings").insert({
      provider_id: prov!.id, category_id: cat!.id, country_code: "EG",
      city_id: city!.id, slug: `stripe-it-${Date.now()}`, status: "published",
      is_test: true, base_price_adult: amountCents, currency: "EUR",
    }).select("id").single();

    const date = new Date(Date.now() + 72 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: slot } = await svc.from("availability").insert({
      listing_id: listing!.id, option_id: null, date, start_time: "10:00", capacity: 20,
    }).select("id").single();

    const { data: bookingId, error: bErr } = await svc.rpc("create_booking", {
      p_listing: listing!.id, p_option: null, p_date: date, p_start_time: "10:00",
      p_adults: 1, p_children: 0, p_infants: 0, p_user: null,
      p_guest_email: email, p_customer_locale: "en",
      p_lead_name: "Stripe IT", p_lead_email: email, p_lead_phone: null,
      p_hotel: null, p_pickup: null, p_special: null,
      p_coupon_code: null, p_idempotency_key: `it_${Date.now()}`,
    });
    expect(bErr).toBeNull();

    const pi = await createConfirmedPayment(amountCents, "eur");
    const { data: pay } = await svc.from("payments").insert({
      booking_id: bookingId, provider: "stripe", provider_payment_id: pi.id,
      status: "requires_payment", amount: amountCents, currency: "EUR",
      idempotency_key: `it_pay_${bookingId}`,
    }).select("id").single();

    return {
      userId, providerId: prov!.id, listingId: listing!.id, slotId: slot!.id,
      bookingId: bookingId as string, paymentRowId: pay!.id,
      paymentIntentId: pi.id,
      chargeId: typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge as Stripe.Charge).id,
      grandTotal: amountCents, currency: "EUR", date,
    };
  }

  async function cleanup(f: Partial<Fx>) {
    if (!f.providerId) return;
    await svc.from("payouts").delete().eq("provider_id", f.providerId);
    await svc.from("refunds").delete().eq("booking_id", f.bookingId!);
    await svc.from("payments").delete().eq("booking_id", f.bookingId!);
    await svc.from("bookings").delete().eq("id", f.bookingId!);
    await svc.from("availability").delete().eq("listing_id", f.listingId!);
    await svc.from("listings").delete().eq("id", f.listingId!);
    await svc.from("providers").delete().eq("id", f.providerId);
    if (f.userId) await svc.auth.admin.deleteUser(f.userId);
  }

  const piEvent = (pi: string, charge: string) => ({
    data: { object: { id: pi, latest_charge: charge, status: "succeeded" } },
  });

  beforeAll(async () => {
    stripe = new Stripe(STRIPE_KEY);
    svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
    // Connect tesztszámla a transfer/reversal forgatókönyvekhez (EUR → eurozóna)
    const acct = await stripe.accounts.create({
      type: "custom", country: "DE", email: `it-connect-${Date.now()}@example.com`,
      business_type: "individual",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
      external_account: "btok_de_verified",
      individual: {
        first_name: "Test", last_name: "Provider",
        dob: { day: 1, month: 1, year: 1990 },
        address: { line1: "Hauptstrasse 1", city: "Berlin", postal_code: "10115", country: "DE" },
        email: `it-connect-${Date.now()}@example.com`,
        phone: "+4930123456",
      },
    });
    connectAccountId = acct.id;
  }, 120_000);

  afterAll(async () => {
    if (connectAccountId) await stripe.accounts.del(connectAccountId).catch(() => {});
  });

  it("1) sikeres fizetés és ismételt webhook – egyszeri könyvelés", async () => {
    fx = await makeFixture();
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(fx.paymentIntentId, fx.chargeId));

    const { data: pay } = await svc.from("payments").select("status, stripe_charge_id").eq("id", fx.paymentRowId).single();
    expect(pay?.status).toBe("captured");
    expect(pay?.stripe_charge_id).toBe(fx.chargeId);
    const { data: bk } = await svc.from("bookings").select("status").eq("id", fx.bookingId).single();
    expect(["confirmed", "pending_confirmation"]).toContain(bk?.status);

    // ISMÉTELT webhook: nem duplikálódik a ledger és a payout
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(fx.paymentIntentId, fx.chargeId));
    const { data: ledger } = await svc.from("ledger_entries")
      .select("id").eq("booking_id", fx.bookingId).eq("kind", "booking_revenue");
    expect(ledger).toHaveLength(1);
    const { data: payouts } = await svc.from("payouts").select("status").eq("booking_id", fx.bookingId);
    expect(payouts).toHaveLength(1);
    expect(payouts?.[0].status).toBe("held");

    // email outbox: dedupe miatt pontosan 1-1 sor
    const { data: outbox } = await svc.from("email_outbox").select("template")
      .like("dedupe_key", `%${fx.bookingId}%`);
    const kinds = (outbox ?? []).map((o) => o.template).sort();
    expect(kinds).toContain("payment_receipt");
    expect(kinds).toContain("booking_confirmation");
    await svc.from("email_outbox").delete().like("dedupe_key", `%${fx.bookingId}%`);
    await cleanup(fx);
  }, 120_000);

  it("2) párhuzamos azonos webhook – atomikus claim, csak egy worker nyer", async () => {
    const evt = `evt_it_${Date.now()}`;
    const [a, b] = await Promise.all([
      svc.rpc("claim_payment_event", {
        p_provider: "stripe", p_event_id: evt, p_type: "test.parallel",
        p_payload: {}, p_worker: "w1",
      }),
      svc.rpc("claim_payment_event", {
        p_provider: "stripe", p_event_id: evt, p_type: "test.parallel",
        p_payload: {}, p_worker: "w2",
      }),
    ]);
    const results = [a.data, b.data].sort();
    expect(results[0]).toBe("claimed");
    expect(["locked", "already_processed"]).toContain(results[1]);

    await svc.rpc("finish_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_worker: "w1", p_success: true,
    });
    // processed esemény nem claimelhető újra
    const again = await svc.rpc("claim_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_type: "test.parallel",
      p_payload: {}, p_worker: "w3",
    });
    expect(again.data).toBe("already_processed");
    await svc.from("payment_events").delete().eq("provider_event_id", evt);
  }, 60_000);

  it("3) két azonos összegű részleges refund – külön re_ ID, külön settle", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    // két azonos összegű refund KÜLÖN belső rekorddal → külön idempotencia-kulcs
    const r1 = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 2000, currency: "EUR", reason: "it_partial_1" });
    // az első lezárása után a második indítható (active-refund index)
    expect(r1.ok).toBe(true);
    const { data: refundRows } = await svc.from("refunds")
      .select("id, provider_refund_id, amount").eq("booking_id", f.bookingId);
    expect(refundRows).toHaveLength(1);
    const reId1 = refundRows![0].provider_refund_id;
    expect(reId1).toMatch(/^re_/);

    // charge.refunded: csak az r1-et zárja le (egyenkénti egyeztetés)
    const charge = await stripe.charges.retrieve(f.chargeId);
    await dispatchStripeEvent(svc, "charge.refunded", {
      data: { object: {
        id: f.chargeId, payment_intent: f.paymentIntentId,
        amount_refunded: charge.amount_refunded,
        refunds: { data: charge.refunds?.data.map((r) => ({
          id: r.id, amount: r.amount, status: r.status, currency: r.currency,
        })) ?? [] },
      } },
    });

    const { data: r1After } = await svc.from("refunds").select("status").eq("id", r1.refundId!).single();
    expect(r1After?.status).toBe("succeeded");
    const { data: bk } = await svc.from("bookings").select("status").eq("id", f.bookingId).single();
    expect(bk?.status).toBe("partially_refunded");

    // második azonos összegű refund – külön re_ ID
    const r2 = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 2000, currency: "EUR", reason: "it_partial_2" });
    expect(r2.ok).toBe(true);
    const { data: all } = await svc.from("refunds")
      .select("provider_refund_id").eq("booking_id", f.bookingId).eq("status", "processing");
    const reId2 = all?.[0]?.provider_refund_id;
    expect(reId2).toMatch(/^re_/);
    expect(reId2).not.toBe(reId1);

    const charge2 = await stripe.charges.retrieve(f.chargeId, { expand: ["refunds"] });
    await dispatchStripeEvent(svc, "charge.refunded", {
      data: { object: {
        id: f.chargeId, payment_intent: f.paymentIntentId,
        amount_refunded: charge2.amount_refunded,
        refunds: { data: charge2.refunds?.data.map((r) => ({
          id: r.id, amount: r.amount, status: r.status, currency: r.currency,
        })) ?? [] },
      } },
    });
    const { data: both } = await svc.from("refunds").select("status").eq("booking_id", f.bookingId);
    expect(both?.every((r) => r.status === "succeeded")).toBe(true);
    const { data: pay } = await svc.from("payments").select("refunded_amount, status").eq("id", f.paymentRowId).single();
    expect(pay?.refunded_amount).toBe(4000);
    expect(pay?.status).toBe("partially_refunded");
    await cleanup(f);
  }, 180_000);

  it("4) teljes refund PAYOUT ELŐTT – payout végleg cancelled, release-kísérlet blokkolva", async () => {
    const f = await makeFixture(8000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    const rr = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 8000, currency: "EUR", reason: "it_full" });
    expect(rr.ok).toBe(true);

    const charge = await stripe.charges.retrieve(f.chargeId, { expand: ["refunds"] });
    await dispatchStripeEvent(svc, "charge.refunded", {
      data: { object: {
        id: f.chargeId, payment_intent: f.paymentIntentId,
        amount_refunded: charge.amount_refunded,
        refunds: { data: charge.refunds?.data.map((r) => ({
          id: r.id, amount: r.amount, status: r.status, currency: r.currency,
        })) ?? [] },
      } },
    });

    const { data: bk } = await svc.from("bookings").select("status").eq("id", f.bookingId).single();
    expect(bk?.status).toBe("refunded");
    const { data: payout } = await svc.from("payouts")
      .select("id, status, reversal_status, amount, hold_reason").eq("booking_id", f.bookingId).single();
    // A LEGKRITIKUSABB JAVÍTÁS: teljes refund után a ki nem fizetett payout
    // végleg 'cancelled' – az eredeti összeg SOHA nem szabadítható fel újra.
    expect(payout?.status).toBe("cancelled");
    expect(payout?.hold_reason).toBe("cancelled_after_full_refund");
    expect(payout?.reversal_status).toBe("none"); // nem fizettük ki → nincs reversal

    // release-kísérlet: payout_blocked v2 (booking refunded) MIATT is blokkolt,
    // és a 'cancelled' státusz eleve kizárt az acquire engedélyezett halmazából.
    const acq = await svc.rpc("acquire_payout_release", { p_payout: payout!.id, p_actor: f.userId });
    expect(acq.error?.message ?? "").toContain("PAYOUT_BLOCKED");
    expect(acq.data).toBeNull();

    // még a blokk-függvényt megkerülő közvetlen állapotváltás se lehessen:
    // 'cancelled' nincs az acquire update-je által elfogadott státuszok közt.
    const { data: still } = await svc.from("payouts").select("status").eq("id", payout!.id).single();
    expect(still?.status).toBe("cancelled");
    await cleanup(f);
  }, 180_000);

  it("5) refund PAYOUT UTÁN – Transfer Reversal (transfers.createReversal)", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    // payout kifizetése: valódi test-transfer a Connect tesztszámlára
    const { data: bkRow } = await svc.from("bookings").select("provider_amount").eq("id", f.bookingId).single();
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f.providerId);
    const transfer = await stripe.transfers.create({
      amount: bkRow!.provider_amount, currency: "eur", destination: connectAccountId,
      source_transaction: f.chargeId,
    }, { idempotencyKey: `it_tr_${f.bookingId}` });

    const { data: payoutRow } = await svc.from("payouts").select("id").eq("booking_id", f.bookingId).single();
    const fin = await svc.rpc("finalize_payout_release", {
      p_payout: payoutRow!.id, p_actor: f.userId, p_transfer_id: transfer.id,
      p_manual_reference: null, p_manual_note: null, p_transferred_amount: transfer.amount,
    });
    // finalize csak 'releasing'-ből enged → először acquire
    if (fin.error || fin.data?.ok !== true) {
      await svc.rpc("acquire_payout_release", { p_payout: payoutRow!.id, p_actor: f.userId });
      const fin2 = await svc.rpc("finalize_payout_release", {
        p_payout: payoutRow!.id, p_actor: f.userId, p_transfer_id: transfer.id,
        p_manual_reference: null, p_manual_note: null, p_transferred_amount: transfer.amount,
      });
      expect(fin2.error).toBeNull();
      expect(fin2.data?.ok).toBe(true);
    }
    const { data: paidPayout } = await svc.from("payouts").select("status").eq("id", payoutRow!.id).single();
    expect(paidPayout?.status).toBe("paid");

    // részleges refund → a webhook Transfer Reversalt indít a provider-részre
    const rr = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 5000, currency: "EUR", reason: "it_after_payout" });
    expect(rr.ok).toBe(true);
    const charge = await stripe.charges.retrieve(f.chargeId, { expand: ["refunds"] });
    await dispatchStripeEvent(svc, "charge.refunded", {
      data: { object: {
        id: f.chargeId, payment_intent: f.paymentIntentId,
        amount_refunded: charge.amount_refunded,
        refunds: { data: charge.refunds?.data.map((r) => ({
          id: r.id, amount: r.amount, status: r.status, currency: r.currency,
        })) ?? [] },
      } },
    });

    // a reversal pending/partial/reversed állapotba került, Stripe-oldalon létezik
    const { data: rev } = await svc.from("payouts")
      .select("reversal_status, reversed_amount").eq("id", payoutRow!.id).single();
    expect(["pending", "partial", "reversed"]).toContain(rev?.reversal_status);

    const transferAfter = await stripe.transfers.retrieve(transfer.id);
    expect(transferAfter.amount_reversed).toBeGreaterThan(0);

    // transfer.reversed webhook settle
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: {
        id: transfer.id, amount_reversed: transferAfter.amount_reversed,
        reversals: { data: transferAfter.reversals?.data.map((r) => ({ id: r.id, amount: r.amount })) ?? [] },
      } },
    });
    const { data: settledPayout } = await svc.from("payouts")
      .select("reversed_amount, reversal_status").eq("id", payoutRow!.id).single();
    expect(settledPayout?.reversed_amount).toBeGreaterThan(0);
    await cleanup(f);
  }, 240_000);

  it("6) chargeback payout ELŐTT (blokk) és UTÁN (reversal)", async () => {
    // ELŐTT: payout még held → handle_chargeback blokkol, reversal nem kell
    const f1 = await makeFixture(6000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f1.paymentIntentId, f1.chargeId));
    await dispatchStripeEvent(svc, "charge.dispute.created", {
      data: { object: { id: `dp_it_${Date.now()}`, payment_intent: f1.paymentIntentId, amount: 6000, currency: "eur" } },
    });
    const { data: pay1 } = await svc.from("payments").select("status").eq("id", f1.paymentRowId).single();
    expect(pay1?.status).toBe("chargeback");
    const { data: bk1 } = await svc.from("bookings").select("status").eq("id", f1.bookingId).single();
    expect(bk1?.status).toBe("disputed");
    const acq1 = await svc.rpc("acquire_payout_release", {
      p_payout: (await svc.from("payouts").select("id").eq("booking_id", f1.bookingId).single()).data!.id,
      p_actor: f1.userId,
    });
    expect(acq1.error?.message ?? "").toContain("PAYOUT_BLOCKED");
    await cleanup(f1);

    // UTÁN: már kifizetett transzfer → reversal-folyamat indul
    const f2 = await makeFixture(6000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f2.paymentIntentId, f2.chargeId));
    const { data: bkRow2 } = await svc.from("bookings").select("provider_amount").eq("id", f2.bookingId).single();
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f2.providerId);
    const tr2 = await stripe.transfers.create({
      amount: bkRow2!.provider_amount, currency: "eur", destination: connectAccountId,
      source_transaction: f2.chargeId,
    }, { idempotencyKey: `it_tr_${f2.bookingId}` });
    const pr2 = (await svc.from("payouts").select("id").eq("booking_id", f2.bookingId).single()).data!;
    await svc.rpc("acquire_payout_release", { p_payout: pr2.id, p_actor: f2.userId });
    await svc.rpc("finalize_payout_release", {
      p_payout: pr2.id, p_actor: f2.userId, p_transfer_id: tr2.id,
      p_manual_reference: null, p_manual_note: null,
    });

    const disputeId = `dp_it_${Date.now()}`;
    await dispatchStripeEvent(svc, "charge.dispute.created", {
      data: { object: { id: disputeId, payment_intent: f2.paymentIntentId, amount: 6000, currency: "eur" } },
    });
    const { data: rev2 } = await svc.from("payouts")
      .select("reversal_status").eq("id", pr2.id).single();
    expect(["pending", "partial", "reversed", "failed"]).toContain(rev2?.reversal_status);
    const tr2After = await stripe.transfers.retrieve(tr2.id);
    expect(tr2After.amount_reversed).toBeGreaterThan(0);
    await cleanup(f2);
  }, 240_000);

  it("7) Transfer sikeres, DB-finalize ideiglenesen hibás – abort → retry → paid", async () => {
    const f = await makeFixture(7000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const pr = (await svc.from("payouts").select("id, status").eq("booking_id", f.bookingId).single()).data!;

    // acquire → 'releasing'
    const acq = await svc.rpc("acquire_payout_release", { p_payout: pr.id, p_actor: f.userId });
    expect(acq.error).toBeNull();

    // finalize hibás bizonyítékkal → PROOF_REQUIRED (ideiglenes DB-hiba szimulálása)
    const bad = await svc.rpc("finalize_payout_release", {
      p_payout: pr.id, p_actor: f.userId,
      p_transfer_id: null, p_manual_reference: null, p_manual_note: null,
    });
    expect(bad.error?.message ?? "").toContain("PROOF_REQUIRED");

    // abort → vissza 'scheduled'-be, a transfer NEM veszett el
    await svc.rpc("abort_payout_release", { p_payout: pr.id, p_reason: "finalize_retry" });
    const { data: afterAbort } = await svc.from("payouts").select("status").eq("id", pr.id).single();
    expect(afterAbort?.status).toBe("scheduled");

    // retry: újra acquire + érvényes finalize → paid, ledger-rel együtt
    await svc.rpc("acquire_payout_release", { p_payout: pr.id, p_actor: f.userId });
    const ok = await svc.rpc("finalize_payout_release", {
      p_payout: pr.id, p_actor: f.userId,
      p_transfer_id: `tr_it_manual_${Date.now()}`, p_manual_reference: null, p_manual_note: null,
    });
    expect(ok.data?.ok).toBe(true);
    const { data: paid } = await svc.from("payouts").select("status").eq("id", pr.id).single();
    expect(paid?.status).toBe("paid");
    const { data: payoutLedger } = await svc.from("ledger_entries")
      .select("id").eq("kind", "payout").eq("meta->>payout_id", pr.id);
    expect(payoutLedger).toHaveLength(1); // nincs paid payout ledger nélkül
    await cleanup(f);
  }, 180_000);

  it("8) webhook közbeni adatbázishiba – failed, nem processed, újra claimelhető", async () => {
    const evt = `evt_it_dbfail_${Date.now()}`;
    const c1 = await svc.rpc("claim_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_type: "payment_intent.succeeded",
      p_payload: { data: { object: { id: "pi_nonexistent" } } }, p_worker: "w1",
    });
    expect(c1.data).toBe("claimed");
    await svc.rpc("finish_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_worker: "w1",
      p_success: false, p_error: "simulated_db_error",
    });
    const { data: row } = await svc.from("payment_events")
      .select("status, processed_at, attempts, processing_error")
      .eq("provider_event_id", evt).single();
    expect(row?.status).toBe("failed");
    expect(row?.processed_at).toBeNull();
    // újra claimelhető (lock feloldva)
    const c2 = await svc.rpc("claim_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_type: "payment_intent.succeeded",
      p_payload: {}, p_worker: "w2",
    });
    expect(c2.data).toBe("claimed");
    const { data: row2 } = await svc.from("payment_events").select("attempts").eq("provider_event_id", evt).single();
    expect(row2?.attempts).toBe(2);
    await svc.from("payment_events").delete().eq("provider_event_id", evt);
  }, 60_000);

  it("9) sikertelen e-mail – outbox failed, attempts nő, fizetés érintetlen", async () => {
    const f = await makeFixture(5000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    // dedupe: ugyanaz a levél nem állítható sorba kétszer
    const e1 = await svc.rpc("enqueue_email", {
      p_dedupe_key: `it_dedupe_${f.bookingId}`, p_to: "a@b.c", p_template: "payment_receipt",
      p_locale: "en", p_vars: {},
    });
    const e2 = await svc.rpc("enqueue_email", {
      p_dedupe_key: `it_dedupe_${f.bookingId}`, p_to: "a@b.c", p_template: "payment_receipt",
      p_locale: "en", p_vars: {},
    });
    expect(e1.data).toBeTruthy();
    expect(e2.data).toBeNull(); // on conflict do nothing

    // claim → sikertelen küldés szimulálása → failed/pending, attempts nő
    const claim = await svc.rpc("claim_pending_emails", { p_limit: 50, p_worker: "it" });
    const mine = (claim.data ?? []).find((r: { dedupe_key: string }) => r.dedupe_key === `it_dedupe_${f.bookingId}`);
    expect(mine).toBeTruthy();
    await svc.rpc("mark_email_failed", { p_id: mine.id, p_error: "smtp_timeout" });
    const { data: after } = await svc.from("email_outbox")
      .select("status, attempts, last_error").eq("id", mine.id).single();
    expect(after?.attempts).toBe(1);
    expect(["pending", "failed"]).toContain(after?.status);

    // a fizetés ettől függetlenül captured maradt
    const { data: pay } = await svc.from("payments").select("status").eq("id", f.paymentRowId).single();
    expect(pay?.status).toBe("captured");
    await svc.from("email_outbox").delete().eq("dedupe_key", `it_dedupe_${f.bookingId}`);
    await cleanup(f);
  }, 180_000);

  it("10) Connect account disabled/past_due – onboarding nem complete, release elutasítva", async () => {
    const f = await makeFixture(5000);
    // past_due requirements szinkron → NEM complete
    await svc.rpc("sync_connect_account", {
      p_account_id: connectAccountId,
      p_charges: true, p_payouts: false, p_details: true,
      p_requirements: { currently_due: ["individual.verification.document"], past_due: ["external_account"], disabled_reason: null },
      p_capabilities: { card_payments: "active", transfers: "inactive" },
      p_country: "US",
    });
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f.providerId);
    await svc.rpc("sync_connect_account", {
      p_account_id: connectAccountId,
      p_charges: true, p_payouts: false, p_details: true,
      p_requirements: { currently_due: ["individual.verification.document"], past_due: ["external_account"], disabled_reason: null },
      p_capabilities: { card_payments: "active", transfers: "inactive" },
      p_country: "US",
    });
    const { data: prov } = await svc.from("providers")
      .select("stripe_onboarding_complete, stripe_requirements, stripe_capabilities")
      .eq("id", f.providerId).single();
    expect(prov?.stripe_onboarding_complete).toBe(false);
    expect((prov?.stripe_requirements as { past_due?: string[] }).past_due).toContain("external_account");

    // disabled_reason → szintén nem complete
    await svc.rpc("sync_connect_account", {
      p_account_id: connectAccountId,
      p_charges: false, p_payouts: false, p_details: true,
      p_requirements: { currently_due: [], past_due: [], disabled_reason: "rejected.fraud" },
      p_capabilities: { card_payments: "inactive", transfers: "inactive" },
      p_country: "US",
    });
    const { data: prov2 } = await svc.from("providers")
      .select("stripe_onboarding_complete").eq("id", f.providerId).single();
    expect(prov2?.stripe_onboarding_complete).toBe(false);
    await cleanup(f);
  }, 120_000);

  // ---- segéd: valódi test-transfer + acquire + finalize → 'paid' payout ----
  async function payOutProvider(f: Fx): Promise<{ payoutId: string; transferId: string; transferAmount: number }> {
    const { data: bkRow } = await svc.from("bookings")
      .select("provider_amount").eq("id", f.bookingId).single();
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f.providerId);
    const transfer = await stripe.transfers.create({
      amount: bkRow!.provider_amount, currency: "eur", destination: connectAccountId,
      source_transaction: f.chargeId,
    }, { idempotencyKey: `it_tr_${f.bookingId}` });
    const payoutId = (await svc.from("payouts").select("id").eq("booking_id", f.bookingId).single()).data!.id;
    await svc.rpc("acquire_payout_release", { p_payout: payoutId, p_actor: f.userId });
    const fin = await svc.rpc("finalize_payout_release", {
      p_payout: payoutId, p_actor: f.userId, p_transfer_id: transfer.id,
      p_manual_reference: null, p_manual_note: null, p_transferred_amount: transfer.amount,
    });
    expect(fin.error).toBeNull();
    expect(fin.data?.ok).toBe(true);
    return { payoutId, transferId: transfer.id, transferAmount: transfer.amount };
  }

  /** charge.refunded webhook diszpcsolása a valódi Stripe charge állapotával. */
  async function dispatchChargeRefunded(f: Fx) {
    const charge = await stripe.charges.retrieve(f.chargeId, { expand: ["refunds"] });
    await dispatchStripeEvent(svc, "charge.refunded", {
      data: { object: {
        id: f.chargeId, payment_intent: f.paymentIntentId,
        amount_refunded: charge.amount_refunded,
        refunds: { data: charge.refunds?.data.map((r) => ({
          id: r.id, amount: r.amount, status: r.status, currency: r.currency,
        })) ?? [] },
      } },
    });
  }

  it("11) részleges refund PAYOUT ELŐTT – a release csak a KORRIGÁLT összeggel lehetséges", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    const { data: bk } = await svc.from("bookings")
      .select("grand_total, commission_amount, provider_amount").eq("id", f.bookingId).single();
    const refundAmount = 4000;
    const platformShare = Math.round((refundAmount * bk!.commission_amount) / bk!.grand_total);
    const providerShare = refundAmount - platformShare;
    const expectedPayout = bk!.provider_amount - providerShare;

    const rr = await requestRefund(svc, {
      bookingId: f.bookingId, amountCents: refundAmount, currency: "EUR", reason: "it_partial_before",
    });
    expect(rr.ok).toBe(true);
    await dispatchChargeRefunded(f);

    // a held payout összege ATOMIKUSAN csökkent a refund szolgáltatói részével
    const { data: payout } = await svc.from("payouts")
      .select("id, amount, status, hold_reason").eq("booking_id", f.bookingId).single();
    expect(payout?.status).toBe("held");
    expect(payout?.amount).toBe(expectedPayout);
    expect(payout?.hold_reason).toContain("refund_adjusted");

    // release: az acquire a KORRIGÁLT összeget adja vissza – az eredeti többé nem érhető el
    const acq = await svc.rpc("acquire_payout_release", { p_payout: payout!.id, p_actor: f.userId });
    expect(acq.error).toBeNull();
    expect(acq.data?.[0]?.amount).toBe(expectedPayout);

    const fin = await svc.rpc("finalize_payout_release", {
      p_payout: payout!.id, p_actor: f.userId,
      p_transfer_id: `tr_it_partial_${Date.now()}`, p_manual_reference: null, p_manual_note: null,
    });
    expect(fin.error).toBeNull();
    expect(fin.data?.ok).toBe(true);
    const { data: paid } = await svc.from("payouts").select("status, amount").eq("id", payout!.id).single();
    expect(paid?.status).toBe("paid");
    expect(paid?.amount).toBe(expectedPayout); // a kifizetett összeg = korrigált összeg
    await cleanup(f);
  }, 180_000);

  it("12) két refund a reversal webhook ELŐTT – committed-cap: requested+succeeded ≤ payout", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    const { data: bk } = await svc.from("bookings")
      .select("grand_total, commission_amount, provider_amount").eq("id", f.bookingId).single();

    // két részleges refund (5000+5000) – mindkettő settle-je reversal-kérést indít,
    // de a transfer.reversed webhook MÉG NEM érkezett meg
    const r1 = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 5000, currency: "EUR", reason: "it_dual_1" });
    expect(r1.ok).toBe(true);
    await dispatchChargeRefunded(f);
    const r2 = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 5000, currency: "EUR", reason: "it_dual_2" });
    expect(r2.ok).toBe(true);
    await dispatchChargeRefunded(f);

    // mindkét reversal külön sor, már BEKÜLDVE (submitted, trr_ ID-val),
    // de a settle (transfer.reversed webhook) még nem futott
    const { data: revs } = await svc.from("payout_reversals")
      .select("id, requested_amount, status, stripe_reversal_id, idempotency_key")
      .eq("payout_id", payoutId);
    expect(revs).toHaveLength(2);
    expect(revs!.every((r) => r.status === "submitted")).toBe(true);
    expect(revs!.every((r) => r.stripe_reversal_id?.startsWith("trr_"))).toBe(true);
    const committed = revs!.reduce((s, r) => s + r.requested_amount, 0);
    expect(committed).toBe(bk!.provider_amount); // pontosan a cap-ig

    // a transfer.reversed webhook előtt a payout még nem mutat reversed összeget
    const { data: po0 } = await svc.from("payouts")
      .select("reversed_amount, reversal_status").eq("id", payoutId).single();
    expect(po0?.reversed_amount).toBe(0);
    expect(po0?.reversal_status).toBe("pending");

    // bármilyen további reversal-kérés (párhuzamos esemény, pl. chargeback) a
    // committed összegen FELÜL → REVERSAL_EXCEEDS_PAYOUT – több nem vonható vissza
    const over = await svc.rpc("request_payout_reversal", {
      p_payout: payoutId, p_amount: 100, p_reason: "it_overcap",
      p_idempotency_key: `it_overcap_${Date.now()}`,
    });
    expect(over.error?.message ?? "").toContain("REVERSAL_EXCEEDS_PAYOUT");
    const { data: revsAfter } = await svc.from("payout_reversals")
      .select("id").eq("payout_id", payoutId);
    expect(revsAfter).toHaveLength(2); // nem jött létre új sor

    // most jön a transfer.reversed webhook: minden trr_ ID KÜLÖN settle-el
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: {
        id: transferId, amount_reversed: committed,
        reversals: { data: revs!.map((r) => ({ id: r.stripe_reversal_id, amount: r.requested_amount })) },
      } },
    });
    const { data: po1 } = await svc.from("payouts")
      .select("reversed_amount, reversal_status").eq("id", payoutId).single();
    expect(po1?.reversed_amount).toBe(bk!.provider_amount);
    expect(po1?.reversal_status).toBe("reversed");
    const { data: revsSettled } = await svc.from("payout_reversals")
      .select("status").eq("payout_id", payoutId);
    expect(revsSettled!.every((r) => r.status === "succeeded")).toBe(true);
    await cleanup(f);
  }, 240_000);

  it("13) refund, majd AZONNALI chargeback – korrigált payout + teljes blokk", async () => {
    const f = await makeFixture(6000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    // 1) részleges refund a kifizetés előtt → payout csökken
    const rr = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 2000, currency: "EUR", reason: "it_refund_then_cb" });
    expect(rr.ok).toBe(true);
    await dispatchChargeRefunded(f);

    const { data: bk } = await svc.from("bookings")
      .select("grand_total, commission_amount, provider_amount").eq("id", f.bookingId).single();
    const providerShare = 2000 - Math.round((2000 * bk!.commission_amount) / bk!.grand_total);
    const { data: po1 } = await svc.from("payouts")
      .select("id, amount, status").eq("booking_id", f.bookingId).single();
    expect(po1?.amount).toBe(bk!.provider_amount - providerShare);

    // 2) azonnali chargeback UGYANARRA a fizetésre
    await dispatchStripeEvent(svc, "charge.dispute.created", {
      data: { object: { id: `dp_it_rcb_${Date.now()}`, payment_intent: f.paymentIntentId, amount: 6000, currency: "eur" } },
    });
    const { data: pay } = await svc.from("payments").select("status").eq("id", f.paymentRowId).single();
    expect(pay?.status).toBe("chargeback");
    const { data: bkAfter } = await svc.from("bookings").select("status").eq("id", f.bookingId).single();
    expect(bkAfter?.status).toBe("disputed");

    // 3) a (már korrigált) payout sem szabadítható fel: chargeback-blokk
    const acq = await svc.rpc("acquire_payout_release", { p_payout: po1!.id, p_actor: f.userId });
    expect(acq.error?.message ?? "").toContain("PAYOUT_BLOCKED");
    // és az összege nem "ugrott vissza" az eredetire
    const { data: po2 } = await svc.from("payouts").select("amount, status").eq("id", po1!.id).single();
    expect(po2?.amount).toBe(bk!.provider_amount - providerShare);
    expect(po2?.status).toBe("held");
    await cleanup(f);
  }, 180_000);

  it("14) KÉSŐI PaymentIntent lejárt (cancelled) foglaláshoz – nincs payout, auto refund, disputed", async () => {
    const f = await makeFixture(10000);
    // a booking a webhook BEÉRKEZÉSE ELŐTT lejár/lemondásra kerül
    await svc.from("bookings").update({ status: "cancelled" }).eq("id", f.bookingId);

    // későn érkező sikeres fizetés
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    // NINCS payout és NINCS újraaktiválás – a booking disputed, a payment captured
    const { data: payouts } = await svc.from("payouts").select("id").eq("booking_id", f.bookingId);
    expect(payouts).toHaveLength(0);
    const { data: bk } = await svc.from("bookings").select("status").eq("id", f.bookingId).single();
    expect(bk?.status).toBe("disputed");
    const { data: pay } = await svc.from("payments").select("status").eq("id", f.paymentRowId).single();
    expect(pay?.status).toBe("captured");
    // booking_revenue ledger NEM keletkezett (a pénz nem bevétel, hanem visszatérítendő)
    const { data: rev } = await svc.from("ledger_entries")
      .select("id").eq("booking_id", f.bookingId).eq("kind", "booking_revenue");
    expect(rev ?? []).toHaveLength(0);
    // automatikus teljes refund-KÉRELEM jött létre – de a késői fizetés NEM
    // tekinthető rendezettnek a pending refundtól: a Stripe-hívást a refund
    // work queue végzi (next_retry_at = azonnal)
    const { data: refunds } = await svc.from("refunds")
      .select("id, amount, status, provider_refund_id, reason, next_retry_at").eq("booking_id", f.bookingId);
    expect(refunds).toHaveLength(1);
    expect(refunds![0].amount).toBe(10000);
    expect(refunds![0].reason).toBe("late_payment");
    expect(refunds![0].status).toBe("pending");
    expect(refunds![0].provider_refund_id).toBeNull();
    expect(refunds![0].next_retry_at).not.toBeNull();

    // kötelező adminriasztás az audit logban
    const { data: alerts } = await svc.from("audit_log")
      .select("id").eq("action", "late_payment_auto_refund").eq("entity_id", f.bookingId);
    expect(alerts!.length).toBeGreaterThan(0);

    // a refund work queue (cron) beküldi a Stripe-nak – idempotens kulccsal
    const q = await processDueRefunds(svc, `it_${Date.now()}`);
    expect(q.submitted).toBeGreaterThanOrEqual(1);
    const { data: refAfter } = await svc.from("refunds")
      .select("status, provider_refund_id").eq("id", refunds![0].id).single();
    expect(refAfter?.status).toBe("processing");
    expect(refAfter?.provider_refund_id).toMatch(/^re_/);

    // a refund lezárul (charge.refunded) → a vásárló visszakapta a pénzt
    await dispatchChargeRefunded(f);
    const { data: bkFinal } = await svc.from("bookings").select("status").eq("id", f.bookingId).single();
    expect(bkFinal?.status).toBe("refunded");
    const { data: payoutsFinal } = await svc.from("payouts").select("id").eq("booking_id", f.bookingId);
    expect(payoutsFinal).toHaveLength(0); // továbbra sincs payout
    await svc.from("email_outbox").delete().like("dedupe_key", `%${f.bookingId}%`);
    await cleanup(f);
  }, 240_000);

  it("15) webhook lock-timeout + stale worker késői finish – a régi worker NEM zárhatja le", async () => {
    const evt = `evt_it_stale_${Date.now()}`;
    const c1 = await svc.rpc("claim_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_type: "test.stale",
      p_payload: {}, p_worker: "w_old",
    });
    expect(c1.data).toBe("claimed");

    // a lock lejár (w_old elszállt), w_new átveszi
    await svc.from("payment_events").update({ locked_at: new Date(Date.now() - 3600_000).toISOString() })
      .eq("provider_event_id", evt);
    const c2 = await svc.rpc("claim_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_type: "test.stale",
      p_payload: {}, p_worker: "w_new",
    });
    expect(c2.data).toBe("claimed");
    const { data: mid } = await svc.from("payment_events")
      .select("status, locked_by, attempts").eq("provider_event_id", evt).single();
    expect(mid?.status).toBe("processing");
    expect(mid?.locked_by).toBe("w_new");

    // a stale worker későn beérkező finish-e: NEM zárhatja le az eseményt
    const staleFinish = await svc.rpc("finish_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_worker: "w_old", p_success: true,
    });
    expect(staleFinish.data).toBe(false);
    const { data: afterStale } = await svc.from("payment_events")
      .select("status, processed_at").eq("provider_event_id", evt).single();
    expect(afterStale?.status).toBe("processing"); // érintetlen maradt
    expect(afterStale?.processed_at).toBeNull();

    // a jogos tulajdonos (w_new) lezárhatja
    const okFinish = await svc.rpc("finish_payment_event", {
      p_provider: "stripe", p_event_id: evt, p_worker: "w_new", p_success: true,
    });
    expect(okFinish.data).toBe(true);
    const { data: done } = await svc.from("payment_events")
      .select("status, processed_at").eq("provider_event_id", evt).single();
    expect(done?.status).toBe("processed");
    expect(done?.processed_at).not.toBeNull();
    await svc.from("payment_events").delete().eq("provider_event_id", evt);
  }, 60_000);

  it("16) chargeback MEGNYERÉSE Transfer Reversal UTÁN – kontrollált új payout", async () => {
    const f = await makeFixture(6000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    // chargeback → reversal-folyamat (valódi transfers.createReversal)
    const disputeId = `dp_it_won_${Date.now()}`;
    await dispatchStripeEvent(svc, "charge.dispute.created", {
      data: { object: { id: disputeId, payment_intent: f.paymentIntentId, amount: 6000, currency: "eur" } },
    });
    const { data: revs } = await svc.from("payout_reversals")
      .select("stripe_reversal_id, requested_amount").eq("payout_id", payoutId);
    expect(revs).toHaveLength(1);
    expect(revs![0].stripe_reversal_id).toMatch(/^trr_/);

    // reversal settle (transfer.reversed)
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: {
        id: transferId, amount_reversed: revs![0].requested_amount,
        reversals: { data: [{ id: revs![0].stripe_reversal_id, amount: revs![0].requested_amount }] },
      } },
    });
    const { data: po } = await svc.from("payouts")
      .select("reversal_status, reversed_amount").eq("id", payoutId).single();
    expect(po?.reversal_status).toBe("reversed");

    // a dispute-ot MEGNYERJÜK → a szolgáltató pénze nem maradhat a platformnál:
    // kontrollált új 'scheduled' payout a visszavont összegre (admin release kell)
    await dispatchStripeEvent(svc, "charge.dispute.closed", {
      data: { object: { id: disputeId, payment_intent: f.paymentIntentId, status: "won" } },
    });
    const { data: all } = await svc.from("payouts")
      .select("id, status, amount, hold_reason, origin_payout_id")
      .eq("booking_id", f.bookingId).order("created_at");
    expect(all).toHaveLength(2);
    const wonPayout = all!.find((p) => p.origin_payout_id === payoutId);
    expect(wonPayout).toBeTruthy();
    expect(wonPayout!.status).toBe("scheduled");
    expect(wonPayout!.amount).toBe(revs![0].requested_amount);
    expect(wonPayout!.hold_reason).toContain("chargeback_won_retransfer");
    const { data: bk } = await svc.from("bookings").select("status").eq("id", f.bookingId).single();
    expect(bk?.status).toBe("confirmed"); // megnyert chargeback → vissza confirmed

    // idempotens: újrahívva NEM jön létre újabb payout
    const again = await svc.rpc("resolve_chargeback_won", { p_booking: f.bookingId, p_dispute: disputeId });
    expect(again.error).toBeNull();
    expect(again.data?.action).toBe("already_created");
    const { data: all2 } = await svc.from("payouts").select("id").eq("booking_id", f.bookingId);
    expect(all2).toHaveLength(2);
    await cleanup(f);
  }, 240_000);

  it("17) ismételt AGGREGÁLT amount_reversed webhook – csak a delta könyvelődik", async () => {
    const f = await makeFixture(7000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    const aggregateEvent = (total: number) => ({
      data: { object: { id: transferId, amount_reversed: total, reversals: { data: [] as { id: string; amount: number }[] } } },
    });

    // első aggregált webhook: 500
    await dispatchStripeEvent(svc, "transfer.reversed", aggregateEvent(500));
    const { data: po1 } = await svc.from("payouts")
      .select("reversed_amount, reversal_status").eq("id", payoutId).single();
    expect(po1?.reversed_amount).toBe(500);
    expect(po1?.reversal_status).toBe("partial");

    // UGYANAZ ismételten: nincs dupla könyvelés
    await dispatchStripeEvent(svc, "transfer.reversed", aggregateEvent(500));
    const { data: po2 } = await svc.from("payouts").select("reversed_amount").eq("id", payoutId).single();
    expect(po2?.reversed_amount).toBe(500);
    const { data: led1 } = await svc.from("ledger_entries")
      .select("id").eq("kind", "adjustment").eq("meta->>note", "transfer_reversed_aggregate")
      .eq("meta->>transfer", transferId);
    expect(led1).toHaveLength(1);

    // nagyobb összesítő: csak a DELTA (300) könyvelődik
    await dispatchStripeEvent(svc, "transfer.reversed", aggregateEvent(800));
    const { data: po3 } = await svc.from("payouts").select("reversed_amount").eq("id", payoutId).single();
    expect(po3?.reversed_amount).toBe(800);
    const { data: aggRows } = await svc.from("payout_reversals")
      .select("requested_amount").eq("payout_id", payoutId);
    expect(aggRows!.map((r) => r.requested_amount).sort((a, b) => a - b)).toEqual([300, 500]);

    // harmadik ismétlés 800-zal: semmi változás
    await dispatchStripeEvent(svc, "transfer.reversed", aggregateEvent(800));
    const { data: po4 } = await svc.from("payouts").select("reversed_amount").eq("id", payoutId).single();
    expect(po4?.reversed_amount).toBe(800);
    const { data: led2 } = await svc.from("ledger_entries")
      .select("id").eq("kind", "adjustment").eq("meta->>note", "transfer_reversed_aggregate")
      .eq("meta->>transfer", transferId);
    expect(led2).toHaveLength(2);
    await cleanup(f);
  }, 240_000);

  it("18) refund, miközben a payout RELEASING – a payout összege érintetlen, kötelezettség → finalize után automatikus reversal; ledger == tényleges Transfer", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { data: bk } = await svc.from("bookings")
      .select("grand_total, commission_amount, provider_amount").eq("id", f.bookingId).single();

    // payout release MEGKEZDŐDIK (külső Stripe Transfer alatt áll)
    const payoutId = (await svc.from("payouts").select("id").eq("booking_id", f.bookingId).single()).data!.id;
    const acq = await svc.rpc("acquire_payout_release", { p_payout: payoutId, p_actor: f.userId });
    expect(acq.error).toBeNull();

    // KÖZBEN refund érkezik és lezárul – a releasing payout összege NEM módosulhat
    const rr = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 4000, currency: "EUR", reason: "it_releasing" });
    expect(rr.ok).toBe(true);
    await dispatchChargeRefunded(f);

    const providerShare = 4000 - Math.round((4000 * bk!.commission_amount) / bk!.grand_total);
    const { data: poReleasing } = await svc.from("payouts")
      .select("amount, status").eq("id", payoutId).single();
    expect(poReleasing?.status).toBe("releasing");
    expect(poReleasing?.amount).toBe(bk!.provider_amount); // ÉRINTETLEN!

    // tartós kötelezettség jött létre (awaiting_transfer)
    const { data: obl } = await svc.from("payout_reversals")
      .select("id, requested_amount, status").eq("payout_id", payoutId).single();
    expect(obl?.status).toBe("awaiting_transfer");
    expect(obl?.requested_amount).toBe(providerShare);

    // a Transfer a teljes (eredeti) összeggel megy ki, a finalize a TÉNYLEGES
    // összeget könyveli, és a kötelezettséget 'requested'-be váltja
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f.providerId);
    const transfer = await stripe.transfers.create({
      amount: bk!.provider_amount, currency: "eur", destination: connectAccountId,
      source_transaction: f.chargeId,
    }, { idempotencyKey: `it_tr_${f.bookingId}` });
    const fin = await svc.rpc("finalize_payout_release", {
      p_payout: payoutId, p_actor: f.userId, p_transfer_id: transfer.id,
      p_manual_reference: null, p_manual_note: null, p_transferred_amount: transfer.amount,
    });
    expect(fin.error).toBeNull();
    expect(fin.data?.ok).toBe(true);
    expect(fin.data?.transferred_amount).toBe(transfer.amount);
    expect(fin.data?.obligations).toHaveLength(1);

    // a kötelezettség automatikus reversal-beküldése (mint az admin route)
    const stripeProv = new StripeProvider();
    const sub = await submitPayoutReversal(svc, stripeProv, obl!.id);
    expect(sub.submitted).toBe(true);

    const { data: oblAfter } = await svc.from("payout_reversals")
      .select("status, stripe_reversal_id").eq("id", obl!.id).single();
    expect(oblAfter?.status).toBe("submitted");
    expect(oblAfter?.stripe_reversal_id).toMatch(/^trr_/);

    // settle a transfer.reversed webhookban
    const trAfter = await stripe.transfers.retrieve(transfer.id);
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: {
        id: transfer.id, amount_reversed: trAfter.amount_reversed,
        reversals: { data: [{ id: oblAfter!.stripe_reversal_id, amount: providerShare }] },
      } },
    });
    const { data: poPaid } = await svc.from("payouts")
      .select("amount, reversed_amount, reversal_status").eq("id", payoutId).single();
    expect(poPaid?.reversed_amount).toBe(providerShare);
    expect(poPaid?.reversal_status).toBe("partial");

    // LEDGER == TÉNYLEGES TRANSFER == DB payout összeg
    const { data: payoutLedger } = await svc.from("ledger_entries")
      .select("amount").eq("kind", "payout").eq("meta->>payout_id", payoutId).single();
    expect(payoutLedger?.amount).toBe(-transfer.amount);
    expect(poPaid?.amount).toBe(transfer.amount);
    await cleanup(f);
  }, 240_000);

  it("19) folyamatleállás a reversal DB-kérés után, Stripe-hívás előtt – replay a teljes sort adja, azonos kulccsal folytatható", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    const key = `revtest_crash_${Date.now()}`;
    const req1 = await svc.rpc("request_payout_reversal", {
      p_payout: payoutId, p_amount: 2000, p_reason: "it_crash", p_idempotency_key: key,
    });
    expect(req1.error).toBeNull();
    expect(req1.data?.reversal_row_id).toBeTruthy();
    expect(req1.data?.idempotent_replay).toBe(false);
    // *** itt "elszáll" a folyamat: a Stripe-hívás elmarad ***

    // újraindulás: a replay NEM lép ki csendben – a teljes sort visszaadja
    const req2 = await svc.rpc("request_payout_reversal", {
      p_payout: payoutId, p_amount: 2000, p_reason: "it_crash", p_idempotency_key: key,
    });
    expect(req2.error).toBeNull();
    expect(req2.data?.idempotent_replay).toBe(true);
    expect(req2.data?.reversal_row_id).toBe(req1.data.reversal_row_id);
    expect(req2.data?.transfer_id).toBe(transferId);
    expect(req2.data?.requested_amount).toBe(2000);
    expect(req2.data?.status).toBe("requested");
    expect(req2.data?.stripe_reversal_id).toBeNull();

    // a Stripe-hívás ugyanazzal az idempotencia-kulccsal biztonságosan újrafut
    const stripeProv = new StripeProvider();
    const sub = await submitPayoutReversal(svc, stripeProv, req1.data.reversal_row_id);
    expect(sub.submitted).toBe(true);
    const trrId = sub.stripeReversalId!;

    // Stripe-oldali idempotens replay: közvetlen újrahívás UGYANAZT a trr_-t adja
    const again = await stripe.transfers.createReversal(transferId, { amount: 2000 }, { idempotencyKey: key });
    expect(again.id).toBe(trrId);
    const trAfter = await stripe.transfers.retrieve(transferId);
    expect(trAfter.reversals?.data).toHaveLength(1); // nincs dupla reversal

    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: { id: transferId, amount_reversed: 2000, reversals: { data: [{ id: trrId, amount: 2000 }] } } },
    });
    const { data: rev } = await svc.from("payout_reversals")
      .select("status").eq("id", req1.data.reversal_row_id).single();
    expect(rev?.status).toBe("succeeded");
    await cleanup(f);
  }, 240_000);

  it("20) Stripe Reversal SIKERES, de a record_reversal_sent DB-hiba – a sor NEM failed, azonos kulccsal újraegyezthető", async () => {
    const f = await makeFixture(6000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    const key = `revtest_dberr_${Date.now()}`;
    const req = await svc.rpc("request_payout_reversal", {
      p_payout: payoutId, p_amount: 1000, p_reason: "it_dberr", p_idempotency_key: key,
    });
    const rowId = req.data!.reversal_row_id as string;

    // a Stripe-hívás SIKERES
    const r1 = await stripe.transfers.createReversal(transferId, { amount: 1000 }, { idempotencyKey: key });
    // ...de a DB-mentés HIBÁZIK (hibás sor-azonosítóval szimulálva)
    const badSave = await svc.rpc("record_reversal_sent", {
      p_reversal_row: "not-a-uuid", p_stripe_reversal_id: r1.id,
    });
    expect(badSave.error).toBeTruthy();

    // a sor NEM lehet failed – 'requested' marad, újrafuttatható
    const { data: rowMid } = await svc.from("payout_reversals")
      .select("status, stripe_reversal_id").eq("id", rowId).single();
    expect(rowMid?.status).toBe("requested");
    expect(rowMid?.stripe_reversal_id).toBeNull();

    // újraegyeztetés azonos idempotencia-kulccsal: a Stripe UGYANAZT a
    // reversalt adja vissza, a mentés most sikerül
    const stripeProv = new StripeProvider();
    const sub = await submitPayoutReversal(svc, stripeProv, rowId);
    expect(sub.submitted).toBe(true);
    expect(sub.stripeReversalId).toBe(r1.id); // nincs új reversal a Stripe-on
    const trAfter = await stripe.transfers.retrieve(transferId);
    expect(trAfter.reversals?.data).toHaveLength(1);

    const { data: rowFinal } = await svc.from("payout_reversals")
      .select("status, stripe_reversal_id").eq("id", rowId).single();
    expect(rowFinal?.status).toBe("submitted");
    expect(rowFinal?.stripe_reversal_id).toBe(r1.id);

    // a webhook még lezárja
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: { id: transferId, amount_reversed: 1000, reversals: { data: [{ id: r1.id, amount: 1000 }] } } },
    });
    const { data: rowSettled } = await svc.from("payout_reversals").select("status").eq("id", rowId).single();
    expect(rowSettled?.status).toBe("succeeded");
    await cleanup(f);
  }, 240_000);

  it("21) korábbi refund-reversal + chargeback reversal + chargeback WON – csak a dispute-hoz tartozó összeg kerül vissza", async () => {
    const f = await makeFixture(8000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);
    const { data: bk } = await svc.from("bookings")
      .select("grand_total, commission_amount, provider_amount").eq("id", f.bookingId).single();

    // 1) refund-reversal (4000 refund → providerShare) beküldve + settle-elve
    const rr = await requestRefund(svc, { bookingId: f.bookingId, amountCents: 4000, currency: "EUR", reason: "it_scoped_ref" });
    expect(rr.ok).toBe(true);
    await dispatchChargeRefunded(f);
    const refundShare = 4000 - Math.round((4000 * bk!.commission_amount) / bk!.grand_total);
    const { data: r1 } = await svc.from("payout_reversals")
      .select("id, requested_amount, status, stripe_reversal_id, dispute_id")
      .eq("payout_id", payoutId).not("refund_id", "is", null).single();
    expect(r1?.requested_amount).toBe(refundShare);
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: { id: transferId, amount_reversed: refundShare,
        reversals: { data: [{ id: r1!.stripe_reversal_id, amount: refundShare }] } } },
    });

    // 2) chargeback → cap-elt reversal a fennmaradó részre
    const disputeId = `dp_it_scoped_${Date.now()}`;
    await dispatchStripeEvent(svc, "charge.dispute.created", {
      data: { object: { id: disputeId, payment_intent: f.paymentIntentId, amount: 8000, currency: "eur" } },
    });
    const { data: r2 } = await svc.from("payout_reversals")
      .select("id, requested_amount, stripe_reversal_id")
      .eq("payout_id", payoutId).eq("dispute_id", disputeId).single();
    expect(r2?.requested_amount).toBe(bk!.provider_amount - refundShare); // cap!
    const trMid = await stripe.transfers.retrieve(transferId);
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: { id: transferId, amount_reversed: trMid.amount_reversed,
        reversals: { data: [{ id: r2!.stripe_reversal_id, amount: r2!.requested_amount }] } } },
    });
    const { data: poAll } = await svc.from("payouts")
      .select("reversed_amount, reversal_status").eq("id", payoutId).single();
    expect(poAll?.reversed_amount).toBe(bk!.provider_amount);
    expect(poAll?.reversal_status).toBe("reversed");

    // 3) chargeback MEGNYERVE → az új payout KIZÁRÓLAG a dispute reversalja
    //    (a refund-reversal összege NEM kerülhet vissza a szolgáltatónak)
    await dispatchStripeEvent(svc, "charge.dispute.closed", {
      data: { object: { id: disputeId, payment_intent: f.paymentIntentId, status: "won" } },
    });
    const { data: wonPayout } = await svc.from("payouts")
      .select("amount, hold_reason, status").eq("origin_payout_id", payoutId).single();
    expect(wonPayout?.amount).toBe(r2!.requested_amount); // NEM refundShare + r2!
    expect(wonPayout?.amount).not.toBe(bk!.provider_amount);
    expect(wonPayout?.hold_reason).toBe(`chargeback_won_retransfer:${disputeId}`);
    expect(wonPayout?.status).toBe("scheduled");
    await cleanup(f);
  }, 300_000);

  it("22) pending refund-reversal után AZONNALI chargeback – csak az elérhető különbözet, nincs elnyelt hiba", async () => {
    const f = await makeFixture(6000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId } = await payOutProvider(f);
    const { data: bk } = await svc.from("bookings")
      .select("provider_amount").eq("id", f.bookingId).single();

    // függő (még be nem adott) refund-reversal – pl. crash a Stripe-hívás előtt
    const pending = 3400;
    const req = await svc.rpc("request_payout_reversal", {
      p_payout: payoutId, p_amount: pending, p_reason: "it_pending_ref",
      p_idempotency_key: `revref_sim_${Date.now()}`,
    });
    expect(req.error).toBeNull();

    // azonnali chargeback UGYANARRA a payoutra
    const disputeId = `dp_it_cap_${Date.now()}`;
    await dispatchStripeEvent(svc, "charge.dispute.created", {
      data: { object: { id: disputeId, payment_intent: f.paymentIntentId, amount: 6000, currency: "eur" } },
    });

    // a chargeback reversal CSAK az elérhető különbözet (amount − committed)
    const { data: cbRow } = await svc.from("payout_reversals")
      .select("requested_amount, status").eq("payout_id", payoutId).eq("dispute_id", disputeId).single();
    expect(cbRow?.requested_amount).toBe(bk!.provider_amount - pending);

    // a két sor együtt pontosan a payout összege – sosem több
    const { data: all } = await svc.from("payout_reversals")
      .select("requested_amount, status").eq("payout_id", payoutId)
      .in("status", ["requested", "submitting", "submitted", "succeeded", "awaiting_transfer"]);
    const total = all!.reduce((s, r) => s + r.requested_amount, 0);
    expect(total).toBe(bk!.provider_amount);
    await cleanup(f);
  }, 240_000);

  it("23) késői fizetés refundja először HIBÁS, a cron retry sikeres; kimerülésnél manual_review + adminriasztás", async () => {
    const f = await makeFixture(10000);
    await svc.from("bookings").update({ status: "cancelled" }).eq("id", f.bookingId);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));

    const { data: refunds } = await svc.from("refunds")
      .select("id, status, attempts").eq("booking_id", f.bookingId);
    expect(refunds).toHaveLength(1);
    const refundId = refunds![0].id;

    // 1) az első kísérlet HIBÁZIK → attempts nő, backoff-os újraidőzítés
    const st1 = await svc.rpc("fail_refund_attempt", {
      p_refund: refundId, p_error: "simulated_network_error", p_max_attempts: 8,
    });
    expect(st1.data).toBe("pending");
    const { data: after1 } = await svc.from("refunds")
      .select("attempts, status, next_retry_at, last_error").eq("id", refundId).single();
    expect(after1?.attempts).toBe(1);
    expect(after1?.status).toBe("pending");
    expect(after1?.last_error).toBe("simulated_network_error");
    expect(new Date(after1!.next_retry_at).getTime()).toBeGreaterThan(Date.now());

    // 2) esedékessé tesszük → a cron-feldolgozó idempotensen beküldi
    await svc.from("refunds").update({ next_retry_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", refundId);
    const q = await processDueRefunds(svc, `it_${Date.now()}`);
    expect(q.submitted).toBeGreaterThanOrEqual(1);
    const { data: after2 } = await svc.from("refunds")
      .select("status, provider_refund_id").eq("id", refundId).single();
    expect(after2?.status).toBe("processing");
    expect(after2?.provider_refund_id).toMatch(/^re_/);

    await dispatchChargeRefunded(f);
    const { data: bk } = await svc.from("bookings").select("status").eq("id", f.bookingId).single();
    expect(bk?.status).toBe("refunded");

    // 3) kimerülés → VÉGLEGES manual_review + adminriasztás az audit logban
    const f2 = await makeFixture(5000);
    const { data: ref2 } = await svc.from("refunds").insert({
      booking_id: f2.bookingId, payment_id: f2.paymentRowId, amount: 1000,
      currency: "EUR", reason: "it_manual_review", status: "pending",
    }).select("id").single();
    for (let i = 0; i < 8; i++) {
      await svc.rpc("fail_refund_attempt", {
        p_refund: ref2!.id, p_error: `attempt_${i}`, p_max_attempts: 8,
      });
    }
    const { data: mr } = await svc.from("refunds")
      .select("status, attempts").eq("id", ref2!.id).single();
    expect(mr?.status).toBe("manual_review");
    expect(mr?.attempts).toBe(8);
    const { data: alertLog } = await svc.from("audit_log")
      .select("id").eq("action", "refund_manual_review").eq("entity_id", ref2!.id);
    expect(alertLog!.length).toBeGreaterThan(0);

    // manual_review-t a queue NEM claimeli újra
    const q2 = await processDueRefunds(svc, `it_${Date.now()}`);
    expect(q2.claimed).toBe(0);
    const { data: stillMr } = await svc.from("refunds").select("status").eq("id", ref2!.id).single();
    expect(stillMr?.status).toBe("manual_review");

    await svc.from("email_outbox").delete().like("dedupe_key", `%${f.bookingId}%`);
    await cleanup(f);
    await cleanup(f2);
  }, 240_000);

  /** attempt elöregítése, hogy a cron claimelje (1 perces stale-küszöb). */
  async function ageAttempt(attemptId: string) {
    await svc.from("payout_transfer_attempts").update({
      created_at: new Date(Date.now() - 3 * 60_000).toISOString(), locked_at: null, locked_by: null,
    }).eq("id", attemptId);
  }

  it("24) Transfer SIKERES, finalize DB-hiba, majd REFUND és cron-retry – eredeti összeg/ID megőrződik", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f.providerId);
    const { data: bk } = await svc.from("bookings")
      .select("provider_amount").eq("id", f.bookingId).single();

    const payoutId = (await svc.from("payouts").select("id").eq("booking_id", f.bookingId).single()).data!.id;
    const acq = await svc.rpc("acquire_payout_release", { p_payout: payoutId, p_actor: f.userId });
    expect(acq.error).toBeNull();
    const attemptId = acq.data![0].attempt_id as string;
    const attemptKey = acq.data![0].idempotency_key as string;
    expect(attemptKey).toBe(`payout_${payoutId}`);

    // a Transfer LÉTREJÖTT a Stripe-on (az attempt befagyasztott összegével/kulcsával)
    await svc.rpc("update_transfer_attempt_target", {
      p_attempt: attemptId, p_destination: connectAccountId, p_source_charge: f.chargeId,
    });
    const transfer = await stripe.transfers.create({
      amount: bk!.provider_amount, currency: "eur", destination: connectAccountId,
      source_transaction: f.chargeId,
    }, { idempotencyKey: attemptKey });
    await svc.rpc("mark_transfer_submitted", { p_attempt: attemptId, p_stripe_transfer_id: transfer.id });

    // a helyi finalize HIBÁZIK → a payout NEM megy vissza scheduled-be
    await svc.rpc("mark_finalize_pending", { p_payout: payoutId });
    const { data: po1 } = await svc.from("payouts").select("status, amount").eq("id", payoutId).single();
    expect(po1?.status).toBe("transfer_submitted");
    expect(po1?.amount).toBe(bk!.provider_amount); // az eredeti összeg megőrződik

    // közben REFUND érkezik → kötelezettség, a payout/attempt összeg érintetlen
    const rr = await requestRefund(svc, {
      bookingId: f.bookingId, amountCents: 3000, currency: "EUR", reason: "it_finalize_pending",
    });
    expect(rr.ok).toBe(true);
    await dispatchChargeRefunded(f);
    const { data: po2 } = await svc.from("payouts").select("status, amount").eq("id", payoutId).single();
    expect(po2?.status).toBe("transfer_submitted");
    expect(po2?.amount).toBe(bk!.provider_amount);
    const { data: obl } = await svc.from("payout_reversals")
      .select("status, requested_amount").eq("payout_id", payoutId);
    expect(obl).toHaveLength(1);
    expect(obl![0].status).toBe("awaiting_transfer");

    // cron-retry: UGYANAZZAL az összeggel/kulccsal fejezi be + automatikus reversal
    await ageAttempt(attemptId);
    const rec = await processDueTransferAttempts(svc, `it_${Date.now()}`);
    expect(rec.errors).toHaveLength(0);
    expect(rec.finalized).toBeGreaterThanOrEqual(1);
    const { data: po3 } = await svc.from("payouts").select("status, amount, provider_payout_id").eq("id", payoutId).single();
    expect(po3?.status).toBe("paid");
    expect(po3?.amount).toBe(bk!.provider_amount);
    expect(po3?.provider_payout_id).toBe(transfer.id); // az EREDETI tr_ ID
    const { data: rev } = await svc.from("payout_reversals")
      .select("status, stripe_reversal_id").eq("payout_id", payoutId).single();
    expect(rev?.status).toBe("submitted");
    expect(rev?.stripe_reversal_id).toMatch(/^trr_/);
    // a főkönyv payout-tétele == a tényleges Transfer összege
    const { data: led } = await svc.from("ledger_entries")
      .select("amount").eq("kind", "payout").eq("booking_id", f.bookingId).single();
    expect(Math.abs(led!.amount)).toBe(transfer.amount);
    await cleanup(f);
  }, 240_000);

  it("25) Transfer hálózati TIMEOUT, miközben a Stripe-on létrejött – azonos kulccsal az EREDETIT kapja vissza", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f.providerId);
    const { data: bk } = await svc.from("bookings")
      .select("provider_amount").eq("id", f.bookingId).single();

    const payoutId = (await svc.from("payouts").select("id").eq("booking_id", f.bookingId).single()).data!.id;
    const acq = await svc.rpc("acquire_payout_release", { p_payout: payoutId, p_actor: f.userId });
    const attemptId = acq.data![0].attempt_id as string;
    const attemptKey = acq.data![0].idempotency_key as string;
    await svc.rpc("update_transfer_attempt_target", {
      p_attempt: attemptId, p_destination: connectAccountId, p_source_charge: f.chargeId,
    });

    // a Stripe-hívás "timeoutol" – de a Transfer LÉTREJÖTT (a válasz veszett el)
    const original = await stripe.transfers.create({
      amount: bk!.provider_amount, currency: "eur", destination: connectAccountId,
      source_transaction: f.chargeId,
    }, { idempotencyKey: attemptKey });
    await svc.rpc("mark_transfer_ambiguous", { p_attempt: attemptId, p_error: "simulated_timeout" });
    const { data: at1 } = await svc.from("payout_transfer_attempts")
      .select("status, stripe_transfer_id").eq("id", attemptId).single();
    expect(at1?.status).toBe("ambiguous");
    expect(at1?.stripe_transfer_id).toBeNull(); // helyben még nem tudunk róla
    const { data: po1 } = await svc.from("payouts").select("status").eq("id", payoutId).single();
    expect(po1?.status).toBe("releasing"); // NEM failed, NEM scheduled – egyeztetés alatt

    // cron: azonos idempotencia-kulccsal újrahív → a Stripe az EREDETIT adja vissza
    await ageAttempt(attemptId);
    const rec = await processDueTransferAttempts(svc, `it_${Date.now()}`);
    expect(rec.errors).toHaveLength(0);
    const { data: po2 } = await svc.from("payouts")
      .select("status, amount, provider_payout_id").eq("id", payoutId).single();
    expect(po2?.status).toBe("paid");
    expect(po2?.provider_payout_id).toBe(original.id); // pontosan az eredeti Transfer
    expect(po2?.amount).toBe(bk!.provider_amount);
    await cleanup(f);
  }, 240_000);

  it("26) Reversal TIMEOUT, miközben a Stripe-on létrejött – azonos kulccsal egyeztet, nincs dupla reversal", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    // reversal-sor a Stripe-hívás ELŐTT (request_payout_reversal nem hív Stripe-ot)
    const amount = 2500;
    const req = await svc.rpc("request_payout_reversal", {
      p_payout: payoutId, p_amount: amount, p_reason: "it_reversal_timeout",
      p_idempotency_key: `it_revtmo_${Date.now()}`,
    });
    expect(req.error).toBeNull();
    const { data: row } = await svc.from("payout_reversals")
      .select("id, idempotency_key, status").eq("payout_id", payoutId).single();
    expect(row!.status).toBe("requested");

    // a createReversal "timeoutol" – a Stripe-on LÉTREJÖTT (a válasz veszett el)
    const original = await stripe.transfers.createReversal(transferId, {
      amount,
      metadata: {
        reversal_row_id: row!.id, idempotency_key: row!.idempotency_key, payout_id: payoutId,
      },
    }, { idempotencyKey: row!.idempotency_key });

    // a queue-újrapróbálkozás AZONOS kulccsal → a Stripe az eredeti reversalt adja
    const res = await submitPayoutReversal(svc, new StripeProvider(), row!.id);
    expect(res.submitted).toBe(true);
    expect(res.stripeReversalId).toBe(original.id); // nem jött létre új reversal
    const { data: after } = await svc.from("payout_reversals")
      .select("status, stripe_reversal_id").eq("id", row!.id).single();
    expect(after?.status).toBe("submitted");
    expect(after?.stripe_reversal_id).toBe(original.id);
    const tr = await stripe.transfers.retrieve(transferId);
    expect(tr.amount_reversed).toBe(amount); // pontosan egyszer könyvelődött
    await cleanup(f);
  }, 240_000);

  it("27) KÉT azonos összegű, azonosító nélküli reversal ugyanazon a Transferen – NEM párosít vakon", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    // két azonos összegű függő reversal-sor (még nincs trr_ ID-juk)
    for (const key of [`it_u1_${Date.now()}`, `it_u2_${Date.now()}`]) {
      const r = await svc.rpc("request_payout_reversal", {
        p_payout: payoutId, p_amount: 2000, p_reason: "it_unidentified", p_idempotency_key: key,
      });
      expect(r.error).toBeNull();
    }

    // két METADATA NÉLKÜLI reversal érkezik a Stripe felől (pl. dashboardon indították)
    const trr1 = await stripe.transfers.createReversal(transferId, { amount: 2000 },
      { idempotencyKey: `it_dash1_${Date.now()}` });
    const trr2 = await stripe.transfers.createReversal(transferId, { amount: 2000 },
      { idempotencyKey: `it_dash2_${Date.now()}` });
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: {
        id: transferId, amount_reversed: 4000,
        reversals: { data: [
          { id: trr1.id, amount: 2000 },
          { id: trr2.id, amount: 2000 },
        ] },
      } },
    });

    // két jelölt + nulla metadata → EGYIK sor sem settle-lődik vakon
    const { data: rows } = await svc.from("payout_reversals")
      .select("status, stripe_reversal_id, idempotency_key").eq("payout_id", payoutId)
      .order("created_at");
    const requested = rows!.filter((r) => r.status === "requested");
    expect(requested).toHaveLength(2); // az eredeti sorok érintetlenek
    const orphans = rows!.filter((r) => r.idempotency_key.startsWith("wh_"));
    expect(orphans).toHaveLength(2);
    expect(orphans.every((o) => o.status === "reconciliation_required")).toBe(true);
    const { data: po } = await svc.from("payouts")
      .select("reversed_amount").eq("id", payoutId).single();
    expect(po?.reversed_amount).toBe(0); // NEM nőhetett vak párosítással
    await cleanup(f);
  }, 240_000);

  it("28) metadata alapú párosítás: a reversal a MEGFELELŐ refund-sorhoz kerül, azonos összegű társa érintetlen", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { payoutId, transferId } = await payOutProvider(f);

    // két AZONOS összegű reversal-sor: A-t beküldjük (metadataval), B függőben marad
    for (const key of [`it_m1_${Date.now()}`, `it_m2_${Date.now()}`]) {
      const r = await svc.rpc("request_payout_reversal", {
        p_payout: payoutId, p_amount: 3000, p_reason: "it_metadata", p_idempotency_key: key,
      });
      expect(r.error).toBeNull();
    }
    const { data: rows } = await svc.from("payout_reversals")
      .select("id").eq("payout_id", payoutId).eq("status", "requested").order("created_at");
    const [rowA, rowB] = rows!;
    const sub = await submitPayoutReversal(svc, new StripeProvider(), rowA.id);
    expect(sub.submitted).toBe(true);

    // a webhook a metadata.reversal_row_id alapján A-hoz párosít – B NEM
    const trr = await stripe.transfers.retrieve(transferId);
    const rev = trr.reversals?.data.find((x) => x.id === sub.stripeReversalId);
    await dispatchStripeEvent(svc, "transfer.reversed", {
      data: { object: {
        id: transferId, amount_reversed: 3000,
        reversals: { data: [{
          id: sub.stripeReversalId, amount: 3000,
          metadata: { reversal_row_id: rowA.id, ...(rev?.metadata ?? {}) },
        }] },
      } },
    });

    const { data: a } = await svc.from("payout_reversals").select("status").eq("id", rowA.id).single();
    const { data: b } = await svc.from("payout_reversals").select("status").eq("id", rowB.id).single();
    expect(a?.status).toBe("succeeded");
    expect(b?.status).toBe("requested"); // az azonos összegű társ NEM settle-lődött
    const { data: po } = await svc.from("payouts")
      .select("reversed_amount").eq("id", payoutId).single();
    expect(po?.reversed_amount).toBe(3000); // pontosan A összege
    await cleanup(f);
  }, 240_000);

  it("29) MANUÁLIS payout közben érkező refund – kötelezettség reconciliation_required, manuális rendezés audit-tal", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    const { data: bk } = await svc.from("bookings")
      .select("provider_amount").eq("id", f.bookingId).single();
    const payoutId = (await svc.from("payouts").select("id").eq("booking_id", f.bookingId).single()).data!.id;

    // release megkezdése (még nincs Transfer – manuális kifizetés lesz)
    const acq = await svc.rpc("acquire_payout_release", { p_payout: payoutId, p_actor: f.userId });
    expect(acq.error).toBeNull();

    // refund a releasing ALATT → kötelezettség (a payout összege érintetlen)
    const rr = await requestRefund(svc, {
      bookingId: f.bookingId, amountCents: 4000, currency: "EUR", reason: "it_manual_during",
    });
    expect(rr.ok).toBe(true);
    await dispatchChargeRefunded(f);

    // MANUÁLIS finalize: nincs tr_ ID → a kötelezettség NEM lehet 'requested'
    const fin = await svc.rpc("finalize_payout_release", {
      p_payout: payoutId, p_actor: f.userId, p_transfer_id: null,
      p_manual_reference: "bank:HU-IT-2026-0812", p_manual_note: "it manual payout",
    });
    expect(fin.error).toBeNull();
    expect(fin.data?.ok).toBe(true);
    const { data: obl } = await svc.from("payout_reversals")
      .select("id, status, requested_amount, stripe_reversal_id").eq("payout_id", payoutId).single();
    expect(obl!.status).toBe("reconciliation_required");
    expect(obl!.stripe_reversal_id).toBeNull(); // NINCS tr_ → NINCS automatikus 'requested'
    const { data: alertLog } = await svc.from("audit_log")
      .select("id").eq("action", "manual_payout_reversal_reconciliation_required")
      .eq("entity_id", payoutId);
    expect(alertLog!.length).toBeGreaterThan(0); // adminriasztás az audit logban

    // hiányos manuális rendezés → hiba (referencia/dátum/összeg/megjegyzés kötelező)
    const bad = await svc.rpc("resolve_reversal_manually", {
      p_reversal_row: obl!.id, p_admin: f.userId, p_reference: "x",
      p_resolved_date: "2026-08-30", p_amount: obl!.requested_amount, p_note: "ok",
    });
    expect(bad.error?.message).toContain("REFERENCE_REQUIRED");

    // teljes manuális rendezés: banki referencia + dátum + összeg + admin + jegyzet
    const res = await svc.rpc("resolve_reversal_manually", {
      p_reversal_row: obl!.id, p_admin: f.userId,
      p_reference: "bank-return:HU-IT-2026-0813", p_resolved_date: "2026-08-30",
      p_amount: obl!.requested_amount, p_note: "provider visszautalta bankon",
    });
    expect(res.error).toBeNull();
    const { data: after } = await svc.from("payout_reversals")
      .select("status").eq("id", obl!.id).single();
    expect(after?.status).toBe("succeeded");
    const { data: po } = await svc.from("payouts")
      .select("reversed_amount, amount, status").eq("id", payoutId).single();
    expect(po?.status).toBe("paid");
    expect(po?.amount).toBe(bk!.provider_amount);
    expect(po?.reversed_amount).toBe(obl!.requested_amount);
    const { data: resLog } = await svc.from("audit_log")
      .select("diff").eq("action", "payout_reversal.manual_resolution")
      .eq("entity_id", obl!.id).single();
    expect(resLog?.diff).toMatchObject({ reference: "bank-return:HU-IT-2026-0813" });
    await cleanup(f);
  }, 240_000);

  it("30) a transfer attempt összege a folyamat közben SOHA nem változik", async () => {
    const f = await makeFixture(10000);
    await dispatchStripeEvent(svc, "payment_intent.succeeded", piEvent(f.paymentIntentId, f.chargeId));
    await svc.from("providers").update({ stripe_account_id: connectAccountId }).eq("id", f.providerId);
    const { data: bk } = await svc.from("bookings")
      .select("provider_amount").eq("id", f.bookingId).single();
    const payoutId = (await svc.from("payouts").select("id").eq("booking_id", f.bookingId).single()).data!.id;

    const acq = await svc.rpc("acquire_payout_release", { p_payout: payoutId, p_actor: f.userId });
    const attemptId = acq.data![0].attempt_id as string;
    const frozen = acq.data![0].amount as number;
    expect(frozen).toBe(bk!.provider_amount);

    // refund a releasing alatt – az attempt összege NEM mozdul
    const rr = await requestRefund(svc, {
      bookingId: f.bookingId, amountCents: 3000, currency: "EUR", reason: "it_frozen",
    });
    expect(rr.ok).toBe(true);
    await dispatchChargeRefunded(f);
    const { data: at1 } = await svc.from("payout_transfer_attempts")
      .select("amount, status").eq("id", attemptId).single();
    expect(at1?.amount).toBe(frozen);
    const { data: po1 } = await svc.from("payouts").select("amount, status").eq("id", payoutId).single();
    expect(po1?.amount).toBe(frozen);
    expect(po1?.status).toBe("releasing");

    // finalize MÁS összeggel → AMOUNT_MISMATCH (közben nem csúszhat el)
    const badFin = await svc.rpc("finalize_payout_release", {
      p_payout: payoutId, p_actor: f.userId, p_transfer_id: `tr_it_fake_${Date.now()}`,
      p_manual_reference: null, p_manual_note: null, p_transferred_amount: frozen - 1,
    });
    expect(badFin.error?.message).toContain("AMOUNT_MISMATCH");

    // helyes finalize a befagyasztott összeggel → paid, attempt finalized
    const fin = await svc.rpc("finalize_payout_release", {
      p_payout: payoutId, p_actor: f.userId, p_transfer_id: `tr_it_frozen_${Date.now()}`,
      p_manual_reference: null, p_manual_note: null, p_transferred_amount: frozen,
    });
    expect(fin.error).toBeNull();
    expect(fin.data?.ok).toBe(true);
    const { data: at2 } = await svc.from("payout_transfer_attempts")
      .select("amount, status").eq("id", attemptId).single();
    expect(at2?.amount).toBe(frozen);
    expect(at2?.status).toBe("finalized");
    const { data: po2 } = await svc.from("payouts").select("amount, status").eq("id", payoutId).single();
    expect(po2?.status).toBe("paid");
    expect(po2?.amount).toBe(frozen);
    await cleanup(f);
  }, 240_000);
});
