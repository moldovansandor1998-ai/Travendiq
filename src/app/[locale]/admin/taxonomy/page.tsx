export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

export default async function AdminTaxonomy({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  const [{ data: countries }, { data: cities }, { data: categories }, { data: currencies }] = await Promise.all([
    svc.from("countries").select("code, name, is_active").order("name"),
    svc.from("cities").select("id, name, country_code, is_active").order("name").limit(200),
    svc.from("categories").select("id, slug, icon, sort_order, is_active, translations:category_translations(locale, name)")
      .order("sort_order"),
    svc.from("currencies").select("code, symbol, rate_to_eur, is_active").order("code"),
  ]);

  async function toggle(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const table = String(formData.get("table") ?? "");
    if (!["countries", "cities", "categories", "currencies"].includes(table)) throw new Error("invalid table");
    const id = String(formData.get("row_id") ?? "");
    const active = String(formData.get("active") ?? "") === "1";
    const idCol = table === "countries" || table === "currencies" ? "code" : "id";
    await s.from(table).update({ is_active: !active }).eq(idCol, id);
    await audit(s, { actorId: u.id, action: "taxonomy.toggle", entity: table, entityId: id });
    revalidatePath(`/${locale}/admin/taxonomy`);
  }

  async function addCategory(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    const nameEn = String(formData.get("name_en") ?? "").trim();
    const nameHu = String(formData.get("name_hu") ?? "").trim();
    if (!/^[a-z0-9-]{2,60}$/.test(slug) || !nameEn) throw new Error("invalid input");
    const { data: cat, error } = await s.from("categories").insert({ slug, sort_order: 100 }).select("id").single();
    if (error || !cat) throw new Error("duplicate slug");
    await s.from("category_translations").insert([
      { category_id: cat.id, locale: "en", name: nameEn },
      ...(nameHu ? [{ category_id: cat.id, locale: "hu", name: nameHu }] : []),
    ]);
    await audit(s, { actorId: u.id, action: "category.create", entity: "categories", entityId: cat.id, diff: { slug } });
    revalidatePath(`/${locale}/admin/taxonomy`);
  }

  function ToggleBtn({ table, id, active }: { table: string; id: string; active: boolean }) {
    return (
      <form action={toggle}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="row_id" value={id} />
        <input type="hidden" name="active" value={active ? "1" : "0"} />
        <button type="submit" className={`badge ${active ? "bg-emerald-100 text-emerald-800" : "bg-sand-200 text-sand-700"}`}>
          {active ? (hu ? "Aktív" : "Active") : (hu ? "Inaktív" : "Inactive")}
        </button>
      </form>
    );
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Törzsadatok" : "Taxonomy"}</h1>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-lagoon-900">{hu ? "Kategóriák" : "Categories"}</h2>
        <form action={addCategory} className="card mt-3 grid gap-3 p-4 sm:grid-cols-4">
          <input name="slug" required placeholder="slug (pl. food-tours)" className="input" />
          <input name="name_en" required placeholder="Név (EN)" className="input" />
          <input name="name_hu" placeholder="Név (HU)" className="input" />
          <button className="btn-primary" type="submit">{hu ? "Új kategória" : "New category"}</button>
        </form>
        <div className="card mt-3 divide-y divide-lagoon-100">
          {(categories ?? []).map((c) => {
            const trs = (c.translations ?? []) as { locale: string; name: string }[];
            const name = (trs.find((x) => x.locale === locale) ?? trs.find((x) => x.locale === "en"))?.name ?? c.slug;
            return (
              <div key={c.id} className="flex items-center justify-between p-3 text-sm">
                <span>{c.icon} {name} <span className="text-xs text-lagoon-400">/{c.slug}</span></span>
                <ToggleBtn table="categories" id={c.id} active={c.is_active} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-lagoon-900">{hu ? "Országok" : "Countries"}</h2>
        <div className="card mt-3 grid gap-x-6 divide-lagoon-100 sm:grid-cols-2">
          {(countries ?? []).map((c) => (
            <div key={c.code} className="flex items-center justify-between border-b border-lagoon-50 p-3 text-sm">
              <span>{c.name} <span className="text-xs text-lagoon-400">{c.code}</span></span>
              <ToggleBtn table="countries" id={c.code} active={c.is_active} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-lagoon-900">{hu ? "Városok" : "Cities"}</h2>
        <div className="card mt-3 grid gap-x-6 sm:grid-cols-2">
          {(cities ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between border-b border-lagoon-50 p-3 text-sm">
              <span>{c.name} <span className="text-xs text-lagoon-400">{c.country_code}</span></span>
              <ToggleBtn table="cities" id={c.id} active={c.is_active} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-lagoon-900">{hu ? "Pénznemek" : "Currencies"}</h2>
        <div className="card mt-3 divide-y divide-lagoon-100">
          {(currencies ?? []).map((c) => (
            <div key={c.code} className="flex items-center justify-between p-3 text-sm">
              <span>{c.code} {c.symbol} <span className="text-xs text-lagoon-400">1 EUR = {c.rate_to_eur} {c.code}</span></span>
              <ToggleBtn table="currencies" id={c.code} active={c.is_active} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
