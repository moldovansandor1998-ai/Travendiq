/**
 * Email-linkek foglalásokhoz. Vendégfoglalásnál a link MINDIG tartalmazza a
 * guest_access_token-t, különben a vásárló 403-at kapna. Bejelentkezett
 * vásárlónál nincs token az URL-ben.
 * A token csak az emailben és a felhasználó böngészőjében jelenik meg –
 * nem naplózzuk (az email_log csak a sablon nevét tárolja).
 */
export function bookingLink(input: {
  code: string;
  locale: string;
  guestToken?: string | null;
  path?: string; // pl. "account/reviews/new?booking=..." helyett alapértelmezett a foglalás-oldal
}): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travendiq.com";
  const base = `${site}/${input.locale}/booking/${input.code}`;
  return input.guestToken ? `${base}?token=${input.guestToken}` : base;
}

export function voucherLink(input: {
  code: string; locale: string; guestToken?: string | null; format?: "pdf" | "html";
}): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travendiq.com";
  const q = new URLSearchParams();
  if (input.guestToken) q.set("token", input.guestToken);
  if (input.format) q.set("format", input.format);
  const qs = q.toString();
  return `${site}/api/voucher/${input.code}${qs ? `?${qs}` : ""}`;
}
