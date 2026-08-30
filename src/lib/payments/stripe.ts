import Stripe from "stripe";
import type {
  CreatePaymentInput, PaymentIntentResult, PaymentProvider, RefundResult, WebhookEvent,
} from "./types";

/**
 * Stripe Connect Express által támogatott országok (platform szempontból
 * elérhető Express-országlista – a Stripe docs alapján karbantartandó).
 *
 * FONTOS – ez a lista kizárólag ELŐZETES UI-VALIDÁCIÓ (a provider onboarding
 * országválasztója szűri vele a nyilvánvalóan lehetetlen országokat).
 * A határokon átnyúló (cross-border) transzfer tényleges megvalósíthatósága
 * a PLATFORM országától függ: a Stripe korlátozhatja, hogy egy adott országú
 * platform mely connected-account országokba utalhat (pl. cross-border
 * payout-korlátozások, platform capabilities). A végső elbírálás ezért MINDIG
 * a Stripe-side történik: az admin payout-folyamat a release előtt frissen
 * lekéri a connected account capabilities.transfers + payouts_enabled
 * állapotát (getAccountDetails), és csak 'active' esetén küldi a transzfert.
 * Ha a Stripe 'inactive'/'restricted'-et ad vissza, a payout blokkolva marad
 * és admin-beavatkozás kell. Lásd még: docs/EXTERNAL-APPROVALS.md.
 */
export const SUPPORTED_CONNECT_COUNTRIES = new Set([
  "AT","AU","BE","BG","BR","CA","CH","CY","CZ","DE","DK","EE","ES","FI","FR",
  "GB","GR","HK","HR","HU","IE","IT","JP","LI","LT","LU","LV","MT","MX","MY",
  "NL","NO","NZ","PL","PT","RO","SE","SG","SI","SK","TH","US","AE",
]);

export function isSupportedConnectCountry(code: string | null | undefined): boolean {
  return !!code && SUPPORTED_CONNECT_COUNTRIES.has(code.toUpperCase());
}

/**
 * Stripe-hiba osztályozása pénzügyi műveleteknél (Transfer / Reversal).
 *
 *  - 'final': egyértelmű Stripe-ELUTASÍTÁS (érvénytelen kérés, jogosultság,
 *    hitelesítés, kártya, idempotencia-ütközés) → a művelet véglegesen failed,
 *    NEM szabad vakon újrapróbálni.
 *  - 'ambiguous': hálózati timeout, kapcsolathiba, 5xx, rate limit, ismeretlen
 *    → NEM biztos sikertelenség! A művelet a Stripe-on LÉTREJÖHETT. Azonos
 *    idempotencia-kulccsal kell újrafuttatni / egyeztetni.
 */
export function classifyStripeError(e: unknown): "final" | "ambiguous" {
  const type = (e as { type?: string } | null)?.type;
  if (
    type === "StripeInvalidRequestError" ||
    type === "StripeAuthenticationError" ||
    type === "StripePermissionError" ||
    type === "StripeIdempotencyError" ||
    type === "StripeCardError"
  ) {
    return "final";
  }
  // StripeAPIError, StripeConnectionError, StripeRateLimitError, timeout, ismeretlen
  return "ambiguous";
}

/**
 * Stripe Connect marketplace architektúra: SEPARATE CHARGES AND TRANSFERS.
 *
 * Pénzáramlás:
 *  1. A vásárló a Travendiq PLATFORM számláján fizet (PaymentIntent, destination NÉLKÜL).
 *  2. A teljes összeg – beleértve a szolgáltató részét is – a platform
 *     Stripe-egyenlegén marad a program teljesüléséig (valódi visszatartás).
 *  3. A kifizetés admin- vagy automatikus "release" során, EGYSZER történik:
 *     Stripe Transfer a szolgáltató Connect-számlájára, source_transaction-nel
 *     az eredeti charge-hoz kötve, idempotencia-kulccsal (payout_<id>).
 *  4. Refundnál a platform fizeti vissza a vásárlónak; ha a szolgáltató már
 *     megkapta a transzfer, azt Transfer Reversal-lel vonjuk vissza
 *     (reverse_transfer), a platformjutalékot pedig visszaírjuk a főkönyvben.
 *
 * A destination charges + application_fee modellt szándékosan NEM használjuk:
 * ott a pénz a foglalás pillanatában a szolgáltatónál landol, ami nem
 * valódi visszatartás, és a későbbi release dupla kifizetést okozna.
 * (Stripe holding period: a platformegyenlegen tartott összegre a Stripe
 * marketplace-irányelvei vonatkoznak – ld. docs/EXTERNAL-APPROVALS.md.)
 */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  private stripe: Stripe | null = null;

  client(): Stripe {
    if (!this.stripe) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("STRIPE_SECRET_KEY nincs beállítva");
      this.stripe = new Stripe(key);
    }
    return this.stripe;
  }

  isConfigured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }

  /** Platform-számlás PaymentIntent (separate charges – nincs destination). */
  async createPayment(input: CreatePaymentInput): Promise<PaymentIntentResult> {
    const pi = await this.client().paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { booking_id: input.bookingId, booking_code: input.bookingCode },
        receipt_email: input.customerEmail ?? undefined,
      },
      { idempotencyKey: input.idempotencyKey }
    );
    return {
      provider: this.name,
      providerPaymentId: pi.id,
      clientSecret: pi.client_secret,
      status: pi.status === "succeeded" ? "captured" : "requires_payment",
      chargeId: typeof pi.latest_charge === "string" ? pi.latest_charge : null,
    };
  }

  async getChargeId(paymentIntentId: string): Promise<string | null> {
    const pi = await this.client().paymentIntents.retrieve(paymentIntentId);
    return typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
  }

  /** Meglévő PaymentIntent client_secret-je (újratöltés / dupla kattintás esetére). */
  async getClientSecret(paymentIntentId: string): Promise<string | null> {
    const pi = await this.client().paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "canceled") return null;
    return pi.client_secret ?? null;
  }

  /**
   * Teljes vagy részleges refund.
   * Az idempotencia-kulcs a BELSŐ refund rekord UUID-jából készül – így két
   * azonos összegű részleges refund is külön Stripe-refundot kap, és a webhook
   * a provider_refund_id (re_...) alapján egyenként egyeztethető.
   *
   * NINCS reverse_transfer/refund_application_fee: separate charges and transfers
   * modellben a refund NEM vonja vissza automatikusan a szolgáltatónak már
   * átutalt transzfert – azt a reverseTransfer() (transfers.createReversal)
   * végzi, a payout állapotának megfelelően (lásd webhook charge.refunded).
   */
  async refund(providerPaymentId: string, amountCents: number, refundId: string): Promise<RefundResult> {
    const r = await this.client().refunds.create(
      { payment_intent: providerPaymentId, amount: amountCents },
      { idempotencyKey: `refund_${refundId}` }
    );
    return {
      providerRefundId: r.id,
      status: r.status === "succeeded" ? "processed" : r.status === "failed" ? "failed" : "pending",
    };
  }

  // ---------- Stripe Connect ----------

  async createConnectAccount(input: {
    email: string; country: string; businessType: "company" | "individual";
  }): Promise<{ accountId: string }> {
    const account = await this.client().accounts.create({
      type: "express",
      country: input.country,
      email: input.email,
      business_type: input.businessType === "company" ? "company" : "individual",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    return { accountId: account.id };
  }

  async createOnboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
    const link = await this.client().accountLinks.create({
      account: accountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: "account_onboarding",
    });
    return link.url;
  }



  /**
   * Szolgáltatói kifizetés: EGYSZERI transzfer a Connect-számlára.
   * source_transaction köti az eredeti charge-hoz (Stripe oldali egyeztetés),
   * az idempotencia-kulcs (payout_<uuid>) a dupla kifizetés ellen véd.
   */
  async transferToProvider(input: {
    accountId: string; amountCents: number; currency: string;
    idempotencyKey: string; sourceChargeId?: string | null;
  }): Promise<{ transferId: string; amountCents: number }> {
    const t = await this.client().transfers.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        destination: input.accountId,
        ...(input.sourceChargeId ? { source_transaction: input.sourceChargeId } : {}),
        metadata: { payout_key: input.idempotencyKey },
      },
      { idempotencyKey: input.idempotencyKey }
    );
    // a ténylegesen átutalt összeget adjuk vissza – ezt könyveli a finalize
    return { transferId: t.id, amountCents: t.amount };
  }

  /**
   * Transzfer visszavonása (transfers.createReversal) – refund/chargeback esetén
   * a már KIFIZETETT szolgáltatói részre. Támogatja a részleges visszavonást;
   * elégtelen connected-account balance esetén a Stripe `balance_insufficient`
   * hibát dob, amit a hívó kezel (payout reversal_status = 'failed').
   * Az idempotencia-kulcsot a hívó adja (pl. revref_<refundUuid>), így ugyanaz
   * a refund nem von vissza kétszer.
   */
  async reverseTransfer(
    transferId: string, amountCents: number, idempotencyKey: string,
    metadata?: Record<string, string>,
  ): Promise<{ reversalId: string }> {
    const r = await this.client().transfers.createReversal(
      transferId,
      // metadata: reversal_row_id / refund_id|dispute_id / idempotency_key /
      // payout_id – a transfer.reversed webhook EZZEL párosítja a belső sort
      { amount: amountCents, ...(metadata ? { metadata } : {}) },
      { idempotencyKey }
    );
    return { reversalId: r.id };
  }

  /** Részletes Connect-állapot: capability-k, requirements, disabled_reason, ország. */
  async getAccountDetails(accountId: string): Promise<{
    chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean;
    currentlyDue: string[]; pastDue: string[]; disabledReason: string | null;
    capabilities: Record<string, string>; country: string | null;
  }> {
    const a = await this.client().accounts.retrieve(accountId);
    return {
      chargesEnabled: a.charges_enabled ?? false,
      payoutsEnabled: a.payouts_enabled ?? false,
      detailsSubmitted: a.details_submitted ?? false,
      currentlyDue: a.requirements?.currently_due ?? [],
      pastDue: a.requirements?.past_due ?? [],
      disabledReason: a.requirements?.disabled_reason ?? null,
      capabilities: {
        card_payments: a.capabilities?.card_payments ?? "inactive",
        transfers: a.capabilities?.transfers ?? "inactive",
      },
      country: a.country ?? null,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): { valid: boolean; event?: WebhookEvent } {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) return { valid: false };
    try {
      const event = this.client().webhooks.constructEvent(rawBody, signature, secret);
      const obj = event.data.object as { id?: string };
      return {
        valid: true,
        event: {
          providerEventId: event.id,
          type: event.type,
          providerPaymentId: obj.id ?? "",
          raw: event,
        },
      };
    } catch {
      return { valid: false };
    }
  }
}
