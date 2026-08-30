export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { requireAdmin, audit } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

export default async function AdminKyc({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);

  const { data: docs } = await svc.from("provider_documents")
    .select("id, provider_id, kind, file_path, expires_at, status, note, created_at, provider:providers(display_name, contact_email)")
    .in("status", ["uploaded", "rejected"])
    .order("created_at");

  // privát bucket → rövid életű signed URL-ek
  const signed = new Map<string, string>();
  for (const d of docs ?? []) {
    const { data } = await svc.storage.from("provider-docs").createSignedUrl(d.file_path, 300);
    if (data?.signedUrl) signed.set(d.id, data.signedUrl);
  }

  async function review(formData: FormData) {
    "use server";
    const { user: u, svc: s } = await requireAdmin(locale);
    const id = String(formData.get("doc_id") ?? "");
    const action = String(formData.get("action") ?? "");
    const note = String(formData.get("note") ?? "").trim() || null;
    if (!["verify", "reject"].includes(action)) throw new Error("invalid action");
    await s.from("provider_documents").update({
      status: action === "verify" ? "verified" : "rejected",
      reviewed_by: u.id,
      reviewed_at: new Date().toISOString(),
      note,
    }).eq("id", id);
    await audit(s, { actorId: u.id, action: `kyc.${action}`, entity: "provider_documents", entityId: id });
    revalidatePath(`/${locale}/admin/kyc`);
  }

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "KYC dokumentumok" : "KYC documents"}</h1>
      <div className="card mt-6 divide-y divide-lagoon-100">
        {(docs ?? []).map((d) => {
          const prov = d.provider as unknown as { display_name: string; contact_email: string } | null;
          const url = signed.get(d.id);
          return (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium text-lagoon-900">{prov?.display_name ?? d.provider_id} · {d.kind}</p>
                <p className="text-xs text-lagoon-500">
                  {new Date(d.created_at).toLocaleDateString(locale)}
                  {d.expires_at && ` · ${hu ? "lejár" : "expires"}: ${d.expires_at}`}
                  {d.status === "rejected" && d.note && ` · ${d.note}`}
                </p>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold text-lagoon-700 underline">
                    {hu ? "Megnyitás (5 perc)" : "Open (5 min)"}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                <form action={review}>
                  <input type="hidden" name="doc_id" value={d.id} />
                  <input type="hidden" name="action" value="verify" />
                  <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">
                    {hu ? "Ellenőrzött" : "Verify"}
                  </button>
                </form>
                <form action={review} className="flex items-center gap-1">
                  <input type="hidden" name="doc_id" value={d.id} />
                  <input type="hidden" name="action" value="reject" />
                  <input name="note" placeholder={hu ? "Indoklás" : "Reason"} className="input w-32 py-1 text-xs" required />
                  <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">
                    {hu ? "Elutasít" : "Reject"}
                  </button>
                </form>
              </div>
            </div>
          );
        })}
        {(docs ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>
    </div>
  );
}
