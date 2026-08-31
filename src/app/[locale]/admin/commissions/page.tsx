export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

export default async function AdminCommissions(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  const [{ data: rules }, { data: countries }] = await Promise.all([
    svc.from("commission_rules")
      .select("id, scope, country_code, provider_id, listing_id, rate, priority, is_active")
      .order("priority", { ascending: false }),
    svc.from("countries").select("code, name").order("name"),
  ]);

  async function add(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const scope = String(formData.get("scope") ?? "global");
    const rate = Number(formData.get("rate") ?? 0);
    if (!["global", "country", "provider", "listing"].includes(scope)) throw new Error("invalid scope");
    if (rate < 0 || rate > 50) throw new Error("invalid rate");
    const entityId = String(formData.get("entity_id") ?? "").trim() || null;
    await s.from("commission_rules").insert({
      scope,
      country_code: scope === "country" ? String(formData.get("country_code") ?? "") || null : null,
      provider_id: scope === "provider" ? entityId : null,
      listing_id: scope === "listing" ? entityId : null,
      rate,
      priority: Number(formData.get("priority") ?? 0) || 0,
    });
    await audit(s, { actorId: u.id, action: "commission.create", entity: "commission_rules", diff: { scope, rate } });
    revalidatePath(`/${locale}/admin/commissions`);
  }

  async function toggle(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("rule_id") ?? "");
    const active = String(formData.get("active") ?? "") === "1";
    await s.from("commission_rules").update({ is_active: !active }).eq("id", id);
    await audit(s, { actorId: u.id, action: "commission.toggle", entity: "commission_rules", entityId: id });
    revalidatePath(`/${locale}/admin/commissions`);
  }

  const scopeLabels: Record<string, string> = hu
    ? { global: "Globális", country: "Ország", provider: "Szolgáltató", listing: "Ajánlat" }
    : { global: "Global", country: "Country", provider: "Provider", listing: "Listing" };

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Jutalék-szabályok" : "Commission rules"}</h1>
      <p className="mt-1 text-sm text-lagoon-600">
        {hu ? "Feloldási sorrend: ajánlat > szolgáltató > ország > globális > 15% alapértelmezett." : "Resolution order: listing > provider > country > global > 15% default."}
      </p>

      <form action={add} className="card mt-6 grid gap-3 p-5 sm:grid-cols-5">
        <label className="text-sm">{hu ? "Hatókör" : "Scope"}
          <select name="scope" className="input mt-1">
            <option value="global">{scopeLabels.global}</option>
            <option value="country">{scopeLabels.country}</option>
            <option value="provider">{scopeLabels.provider}</option>
            <option value="listing">{scopeLabels.listing}</option>
          </select>
        </label>
        <label className="text-sm">{hu ? "Ország (ha ország)" : "Country (if country)"}
          <select name="country_code" className="input mt-1">
            <option value="">–</option>
            {(countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm">{hu ? "Entitás ID (opcionális)" : "Entity ID (optional)"}
          <input name="entity_id" placeholder="uuid" className="input mt-1" />
        </label>
        <label className="text-sm">{hu ? "Jutalék %" : "Rate %"}
          <input name="rate" type="number" required min={0} max={50} step="0.1" defaultValue={15} className="input mt-1" />
        </label>
        <div className="flex items-end">
          <button className="btn-primary" type="submit">{hu ? "Hozzáadás" : "Add"}</button>
        </div>
        <input type="hidden" name="priority" value="0" />
      </form>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(rules ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <span className="font-medium text-lagoon-900">{scopeLabels[r.scope] ?? r.scope}</span>
              <span className="ms-3 text-lagoon-600">
                {r.country_code ?? r.provider_id ?? r.listing_id ?? ""} · {r.rate}%
              </span>
            </div>
            <form action={toggle}>
              <input type="hidden" name="rule_id" value={r.id} />
              <input type="hidden" name="active" value={r.is_active ? "1" : "0"} />
              <button type="submit" className={`badge ${r.is_active ? "bg-emerald-100 text-emerald-800" : "bg-sand-200 text-sand-700"}`}>
                {r.is_active ? (hu ? "Aktív" : "Active") : (hu ? "Inaktív" : "Inactive")}
              </button>
            </form>
          </div>
        ))}
        {(rules ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
