import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const TABLES: Record<string, { table: string; columns: string }> = {
  bookings: { table: "bookings", columns: "code,date,status,grand_total,currency,lead_name,lead_email,created_at" },
  payouts: { table: "payouts", columns: "id,provider_id,amount,currency,status,scheduled_for,paid_at,created_at" },
  users: { table: "profiles", columns: "id,email,full_name,is_suspended,created_at" },
  ledger: { table: "ledger_entries", columns: "id,provider_id,booking_id,kind,amount,currency,created_at" },
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  try {
    const { svc } = await requireAdmin("en");
    const ip = clientIp(req);
    if (!(await rateLimit(svc, `admin-export:${ip}`, 10))) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    const kind = new URL(req.url).searchParams.get("kind") ?? "";
    const cfg = TABLES[kind];
    if (!cfg) return NextResponse.json({ error: "unknown export" }, { status: 400 });

    const { data, error } = await svc.from(cfg.table).select(cfg.columns).limit(10000);
    if (error) throw error;

    const cols = cfg.columns.split(",");
    const lines = [cols.join(",")];
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      lines.push(cols.map((c) => csvEscape(row[c])).join(","));
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="travendiq-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
