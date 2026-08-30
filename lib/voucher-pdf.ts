import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { signVoucher } from "@/lib/qr";
import QRCode from "qrcode";
import type { VoucherLabels } from "@/lib/voucher-i18n";

export interface VoucherData {
  code: string;
  title: string;
  date: string;
  time: string;
  guests: string;
  leadName: string;
  meetingPoint: string;
  provider: string;
  /** a booking.customer_locale feliratai (angol fallback) */
  labels?: VoucherLabels;
}

/** Valódi, letölthető PDF voucher generálása aláírt QR-kóddal. */
export async function generateVoucherPdf(data: VoucherData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const teal = rgb(0.15, 0.38, 0.43);
  const dark = rgb(0.07, 0.17, 0.2);
  const gray = rgb(0.45, 0.5, 0.52);

  page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: teal });
  page.drawText("Travendiq", { x: 40, y: 810, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText("VOUCHER", { x: 480, y: 810, size: 14, font: bold, color: rgb(1, 1, 1) });

  const L = data.labels;
  page.drawText(L?.voucherTitle ?? "Booking voucher", { x: 40, y: 750, size: 10, font, color: gray });
  page.drawText(data.code, { x: 40, y: 728, size: 22, font: bold, color: dark });

  const rows: [string, string][] = [
    [L?.experience ?? "Experience", data.title],
    [L?.date ?? "Date", `${data.date}  ${data.time}`],
    [L?.guests ?? "Guests", data.guests],
    [L?.leadGuest ?? "Lead guest", data.leadName],
    [L?.meetingPoint ?? "Meeting point", data.meetingPoint],
    [L?.provider ?? "Provider", data.provider],
  ];
  let y = 690;
  for (const [label, value] of rows) {
    page.drawText(label, { x: 40, y, size: 9, font, color: gray });
    page.drawText(value.slice(0, 70), { x: 40, y: y - 16, size: 12, font: bold, color: dark });
    y -= 46;
  }

  const token = signVoucher({ code: data.code, exp: data.date });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travendiq.com";
  const qrData = await QRCode.toBuffer(`${site}/checkin/scan?t=${encodeURIComponent(token)}`, {
    width: 300, margin: 1,
  });
  const qrImage = await doc.embedPng(qrData);
  page.drawImage(qrImage, { x: 380, y: 560, width: 160, height: 160 });

  page.drawText(L?.showAtCheckin ?? "Show this voucher at check-in.", { x: 380, y: 545, size: 9, font, color: gray });
  page.drawLine({ start: { x: 40, y: 400 }, end: { x: 555, y: 400 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  page.drawText(
    "Travendiq acts as an intermediary marketplace. travendiq.com",
    { x: 40, y: 380, size: 8, font, color: gray }
  );

  return doc.save();
}
