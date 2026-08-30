/**
 * Jutalék-feloldás – a resolve_commission_rate() SQL függvény TS tükre.
 * Prioritás: listing > provider (override vagy szabály) > country > global > 15%.
 */
export interface CommissionRuleInput {
  listingRate?: number | null;
  providerOverride?: number | null;
  providerRate?: number | null;
  countryRate?: number | null;
  globalRate?: number | null;
}

export const DEFAULT_COMMISSION = 15;

export function resolveCommissionRate(r: CommissionRuleInput): number {
  return (
    r.listingRate ??
    r.providerOverride ??
    r.providerRate ??
    r.countryRate ??
    r.globalRate ??
    DEFAULT_COMMISSION
  );
}

export function splitAmounts(grandTotalCents: number, rate: number) {
  const commission = Math.round((grandTotalCents * rate) / 100);
  return { commission, provider: grandTotalCents - commission };
}
