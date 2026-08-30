export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export default async function AdminListingsPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params; const t = getDictionary(locale); const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect(`/${locale}`);

  const listingSelect = `
    id, slug, status, created_at, country_code, currency, base_price_adult, base_price_child,
    duration_minutes, max_participants, min_participants, meeting_point, confirmation,
    has_transfer, is_family_friendly, is_wheelchair_accessible, free_cancellation,
    languages, provider:providers(display_name, legal_name, contact_email, contact_phone),
    translations:listing_translations(locale,title,short_description,description,includes,excludes,bring_with,important_info),
    media:listing_media(id,kind,url,sort_order),
    zones:listing_transfer_zones(zone_name,pickup_from,pickup_to,pickup_fee,note),
    options:listing_options(code,price_delta_adult,max_participants),
    extras:listing_extras(name,price,currency,per_person)
  `;
  const [{ data: pending }, { data: managed }] = await Promise.all([
    sb.from("listings").select(listingSelect).eq("status", "pending_review").order("created_at", { ascending: true }).limit(50),
    sb.from("listings").select(listingSelect).in("status", ["published", "paused", "changes_requested", "rejected", "archived"]).order("created_at", { ascending: false }).limit(100),
  ]);

  async function review(formData: FormData) {
    "use server";
    const actionClient = createClient(); const { data: { user: actor } } = await actionClient.auth.getUser();
    if (!actor) redirect(`/${locale}/auth/login`);
    const { data: actorIsAdmin } = await actionClient.rpc("is_admin");
    if (!actorIsAdmin) redirect(`/${locale}`);
    const id = String(formData.get("id")); const action = String(formData.get("action"));
    const status = action === "publish" ? "published"
      : action === "changes" ? "changes_requested"
      : action === "pause" ? "paused"
      : action === "restore" ? "published"
      : action === "archive" ? "archived"
      : "rejected";
    await actionClient.from("listings").update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    }).eq("id", id);
    await actionClient.from("audit_log").insert({ actor_id: actor?.id, actor_role: "admin", action: `listing.${status}`, entity: "listings", entity_id: id });
    redirect(`/${locale}/admin/listings`);
  }

  return <div className="container-page py-10">
    <div className="rounded-2xl bg-gradient-to-r from-lagoon-950 to-lagoon-700 p-7 text-white shadow-lg">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lagoon-100">Minőségellenőrzés</p>
      <div className="mt-2 flex items-end justify-between"><div><h1 className="text-2xl font-bold">{t.admin.pendingListings}</h1>
        <p className="mt-1 text-sm text-lagoon-100">Csak a szolgáltatók által véglegesen beküldött programok jelennek meg itt.</p></div>
        <span className="rounded-full bg-white/15 px-4 py-2 font-bold">{pending?.length ?? 0}</span>
      </div>
    </div>

    <div className="mt-6 space-y-5">
      {(pending ?? []).map((listing) => {
        const translations = (listing.translations ?? []) as any[];
        const tr = translations.find((x) => x.locale === "en") ?? translations[0];
        const media = [...((listing.media ?? []) as any[])].sort((a, b) => a.sort_order - b.sort_order);
        const provider = listing.provider as any;
        const imageCount = media.filter((m) => m.kind === "image").length;
        const checkCount = 1 + (imageCount < 3 ? 1 : 0) + (!tr?.description ? 1 : 0);
        return <details key={listing.id} className="group overflow-hidden rounded-2xl border border-lagoon-100 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 hover:bg-lagoon-50 sm:px-5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-lg font-black text-amber-800">!</span>
            <div className="min-w-0 flex-1"><h2 className="truncate font-bold text-lagoon-950">{tr?.title ?? listing.slug}</h2><p className="truncate text-xs text-lagoon-600">{provider?.display_name || provider?.legal_name || "Ismeretlen szolgáltató"} · {(listing.base_price_adult / 100).toFixed(2)} {listing.currency}</p></div>
            <span className="badge shrink-0 bg-amber-100 text-amber-900">{checkCount} ellenőrzés</span>
            <span className="text-xl text-lagoon-500 transition group-open:rotate-45">＋</span>
          </summary>
          <div className="border-t border-lagoon-100">
          <div className="grid md:grid-cols-[260px_1fr]">
            <div className="bg-sand-100">
              {media[0] ? (media[0].kind === "video" ? <video src={media[0].url} controls className="h-full min-h-56 w-full object-cover" /> :
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media[0].url} alt={tr?.title ?? listing.slug} className="h-full min-h-56 w-full object-cover" />) :
                <div className="grid min-h-56 place-items-center text-sm text-lagoon-500">Nincs kép</div>}
            </div>
            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><span className="badge bg-amber-100 text-amber-900">Ellenőrzésre beküldve</span>
                  <h2 className="mt-2 text-xl font-bold text-lagoon-950">{tr?.title ?? listing.slug}</h2>
                  <p className="mt-1 text-sm text-lagoon-600">{provider?.display_name || provider?.legal_name || "Ismeretlen szolgáltató"} · {provider?.contact_email}</p>
                </div>
                <div className="text-end"><p className="text-xl font-bold text-lagoon-950">{(listing.base_price_adult / 100).toFixed(2)} {listing.currency}</p>
                  <p className="text-xs text-lagoon-500">felnőtt alapár</p></div>
              </div>
              <p className="mt-4 line-clamp-3 text-sm leading-6 text-lagoon-700">{tr?.short_description || tr?.description || "Nincs leírás"}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="Időtartam" value={`${listing.duration_minutes ?? "—"} perc`} />
                <Stat label="Kapacitás" value={`${listing.max_participants ?? "—"} fő`} />
                <Stat label="Képek" value={`${media.filter((m) => m.kind === "image").length} db`} />
                <Stat label="Nyelvek" value={(listing.languages ?? []).join(", ") || "—"} />
              </div>
            </div>
          </div>

          <details className="border-t border-lagoon-100">
            <summary className="cursor-pointer list-none px-6 py-4 font-semibold text-lagoon-800 hover:bg-lagoon-50">Teljes programadatlap megnyitása ＋</summary>
            <div className="grid gap-6 border-t border-lagoon-100 bg-lagoon-50/40 p-6 md:grid-cols-2">
              <Info title="Részletes leírás" text={tr?.description} />
              <Info title="Találkozási pont" text={listing.meeting_point} />
              <Info title="Mit tartalmaz?" text={tr?.includes} />
              <Info title="Mit nem tartalmaz?" text={tr?.excludes} />
              <Info title="Mit hozzon magával?" text={tr?.bring_with} />
              <Info title="Fontos információ" text={tr?.important_info} />
              <Info title="Transzfer" text={listing.has_transfer ? "Van transzfer" : "Nincs transzfer"} />
              <Info title="Visszaigazolás" text={listing.confirmation === "instant" ? "Azonnali" : "Kézi"} />
              <div className="md:col-span-2"><h3 className="font-semibold text-lagoon-950">Transzferzónák</h3>
                <div className="mt-2 space-y-2">{((listing.zones ?? []) as any[]).map((z, i) => <div key={i} className="rounded-lg border bg-white p-3 text-sm">
                  <strong>{z.zone_name}</strong>: {z.pickup_from || "—"} → {z.pickup_to || "—"} · +{(z.pickup_fee / 100).toFixed(2)} {listing.currency}{z.note ? ` · ${z.note}` : ""}
                </div>)}{!(listing.zones ?? []).length && <p className="text-sm text-lagoon-500">Nincs megadva.</p>}</div>
              </div>
              {media.length > 1 && <div className="md:col-span-2"><h3 className="font-semibold text-lagoon-950">Média</h3><div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {media.map((m, i) => m.kind === "image" ? <img key={m.id} src={m.url} alt={`Programkép ${i + 1}`} className="h-28 w-full rounded-lg object-cover" /> : null)} {/* eslint-disable-line @next/next/no-img-element */}
              </div></div>}
            </div>
          </details>
          <form action={review} className="flex flex-wrap justify-end gap-2 border-t border-lagoon-100 p-4">
            <input type="hidden" name="id" value={listing.id} />
            <button name="action" value="changes" className="btn-secondary px-4 py-2">Módosítás kérése</button>
            <button name="action" value="reject" className="btn-secondary px-4 py-2 text-red-700">{t.admin.reject}</button>
            <button name="action" value="publish" className="btn-primary px-5 py-2">{t.admin.approve}</button>
          </form>
          </div>
        </details>;
      })}
      {(pending ?? []).length === 0 && <div className="rounded-2xl border border-dashed border-lagoon-200 bg-white p-12 text-center">
        <p className="text-lg font-semibold text-lagoon-900">Nincs ellenőrzésre váró program</p><p className="mt-1 text-sm text-lagoon-500">A piszkozatok itt nem jelennek meg.</p>
      </div>}
    </div>

    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-lagoon-600">Programkezelés</p>
          <h2 className="mt-1 text-2xl font-bold text-lagoon-950">Korábban elbírált programok</h2>
          <p className="mt-1 text-sm text-lagoon-600">A jóváhagyott programok nem tűnnek el: itt visszavonhatók, újra aktiválhatók, módosításra küldhetők vagy archiválhatók.</p></div>
        <span className="rounded-full bg-lagoon-100 px-4 py-2 font-bold text-lagoon-900">{managed?.length ?? 0}</span>
      </div>
      <div className="mt-5 space-y-4">
        {(managed ?? []).map((listing) => {
          const translations = (listing.translations ?? []) as any[];
          const tr = translations.find((x) => x.locale === "hu") ?? translations.find((x) => x.locale === "en") ?? translations[0];
          const media = [...((listing.media ?? []) as any[])].sort((a, b) => a.sort_order - b.sort_order);
          const provider = listing.provider as any;
          const needsAction = ["changes_requested", "rejected", "paused"].includes(listing.status);
          return <details key={listing.id} className="group overflow-hidden rounded-2xl border border-lagoon-100 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 hover:bg-lagoon-50 sm:px-5">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-black ${needsAction ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{needsAction ? "!" : "✓"}</span>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold text-lagoon-950">{tr?.title ?? listing.slug}</h3><StatusBadge status={listing.status} /></div><p className="truncate text-xs text-lagoon-600">{provider?.display_name || provider?.legal_name || "Ismeretlen szolgáltató"} · {(listing.base_price_adult / 100).toFixed(2)} {listing.currency}</p></div>
              <span className={`badge shrink-0 ${needsAction ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{needsAction ? "Teendő" : "Nincs teendő"}</span>
              <span className="text-xl text-lagoon-500 transition group-open:rotate-45">＋</span>
            </summary>
            <div className="border-t border-lagoon-100">
            <div className="grid sm:grid-cols-[150px_1fr]">
              <div className="bg-sand-100">{media[0]?.kind === "image" ? <img src={media[0].url} alt="" className="h-full min-h-32 w-full object-cover" /> : <div className="grid h-32 place-items-center text-sm text-lagoon-500">Nincs kép</div>}</div>
              <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3">
                <div><StatusBadge status={listing.status} /><h3 className="mt-2 text-lg font-bold text-lagoon-950">{tr?.title ?? listing.slug}</h3>
                  <p className="text-sm text-lagoon-600">{provider?.display_name || provider?.legal_name || "Ismeretlen szolgáltató"} · {(listing.base_price_adult / 100).toFixed(2)} {listing.currency}</p></div>
                <a href={`/${locale}/listing/${listing.slug}`} target="_blank" className="btn-secondary px-4 py-2 text-sm">Nyilvános adatlap ↗</a>
              </div></div>
            </div>
            <details className="border-t border-lagoon-100"><summary className="cursor-pointer px-5 py-3 font-semibold text-lagoon-800">Programadatok és média megnyitása ＋</summary>
              <div className="grid gap-5 border-t bg-lagoon-50/40 p-5 md:grid-cols-2"><Info title="Leírás" text={tr?.description} /><Info title="Találkozási pont" text={listing.meeting_point} />
                <Info title="Tartalmazza" text={tr?.includes} /><Info title="Nem tartalmazza" text={tr?.excludes} /></div>
            </details>
            <form action={review} className="flex flex-wrap justify-end gap-2 border-t border-lagoon-100 p-4"><input type="hidden" name="id" value={listing.id} />
              {listing.status === "published" ? <button name="action" value="pause" className="btn-secondary px-4 py-2">Visszavonás</button> : <button name="action" value="restore" className="btn-primary px-4 py-2">Újra aktiválás</button>}
              <button name="action" value="changes" className="btn-secondary px-4 py-2">Módosítás kérése</button>
              {listing.status !== "archived" && <button name="action" value="archive" className="btn-secondary px-4 py-2 text-red-700">Törlés / archiválás</button>}
            </form>
            </div>
          </details>;
        })}
      </div>
    </section>
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { published: "Aktív", paused: "Visszavonva", changes_requested: "Módosítás szükséges", rejected: "Elutasítva", archived: "Archiválva" };
  const color = status === "published" ? "bg-emerald-100 text-emerald-800" : status === "archived" || status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900";
  return <span className={`badge ${color}`}>{labels[status] ?? status}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-lagoon-50 p-3"><p className="text-xs text-lagoon-500">{label}</p><p className="mt-1 font-semibold text-lagoon-900">{value}</p></div>;
}
function Info({ title, text }: { title: string; text?: string | null }) {
  return <div><h3 className="font-semibold text-lagoon-950">{title}</h3><p className="mt-1 whitespace-pre-line text-sm leading-6 text-lagoon-700">{text || "—"}</p></div>;
}
