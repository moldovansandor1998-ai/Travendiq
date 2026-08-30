export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { couponSchema } from "@/lib/validation";
import { getDictionary, type Locale } from "@/lib/i18n";

export default async function ProviderCoupons({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const pc = t.providerCoupons as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers").select("id").eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const { data: coupons } = await sb.from("coupons")
    .select("id, code, kind, value, currency, valid_from, valid_to, max_redemptions, redeemed_count, is_active, min_order_total")
    .eq("provider_id", provider.id).order("created_at", { ascending: false });

  async function addCoupon(formData: FormData) {
    "use server";
    const sb2 = createClient();
    const { data: { user: u } } = await sb2.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const { data: prov } = await sb2.from("providers").select("id").eq("owner_id", u.id).maybeSingle();
    if (!prov) throw new Error("forbidden");
    const parsed = couponSchema.safeParse({
      code: String(formData.get("code") ?? ""),
      kind: String(formData.get("kind") ?? "percent"),
      value: Number(formData.get("value") ?? 0),
      validFrom: String(formData.get("valid_from") ?? "") || undefined,
      validTo: String(formData.get("valid_to") ?? "") || undefined,
      maxRedemptions: formData.get("max_redemptions") ? Number(formData.get("max_redemptions")) : null,
      minOrderTotal: formData.get("min_order_total") ? Number(formData.get("min_order_total")) : null,
    });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid");
    const svc = createServiceClient();
    const { error: insErr } = await svc.from("coupons").insert({
      code: parsed.data.code.toUpperCase(),
      kind: parsed.data.kind,
      value: parsed.data.value,
      currency: "EUR",
      valid_from: parsed.data.validFrom || null,
      valid_to: parsed.data.validTo || null,
      max_redemptions: parsed.data.maxRedemptions ?? null,
      min_order_total: parsed.data.minOrderTotal ? Math.round(parsed.data.minOrderTotal * 100) : null,
      provider_id: prov.id,
      created_by: u.id,
    });
    if (insErr) {
      console.error("[provider/coupons] insert failed:", insErr.message);
      throw new Error("coupon creation failed");
    }
    revalidatePath(`/${locale}/provider/coupons`);
  }

  async function toggle(formData: FormData) {
    "use server";
    const sb2 = createClient();
    const { data: { user: u } } = await sb2.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const { data: prov } = await sb2.from("providers").select("id").eq("owner_id", u.id).maybeSingle();
    if (!prov) throw new Error("forbidden");
    const id = String(formData.get("coupon_id") ?? "");
    const active = String(formData.get("active") ?? "") === "1";
    const svc = createServiceClient();
    const { error: upErr } = await svc.from("coupons").update({ is_active: !active }).eq("id", id).eq("provider_id", prov.id);
    if (upErr) {
      console.error("[provider/coupons] toggle failed:", upErr.message);
      throw new Error("coupon update failed");
    }
    revalidatePath(`/${locale}/provider/coupons`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{pc.title}</h1>

      <form action={addCoupon} className="card mt-6 grid gap-3 p-5 sm:grid-cols-3">
        <label className="text-sm">{pc.code}
          <input name="code" required minLength={3} maxLength={32} className="input mt-1" placeholder="SUMMER10" />
        </label>
        <label className="text-sm">{pc.type}
          <select name="kind" className="input mt-1">
            <option value="percent">%</option>
            <option value="fixed">EUR</option>
          </select>
        </label>
        <label className="text-sm">{pc.value}
          <input name="value" type="number" required min={1} step="0.01" className="input mt-1" />
        </label>
        <label className="text-sm">{pc.validFrom}
          <input name="valid_from" type="date" className="input mt-1" />
        </label>
        <label className="text-sm">{pc.validTo}
          <input name="valid_to" type="date" className="input mt-1" />
        </label>
        <label className="text-sm">{pc.maxRedemptions}
          <input name="max_redemptions" type="number" min={1} className="input mt-1" />
        </label>
        <label className="text-sm">{pc.minOrder}
          <input name="min_order_total" type="number" min={0} step="0.01" className="input mt-1" />
        </label>
        <div className="flex items-end">
          <button className="btn-primary" type="submit">{t.common.save}</button>
        </div>
      </form>

      <div className="card mt-6 divide-y divide-lagoon-100">
        {(coupons ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <span className="font-mono font-bold text-lagoon-900">{c.code}</span>
              <span className="ms-3 text-lagoon-600">
                {c.kind === "percent" ? `${c.value}%` : `${c.value} ${c.currency ?? "EUR"}`}
                {" · "}{c.redeemed_count}{c.max_redemptions ? `/${c.max_redemptions}` : ""} {pc.redeemed}
              </span>
            </div>
            <form action={toggle}>
              <input type="hidden" name="coupon_id" value={c.id} />
              <input type="hidden" name="active" value={c.is_active ? "1" : "0"} />
              <button type="submit" className={`badge ${c.is_active ? "bg-emerald-100 text-emerald-800" : "bg-sand-200 text-sand-700"}`}>
                {c.is_active ? pc.active : pc.inactive}
              </button>
            </form>
          </div>
        ))}
        {(coupons ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
