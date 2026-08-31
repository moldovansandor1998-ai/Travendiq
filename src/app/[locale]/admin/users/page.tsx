export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

const ROLES = ["customer", "provider", "provider_staff", "promoter", "support", "admin"] as const;

export default async function AdminUsers({ params, searchParams }: {
  params: { locale: Locale };
  searchParams: { q?: string };
}) {
  const { locale } = params;
  const hu = locale === "hu";
  const { user, svc } = await requireAdmin(locale);

  let query = svc.from("profiles")
    .select("id, email, full_name, is_suspended, two_factor_enabled, created_at, roles:user_roles(role)")
    .order("created_at", { ascending: false }).limit(100);
  if (searchParams.q) query = query.ilike("email", `%${searchParams.q}%`);
  const { data: users } = await query;
  const customerUsers = (users ?? []).filter((profile) => {
    const roles = ((profile.roles ?? []) as { role: string }[]).map((item) => item.role);
    return !roles.includes("provider") && !roles.includes("provider_staff");
  });

  async function toggleSuspend(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("user_id") ?? "");
    const suspended = String(formData.get("suspended") ?? "") === "1";
    await s.from("profiles").update({ is_suspended: !suspended }).eq("id", id);
    await audit(s, { actorId: u.id, action: suspended ? "user.unsuspend" : "user.suspend", entity: "profiles", entityId: id });
    revalidatePath(`/${locale}/admin/users`);
  }

  async function toggleRole(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("user_id") ?? "");
    const role = String(formData.get("role") ?? "");
    const has = String(formData.get("has") ?? "") === "1";
    if (!ROLES.includes(role as (typeof ROLES)[number])) throw new Error("invalid role");
    if (role === "admin" && id === u.id && has) throw new Error("cannot revoke own admin");
    if (has) {
      await s.from("user_roles").delete().eq("user_id", id).eq("role", role);
    } else {
      await s.from("user_roles").upsert({ user_id: id, role, granted_by: u.id });
    }
    await audit(s, { actorId: u.id, action: has ? "role.revoke" : "role.grant", entity: "user_roles", entityId: id, diff: { role } });
    revalidatePath(`/${locale}/admin/users`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Felhasználók" : "Users"}</h1>
      <p className="mt-1 text-sm text-lagoon-600">{hu ? "A vásárlói és belső felhasználói fiókok. A szolgáltatók külön, a Szolgáltatók menüpontban láthatók." : "Customer and internal accounts. Providers are listed separately under Providers."}</p>
      <form className="mt-4 flex gap-2" method="get">
        <input name="q" defaultValue={searchParams.q ?? ""} placeholder="E-mail…" className="input max-w-xs" />
        <button className="btn-secondary" type="submit">{hu ? "Keresés" : "Search"}</button>
      </form>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {customerUsers.map((p) => {
          const roles = ((p.roles ?? []) as { role: string }[]).map((r) => r.role);
          return (
            <div key={p.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-lagoon-900">{p.full_name ?? p.email}</p>
                  <p className="text-xs text-lagoon-500">
                    {p.email} · {new Date(p.created_at).toLocaleDateString(locale)}
                    {p.two_factor_enabled && " · 2FA"}
                  </p>
                </div>
                <form action={toggleSuspend}>
                  <input type="hidden" name="user_id" value={p.id} />
                  <input type="hidden" name="suspended" value={p.is_suspended ? "1" : "0"} />
                  <button type="submit" className={`badge ${p.is_suspended ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {p.is_suspended ? (hu ? "Felfüggesztve" : "Suspended") : (hu ? "Aktív" : "Active")}
                  </button>
                </form>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ROLES.map((r) => {
                  const has = roles.includes(r);
                  return (
                    <form key={r} action={toggleRole}>
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="role" value={r} />
                      <input type="hidden" name="has" value={has ? "1" : "0"} />
                      <button type="submit"
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${has ? "bg-lagoon-600 text-white" : "bg-sand-100 text-lagoon-600"}`}>
                        {r}
                      </button>
                    </form>
                  );
                })}
              </div>
            </div>
          );
        })}
        {customerUsers.length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
