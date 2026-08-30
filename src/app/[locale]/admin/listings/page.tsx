export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export default async function AdminListingsPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect(`/${locale}`);

  const { data: pending } = await sb.from("listings")
    .select("id, slug, status, is_test, created_at, translations:listing_translations(locale,title)")
    .in("status", ["pending_review", "draft"])
    .order("created_at")
    .limit(50);

  async function review(formData: FormData) {
    "use server";
    const sb = createClient();
    const { data: { user: u } } = await sb.auth.getUser();
    const id = String(formData.get("id"));
    const action = String(formData.get("action"));
    const status = action === "publish" ? "published" : action === "changes" ? "changes_requested" : "rejected";
    await sb.from("listings").update({
      status, published_at: status === "published" ? new Date().toISOString() : null,
    }).eq("id", id);
    await sb.from("audit_log").insert({
      actor_id: u?.id, actor_role: "admin",
      action: `listing.${status}`, entity: "listings", entity_id: id,
    });
    redirect(`/${locale}/admin/listings`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.admin.pendingListings}</h1>
      <p className="mt-2 text-sm text-lagoon-600">
        A demo Hurghada programok „draft” állapotúak – publikálás előtt ellenőrizd az árakat és leírásokat.
      </p>
      <div className="card mt-6 divide-y divide-lagoon-100">
        {(pending ?? []).map((l) => {
          const trs = (l.translations ?? []) as { locale: string; title: string }[];
          const title = (trs.find((x) => x.locale === "en") ?? trs[0])?.title ?? l.slug;
          return (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-4 p-4 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-medium text-lagoon-900">{title}</span>
                <span className="badge bg-lagoon-100 text-lagoon-800">{l.status}</span>
                {l.is_test && <span className="badge bg-amber-100 text-amber-800">demo</span>}
              </div>
              <form action={review} className="flex gap-2">
                <input type="hidden" name="id" value={l.id} />
                <button name="action" value="publish" className="btn-primary px-4 py-2">{t.admin.approve}</button>
                <button name="action" value="changes" className="btn-secondary px-4 py-2">Changes</button>
                <button name="action" value="reject" className="btn-secondary px-4 py-2 text-red-700">{t.admin.reject}</button>
              </form>
            </div>
          );
        })}
        {(pending ?? []).length === 0 && <p className="p-6 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
