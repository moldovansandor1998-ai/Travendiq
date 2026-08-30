export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getDictionary, type Locale } from "@/lib/i18n";

const ALL_PERMISSIONS = ["bookings.read", "bookings.write", "listings.write", "checkin", "finance.read"] as const;

export default async function ProviderTeam({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const pt = t.providerTeam as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers").select("id").eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const { data: members } = await sb.from("provider_members")
    .select("user_id, permissions, created_at, profile:profiles(full_name, email)")
    .eq("provider_id", provider.id);

  async function addMember(formData: FormData) {
    "use server";
    const sb2 = createClient();
    const { data: { user: u } } = await sb2.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const { data: prov } = await sb2.from("providers").select("id").eq("owner_id", u.id).maybeSingle();
    if (!prov) throw new Error("forbidden");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const perms = ALL_PERMISSIONS.filter((p) => formData.get(`perm_${p}`) === "on");
    if (!email || perms.length === 0) throw new Error("invalid input");
    const svc = createServiceClient();
    const { data: profile } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!profile) throw new Error("no registered user with this email");
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
  }

  async function removeMember(formData: FormData) {
    "use server";
    const sb2 = createClient();
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

  const permLabels: Record<string, string> = {
    "bookings.read": pt.perm_bookings_read, "bookings.write": pt.perm_bookings_write,
    "listings.write": pt.perm_listings_write, checkin: pt.perm_checkin,
    "finance.read": pt.perm_finance_read,
  };

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{pt.title}</h1>

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
