export const dynamic = "force-dynamic";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";

export default async function AcceptTeamInvitation({ params, searchParams }: {
  params: { locale: Locale }; searchParams: { token?: string; done?: string; error?: string };
}) {
  const { locale } = params;
  const token = String(searchParams.token ?? "");
  if (!token) redirect(`/${locale}`);
  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  const next = `/${locale}/provider/team/accept?token=${encodeURIComponent(token)}`;
  if (!user) redirect(`/${locale}/auth/login?next=${encodeURIComponent(next)}`);
  const svc = createServiceClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: invite } = await svc.from("provider_team_invitations")
    .select("id, provider_id, email, permissions, expires_at, accepted_at, provider:providers(display_name)")
    .eq("token_hash", tokenHash).maybeSingle();
  const valid = invite && !invite.accepted_at && invite.expires_at > new Date().toISOString() && invite.email.toLowerCase() === (user.email ?? "").toLowerCase();

  async function accept() {
    "use server";
    const auth = createClient();
    const { data: { user: u } } = await auth.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login?next=${encodeURIComponent(next)}`);
    const service = createServiceClient();
    const hash = createHash("sha256").update(token).digest("hex");
    const { data: row } = await service.from("provider_team_invitations").select("id, provider_id, email, permissions, expires_at, accepted_at").eq("token_hash", hash).maybeSingle();
    if (!row || row.accepted_at || row.expires_at <= new Date().toISOString() || row.email.toLowerCase() !== (u.email ?? "").toLowerCase()) redirect(`${next}&error=invalid`);
    const { error } = await service.from("provider_members").upsert({ provider_id: row.provider_id, user_id: u.id, permissions: row.permissions, invited_by: null });
    if (error) redirect(`${next}&error=save`);
    await service.from("user_roles").upsert({ user_id: u.id, role: "provider_staff" });
    await service.from("provider_team_invitations").update({ accepted_at: new Date().toISOString(), accepted_by: u.id }).eq("id", row.id).is("accepted_at", null);
    redirect(`/${locale}/provider/dashboard`);
  }

  const providerName = (invite?.provider as unknown as { display_name?: string } | null)?.display_name ?? "Travendiq";
  return <div className="container-page max-w-lg py-16"><div className="card p-6"><h1 className="text-xl font-bold text-lagoon-950">{locale === "hu" ? "Munkatársi meghívás" : "Team invitation"}</h1>{valid ? <><p className="mt-3 text-sm text-lagoon-700">{locale === "hu" ? `${providerName} meghívott a szolgáltatói csapatába. Elfogadás után a kijelölt feladatokat kezelheted.` : `${providerName} invited you to their provider team. After accepting, you can use the assigned permissions.`}</p><form action={accept}><button className="btn-primary mt-5" type="submit">{locale === "hu" ? "Meghívás elfogadása" : "Accept invitation"}</button></form></> : <p role="alert" className="mt-3 text-sm text-red-700">{locale === "hu" ? "A meghívás lejárt, már felhasználták, vagy másik email-címhez tartozik." : "This invitation expired, was already used, or belongs to another email address."}</p>}</div></div>;
}
