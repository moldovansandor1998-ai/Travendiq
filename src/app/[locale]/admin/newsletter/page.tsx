export const dynamic = "force-dynamic";

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

export default async function AdminNewsletter(
  props: {
    params: Promise<{ locale: Locale }>;
    searchParams: Promise<{ q?: string; status?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);
  const q = String(searchParams.q ?? "").trim().slice(0, 200);
  const status = searchParams.status === "inactive" ? "inactive" : searchParams.status === "all" ? "all" : "active";

  let query = svc.from("newsletter_subscribers")
    .select("id, email, locale, is_active, consented_at, unsubscribed_at")
    .order("consented_at", { ascending: false }).limit(500);
  if (q) query = query.ilike("email", `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  if (status !== "all") query = query.eq("is_active", status === "active");
  const { data: subscribers, error } = await query;
  if (error) throw new Error(`newsletter_load_failed: ${error.message}`);

  async function setStatus(formData: FormData) {
    "use server";
    const { user, svc: service } = await requireAdmin(locale);
    const id = String(formData.get("id") ?? "");
    const active = formData.get("active") === "1";
    const { error: updateError } = await service.from("newsletter_subscribers").update({
      is_active: active,
      unsubscribed_at: active ? null : new Date().toISOString(),
    }).eq("id", id);
    if (updateError) throw new Error(`newsletter_update_failed: ${updateError.message}`);
    await audit(service, { actorId: user.id, action: active ? "newsletter.activate" : "newsletter.deactivate", entity: "newsletter_subscribers", entityId: id });
    revalidatePath(`/${locale}/admin/newsletter`);
  }

  async function remove(formData: FormData) {
    "use server";
    const { user, svc: service } = await requireAdmin(locale);
    const id = String(formData.get("id") ?? "");
    const { error: deleteError } = await service.from("newsletter_subscribers").delete().eq("id", id);
    if (deleteError) throw new Error(`newsletter_delete_failed: ${deleteError.message}`);
    await audit(service, { actorId: user.id, action: "newsletter.delete", entity: "newsletter_subscribers", entityId: id });
    revalidatePath(`/${locale}/admin/newsletter`);
  }

  return <div className="container-page py-10">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Hírlevél-feliratkozók" : "Newsletter subscribers"}</h1>
        <p className="mt-1 text-sm text-lagoon-600">{subscribers?.length ?? 0} {hu ? "megjelenített cím" : "shown addresses"}</p></div>
      <Link className="btn-secondary" href={`/${locale}/admin`}>{hu ? "Vissza az adminhoz" : "Back to admin"}</Link>
    </div>
    <form className="mt-6 flex flex-wrap gap-2">
      <input name="q" defaultValue={q} className="input max-w-sm" placeholder={hu ? "Keresés email alapján" : "Search by email"} />
      <select name="status" defaultValue={status} className="input max-w-44">
        <option value="active">{hu ? "Aktív" : "Active"}</option><option value="inactive">{hu ? "Leiratkozott" : "Inactive"}</option><option value="all">{hu ? "Összes" : "All"}</option>
      </select>
      <button className="btn-secondary">{hu ? "Szűrés" : "Filter"}</button>
    </form>
    <div className="card mt-6 overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-sand-50 text-xs uppercase text-lagoon-700"><tr><th className="px-3 py-2 text-start">Email</th><th className="px-3 py-2 text-start">{hu ? "Nyelv" : "Locale"}</th><th className="px-3 py-2 text-start">{hu ? "Dátum" : "Date"}</th><th className="px-3 py-2 text-start">{hu ? "Állapot" : "Status"}</th><th className="px-3 py-2 text-end">{hu ? "Kezelés" : "Actions"}</th></tr></thead>
      <tbody>{(subscribers ?? []).map((s) => <tr key={s.id} className="border-t border-sand-100"><td className="px-3 py-2">{s.email}</td><td className="px-3 py-2">{s.locale}</td><td className="px-3 py-2">{new Date(s.consented_at).toLocaleString(locale)}</td><td className="px-3 py-2"><span className={`badge ${s.is_active ? "bg-emerald-100 text-emerald-800" : "bg-sand-200 text-sand-700"}`}>{s.is_active ? (hu ? "Aktív" : "Active") : (hu ? "Leiratkozott" : "Inactive")}</span></td><td className="px-3 py-2"><div className="flex justify-end gap-2"><form action={setStatus}><input type="hidden" name="id" value={s.id}/><input type="hidden" name="active" value={s.is_active ? "0" : "1"}/><button className="btn-secondary px-3 py-1.5">{s.is_active ? (hu ? "Letiltás" : "Deactivate") : (hu ? "Aktiválás" : "Activate")}</button></form><form action={remove}><input type="hidden" name="id" value={s.id}/><button className="rounded-lg border border-red-200 px-3 py-1.5 font-semibold text-red-700">{hu ? "Törlés" : "Delete"}</button></form></div></td></tr>)}</tbody>
    </table></div>
  </div>;
}
