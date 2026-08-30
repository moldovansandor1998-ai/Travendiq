/**
 * Visszatérítés-számítás – a compute_refund_amount() SQL függvény TS tükre.
 * A kettőt szinkronban kell tartani; az SQL a végső igazság (az adatbázisban fut).
 */
export type CancellationPolicy = "full_until_hours" | "percent_refund" | "non_refundable";

export interface RefundInput {
  grandTotalCents: number;
  policy: CancellationPolicy;
  cancelFullHours: number;   // teljes visszatérítés határideje órában
  cancelPercent: number;     // százalékos visszatérítésnél
  hoursUntilStart: number;   // hány óra van a kezdésig (negatív, ha már elmúlt)
  cancelReason?: string;     // provider_cancelled | weather → 100%
  currentStatus: string;
}

export function computeRefundAmount(i: RefundInput): number {
  if (i.currentStatus === "refunded" || i.currentStatus === "cancelled") return 0;
  if (i.cancelReason === "provider_cancelled" || i.cancelReason === "weather") {
    return i.grandTotalCents;
  }
  switch (i.policy) {
    case "non_refundable":
      return 0;
    case "percent_refund":
      return Math.round((i.grandTotalCents * i.cancelPercent) / 100);
    case "full_until_hours":
    default:
      return i.hoursUntilStart >= i.cancelFullHours ? i.grandTotalCents : 0;
  }
}

/**
 * Refund főkönyvi felosztása – a settle_refund() SQL függvény TS tükre.
 * A visszatérített összeget a platformjutalék-arány szerint osztja:
 * provider_share + platform_share = amount.
 */
export function splitRefund(amountCents: number, grandTotalCents: number, commissionCents: number): {
  providerShare: number; platformShare: number;
} {
  const platformShare = grandTotalCents > 0
    ? Math.round((amountCents * commissionCents) / grandTotalCents)
    : 0;
  return { providerShare: amountCents - platformShare, platformShare };
}
