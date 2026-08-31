export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import { couponSchema } from "@/lib/validation";
import type { Locale } from "@/lib/i18n";

export default async function AdminCoupons(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  const { data: coupons } = await svc.from("coupons")
    .select("id, code, kind, value, currency, valid_from, valid_to, max_redemptions, redeemed_count, is_active, provider_id, listing_id")
    .is("provider_id", null)
    .order("created_at", { ascending: false });

  async function add(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const parsed = couponSchema.safeParse({
      code: String(formData.get("code") ?? ""),
      kind: String(formData.get("kind") ?? "percent"),
      value: Number(formData.get("value") ?? 0),
      validFrom: String(formData.get("valid_from") ?? "") || undefined,
      validTo: String(formData.get("valid_to") ?? "") || undefined,
      maxRedemptions: formData.get("max_redemptions") ? Number(formData.get("max_redemptions")) : null,
      minOrderTotal: null,
    });
    if (!parsed.success) throw new Error("invalid input");
    await s.from("coupons").insert({
      code: parsed.data.code.toUpperCase(), kind: parsed.data.kind, value: parsed.data.value,
      currency: "EUR", valid_from: parsed.data.validFrom || null, valid_to: parsed.data.validTo || null,
      max_redemptions: parsed.data.maxRedemptions ?? null, created_by: u.id,
    });
    await audit(s, { actorId: u.id, action: "coupon.create", entity: "coupons", diff: { code: parsed.data.code } });
    revalidatePath(`/${locale}/admin/coupons`);
  }

  async function toggle(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("coupon_id") ?? "");
    const active = String(formData.get("active") ?? "") === "1";
    await s.from("coupons").update({ is_active: !active }).eq("id", id);
    await audit(s, { actorId: u.id, action: "coupon.toggle", entity: "coupons", entityId: id });
    revalidatePath(`/${locale}/admin/coupons`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Platform kuponok" : "Platform coupons"}</h1>

      <form action={add} className="card mt-6 grid gap-3 p-5 sm:grid-cols-3">
        <label className="text-sm">{hu ? "Kód" : "Code"}
          <input name="code" required minLength={3} className="input mt-1" placeholder="WELCOME10" />
        </label>
        <label className="text-sm">{hu ? "Típus" : "Type"}
          <select name="kind" className="input mt-1"><option value="percent">%</option><option value="fixed">EUR</option></select>
        </label>
        <label className="text-sm">{hu ? "Érték" : "Value"}
          <input name="value" type="number" required min={1} step="0.01" className="input mt-1" />
        </label>
        <label className="text-sm">{hu ? "Érvényes -tól" : "Valid from"}
          <input name="valid_from" type="date" className="input mt-1" />
        </label>
        <label className="text-sm">{hu ? "Érvényes -ig" : "Valid to"}
          <input name="valid_to" type="date" className="input mt-1" />
        </label>
        <label className="text-sm">{hu ? "Max. beváltás" : "Max redemptions"}
          <input name="max_redemptions" type="number" min={1} className="input mt-1" />
        </label>
        <div className="flex items-end sm:col-span-3">
          <button className="btn-primary" type="submit">{hu ? "Hozzáadás" : "Add"}</button>
        </div>
      </form>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(coupons ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <span className="font-mono font-bold text-lagoon-900">{c.code}</span>
              <span className="ms-3 text-lagoon-600">
                {c.kind === "percent" ? `${c.value}%` : `${c.value} ${c.currency ?? "EUR"}`}
                {" · "}{c.redeemed_count}{c.max_redemptions ? `/${c.max_redemptions}` : ""}
                {c.listing_id && ` · ${hu ? "ajánlathoz kötve" : "listing-bound"}`}
              </span>
            </div>
            <form action={toggle}>
              <input type="hidden" name="coupon_id" value={c.id} />
              <input type="hidden" name="active" value={c.is_active ? "1" : "0"} />
              <button type="submit" className={`badge ${c.is_active ? "bg-emerald-100 text-emerald-800" : "bg-sand-200 text-sand-700"}`}>
                {c.is_active ? (hu ? "Aktív" : "Active") : (hu ? "Inaktív" : "Inactive")}
              </button>
            </form>
          </div>
        ))}
        {(coupons ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
