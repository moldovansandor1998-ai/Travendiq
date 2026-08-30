import { Resend } from "resend";
import { escapeHtml } from "@/lib/escape";

/**
 * Resend emailrendszer – teljes sablonkészlet, újraküldés, naplózás.
 * - Fejlesztés: RESEND_API_KEY nélkül a levelek a konzolra és az email_logba kerülnek
 *   (a napló status = 'simulated', jól láthatóan).
 * - Production: kulcs nélkül a küldés HIBÁT dob (csendes szimuláció tiltva).
 */

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "Travendiq <no-reply@travendiq.com>";
const IS_PROD = process.env.NODE_ENV === "production";

export type EmailTemplate =
  | "registration" | "email_confirmation" | "provider_application"
  | "provider_docs_required" | "provider_approved" | "provider_rejected"
  | "provider_team_invitation"
  | "booking_confirmation" | "payment_receipt" | "trip_reminder"
  | "pickup_info" | "booking_modified" | "booking_cancelled"
  | "refund_processed" | "review_request" | "payout_notification" | "security_alert";

export interface EmailVars {
  code?: string; title?: string; date?: string; time?: string;
  amount?: string; currency?: string; name?: string; message?: string;
  link?: string; meetingPoint?: string; pickupTime?: string;
  reason?: string; missingDocs?: string; period?: string; [k: string]: string | undefined;
}

interface SendInput {
  to: string;
  template: EmailTemplate;
  locale?: string;
  vars?: EmailVars;
}

type Tpl = { subject: string; body: (v: EmailVars) => string };
type TplSet = Record<EmailTemplate, Tpl>;

const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:14px;">${label}</a>`;

const en: TplSet = {
  registration: { subject: "Welcome to Travendiq", body: (v) => `<p>Hi ${e(v.name)},</p><p>your Travendiq account is ready. Discover and book experiences worldwide.</p>` },
  email_confirmation: { subject: "Confirm your Travendiq account", body: (v) => `<p>Welcome to Travendiq${v.name ? `, ${e(v.name)}` : ""}.</p><p>Please confirm your email address to activate your account and start discovering experiences.</p>${v.link ? btn(v.link, "Confirm my email") : ""}<p style="margin-top:20px;color:#6b7280;font-size:12px">This secure link can only be used once. If you did not create a Travendiq account, you can safely ignore this email.</p>` },
  provider_application: { subject: "Provider application received", body: () => `<p>Thank you for applying as a Travendiq provider. Our team will review your application and documents. You can publish paid experiences after approval.</p>` },
  provider_docs_required: { subject: "Additional documents required", body: (v) => `<p>We need additional documents to verify your provider account:</p><p><b>${e(v.missingDocs)}</b></p><p>Please upload them in your provider dashboard.</p>` },
  provider_approved: { subject: "Your provider account is approved", body: (v) => `<p>Great news${v.name ? `, ${e(v.name)}` : ""}! Your provider account has been approved. You can now publish and sell experiences on Travendiq.</p>` },
  provider_rejected: { subject: "Provider application update", body: (v) => `<p>Unfortunately we could not approve your provider application at this time.</p>${v.reason ? `<p>Reason: ${e(v.reason)}</p>` : ""}<p>You may re-apply after resolving the issues above.</p>` },
  provider_team_invitation: { subject: "You have been invited to a Travendiq provider team", body: (v) => `<p><b>${e(v.name)}</b> invited you to join their Travendiq provider team.</p><p>Sign in or create an account with this email address, then accept the invitation.</p>${v.link ? btn(v.link, "Open invitation") : ""}<p style="margin-top:20px;color:#6b7280;font-size:12px">This invitation expires in 7 days.</p>` },
  booking_confirmation: { subject: "Booking confirmed – {{code}}", body: (v) => `<p>Thank you for your booking!</p><p><b>Booking code:</b> ${e(v.code)}</p><p><b>${e(v.title)}</b><br/>${e(v.date)} ${e(v.time ?? "")}</p>${v.meetingPoint ? `<p><b>Meeting point:</b> ${e(v.meetingPoint)}</p>` : ""}${v.voucher ? btn(v.voucher, "Download voucher") : ""}${v.link ? btn(v.link, "View booking") : ""}` },
  payment_receipt: { subject: "Payment receipt – {{code}}", body: (v) => `<p>We received your payment of <b>${e(v.amount)} ${e(v.currency)}</b> for booking <b>${e(v.code)}</b>.</p><p>This email serves as your payment confirmation.</p>${v.link ? btn(v.link, "View booking") : ""}` },
  trip_reminder: { subject: "Your trip is coming up – {{code}}", body: (v) => `<p>Reminder: <b>${e(v.title)}</b> starts on <b>${e(v.date)} ${e(v.time ?? "")}</b>.</p>${v.meetingPoint ? `<p><b>Meeting point:</b> ${e(v.meetingPoint)}</p>` : ""}${v.link ? btn(v.link, "Open voucher") : ""}` },
  pickup_info: { subject: "Pickup information – {{code}}", body: (v) => `<p>Pickup details for your booking <b>${e(v.code)}</b>:</p><p><b>Time:</b> ${e(v.pickupTime)}<br/><b>Address:</b> ${e(v.meetingPoint)}</p>${v.link ? btn(v.link, "View booking") : ""}` },
  booking_modified: { subject: "Booking modified – {{code}}", body: (v) => `<p>Your booking <b>${e(v.code)}</b> has been modified.</p><p>${e(v.message)}</p>${v.link ? btn(v.link, "View booking") : ""}` },
  booking_cancelled: { subject: "Booking cancelled – {{code}}", body: (v) => `<p>Your booking <b>${e(v.code)}</b> (${e(v.title)}) has been cancelled.</p>${v.reason ? `<p>Reason: ${e(v.reason)}</p>` : ""}${v.amount ? `<p>Refund amount: <b>${e(v.amount)} ${e(v.currency)}</b></p>` : ""}${v.link ? btn(v.link, "View booking") : ""}` },
  refund_processed: { subject: "Refund processed – {{code}}", body: (v) => `<p>Your refund of <b>${e(v.amount)} ${e(v.currency)}</b> for booking <b>${e(v.code)}</b> has been processed. It may take 5–10 business days to appear on your statement.</p>${v.link ? btn(v.link, "View booking") : ""}` },
  review_request: { subject: "How was your experience?", body: (v) => `<p>We hope you enjoyed <b>${e(v.title)}</b>! Your feedback helps other travellers.</p>${v.link ? btn(v.link, "Write a review") : ""}` },
  payout_notification: { subject: "Payout on the way", body: (v) => `<p>Your payout of <b>${e(v.amount)} ${e(v.currency)}</b>${v.period ? ` for ${e(v.period)}` : ""} has been sent.</p>${v.link ? btn(v.link, "View finance") : ""}` },
  security_alert: { subject: "Security alert", body: (v) => `<p>We detected a security-relevant event on your account:</p><p><b>${e(v.message)}</b></p><p>If this wasn't you, contact support immediately.</p>` },
};

const hu: TplSet = {
  registration: { subject: "Üdv a Travendiqnél", body: (v) => `<p>Szia${v.name ? ` ${e(v.name)}` : ""}!</p><p>a Travendiq-fiókod elkészült. Fedezz fel és foglalj élményeket világszerte.</p>` },
  email_confirmation: { subject: "Erősítsd meg az emailed", body: (v) => `<p>Kérjük, erősítsd meg az emailcímed a fiók befejezéséhez.</p>${v.link ? btn(v.link, "Email megerősítése") : ""}` },
  provider_application: { subject: "Szolgáltatói jelentkezés megérkezett", body: () => `<p>Köszönjük a szolgáltatói jelentkezést! Csapatunk ellenőrzi az adatokat és dokumentumokat. Jóváhagyás után publikálhatsz fizetős programokat.</p>` },
  provider_docs_required: { subject: "További dokumentum szükséges", body: (v) => `<p>A fiókod ellenőrzéséhez további dokumentumokra van szükség:</p><p><b>${e(v.missingDocs)}</b></p><p>Kérjük, töltsd fel őket a szolgáltatói felületen.</p>` },
  provider_approved: { subject: "Szolgáltatói fiókod jóváhagyva", body: (v) => `<p>Jó hír${v.name ? `, ${e(v.name)}` : ""}! A szolgáltatói fiókodat jóváhagytuk – mostantól értékesíthetsz programokat a Travendiqen.</p>` },
  provider_rejected: { subject: "Szolgáltatói jelentkezés – tájékoztatás", body: (v) => `<p>Sajnos ezúttal nem tudtuk jóváhagyni a szolgáltatói jelentkezésed.</p>${v.reason ? `<p>Indok: ${e(v.reason)}</p>` : ""}<p>A problémák rendezése után újra jelentkezhetsz.</p>` },
  provider_team_invitation: { subject: "Meghívást kaptál egy Travendiq szolgáltatói csapatba", body: (v) => `<p><b>${e(v.name)}</b> meghívott a Travendiq szolgáltatói csapatába.</p><p>Jelentkezz be vagy hozz létre fiókot ezzel az email-címmel, majd fogadd el a meghívást.</p>${v.link ? btn(v.link, "Meghívás megnyitása") : ""}<p style="margin-top:20px;color:#6b7280;font-size:12px">A meghívás 7 napig érvényes.</p>` },
  booking_confirmation: { subject: "Foglalás visszaigazolva – {{code}}", body: (v) => `<p>Köszönjük a foglalást!</p><p><b>Foglalási azonosító:</b> ${e(v.code)}</p><p><b>${e(v.title)}</b><br/>${e(v.date)} ${e(v.time ?? "")}</p>${v.meetingPoint ? `<p><b>Találkozási pont:</b> ${e(v.meetingPoint)}</p>` : ""}${v.voucher ? btn(v.voucher, "Voucher letöltése") : ""}${v.link ? btn(v.link, "Foglalás megnyitása") : ""}` },
  payment_receipt: { subject: "Fizetési visszaigazolás – {{code}}", body: (v) => `<p>Megérkezett a fizetésed: <b>${e(v.amount)} ${e(v.currency)}</b> – foglalás: <b>${e(v.code)}</b>.</p><p>Ez az email a fizetés visszaigazolásaként szolgál.</p>${v.link ? btn(v.link, "Foglalás megnyitása") : ""}` },
  trip_reminder: { subject: "Hamarosan indul a programod – {{code}}", body: (v) => `<p>Emlékeztető: <b>${e(v.title)}</b> – <b>${e(v.date)} ${e(v.time ?? "")}</b>.</p>${v.meetingPoint ? `<p><b>Találkozási pont:</b> ${e(v.meetingPoint)}</p>` : ""}${v.link ? btn(v.link, "Voucher megnyitása") : ""}` },
  pickup_info: { subject: "Pickup információ – {{code}}", body: (v) => `<p>A <b>${e(v.code)}</b> foglaláshoz tartozó pickup adatok:</p><p><b>Időpont:</b> ${e(v.pickupTime)}<br/><b>Cím:</b> ${e(v.meetingPoint)}</p>${v.link ? btn(v.link, "Foglalás megnyitása") : ""}` },
  booking_modified: { subject: "Foglalás módosítva – {{code}}", body: (v) => `<p>A <b>${e(v.code)}</b> foglalásod módosult.</p><p>${e(v.message)}</p>${v.link ? btn(v.link, "Foglalás megnyitása") : ""}` },
  booking_cancelled: { subject: "Foglalás lemondva – {{code}}", body: (v) => `<p>A <b>${e(v.code)}</b> foglalásod (${e(v.title)}) lemondásra került.</p>${v.reason ? `<p>Indok: ${e(v.reason)}</p>` : ""}${v.amount ? `<p>Visszatérítés összege: <b>${e(v.amount)} ${e(v.currency)}</b></p>` : ""}${v.link ? btn(v.link, "Foglalás megnyitása") : ""}` },
  refund_processed: { subject: "Visszatérítés feldolgozva – {{code}}", body: (v) => `<p>A <b>${e(v.code)}</b> foglaláshoz tartozó <b>${e(v.amount)} ${e(v.currency)}</b> visszatérítést feldolgoztuk. Az összeg 5–10 munkanapon belül jelenik meg a számládon.</p>${v.link ? btn(v.link, "Foglalás megnyitása") : ""}` },
  review_request: { subject: "Milyen volt az élmény?", body: (v) => `<p>Reméljük, jól érezted magad: <b>${e(v.title)}</b>! Véleményed sokat segít más utazóknak.</p>${v.link ? btn(v.link, "Értékelés írása") : ""}` },
  payout_notification: { subject: "Kifizetés úton", body: (v) => `<p>Kifizetésed elküldtük: <b>${e(v.amount)} ${e(v.currency)}</b>${v.period ? ` – ${e(v.period)}` : ""}.</p>` },
  security_alert: { subject: "Biztonsági figyelmeztetés", body: (v) => `<p>Biztonsági eseményt észleltünk a fiókodon:</p><p><b>${e(v.message)}</b></p><p>Ha nem te voltál, azonnal vedd fel a kapcsolatot az ügyfélszolgálattal.</p>` },
};

const dicts: Record<string, TplSet> = { en, hu };
function e(v: string | undefined): string { return escapeHtml(v ?? ""); }

function baseLayout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3f0e9;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="font-size:22px;font-weight:700;color:#28616d;">Travendiq</div>
    <div style="background:#fff;border-radius:12px;padding:24px;margin-top:12px;">
      <h1 style="font-size:18px;margin:0 0 12px;color:#132c34;">${escapeHtml(title)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#333;">${body}</div>
    </div>
    <p style="font-size:11px;color:#888;margin-top:16px;">Travendiq – travendiq.com</p>
  </div></body></html>`;
}

function fill(tpl: string, vars: EmailVars): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, escapeHtml(v ?? "")), tpl
  );
}

export function renderEmail(input: SendInput): { subject: string; html: string } {
  const locale = input.locale === "hu" ? "hu" : "en"; // további nyelvek: EN fallback
  const tpl = dicts[locale][input.template];
  const vars = input.vars ?? {};
  const subject = fill(tpl.subject, vars);
  return { subject, html: baseLayout(subject, tpl.body(vars)) };
}

/** Naplózás az email_log táblába (service role szükséges). */
async function logEmail(entry: {
  to: string; template: string; locale: string; status: string; providerMessageId?: string | null;
}) {
  try {
    const { createServiceClient } = await import("@/lib/supabase/server");
    const sb = createServiceClient();
    await sb.from("email_log").insert({
      to_email: entry.to, template: entry.template, locale: entry.locale,
      status: entry.status, provider_message_id: entry.providerMessageId ?? null,
    });
  } catch (err) {
    console.error("[email] log failed", err);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendEmail(
  input: SendInput,
  opts: { retries?: number } = {}
): Promise<{ ok: boolean; simulated: boolean }> {
  const { subject, html } = renderEmail(input);

  if (!resend) {
    if (IS_PROD) {
      throw new Error("RESEND_API_KEY hiányzik production környezetben – csendes szimuláció tiltva.");
    }
    console.log(`[email:SIMULATED] → ${input.to} | ${input.template} | ${subject}`);
    await logEmail({ to: input.to, template: input.template, locale: input.locale ?? "en", status: "simulated" });
    return { ok: true, simulated: true };
  }

  const retries = opts.retries ?? 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await resend.emails.send({ from: FROM, to: input.to, subject, html });
    if (!error) {
      await logEmail({ to: input.to, template: input.template, locale: input.locale ?? "en", status: "sent", providerMessageId: data?.id });
      return { ok: true, simulated: false };
    }
    if (attempt < retries) await sleep(500 * (attempt + 1));
    else {
      await logEmail({ to: input.to, template: input.template, locale: input.locale ?? "en", status: "failed" });
      console.error(`[email] failed after ${retries + 1} attempts → ${input.to}`, error.message);
    }
  }
  return { ok: false, simulated: false };
}
