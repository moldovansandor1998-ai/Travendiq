import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { escapeHtml } from "@/lib/escape";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Utaslista export (CSV) – csak a szolgáltató saját foglalásai. */
export async function GET(req: NextRequest) {
  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = createServiceClient();
  const ip = clientIp(req);
  if (!(await rateLimit(sb, `provider-export:${user.id}:${ip}`, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const { data: provider } = await sb.from("providers").select("id").eq("owner_id", user.id).maybeSingle();
  if (!provider) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const date = req.nextUrl.searchParams.get("date");
  let q = sb.from("bookings")
    .select("code, date, start_time, status, adults, children, infants, lead_name, lead_phone, hotel_name, pickup_address, special_requests")
    .eq("provider_id", provider.id)
    .in("status", ["confirmed", "pending_confirmation", "attended"])
    .order("date");
  if (date) q = q.eq("date", date);

  const { data } = await q;
  const csv = (v: unknown) => `"${escapeHtml(String(v ?? "")).replaceAll('"', '""')}"`;
  const rows = [
    ["code", "date", "time", "status", "adults", "children", "infants", "name", "phone", "hotel", "pickup", "requests"].join(","),
    ...(data ?? []).map((b) => [
      b.code, b.date, String(b.start_time).slice(0, 5), b.status, b.adults, b.children, b.infants,
      b.lead_name, b.lead_phone, b.hotel_name, b.pickup_address, b.special_requests,
    ].map(csv).join(",")),
  ];

  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="passenger-list${date ? `-${date}` : ""}.csv"`,
    },
  });
}
