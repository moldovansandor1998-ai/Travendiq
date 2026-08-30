/**
 * Provider-független fizetési felület.
 * A Stripe az első implementáció; új providert a PaymentProvider interfész
 * megvalósításával lehet csatlakoztatni (pl. Adyen, PayU, Barion).
 */
export interface PaymentIntentResult {
  provider: string;
  providerPaymentId: string;
  clientSecret: string | null;
  status: "requires_payment" | "authorized" | "captured" | "failed";
  chargeId?: string | null;          // ch_... a transzfer source_transaction-jéhez
}

export interface CreatePaymentInput {
  bookingId: string;
  bookingCode: string;
  amountCents: number;
  currency: string;
  customerEmail?: string | null;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: "pending" | "processed" | "failed";
}

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntentResult>;
  /**
   * Refund indítása. Az idempotencia-kulcs a BELSŐ refund rekord UUID-jából
   * készül (refundId) – így két azonos összegű részleges refund is külön
   * Stripe-refund, a belső rekord pedig pontosan egyeztethető.
   */
  refund(providerPaymentId: string, amountCents: number, refundId: string): Promise<RefundResult>;
  /** Meglévő PaymentIntent client_secret-je (újratöltés / dupla kattintás esetére). */
  getClientSecret(paymentIntentId: string): Promise<string | null>;
  verifyWebhookSignature(rawBody: string, signature: string | null): { valid: boolean; event?: WebhookEvent };
}

export interface WebhookEvent {
  providerEventId: string;
  type: string;              // pl. payment.succeeded | payment.failed | charge.refunded | chargeback
  providerPaymentId: string;
  raw: unknown;
}
