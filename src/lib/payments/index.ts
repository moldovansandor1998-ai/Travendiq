import { StripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

const registry: Record<string, () => PaymentProvider> = {
  stripe: () => new StripeProvider(),
  // future: adyen: () => new AdyenProvider(), barion: () => new BarionProvider(),
};

export function getPaymentProvider(name = "stripe"): PaymentProvider {
  const factory = registry[name];
  if (!factory) throw new Error(`Ismeretlen payment provider: ${name}`);
  return factory();
}

export type { PaymentProvider } from "./types";
