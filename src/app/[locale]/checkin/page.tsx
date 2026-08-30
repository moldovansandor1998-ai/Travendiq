import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { Scanner } from "./Scanner";

export const dynamic = "force-dynamic";

/** Beléptető felület – csak checkin joggal rendelkező munkatárs / staff. */
export default async function CheckinPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
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
