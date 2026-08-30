export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { listingSchema } from "@/lib/validation";
import { MediaUploader } from "./MediaUploader";
import { CalendarManager } from "./CalendarManager";

type Tab = "basics" | "options" | "media" | "calendar";

export default async function ListingEditorPage({
  params, searchParams,
}: { params: { locale: Locale; id: string }; searchParams: { tab?: string } }) {
  const { locale, id } = params;
  const t = getDictionary(locale);
  const tab = (["basics", "options", "media", "calendar"].includes(searchParams.tab ?? "")
    ? searchParams.tab : "basics") as Tab;

  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers").select("id, status")
    .eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const { data: l } = await sb.from("listings")
    .select(`*, translations:listing_translations(*),
      options:listing_options(*, translations:listing_option_translations(*)),
      extras:listing_extras(*), zones:listing_transfer_zones(*),
      media:listing_media(*)`)
    .eq("id", id).eq("provider_id", provider.id).maybeSingle();
  if (!l) notFound();

  const { data: categories } = await sb.from("categories").select("id, slug").eq("is_active", true);
  const { data: cities } = await sb.from("cities").select("id, name, country_code").eq("is_active", true);

  const trs = (l.translations ?? []) as { locale: string; title: string; description: string | null }[];
  const trEn = trs.find((x) => x.locale === "en");
  const trHu = trs.find((x) => x.locale === "hu");

  // ---------- server actions ----------
  async function saveBasics(formData: FormData) {
    "use server";
    const parsed = listingSchema.safeParse({
      title: formData.get("title"), description: formData.get("description") ?? "",
      categoryId: formData.get("category_id"), cityId: formData.get("city_id"),
      priceAdult: formData.get("price"), priceChild: formData.get("price_child") || null,
      currency: formData.get("currency"), duration: formData.get("duration") || null,
      maxParticipants: formData.get("max_participants"),
      confirmation: formData.get("confirmation"),
      meetingPoint: formData.get("meeting_point") ?? "",
      hasTransfer: formData.get("has_transfer") === "on",
      family: formData.get("family") === "on",
      wheelchair: formData.get("wheelchair") === "on",
      freeCancellation: formData.get("free_cancel") === "on",
      cancelFullHours: formData.get("cancel_hours") ?? 24,
    });
    if (!parsed.success) redirect(`/${locale}/provider/listings/${id}?tab=basics&error=validation`);
    const v = parsed.data;
    const city = (cities ?? []).find((c) => c.id === v.cityId);
    const sb2 = createClient();
    await sb2.from("listings").update({
      category_id: v.categoryId, city_id: v.cityId, country_code: city?.country_code ?? l!.country_code,
      base_price_adult: Math.round(v.priceAdult * 100),
      base_price_child: v.priceChild != null ? Math.round(v.priceChild * 100) : null,
      currency: v.currency, duration_minutes: v.duration, max_participants: v.maxParticipants,
      confirmation: v.confirmation, meeting_point: v.meetingPoint,
      has_transfer: v.hasTransfer, is_family_friendly: v.family,
      is_wheelchair_accessible: v.wheelchair, free_cancellation: v.freeCancellation,
      cancel_full_hours: v.cancelFullHours, updated_at: new Date().toISOString(),
    }).eq("id", id);
    await sb2.from("listing_translations").upsert([
      { listing_id: id, locale: "en", title: v.title, description: v.description },
      ...(String(formData.get("title_hu") ?? "")
        ? [{ listing_id: id, locale: "hu", title: String(formData.get("title_hu")) }] : []),
    ]);
    redirect(`/${locale}/provider/listings/${id}?tab=basics&saved=1`);
  }

  async function submitForReview() {
    "use server";
    const sb2 = createClient();
    await sb2.from("listings").update({ status: "pending_review" }).eq("id", id);
    redirect(`/${locale}/provider/listings/${id}?submitted=1`);
  }

  async function duplicate() {
    "use server";
    const sb2 = createClient();
    const { data: copy } = await sb2.from("listings").insert({
      provider_id: provider!.id, category_id: l!.category_id, city_id: l!.city_id,
      country_code: l!.country_code, slug: `${l!.slug}-copy-${Math.random().toString(36).slice(2, 6)}`,
      status: "draft", confirmation: l!.confirmation, duration_minutes: l!.duration_minutes,
      max_participants: l!.max_participants, base_price_adult: l!.base_price_adult,
      base_price_child: l!.base_price_child, currency: l!.currency,
      has_transfer: l!.has_transfer, meeting_point: l!.meeting_point,
      is_family_friendly: l!.is_family_friendly, is_wheelchair_accessible: l!.is_wheelchair_accessible,
      free_cancellation: l!.free_cancellation, cancel_full_hours: l!.cancel_full_hours,
    }).select("id").single();
    if (copy) {
      for (const tr of trs) {
        await sb2.from("listing_translations").insert({
          listing_id: copy.id, locale: tr.locale, title: `${tr.title} (copy)`, description: tr.description,
        });
      }
      redirect(`/${locale}/provider/listings/${copy.id}`);
    }
    redirect(`/${locale}/provider/dashboard`);
  }

  async function addOption(formData: FormData) {
    "use server";
    const sb2 = createClient();
    const code = String(formData.get("code") ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!code) return;
    const { data: opt } = await sb2.from("listing_options").insert({
      listing_id: id, code,
      price_delta_adult: Math.round(Number(formData.get("delta") ?? 0) * 100),
      max_participants: Number(formData.get("max_participants") ?? 0) || null,
    }).select("id").single();
    if (opt) {
      await sb2.from("listing_option_translations").insert([
        { option_id: opt.id, locale: "en", name: String(formData.get("name_en") ?? code) },
        { option_id: opt.id, locale: "hu", name: String(formData.get("name_hu") ?? code) },
      ]);
    }
    redirect(`/${locale}/provider/listings/${id}?tab=options`);
  }

  async function deleteRow(formData: FormData) {
    "use server";
    const sb2 = createClient();
    const kind = String(formData.get("kind"));
    const rowId = String(formData.get("row_id"));
    const tables: Record<string, string> = {
      option: "listing_options", extra: "listing_extras", zone: "listing_transfer_zones", media: "listing_media",
    };
    if (tables[kind]) {
      await sb2.from(tables[kind]).delete().eq("id", rowId).eq(kind === "media" ? "listing_id" : "listing_id", id);
    }
    redirect(`/${locale}/provider/listings/${id}?tab=${searchParams.tab ?? "options"}`);
  }

  async function addExtra(formData: FormData) {
    "use server";
    const sb2 = createClient();
    await sb2.from("listing_extras").insert({
      listing_id: id, name: String(formData.get("name") ?? ""),
      price: Math.round(Number(formData.get("price") ?? 0) * 100),
      currency: l!.currency, per_person: formData.get("per_person") === "on",
    });
    redirect(`/${locale}/provider/listings/${id}?tab=options`);
  }

  async function addZone(formData: FormData) {
    "use server";
    const sb2 = createClient();
    await sb2.from("listing_transfer_zones").insert({
      listing_id: id, zone_name: String(formData.get("zone_name") ?? ""),
      pickup_fee: Math.round(Number(formData.get("fee") ?? 0) * 100),
      note: String(formData.get("note") ?? ""),
    });
    redirect(`/${locale}/provider/listings/${id}?tab=options`);
  }

  const tabs: [Tab, string][] = [
    ["basics", t.providerArea.basics],
    ["options", t.providerArea.optionsExtrasZones],
    ["media", t.providerArea.media],
    ["calendar", t.providerArea.calendarPricing],
  ];

  return (
    <div className="container-page max-w-4xl py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-lagoon-950">{trEn?.title ?? l.slug}</h1>
        <div className="flex gap-2">
          <span className="badge bg-lagoon-100 text-lagoon-800">{l.status}</span>
          {l.is_test && <span className="badge bg-amber-100 text-amber-800">demo</span>}
          <form action={duplicate}><button className="btn-secondary px-3 py-2" type="submit">
            {t.providerArea.duplicate}</button></form>
          {["draft", "changes_requested"].includes(l.status) && (
            <form action={submitForReview}><button className="btn-primary px-3 py-2" type="submit">
              {t.providerArea.submitForReview}</button></form>
          )}
        </div>
      </div>

      <nav className="mt-6 flex gap-2 border-b border-lagoon-100 pb-2 text-sm">
        {tabs.map(([k, label]) => (
          <a key={k} href={`/${locale}/provider/listings/${id}?tab=${k}`}
            className={`rounded-lg px-3 py-2 font-medium ${tab === k ? "bg-lagoon-700 text-white" : "text-lagoon-700 hover:bg-lagoon-50"}`}>
            {label}
          </a>
        ))}
      </nav>

      {tab === "basics" && (
        <form action={saveBasics} className="card mt-6 space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="Title (EN)" name="title" defaultValue={trEn?.title} required />
            <F label="Cím (HU)" name="title_hu" defaultValue={trHu?.title ?? ""} />
            <div>
              <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.home.categories}</label>
              <select name="category_id" defaultValue={l.category_id} className="input">
                {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.slug}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.provider.city}</label>
              <select name="city_id" defaultValue={l.city_id} className="input">
                {(cities ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <F label={`${t.search.price} (${l.currency})`} name="price" type="number" step="0.01"
              defaultValue={(l.base_price_adult / 100).toFixed(2)} required />
            <F label={`${t.listing.children} (${l.currency})`} name="price_child" type="number" step="0.01"
              defaultValue={l.base_price_child != null ? (l.base_price_child / 100).toFixed(2) : ""} />
            <F label={`${t.search.duration} (min)`} name="duration" type="number"
              defaultValue={l.duration_minutes ?? ""} />
            <F label="Max pax" name="max_participants" type="number" defaultValue={l.max_participants} required />
            <div>
              <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.common.currency}</label>
              <select name="currency" defaultValue={l.currency} className="input">
                {["EUR", "USD", "HUF", "EGP", "GBP"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-lagoon-700">{t.search.instant}</label>
              <select name="confirmation" defaultValue={l.confirmation} className="input">
                <option value="instant">{t.search.instant}</option>
                <option value="manual">{t.providerArea.manual}</option>
              </select>
            </div>
            <F label={t.listing.meetingPoint} name="meeting_point" defaultValue={l.meeting_point ?? ""} />
            <F label={`${t.listing.freeCancel} (h)`} name="cancel_hours" type="number"
              defaultValue={l.cancel_full_hours} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">Description (EN)</label>
            <textarea name="description" rows={5} defaultValue={trEn?.description ?? ""} className="input" />
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <C name="has_transfer" label={t.search.withTransfer} defaultChecked={l.has_transfer} />
            <C name="family" label={t.search.family} defaultChecked={l.is_family_friendly} />
            <C name="wheelchair" label={t.search.wheelchair} defaultChecked={l.is_wheelchair_accessible} />
            <C name="free_cancel" label={t.search.freeCancellation} defaultChecked={l.free_cancellation} />
          </div>
          <button className="btn-primary" type="submit">{t.common.save}</button>
        </form>
      )}

      {tab === "options" && (
        <div className="mt-6 space-y-8">
          <Section title={t.listing.options}>
            <RowList rows={((l.options ?? []) as { id: string; code: string; price_delta_adult: number }[])
              .map((o) => ({ id: o.id, kind: "option",
                text: `${o.code} (+${(o.price_delta_adult / 100).toFixed(2)} ${l.currency})` }))}
              deleteAction={deleteRow} />
            <form action={addOption} className="mt-3 grid gap-2 sm:grid-cols-5">
              <input name="code" placeholder="vip" required className="input py-2" />
              <input name="name_en" placeholder="Name EN" required className="input py-2" />
              <input name="name_hu" placeholder="Név HU" className="input py-2" />
              <input name="delta" type="number" step="0.01" placeholder={`+${l.currency}`} className="input py-2" />
              <button className="btn-secondary py-2" type="submit">+</button>
            </form>
          </Section>

          <Section title={t.listing.extras}>
            <RowList rows={((l.extras ?? []) as { id: string; name: string; price: number; per_person: boolean }[])
              .map((x) => ({ id: x.id, kind: "extra",
                text: `${x.name} – ${(x.price / 100).toFixed(2)} ${l.currency}${x.per_person ? " /pax" : ""}` }))}
              deleteAction={deleteRow} />
            <form action={addExtra} className="mt-3 grid gap-2 sm:grid-cols-4">
              <input name="name" placeholder="Extra name" required className="input py-2" />
              <input name="price" type="number" step="0.01" placeholder={l.currency} className="input py-2" />
              <label className="flex items-center gap-2 text-sm text-lagoon-700">
                <input type="checkbox" name="per_person" className="h-4 w-4" /> /pax
              </label>
              <button className="btn-secondary py-2" type="submit">+</button>
            </form>
          </Section>

          <Section title={t.providerArea.transferZones}>
            <RowList rows={((l.zones ?? []) as { id: string; zone_name: string; pickup_fee: number }[])
              .map((z) => ({ id: z.id, kind: "zone",
                text: `${z.zone_name} (+${(z.pickup_fee / 100).toFixed(2)} ${l.currency})` }))}
              deleteAction={deleteRow} />
            <form action={addZone} className="mt-3 grid gap-2 sm:grid-cols-4">
              <input name="zone_name" placeholder="Zone name" required className="input py-2" />
              <input name="fee" type="number" step="0.01" placeholder={`Fee ${l.currency}`} className="input py-2" />
              <input name="note" placeholder="Note" className="input py-2" />
              <button className="btn-secondary py-2" type="submit">+</button>
            </form>
          </Section>
        </div>
      )}

      {tab === "media" && (
        <div className="mt-6">
          <MediaUploader listingId={id}
            media={((l.media ?? []) as { id: string; url: string; kind: string; sort_order: number }[])
              .sort((a, b) => a.sort_order - b.sort_order)}
            labels={{
              upload: t.providerArea.uploadImage,
              delete: t.providerArea.delete,
              uploading: t.providerArea.uploading,
            }} />
        </div>
      )}

      {tab === "calendar" && (
        <div className="mt-6">
          <CalendarManager listingId={id} locale={locale}
            labels={{
              addSlots: t.providerArea.addSlots,
              from: t.providerArea.from, to: t.providerArea.to,
              time: t.common.time, capacity: t.providerArea.capacity,
              priceAdult: t.providerArea.adultPriceSeasonal,
              priceChild: t.providerArea.childPrice,
              block: t.providerArea.blockDay,
              unblock: t.providerArea.unblock,
              save: t.common.save, blocked: t.providerArea.blocked,
              remaining: t.providerArea.free,
            }} />
        </div>
      )}
    </div>
  );
}

function F({ label, name, type = "text", defaultValue, required = false, step }: {
  label: string; name: string; type?: string; defaultValue?: string | number;
  required?: boolean; step?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-lagoon-700">{label}</label>
      <input name={name} type={type} step={step} defaultValue={defaultValue} required={required} className="input" />
    </div>
  );
}
function C({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 font-medium text-lagoon-700">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4" /> {label}
    </label>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold text-lagoon-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function RowList({ rows, deleteAction }: {
  rows: { id: string; kind: string; text: string }[];
  deleteAction: (fd: FormData) => Promise<void>;
}) {
  if (rows.length === 0) return <p className="text-sm text-lagoon-500">–</p>;
  return (
    <ul className="divide-y divide-lagoon-100 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between py-2">
          <span className="text-lagoon-800">{r.text}</span>
          <form action={deleteAction}>
            <input type="hidden" name="kind" value={r.kind} />
            <input type="hidden" name="row_id" value={r.id} />
            <button className="text-xs font-semibold text-red-700" type="submit">✕</button>
          </form>
        </li>
      ))}
    </ul>
  );
}
