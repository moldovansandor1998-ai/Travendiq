export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { listingSchema } from "@/lib/validation";
import { MediaUploader } from "./MediaUploader";
import { CalendarManager } from "./CalendarManager";

type Tab = "basics" | "options" | "media" | "calendar" | "review";

export default async function ListingEditorPage(
  props: { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ tab?: string; error?: string; submitted?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { locale, id } = params;
  const t = getDictionary(locale);
  const tab = (["basics", "options", "media", "calendar", "review"].includes(searchParams.tab ?? "")
    ? searchParams.tab : "basics") as Tab;

  const sb = await createClient();
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

  const trs = (l.translations ?? []) as { locale: string; title: string; description: string | null;
    short_description: string | null; includes: string | null; excludes: string | null;
    bring_with: string | null; important_info: string | null; accessibility_info: string | null }[];
  const trEn = trs.find((x) => x.locale === "en");
  const trHu = trs.find((x) => x.locale === "hu");
  const mediaCount = (l.media ?? []).filter((m: { kind: string }) => m.kind === "image").length;
  const { count: futureSlots } = await sb.from("availability").select("id", { count: "exact", head: true })
    .eq("listing_id", id).gte("date", new Date().toISOString().slice(0, 10)).eq("is_blocked", false);
  const completion = [
    { ok: Boolean(trEn?.title && trEn.title.trim().length >= 5), label: locale === "hu" ? "Programcím" : "Activity title" },
    { ok: Boolean(trEn?.description && trEn.description.trim().length >= 80), label: locale === "hu" ? "Részletes leírás" : "Detailed description" },
    { ok: Boolean(trEn?.short_description && trEn.short_description.trim().length >= 30), label: locale === "hu" ? "Rövid összefoglaló" : "Short summary" },
    { ok: Boolean(trEn?.includes?.trim() && trEn?.excludes?.trim()), label: locale === "hu" ? "Tartalmazza / nem tartalmazza" : "Includes / excludes" },
    { ok: Boolean(l.meeting_point && l.duration_minutes && l.base_price_adult > 0), label: locale === "hu" ? "Találkozás, időtartam és ár" : "Meeting, duration and price" },
    { ok: mediaCount >= 3, label: locale === "hu" ? `Legalább 3 kép (${mediaCount}/3)` : `At least 3 photos (${mediaCount}/3)` },
    { ok: (futureSlots ?? 0) > 0, label: locale === "hu" ? "Legalább egy foglalható időpont" : "At least one bookable time" },
  ];
  const isComplete = completion.every((item) => item.ok);

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
      minParticipants: formData.get("min_participants") ?? 1,
      languages: String(formData.get("languages") ?? "en").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
    });
    if (!parsed.success) redirect(`/${locale}/provider/listings/${id}?tab=basics&error=validation`);
    const v = parsed.data;
    const city = (cities ?? []).find((c) => c.id === v.cityId);
    const sb2 = await createClient();
    await sb2.from("listings").update({
      category_id: v.categoryId, city_id: v.cityId, country_code: city?.country_code ?? l!.country_code,
      base_price_adult: Math.round(v.priceAdult * 100),
      base_price_child: v.priceChild != null ? Math.round(v.priceChild * 100) : null,
      currency: v.currency, duration_minutes: v.duration, max_participants: v.maxParticipants,
      confirmation: v.confirmation, meeting_point: v.meetingPoint,
      has_transfer: v.hasTransfer, is_family_friendly: v.family,
      is_wheelchair_accessible: v.wheelchair, free_cancellation: v.freeCancellation,
      cancel_full_hours: v.cancelFullHours, updated_at: new Date().toISOString(),
      min_participants: v.minParticipants,
      min_age: Number(formData.get("min_age") ?? 0) || null,
      max_age: Number(formData.get("max_age") ?? 0) || null,
      is_private_available: formData.get("private_available") === "on",
      languages: v.languages,
    }).eq("id", id);
    await sb2.from("listing_translations").upsert([
      { listing_id: id, locale: "en", title: v.title, description: v.description,
        short_description: String(formData.get("short_description") ?? "").trim(),
        includes: String(formData.get("includes") ?? "").trim(),
        excludes: String(formData.get("excludes") ?? "").trim(),
        bring_with: String(formData.get("bring_with") ?? "").trim(),
        important_info: String(formData.get("important_info") ?? "").trim(),
        accessibility_info: String(formData.get("accessibility_info") ?? "").trim() },
      ...(String(formData.get("title_hu") ?? "")
        ? [{ listing_id: id, locale: "hu", title: String(formData.get("title_hu")) }] : []),
    ]);
    redirect(`/${locale}/provider/listings/${id}?tab=options`);
  }

  async function duplicate() {
    "use server";
    const sb2 = await createClient();
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
    const sb2 = await createClient();
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
    const sb2 = await createClient();
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
    const sb2 = await createClient();
    await sb2.from("listing_extras").insert({
      listing_id: id, name: String(formData.get("name") ?? ""),
      price: Math.round(Number(formData.get("price") ?? 0) * 100),
      currency: l!.currency, per_person: formData.get("per_person") === "on",
    });
    redirect(`/${locale}/provider/listings/${id}?tab=options`);
  }

  async function addZone(formData: FormData) {
    "use server";
    const sb2 = await createClient();
    await sb2.from("listing_transfer_zones").insert({
      listing_id: id, zone_name: String(formData.get("zone_name") ?? ""),
      pickup_from: String(formData.get("pickup_from") ?? ""),
      pickup_to: String(formData.get("pickup_to") ?? ""),
      pickup_fee: Math.round(Number(formData.get("fee") ?? 0) * 100),
      note: String(formData.get("note") ?? ""),
    });
    redirect(`/${locale}/provider/listings/${id}?tab=options`);
  }

  async function submitForReview() {
    "use server";
    const auth = await createClient();
    const { data: { user: actionUser } } = await auth.auth.getUser();
    if (!actionUser) redirect(`/${locale}/auth/login`);
    const { data: owned } = await auth.from("listings").select("id").eq("id", id).eq("provider_id", provider!.id).maybeSingle();
    if (!owned) redirect(`/${locale}/provider/dashboard`);
    const svc = createServiceClient();
    const [{ data: listing }, { data: translation }, { count: images }, { count: slots }] = await Promise.all([
      svc.from("listings").select("status, meeting_point, duration_minutes, base_price_adult").eq("id", id).single(),
      svc.from("listing_translations").select("title, description, short_description, includes, excludes")
        .eq("listing_id", id).eq("locale", "en").maybeSingle(),
      svc.from("listing_media").select("id", { count: "exact", head: true }).eq("listing_id", id).eq("kind", "image"),
      svc.from("availability").select("id", { count: "exact", head: true }).eq("listing_id", id)
        .gte("date", new Date().toISOString().slice(0, 10)).eq("is_blocked", false),
    ]);
    const complete = Boolean(listing && ["draft", "changes_requested"].includes(listing.status) &&
      listing.meeting_point && listing.duration_minutes && listing.base_price_adult > 0 &&
      translation?.title?.trim().length >= 5 && translation?.description?.trim().length >= 80 &&
      translation?.short_description?.trim().length >= 30 && translation?.includes?.trim() &&
      translation?.excludes?.trim() && (images ?? 0) >= 3 && (slots ?? 0) > 0);
    if (!complete) redirect(`/${locale}/provider/listings/${id}?tab=review&error=incomplete`);
    await svc.from("listings").update({ status: "pending_review", updated_at: new Date().toISOString() })
      .eq("id", id).in("status", ["draft", "changes_requested"]);
    redirect(`/${locale}/provider/listings/${id}?tab=review&submitted=1`);
  }

  const tabs: [Tab, string][] = [
    ["basics", t.providerArea.basics],
    ["options", t.providerArea.optionsExtrasZones],
    ["media", t.providerArea.media],
    ["calendar", t.providerArea.calendarPricing],
    ["review", locale === "hu" ? "Áttekintés és beküldés" : "Review and submit"],
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
        </div>
      </div>

      {["draft", "changes_requested"].includes(l.status) && (
        <section className="mt-5 rounded-xl border border-lagoon-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-lagoon-950">{locale === "hu" ? "Program teljessége" : "Activity completeness"}</h2>
              <p className="mt-1 text-sm text-lagoon-600">{locale === "hu" ? "Haladj végig az 5 lépésen. A program csak az utolsó oldalon, az Ellenőrzésre küldés gombbal kerül beküldésre." : "Complete all 5 steps. The activity is only submitted from the final review page."}</p>
            </div>
            <span className={`badge ${isComplete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
              {completion.filter((x) => x.ok).length}/{completion.length}
            </span>
          </div>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {completion.map((item) => <li key={item.label} className={item.ok ? "text-emerald-700" : "text-lagoon-600"}>{item.ok ? "✓" : "○"} {item.label}</li>)}
          </ul>
        </section>
      )}

      <div className="mt-6 rounded-2xl bg-gradient-to-r from-lagoon-950 via-lagoon-800 to-lagoon-700 p-5 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lagoon-100">Program létrehozása</p>
        <div className="mt-2 flex items-end justify-between gap-4"><div><h2 className="text-xl font-bold">{tabs.find(([key]) => key === tab)?.[1]}</h2>
          <p className="mt-1 text-sm text-lagoon-100">Tölts ki minden szükséges információt, hogy a vendég pontosan tudja, mit foglal.</p></div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">{tabs.findIndex(([key]) => key === tab) + 1}/5</span>
        </div>
      </div>
      <nav className="mt-4 grid gap-2 border-b border-lagoon-100 pb-4 text-sm sm:grid-cols-5">
        {tabs.map(([k, label], index) => (
          <a key={k} href={`/${locale}/provider/listings/${id}?tab=${k}`}
            className={`flex min-h-14 items-center gap-2 rounded-xl px-3 py-2 font-medium transition ${tab === k ? "bg-lagoon-700 text-white shadow-md" : "border border-lagoon-100 bg-white text-lagoon-700 hover:border-lagoon-300 hover:bg-lagoon-50"}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${tab === k ? "bg-white text-lagoon-800" : "bg-lagoon-100"}`}>{index + 1}</span>
            <span className="leading-tight">{label}</span>
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
            <F label={locale === "hu" ? "Minimum résztvevő" : "Minimum participants"} name="min_participants" type="number" defaultValue={l.min_participants ?? 1} required />
            <F label={locale === "hu" ? "Minimum életkor" : "Minimum age"} name="min_age" type="number" defaultValue={l.min_age ?? ""} />
            <F label={locale === "hu" ? "Maximum életkor" : "Maximum age"} name="max_age" type="number" defaultValue={l.max_age ?? ""} />
            <F label={locale === "hu" ? "Program nyelvei (pl. en,hu,de)" : "Activity languages (e.g. en,hu,de)"} name="languages" defaultValue={(l.languages ?? ["en"]).join(",")} required />
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
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700">{locale === "hu" ? "Rövid összefoglaló (EN)" : "Short summary (EN)"}</label>
            <textarea name="short_description" rows={2} minLength={30} defaultValue={trEn?.short_description ?? ""} className="input" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextArea label={locale === "hu" ? "Mit tartalmaz? (EN)" : "What's included? (EN)"} name="includes" value={trEn?.includes ?? ""} />
            <TextArea label={locale === "hu" ? "Mit nem tartalmaz? (EN)" : "What's not included? (EN)"} name="excludes" value={trEn?.excludes ?? ""} />
            <TextArea label={locale === "hu" ? "Mit hozzon magával? (EN)" : "What to bring? (EN)"} name="bring_with" value={trEn?.bring_with ?? ""} />
            <TextArea label={locale === "hu" ? "Fontos tudnivalók (EN)" : "Important information (EN)"} name="important_info" value={trEn?.important_info ?? ""} />
            <TextArea label={locale === "hu" ? "Akadálymentességi információ (EN)" : "Accessibility information (EN)"} name="accessibility_info" value={trEn?.accessibility_info ?? ""} />
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <C name="has_transfer" label={t.search.withTransfer} defaultChecked={l.has_transfer} />
            <C name="family" label={t.search.family} defaultChecked={l.is_family_friendly} />
            <C name="wheelchair" label={t.search.wheelchair} defaultChecked={l.is_wheelchair_accessible} />
            <C name="free_cancel" label={t.search.freeCancellation} defaultChecked={l.free_cancellation} />
            <C name="private_available" label={locale === "hu" ? "Privát foglalás elérhető" : "Private booking available"} defaultChecked={l.is_private_available} />
          </div>
          <button className="btn-primary" type="submit">{locale === "hu" ? "Mentés és tovább" : "Save and continue"} →</button>
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
            <p className="mb-4 text-sm text-lagoon-600">Add meg pontosan, melyik területről melyik területig érvényes a felvétel és mennyi a felár.</p>
            <RowList rows={((l.zones ?? []) as { id: string; zone_name: string; pickup_from: string | null; pickup_to: string | null; pickup_fee: number }[])
              .map((z) => ({ id: z.id, kind: "zone",
                text: `${z.zone_name}: ${z.pickup_from || "—"} → ${z.pickup_to || "—"} (+${(z.pickup_fee / 100).toFixed(2)} ${l.currency})` }))}
              deleteAction={deleteRow} />
            <form action={addZone} className="mt-4 grid gap-3 rounded-xl bg-lagoon-50 p-4 sm:grid-cols-2">
              <F label="Zóna neve" name="zone_name" required />
              <F label="Felár" name="fee" type="number" step="0.01" />
              <F label="Felvétel innen (pl. Hurghada központ)" name="pickup_from" required />
              <F label="Zóna határa / eddig (pl. Makadi Bay)" name="pickup_to" required />
              <div className="sm:col-span-2"><F label="Megjegyzés a vendégnek" name="note" /></div>
              <button className="btn-secondary py-3 sm:col-span-2" type="submit">＋ Transzferzóna hozzáadása</button>
            </form>
          </Section>
          <div className="flex justify-end"><a className="btn-primary" href={`/${locale}/provider/listings/${id}?tab=media`}>
            {locale === "hu" ? "Tovább a képekhez" : "Continue to photos"} →</a></div>
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
          <div className="mt-6 flex items-center justify-between gap-3">
            <span className={`text-sm font-medium ${mediaCount >= 3 ? "text-emerald-700" : "text-amber-700"}`}>
              {mediaCount >= 3 ? `✓ ${mediaCount} kép feltöltve` : `${mediaCount}/3 kötelező kép feltöltve`}
            </span>
            <a aria-disabled={mediaCount < 3} className={`btn-primary ${mediaCount < 3 ? "pointer-events-none opacity-40" : ""}`}
              href={`/${locale}/provider/listings/${id}?tab=calendar`}>{locale === "hu" ? "Tovább a naptárhoz" : "Continue to calendar"} →</a>
          </div>
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
          <div className="mt-6 flex justify-end"><a className="btn-primary" href={`/${locale}/provider/listings/${id}?tab=review`}>
            {locale === "hu" ? "Tovább az áttekintéshez" : "Continue to review"} →</a></div>
        </div>
      )}

      {tab === "review" && (
        <div className="mt-6 space-y-5">
          {searchParams.error === "incomplete" && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            A program még nem teljes. Pótold a pirossal vagy üres körrel jelölt adatokat, majd küldd be újra.
          </div>}
          {searchParams.submitted === "1" && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
            A programot sikeresen elküldted ellenőrzésre.
          </div>}
          <section className="card p-6">
            <h2 className="text-xl font-bold text-lagoon-950">{locale === "hu" ? "Program áttekintése" : "Activity review"}</h2>
            <p className="mt-1 text-sm text-lagoon-600">Ellenőrizd a program minden részét beküldés előtt.</p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <ReviewItem label="Program neve" value={trEn?.title || "—"} />
              <ReviewItem label="Helyszín" value={(cities ?? []).find((c) => c.id === l.city_id)?.name || "—"} />
              <ReviewItem label="Ár" value={`${(l.base_price_adult / 100).toFixed(2)} ${l.currency}`} />
              <ReviewItem label="Időtartam" value={l.duration_minutes ? `${l.duration_minutes} perc` : "—"} />
              <ReviewItem label="Képek" value={`${mediaCount} db`} />
              <ReviewItem label="Foglalható időpontok" value={`${futureSlots ?? 0} db`} />
            </dl>
            <div className="mt-6 border-t border-lagoon-100 pt-5">
              <h3 className="font-semibold">Beküldés előtti ellenőrzőlista</h3>
              <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {completion.map((item) => <li key={item.label} className={item.ok ? "text-emerald-700" : "font-medium text-red-700"}>{item.ok ? "✓" : "○"} {item.label}</li>)}
              </ul>
            </div>
          </section>
          {["draft", "changes_requested"].includes(l.status) && <form action={submitForReview} className="flex justify-end">
            <button type="submit" disabled={!isComplete} className="btn-primary disabled:cursor-not-allowed disabled:opacity-40">
              {locale === "hu" ? "Ellenőrzésre küldés" : "Submit for review"}
            </button>
          </form>}
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
function TextArea({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-lagoon-700">{label}</label>
      <textarea name={name} rows={4} defaultValue={value} className="input" />
    </div>
  );
}
function ReviewItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-lagoon-50 p-4">
    <dt className="text-xs font-semibold uppercase tracking-wide text-lagoon-600">{label}</dt>
    <dd className="mt-1 font-medium text-lagoon-950">{value}</dd>
  </div>;
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
