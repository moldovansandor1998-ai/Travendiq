import { createHmac } from "crypto";
import QRCode from "qrcode";

/**
 * Voucher QR payload: HMAC-aláírt tartalom, hogy a beléptető oldal
 * hamisítás ellen védve ellenőrizhesse. Wallet-integrációra előkészítve:
 * a payload később 1:1-ben Apple/Google Wallet pass mezőire mappelhető.
 */
export interface VoucherPayload {
  code: string;        // foglalási azonosító (TRV-26-XXXXXX)
  exp: string;         // a program dátuma (ISO)
}

export function signVoucher(payload: VoucherPayload): string {
  const secret = process.env.VOUCHER_SIGNING_SECRET;
  if (!secret) throw new Error("VOUCHER_SIGNING_SECRET hiányzik");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyVoucher(token: string): VoucherPayload | null {
  const secret = process.env.VOUCHER_SIGNING_SECRET;
  if (!secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (expected !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as VoucherPayload;
  } catch {
    return null;
  }
}

export async function voucherQrDataUrl(token: string): Promise<string> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const url = `${site}/api/checkin?t=${encodeURIComponent(token)}`;
  return QRCode.toDataURL(url, { width: 320, margin: 1 });
}
