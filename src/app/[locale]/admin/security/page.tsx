export const dynamic = "force-dynamic";
import { requireAdmin } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";
import { MfaEnroll } from "./MfaEnroll";

export default async function AdminSecurity({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const hu = locale === "hu";
  const { sb } = await requireAdmin(locale);

  const { data: factors } = await sb.auth.mfa.listFactors();
  const totp = factors?.totp ?? [];
  const hasVerified = totp.some((f) => f.status === "verified");

  return (
    <div className="container-page max-w-2xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">
        {hu ? "Biztonság – kétlépcsős azonosítás" : "Security – two-factor authentication"}
      </h1>
      <p className="mt-2 text-sm text-lagoon-600">
        {hu
          ? "Adminisztrátori szerepkörhöz kötelező a TOTP-alapú 2FA (pl. Google Authenticator, 1Password)."
          : "TOTP-based 2FA is required for administrator roles (e.g. Google Authenticator, 1Password)."}
      </p>

      <div className="card mt-6 p-5">
        {hasVerified ? (
          <p className="text-sm">
            <span className="badge bg-emerald-100 text-emerald-800">
              {hu ? "2FA aktív" : "2FA active"}
            </span>
            <span className="ms-3 text-lagoon-600">
              {hu ? `${totp.length} hitelesítő eszköz regisztrálva.` : `${totp.length} authenticator registered.`}
            </span>
          </p>
        ) : (
          <MfaEnroll labels={{
            enroll: hu ? "2FA beállítása" : "Set up 2FA",
            scan: hu ? "Olvasd be a QR-kódot a hitelesítő alkalmazással, majd írd be a 6 jegyű kódot." : "Scan the QR code with your authenticator app, then enter the 6-digit code.",
            code: hu ? "6 jegyű kód" : "6-digit code",
            verify: hu ? "Aktiválás" : "Activate",
            error: hu ? "Hibás kód. Próbáld újra." : "Invalid code. Try again.",
          }} />
        )}
      </div>
    </div>
  );
}
