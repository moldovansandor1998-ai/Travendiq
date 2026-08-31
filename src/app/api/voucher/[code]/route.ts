import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { signVoucher, voucherQrDataUrl } from "@/lib/qr";
import { generateVoucherPdf } from "@/lib/voucher-pdf";
import { escapeHtml } from "@/lib/escape";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { voucherLabels } from "@/lib/voucher-i18n";

/**
 * Voucher letöltés: ?format=pdf → valódi PDF, alapértelmezésben nyomtatható HTML.
 *
 * Hozzáférés (KÉT jogosult út):
 *  1. VENDÉG: érvényes guest_access_token a ?token= paraméterben;
 *  2. BEJELENTKEZETT TULAJDONOS: a booking user_id-je a session user – ilyenkor
 *     NEM kell a guest token az URL-be (a bejelentkezett vásárló oldala
 *     token nélkül hívja).
 * A tokent nem naplózzuk és a válaszban sem jelenítjük meg.
 * A feliratok és a listing címe a booking.customer_locale-t követik (en fallback).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  const token = req.nextUrl.searchParams.get("token");
  const format = req.nextUrl.searchParams.get("format") ?? "html";

  let sb;
  try {
    sb = createServiceClient();
  } catch (e) {
    // konfigurációs hiba (hiányzó service role kulcs) – naplózott, NEM csendes 500
    console.error("[voucher] service client init failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
  const ip = clientIp(req);
  if (!(await rateLimit(sb, `voucher:${ip}`, 20))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { data: b, error: readErr } = await sb
    .from("bookings")
    .select(`code, date, start_time, adults, children, infants, lead_name, status,
      guest_access_token, user_id, customer_locale,
      listing:listings(translations:listing_translations(locale,title), meeting_point,
        provider:providers(display_name))`)
    .eq("code", params.code.toUpperCase())
    .maybeSingle();

  if (readErr) {
    // DB-hiba NEM csendes: 503 + napló (nem 403 – az jogosultsági válasz lenne)
    console.error("[voucher] booking lookup failed:", readErr.message);
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
  if (!b) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 1) vendég: érvényes guest token
  let authorized = Boolean(token) && token === b.guest_access_token;

  // 2) bejelentkezett tulajdonos: session user == booking.user_id (token nélkül)
  if (!authorized && b.user_id) {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (user && user.id === b.user_id) authorized = true;
  }

  if (!authorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!["confirmed", "attended", "completed"].includes(b.status)) {
    return NextResponse.json({ error: "voucher_not_available" }, { status: 409 });
  }

  // a voucher nyelve a booking.customer_locale (angol fallback)
  const { labels: L, locale, rtl } = voucherLabels(b.customer_locale);

  const listing = b.listing as unknown as {
    translations: { locale: string; title: string }[];
    meeting_point: string | null;
    provider: { display_name: string } | null;
  };
  // a listing címe az ügyfél locale-ján, angol fallbackkel
  const title =
    listing?.translations?.find((x) => x.locale === locale)?.title ??
    listing?.translations?.find((x) => x.locale === "en")?.title ?? "";
  const meeting = listing?.meeting_point ?? "";
  const provider = listing?.provider?.display_name ?? "";
  const guests = `${b.adults} ${L.adults}, ${b.children} ${L.children}, ${b.infants} ${L.infants}`;
  const time = String(b.start_time).slice(0, 5);

  if (format === "pdf") {
    // pdf-lib WinAnsi: az arab feliratokat nem tudja kirajzolni → a PDF-nél
    // arab locale esetén angol feliratok (a HTML voucher teljes ar/RTL támogatott)
    const pdfLabels = rtl ? voucherLabels("en").labels : L;
    const pdf = await generateVoucherPdf({
      code: b.code, title, date: b.date, time, guests,
      leadName: b.lead_name ?? "", meetingPoint: meeting, provider,
      labels: pdfLabels,
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="travendiq-voucher-${b.code}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // HTML fallback (mobilra optimalizált, escape-elve, RTL-támogatással)
  const qrToken = signVoucher({ code: b.code, exp: b.date });
  const qr = await voucherQrDataUrl(qrToken);
  const html = `<!doctype html><html lang="${locale}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Travendiq – ${escapeHtml(L.voucherTitle)} ${escapeHtml(b.code)}</title>
<style>body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#132c34}
.card{border:1px solid #ddd;border-radius:14px;padding:24px}
h1{color:#28616d;font-size:20px;margin:0 0 4px}.code{font-family:monospace;font-size:24px;font-weight:bold;margin:8px 0 16px}
table{width:100%;font-size:15px;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #eee;color:#333}
td:first-child{color:#888;width:40%}img{display:block;margin:24px auto;max-width:220px;width:60%}
.foot{font-size:12px;color:#888;text-align:center;margin-top:16px}</style></head>
<body><div class="card">
<h1>Travendiq</h1>
<p class="code">${escapeHtml(b.code)}</p>
<table>
<tr><td>${escapeHtml(L.experience)}</td><td><b>${escapeHtml(title)}</b></td></tr>
<tr><td>${escapeHtml(L.date)}</td><td>${escapeHtml(b.date)} ${escapeHtml(time)}</td></tr>
<tr><td>${escapeHtml(L.guests)}</td><td>${escapeHtml(guests)}</td></tr>
<tr><td>${escapeHtml(L.leadGuest)}</td><td>${escapeHtml(b.lead_name)}</td></tr>
<tr><td>${escapeHtml(L.meetingPoint)}</td><td>${escapeHtml(meeting)}</td></tr>
<tr><td>${escapeHtml(L.provider)}</td><td>${escapeHtml(provider)}</td></tr>
</table>
<img src="${qr}" alt="${escapeHtml(L.qrAlt)}"/>
<p class="foot">${escapeHtml(L.showAtCheckin)} · travendiq.com</p>
</div></body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
