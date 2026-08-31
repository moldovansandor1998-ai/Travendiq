export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createHash, randomBytes } from "node:crypto";
import { sendEmail } from "@/lib/email";

const ALL_PERMISSIONS = ["bookings.read", "bookings.write", "listings.write", "checkin", "finance.read"] as const;

export default async function ProviderTeam(
  props: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ invited?: string; added?: string; error?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { locale } = params;
  const t = getDictionary(locale);
  const pt = t.providerTeam as Record<string, string>;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers").select("id, display_name").eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);
  const providerName = provider.display_name;

  const { data: members } = await sb.from("provider_members")
    .select("user_id, permissions, created_at, profile:profiles(full_name, email)")
    .eq("provider_id", provider.id);
  const svcRead = createServiceClient();
  const { data: invitations } = await svcRead.from("provider_team_invitations")
    .select("id, email, permissions, expires_at, created_at").eq("provider_id", provider.id)
    .is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });

  async function addMember(formData: FormData) {
    "use server";
    const sb2 = await createClient();
    const { data: { user: u } } = await sb2.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const { data: prov } = await sb2.from("providers").select("id").eq("owner_id", u.id).maybeSingle();
    if (!prov) throw new Error("forbidden");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const perms = ALL_PERMISSIONS.filter((p) => formData.get(`perm_${p}`) === "on");
    if (!email || perms.length === 0) throw new Error("invalid input");
    const svc = createServiceClient();
    const { data: profile } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!profile) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await svc.from("provider_team_invitations").delete().eq("provider_id", prov.id).eq("email", email).is("accepted_at", null);
      await svc.from("email_outbox").delete().eq("dedupe_key", `provider_team_invite:${prov.id}:${email}`).eq("status", "pending");
      const { error: inviteErr } = await svc.from("provider_team_invitations").insert({
        provider_id: prov.id, email, permissions: perms, token_hash: tokenHash,
        invited_by: u.id, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      if (inviteErr) {
        console.error("[provider/team] invitation failed:", inviteErr.message);
        redirect(`/${locale}/provider/team?error=invite`);
      }
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.travendiq.com";
      const link = `${base}/${locale}/provider/team/accept?token=${encodeURIComponent(token)}`;
      const result = await sendEmail({ to: email, template: "provider_team_invitation", locale, vars: { name: providerName, link } });
      if (!result.ok) redirect(`/${locale}/provider/team?error=email`);
      redirect(`/${locale}/provider/team?invited=1`);
    }
    // DB-hiba nem csendes: hamis "tag hozzáadva" állapot tiltva
    const { error: upErr } = await svc.from("provider_members").upsert({
      provider_id: prov.id, user_id: profile.id, permissions: perms, invited_by: u.id,
    });
    if (upErr) {
      console.error("[provider/team] member upsert failed:", upErr.message);
      throw new Error("member upsert failed");
    }
    const { error: roleErr } = await svc.from("user_roles").upsert({ user_id: profile.id, role: "provider_staff" });
    if (roleErr) {
      console.error("[provider/team] role upsert failed:", roleErr.message);
      throw new Error("member upsert failed");
    }
    await svc.from("audit_log").insert({
      actor_id: u.id, action: "provider.member_upsert", entity: "provider_members",
      entity_id: String(profile.id), diff: { permissions: perms },
    });
    revalidatePath(`/${locale}/provider/team`);
    redirect(`/${locale}/provider/team?added=1`);
  }

  async function removeMember(formData: FormData) {
    "use server";
    const sb2 = await createClient();
    const { data: { user: u } } = await sb2.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const { data: prov } = await sb2.from("providers").select("id").eq("owner_id", u.id).maybeSingle();
    if (!prov) throw new Error("forbidden");
    const memberId = String(formData.get("member_id") ?? "");
    const svc = createServiceClient();
    const { error: delErr } = await svc.from("provider_members").delete().eq("provider_id", prov.id).eq("user_id", memberId);
    if (delErr) {
      console.error("[provider/team] member delete failed:", delErr.message);
      throw new Error("member remove failed");
    }
    await svc.from("audit_log").insert({
      actor_id: u.id, action: "provider.member_remove", entity: "provider_members", entity_id: String(memberId),
    });
    revalidatePath(`/${locale}/provider/team`);
  }

  async function resendInvitation(formData: FormData) {
    "use server";
    const session = await createClient();
    const { data: { user: u } } = await session.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const svc = createServiceClient();
    const { data: prov } = await svc.from("providers").select("id,display_name").eq("owner_id", u.id).maybeSingle();
    if (!prov) throw new Error("forbidden");
    const invitationId = String(formData.get("invitation_id") ?? "");
    const { data: invitation } = await svc.from("provider_team_invitations").select("id,email").eq("id", invitationId).eq("provider_id", prov.id).is("accepted_at", null).single();
    if (!invitation) redirect(`/${locale}/provider/team?error=invite`);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await svc.from("provider_team_invitations").update({ token_hash: tokenHash, expires_at: expiresAt }).eq("id", invitation.id);
    await svc.from("email_outbox").delete().eq("dedupe_key", `provider_team_invite:${prov.id}:${invitation.email}`).eq("status", "pending");
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.travendiq.com";
    const link = `${base}/${locale}/provider/team/accept?token=${encodeURIComponent(token)}`;
    const result = await sendEmail({ to: invitation.email, template: "provider_team_invitation", locale, vars: { name: prov.display_name, link } });
    redirect(`/${locale}/provider/team?${result.ok ? "invited=1" : "error=email"}`);
  }

  const permLabels: Record<string, string> = {
    "bookings.read": pt.perm_bookings_read, "bookings.write": pt.perm_bookings_write,
    "listings.write": pt.perm_listings_write, checkin: pt.perm_checkin,
    "finance.read": pt.perm_finance_read,
  };

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{pt.title}</h1>
      {searchParams.invited === "1" && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{locale === "hu" ? "A munkatársi meghívót elküldtük emailben. A meghívott a link elfogadása után jelenik meg a csapatban." : "Invitation sent by email. The member will appear after accepting it."}</p>}
      {searchParams.added === "1" && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{locale === "hu" ? "A regisztrált munkatársat hozzáadtuk." : "The registered team member was added."}</p>}
      {searchParams.error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{searchParams.error === "email" ? (locale === "hu" ? "A meghívás létrejött, de az email küldése nem sikerült. Használd az Újraküldés gombot." : "The invitation was created, but email delivery failed. Use Resend.") : (locale === "hu" ? "A meghívás nem sikerült. Próbáld újra." : "Invitation failed. Please try again.")}</p>}

      <form action={addMember} className="card mt-6 p-5">
        <h2 className="font-semibold text-lagoon-900">{pt.addTitle}</h2>
        <p className="mt-1 text-xs text-lagoon-500">{pt.addNote}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">E-mail
            <input name="email" type="email" required className="input mt-1" />
          </label>
          <fieldset className="text-sm">
            <legend className="mb-1">{pt.permissions}</legend>
            <div className="flex flex-wrap gap-3">
              {ALL_PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-1.5">
                  <input type="checkbox" name={`perm_${p}`} defaultChecked={p === "bookings.read"} />
                  <span>{permLabels[p]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <button className="btn-primary mt-4" type="submit">{pt.add}</button>
      </form>

      {(invitations ?? []).length > 0 && <div className="card mt-6 divide-y divide-lagoon-100"><h2 className="p-4 font-semibold text-lagoon-900">{locale === "hu" ? "Függőben lévő meghívások" : "Pending invitations"}</h2>{(invitations ?? []).map((i) => <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><span>{i.email}</span><div className="flex items-center gap-2"><span className="badge bg-amber-100 text-amber-800">{locale === "hu" ? `Lejár: ${new Date(i.expires_at).toLocaleDateString("hu-HU")}` : `Expires: ${new Date(i.expires_at).toLocaleDateString("en-GB")}`}</span><form action={resendInvitation}><input type="hidden" name="invitation_id" value={i.id}/><button className="btn-secondary px-3 py-1.5 text-xs">{locale === "hu" ? "Újraküldés" : "Resend"}</button></form></div></div>)}</div>}

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(members ?? []).map((m) => {
          const prof = m.profile as unknown as { full_name: string | null; email: string } | null;
          return (
            <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium text-lagoon-900">{prof?.full_name ?? prof?.email ?? m.user_id}</p>
                <p className="text-xs text-lagoon-500">{((m.permissions ?? []) as string[]).map((p: string) => permLabels[p] ?? p).join(" · ")}</p>
              </div>
              <form action={removeMember}>
                <input type="hidden" name="member_id" value={m.user_id} />
                <button type="submit" className="text-xs font-semibold text-red-700">
                  {pt.remove}
                </button>
              </form>
            </div>
          );
        })}
        {(members ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
