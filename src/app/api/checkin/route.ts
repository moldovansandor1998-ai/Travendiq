import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { verifyVoucher } from "@/lib/qr";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Beléptetés API – QR-token vagy kézi kód alapján.
 * Csak szolgáltatói munkatárs (checkin jog) vagy staff használhatja.
 * Minden ellenőrzés naplózva a checkins táblába.
 * Offline mód: a kliens a tokeneket előre letöltheti, a sync flaggel tölti fel.
 */
async function authorize(providerId: string): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  // jogosultsági RPC-hiba NEM csendes (fail-closed: hibánál NEM jogosult)
  const { data, error: permErr } = await sb.rpc("has_provider_permission", { p: providerId, perm: "checkin" });
  if (permErr) console.error("[checkin] has_provider_permission failed:", permErr.message);
  if (!permErr && data) return true;
  const { data: staff, error: staffErr } = await sb.rpc("is_staff");
  if (staffErr) console.error("[checkin] is_staff failed:", staffErr.message);
  return !staffErr && Boolean(staff);
}

export async function GET(req: NextRequest) {
  // QR-beolvasás cél-URL-je: ?t=<signed token> – csak státuszlekérdezés
  const token = req.nextUrl.searchParams.get("t");
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });
  const payload = verifyVoucher(token);
  if (!payload) return NextResponse.json({ result: "invalid" }, { status: 200 });

  const sb = createServiceClient();
  const { data: b } = await sb.from("bookings")
    .select("code, status, date, provider_id, total_participants")
    .eq("code", payload.code).single();
  if (!b) return NextResponse.json({ result: "invalid" });
  return NextResponse.json({ result: b.status === "confirmed" ? "valid" : b.status, booking: { code: b.code, date: b.date } });
}

export async function POST(req: NextRequest) {
  const rl = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(rl, `checkin:${ip}`, 30))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as {
    code?: string; token?: string; participants?: number; method?: "qr" | "manual"; offline?: boolean;
  } | null;
  if (!body || (!body.code && !body.token)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let code = body.code?.toUpperCase();
  if (body.token) {
    const payload = verifyVoucher(body.token);
    if (!payload) {
      return NextResponse.json({ result: "invalid" });
    }
    code = payload.code;
  }

  const sb = createServiceClient();
  const { data: b } = await sb.from("bookings")
    .select("id, code, status, provider_id, total_participants")
    .eq("code", code!).single();

  if (!b || !(await authorize(b.provider_id))) {
    return NextResponse.json({ result: "invalid" }, { status: 403 });
  }

  const { data: previous } = await sb.from("checkins")
    .select("participants_admitted").eq("booking_id", b.id).eq("result", "valid");

  let result: "valid" | "already_used" | "invalid" | "partial";
  const admitted = Math.min(Math.max(1, body.participants ?? b.total_participants), b.total_participants);

  if (b.status !== "confirmed") {
    result = b.status === "attended" ? "already_used" : "invalid";
  } else {
    const already = (previous ?? []).reduce((s, c) => s + c.participants_admitted, 0);
    if (already >= b.total_participants) {
      result = "already_used";
    } else if (already + admitted < b.total_participants) {
      result = "partial"; // részleges csoportos beléptetés
    } else {
      result = "valid";
    }
  }

  const { error: checkinErr } = await sb.from("checkins").insert({
    booking_id: b.id,
    method: body.method ?? (body.token ? "qr" : "manual"),
    result,
    participants_admitted: result === "valid" || result === "partial" ? admitted : 0,
    device_info: req.headers.get("user-agent") ?? undefined,
    is_offline_sync: Boolean(body.offline),
  });
  if (checkinErr) {
    console.error("[checkin] insert failed:", checkinErr.message);
    return NextResponse.json({ error: "checkin_record_failed" }, { status: 500 });
  }

  if (result === "valid") {
    const { error: upErr } = await sb.from("bookings").update({ status: "attended" }).eq("id", b.id);
    if (upErr) {
      console.error("[checkin] booking status update failed:", upErr.message);
      return NextResponse.json({ error: "status_update_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ result, booking: { code: b.code } });
}
