export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

export default async function AdminCms({ params, searchParams }: {
  params: { locale: Locale };
  searchParams: { slug?: string; plocale?: string };
}) {
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  const { data: pages } = await svc.from("pages")
    .select("id, slug, locale, title, is_published, legal_approved, updated_at")
    .order("slug").order("locale");

  const editSlug = searchParams.slug;
  const editLocale = searchParams.plocale ?? "en";
  const { data: editing } = editSlug
    ? await svc.from("pages").select("id, slug, locale, title, body_md, is_published, legal_approved")
        .eq("slug", editSlug).eq("locale", editLocale).maybeSingle()
    : { data: null };

  async function save(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const slug = String(formData.get("slug") ?? "").trim();
    const plocale = String(formData.get("plocale") ?? "en").trim();
    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body_md") ?? "");
    const published = formData.get("is_published") === "on";
    const legalApproved = formData.get("legal_approved") === "on";
    if (!slug || !title) throw new Error("invalid input");
    const { error: saveErr } = await s.from("pages").upsert({
      slug, locale: plocale, title, body_md: body, is_published: published,
      legal_approved: legalApproved,
      updated_by: u.id, updated_at: new Date().toISOString(),
    }, { onConflict: "slug,locale" });
    if (saveErr) throw new Error(`cms_save_failed: ${saveErr.message}`);
    await audit(s, { actorId: u.id, action: "cms.save", entity: "pages", entityId: `${slug}/${plocale}` });
    revalidatePath(`/${locale}/admin/cms`);
    revalidatePath(`/${locale}/legal/${slug}`);
  }

  async function togglePublish(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const slug = String(formData.get("slug") ?? "");
    const plocale = String(formData.get("plocale") ?? "en");
    const published = String(formData.get("published") ?? "") === "1";
    const { error: togErr } = await s.from("pages").update({ is_published: !published }).eq("slug", slug).eq("locale", plocale);
    if (togErr) throw new Error(`cms_toggle_failed: ${togErr.message}`);
    await audit(s, { actorId: u.id, action: "cms.toggle", entity: "pages", entityId: `${slug}/${plocale}` });
    revalidatePath(`/${locale}/admin/cms`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "CMS oldalak" : "CMS pages"}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card divide-y divide-lagoon-100 self-start">
          {(pages ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <a href={`/${locale}/admin/cms?slug=${p.slug}&plocale=${p.locale}`}
                className="font-medium text-lagoon-800 hover:underline">
                {p.slug} <span className="text-xs text-lagoon-400">[{p.locale}]</span>
                {!p.legal_approved && (
                  <span className="badge ml-1 bg-amber-100 text-amber-800">
                    {hu ? "jogi jóváhagyásra vár" : "legal approval pending"}
                  </span>
                )}
              </a>
              <form action={togglePublish}>
                <input type="hidden" name="slug" value={p.slug} />
                <input type="hidden" name="plocale" value={p.locale} />
                <input type="hidden" name="published" value={p.is_published ? "1" : "0"} />
                <button type="submit" className={`badge ${p.is_published ? "bg-emerald-100 text-emerald-800" : "bg-sand-200 text-sand-700"}`}>
                  {p.is_published ? (hu ? "Publikus" : "Published") : (hu ? "Rejtett" : "Hidden")}
                </button>
              </form>
            </div>
          ))}
        </div>

        <form action={save} className="card self-start p-5">
          <h2 className="font-semibold text-lagoon-900">
            {editing ? `${editing.slug} [${editing.locale}]` : (hu ? "Új oldal" : "New page")}
          </h2>
          <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Slug
                <input name="slug" required defaultValue={editing?.slug ?? ""} className="input mt-1" readOnly={!!editing} />
              </label>
              <label className="text-sm">{hu ? "Nyelv" : "Locale"}
                <input name="plocale" required defaultValue={editing?.locale ?? "en"} className="input mt-1" readOnly={!!editing} />
              </label>
            </div>
            <label className="text-sm">{hu ? "Cím" : "Title"}
              <input name="title" required defaultValue={editing?.title ?? ""} className="input mt-1" />
            </label>
            <label className="text-sm">{hu ? "Tartalom (Markdown)" : "Content (Markdown)"}
              <textarea name="body_md" rows={14} defaultValue={editing?.body_md ?? ""} className="input mt-1 font-mono text-xs" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_published" defaultChecked={editing?.is_published ?? true} />
              {hu ? "Publikus" : "Published"}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="legal_approved" defaultChecked={editing?.legal_approved ?? false} />
              {hu
                ? "Jogász által jóváhagyva (jogi oldalak csak így jelennek meg)"
                : "Approved by legal counsel (legal pages only render with this)"}
            </label>
            <button className="btn-primary" type="submit">{hu ? "Mentés" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
