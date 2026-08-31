export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

export default async function AdminReviews(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  const [{ data: reviews }, { data: reports }] = await Promise.all([
    svc.from("reviews")
      .select("id, listing_id, rating, comment, status, created_at, listing:listings(slug)")
      .in("status", ["pending", "flagged"])
      .order("created_at"),
    svc.from("review_reports").select("id, review_id, reason, created_at").order("created_at", { ascending: false }).limit(50),
  ]);

  async function moderate(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("review_id") ?? "");
    const action = String(formData.get("action") ?? "");
    if (!["publish", "hide", "remove"].includes(action)) throw new Error("invalid action");
    const status = action === "publish" ? "published" : "hidden";
    await s.from("reviews").update({
      status, moderated_by: u.id, moderated_at: new Date().toISOString(),
    }).eq("id", id);
    if (action === "publish") {
      // a trigger frissíti a listing ratinget
      await s.from("review_reports").delete().eq("review_id", id);
    }
    await audit(s, { actorId: u.id, action: `review.${action}`, entity: "reviews", entityId: id });
    revalidatePath(`/${locale}/admin/reviews`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Értékelés-moderáció" : "Review moderation"}</h1>
      <div className="card mt-6 divide-y divide-lagoon-100">
        {(reviews ?? []).map((r) => {
          const listing = r.listing as unknown as { slug: string } | null;
          const reportCount = (reports ?? []).filter((x) => x.review_id === r.id).length;
          return (
            <div key={r.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-lagoon-900">
                    {"★".repeat(r.rating)}
                    <span className="ms-2 text-xs text-lagoon-500">{listing?.slug}</span>
                    {reportCount > 0 && <span className="ms-2 badge bg-red-100 text-red-800">{reportCount} ⚑</span>}
                  </p>
                  <p className="mt-1 text-lagoon-600">{r.comment}</p>
                </div>
                <div className="flex gap-2">
                  {(["publish", "hide", "remove"] as const).map((a) => (
                    <form key={a} action={moderate}>
                      <input type="hidden" name="review_id" value={r.id} />
                      <input type="hidden" name="action" value={a} />
                      <button type="submit" className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${a === "publish" ? "bg-emerald-600" : a === "hide" ? "bg-amber-600" : "bg-red-600"}`}>
                        {hu ? (a === "publish" ? "Publikál" : a === "hide" ? "Elrejt" : "Töröl") : a}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {(reviews ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
