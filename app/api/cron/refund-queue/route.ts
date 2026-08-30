import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { processDueRefunds, processDueReversals } from "@/lib/refunds/queue";
import { processDueTransferAttempts } from "@/lib/payments/transfer-attempts";

/**
 * Refund/reversal work queue feldolgozó (Vercel Cron: percenként, lásd vercel.json).
 * Hitelesítés: Authorization: Bearer <CRON_SECRET>.
 *
 * Feladatai:
 *  1. esedékes pending refundok idempotens újraküldése a Stripe-nak
 *     (késői fizetések auto-refundja + minden korábban meghiúsult refund;
 *     attempts/backoff/manual_review + kötelező adminriasztás),
 *  2. beadatlan payout-reversals sorok újraküldése (crash-recovery,
 *     azonos idempotencia-kulccsal),
 *  3. payout transfer-attemptek rekonsziliációja: a sikerült, de helyben nem
 *     lezárt Transfer (transfer_submitted) és a bizonytalan (ambiguous)
 *     állapotok az EREDETI, befagyasztott összeggel és idempotencia-kulccsal
 *     újrapróbálkoznak — sosem új összeggel.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createServiceClient();
  const worker = `cron_refund_${Date.now()}`;

  try {
    const refunds = await processDueRefunds(sb, worker);
    const reversals = await processDueReversals(sb, worker);
    const transferAttempts = await processDueTransferAttempts(sb, worker);
    const failed =
      refunds.errors.length +
      reversals.errors.length +
      transferAttempts.errors.length;
    return NextResponse.json(
      { ok: failed === 0, refunds, reversals, transferAttempts },
      { status: failed > 0 ? 500 : 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "refund_queue_error" },
      { status: 500 },
    );
  }
}
