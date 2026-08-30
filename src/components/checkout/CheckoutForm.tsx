"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return stripePromise;
}

/**
 * Kártyaadat-bekérő felület Stripe Payment Elementtel.
 * A clientSecretet a /api/bookings/[id]/pay végpontról kéri,
 * a megerősítés kliensoldalon történik (3DS támogatva).
 */
export function CheckoutForm({
  bookingId, token, returnUrl, labels,
}: {
  bookingId: string;
  token?: string;
  returnUrl: string;
  labels: { pay: string; secure: string; failed: string; loading: string };
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/bookings/${bookingId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token ?? null }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "payment_init_failed");
        if (data.free) {
          window.location.href = returnUrl + "?paid=1";
          return null;
        }
        return data.clientSecret as string;
      })
      .then((cs) => cs && setClientSecret(cs))
      .catch((err) => setError(err.message));
  }, [bookingId, token, returnUrl]);

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {labels.failed} ({error})
      </div>
    );
  }
  if (!clientSecret) {
    return <p className="py-6 text-center text-sm text-lagoon-500">{labels.loading}</p>;
  }

  return (
    <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#2a7685" } } }}>
      <InnerForm returnUrl={returnUrl} labels={labels} />
    </Elements>
  );
}

function InnerForm({ returnUrl, labels }: { returnUrl: string; labels: { pay: string; secure: string; failed: string } }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl + "?paid=1" },
    });
    if (error) {
      setError(error.message ?? labels.failed);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" type="submit" disabled={!stripe || busy}>
        {labels.pay}
      </button>
      <p className="text-center text-xs text-lagoon-500">{labels.secure} · Stripe</p>
    </form>
  );
}
