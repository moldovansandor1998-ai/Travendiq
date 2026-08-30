import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import type { EmailTemplate, EmailVars } from "@/lib/email";

/**
 * Email outbox feldolgozó (Vercel Cron: percenként, lásd vercel.json).
 * Hitelesítés: Authorization: Bearer <CRON_SECRET> (a Vercel automatikusan
 * elküldi, ha a CRON_SECRET env be van állítva).
 *
 * A pénzügyi webhookok/flow-k csak sorba állítanak (enqueue_email) – a tényleges
 * küldés itt történik, külön folyamatban, próbálkozásszámlálóval. Egy emailhiba
 * így sosem befolyásolja a fizetési állapotot.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createServiceClient();
  const worker = `cron_${Date.now()}`;

  const { data: batch, error } = await sb.rpc("claim_pending_emails", {
    p_limit: 25, p_worker: worker,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (batch ?? []) as {
    id: string; to_email: string; template: string; locale: string; vars: Record<string, string>;
  }[];

  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    try {
      const sendResult = await sendEmail({
        to: row.to_email,
        template: row.template as EmailTemplate,
        locale: row.locale,
        vars: row.vars as EmailVars,
      });
      if (!sendResult.ok) {
        throw new Error("email_send_failed");
      }
      // KRITIKUS: a küldés MÁR megtörtént – a 'sent' státuszmentés hibája NEM
      // jelentheti azt, hogy az email "nem ment ki" (az újra-claim duplikálna).
      // A sor 'sending' állapotban marad, és a lock-timeout után újra
      // claimelhető lesz (enqueue dedupe védi a címzettet).
      const { error: sentErr } = await sb.rpc("mark_email_sent", { p_id: row.id });
      if (sentErr) {
        console.error(`[email-outbox] mark_email_sent failed for ${row.id}:`, sentErr.message);
        errors.push(`mark_sent:${row.id}`);
      }
      sent++;
    } catch (e) {
      const { error: failErr } = await sb.rpc("mark_email_failed", {
        p_id: row.id, p_error: e instanceof Error ? e.message : "send_failed",
      });
      if (failErr) {
        console.error(`[email-outbox] mark_email_failed failed for ${row.id}:`, failErr.message);
        errors.push(`mark_failed:${row.id}`);
      }
      failed++;
    }
  }

  // a státuszmentési hibák láthatók legyenek a monitorozásban (500), nem csendesek
  if (errors.length > 0) {
    return NextResponse.json(
      { processed: rows.length, sent, failed, errors },
      { status: 500 },
    );
  }
  return NextResponse.json({ processed: rows.length, sent, failed });
}
