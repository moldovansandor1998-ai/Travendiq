import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { Scanner } from "./Scanner";

export const dynamic = "force-dynamic";

/** Beléptető felület – csak checkin joggal rendelkező munkatárs / staff. */
export default async function CheckinPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: staff } = await sb.rpc("is_staff");
  const { data: memberships } = await sb.from("provider_members")
    .select("provider_id, permissions").eq("user_id", user.id);
  const { data: owned } = await sb.from("providers").select("id").eq("owner_id", user.id);

  const canCheckin = staff || (owned?.length ?? 0) > 0 ||
    (memberships ?? []).some((m) => m.permissions.includes("checkin"));
  if (!canCheckin) redirect(`/${locale}`);

  return (
    <div className="container-page max-w-xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">
        {t.checkin.title}
      </h1>
      <p className="mt-2 text-sm text-lagoon-600">{locale === "hu" ? "A vendég voucherén lévő QR-kódot itt olvashatod be érkezéskor. A rendszer ellenőrzi a foglalást, majd rögzíti a ténylegesen beléptetett résztvevők számát. Ez nem munkatársi bejelentkezés." : "Scan the QR code on the guest's voucher on arrival. The system verifies the booking and records admitted participants. This is not staff sign-in."}</p>
      <Scanner
        locale={locale}
        labels={{
          startCamera: t.checkin.startCamera,
          stopCamera: t.checkin.stopCamera,
          manualCode: t.checkin.manualCode,
          check: t.checkin.check,
          participants: t.checkin.participants,
          admit: t.checkin.admit,
          valid: t.checkin.valid,
          partial: t.checkin.partial,
          alreadyUsed: t.checkin.alreadyUsed,
          invalid: t.checkin.invalid,
          noCamera: t.checkin.noCamera,
        }}
      />
    </div>
  );
}
