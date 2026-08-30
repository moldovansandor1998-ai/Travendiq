import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/lib/payments";
import { dispatchStripeEvent } from "@/lib/webhooks/stripe-handlers";

/**
 * Stripe webhook végpont.
 *
 * Feldolgozási modell:
 *  1. aláírás-ellenőrzés (STRIPE_WEBHOOK_SECRET),
 *  2. ATOMIKUS claim (claim_payment_event RPC): egy eseményt egyszerre csak egy
 *     worker dolgozhat fel; lock-timeout után a félbehagyott esemény újra claimelhető,
 *  3. a handler minden pénzügyi DB-művelet hibáját ellenőrzi – hiba esetén az
 *     esemény 'failed' lesz (NEM processed) és 500-at adunk → a Stripe újraküldi,
 *  4. siker esetén finish_payment_event → 'processed'.
 *  Emailküldés nincs a feldolgozásban – a handlerek az email_outboxba állítanak.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  const provider = getPaymentProvider("stripe");

  const { valid, event } = provider.verifyWebhookSignature(rawBody, signature);
  if (!valid || !event) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const sb = createServiceClient();
  const worker = `wh_${process.env.VERCEL_REGION ?? "local"}_${Date.now()}`;

  // 1) atomikus claim – dupla esemény / párhuzamos worker kizárva
  const { data: claim, error: claimErr } = await sb.rpc("claim_payment_event", {
    p_provider: "stripe",
    p_event_id: event.providerEventId,
    p_type: event.type,
    p_payload: event.raw as Record<string, unknown>,
    p_worker: worker,
  });
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (claim === "already_processed") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (claim === "locked") {
    // egy másik worker dolgozik rajta – a Stripe újrapróbálja később
    return NextResponse.json({ received: true, locked: true }, { status: 409 });
  }

  // 2) feldolgozás – hiba esetén NEM lesz processed, a Stripe retry-ja újrafuttatja.
  //    A finish_payment_event v2 CSAK akkor zárja le az eseményt, ha
  //    locked_by = ez a worker ÉS a státusz még 'processing' (00019).
  //    Ha a lock közben lejárt és egy másik worker átvette (return false),
  //    ez a "stale" worker NEM jelölheti be fejezettnek: 500 → Stripe retry.
  try {
    await dispatchStripeEvent(sb, event.type, event.raw as {
      data: { object: Record<string, unknown> }; account?: string;
    });
    const { data: finished } = await sb.rpc("finish_payment_event", {
      p_provider: "stripe", p_event_id: event.providerEventId,
      p_worker: worker, p_success: true,
    });
    if (finished !== true) {
      return NextResponse.json({ error: "lock_lost_before_finish" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "processing_error";
    await sb.rpc("finish_payment_event", {
      p_provider: "stripe", p_event_id: event.providerEventId,
      p_worker: worker, p_success: false, p_error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
