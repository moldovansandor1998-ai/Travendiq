import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type Labels = {
  addSlots: string; from: string; to: string; time: string; capacity: string;
  priceAdult: string; priceChild: string; block: string; unblock: string;
  save: string; blocked: string; remaining: string;
};

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function CalendarManager({ listingId, locale, labels }: {
  listingId: string; locale: string; labels: Labels;
}) {
  const sb = createClient();
  const today = fmtDate(new Date());
  const until = fmtDate(new Date(Date.now() + 60 * 86400000));

  const { data: slots } = await sb
    .from("availability")
    .select("id, date, start_time, capacity, booked_count, is_blocked, price_adult, price_child, option_id")
    .eq("listing_id", listingId)
    .is("option_id", null)
    .gte("date", today)
    .lte("date", until)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(200);

  async function guardOwner() {
    "use server";
    const sb2 = createClient();
    const { data: { user } } = await sb2.auth.getUser();
    if (!user) redirect(`/${locale}/auth/login`);
    const { data: l } = await sb2.from("listings").select("provider_id").eq("id", listingId).single();
    if (!l) throw new Error("not found");
    const { data: isStaff } = (await sb2.rpc("is_staff")) as { data: boolean | null };
    const { data: prov } = await sb2.from("providers").select("id").eq("id", l.provider_id).eq("owner_id", user.id).maybeSingle();
    const { data: member } = await sb2.from("provider_members").select("id").eq("provider_id", l.provider_id).eq("user_id", user.id).maybeSingle();
    if (!isStaff && !prov && !member) throw new Error("forbidden");
    return createServiceClient();
  }

  async function addSlots(formData: FormData) {
    "use server";
    const svc = await guardOwner();
    const from = String(formData.get("from") ?? "");
    const to = String(formData.get("to") ?? "");
    const time = String(formData.get("time") ?? "09:00");
    const capacity = Math.max(1, Math.min(500, Number(formData.get("capacity") ?? 0) || 0));
    const paRaw = String(formData.get("price_adult") ?? "").trim();
    const pcRaw = String(formData.get("price_child") ?? "").trim();
    const priceAdult = paRaw ? Math.round(Number(paRaw) * 100) : null;
    const priceChild = pcRaw ? Math.round(Number(pcRaw) * 100) : null;
    if (!from || !to || !capacity) throw new Error("invalid input");
    const rows: Record<string, unknown>[] = [];
    const d0 = new Date(from + "T00:00:00Z");
    const d1 = new Date(to + "T00:00:00Z");
    for (let d = d0; d <= d1 && rows.length < 370; d = new Date(d.getTime() + 86400000)) {
      rows.push({
        listing_id: listingId,
        option_id: null,
        date: fmtDate(d),
        start_time: time,
        capacity,
        price_adult: priceAdult,
        price_child: priceChild,
        is_blocked: false,
      });
    }
    if (rows.length) {
      // a meglévő (listing, date, time) alapturnusokat a rész-unique index miatt kihagyja
      await svc.from("availability").upsert(rows, { ignoreDuplicates: true });
    }
    // Ez az utolsó kötelező lépés. Csak teljes program kerül automatikusan
    // ellenőrzésre; a hiányos adatlap továbbra is piszkozat marad.
    const [{ data: listing }, { data: translation }, { count: imageCount }, { count: slotCount }] = await Promise.all([
      svc.from("listings").select("status, meeting_point, duration_minutes, base_price_adult").eq("id", listingId).single(),
      svc.from("listing_translations").select("title, description, short_description, includes, excludes")
        .eq("listing_id", listingId).eq("locale", "en").maybeSingle(),
      svc.from("listing_media").select("id", { count: "exact", head: true }).eq("listing_id", listingId).eq("kind", "image"),
      svc.from("availability").select("id", { count: "exact", head: true }).eq("listing_id", listingId)
        .gte("date", fmtDate(new Date())).eq("is_blocked", false),
    ]);
    const complete = Boolean(
      listing && ["draft", "changes_requested"].includes(listing.status) &&
      listing.meeting_point && listing.duration_minutes && listing.base_price_adult > 0 &&
      translation?.title?.trim().length >= 5 &&
      translation?.description?.trim().length >= 80 &&
      translation?.short_description?.trim().length >= 30 &&
      translation?.includes?.trim() && translation?.excludes?.trim() &&
      (imageCount ?? 0) >= 3 && (slotCount ?? 0) > 0
    );
    if (complete) {
      await svc.from("listings").update({ status: "pending_review", updated_at: new Date().toISOString() })
        .eq("id", listingId).in("status", ["draft", "changes_requested"]);
    }
    revalidatePath(`/${locale}/provider/listings/${listingId}`);
  }

  async function toggleBlock(formData: FormData) {
    "use server";
    const svc = await guardOwner();
    const id = String(formData.get("slot_id") ?? "");
    const blocked = String(formData.get("blocked") ?? "") === "1";
    await svc.from("availability").update({ is_blocked: !blocked }).eq("id", id).eq("listing_id", listingId);
    revalidatePath(`/${locale}/provider/listings/${listingId}`);
  }

  async function removeSlot(formData: FormData) {
    "use server";
    const svc = await guardOwner();
    const id = String(formData.get("slot_id") ?? "");
    await svc.from("availability").delete().eq("id", id).eq("listing_id", listingId).eq("booked_count", 0);
    revalidatePath(`/${locale}/provider/listings/${listingId}`);
  }

  return (
    <div className="space-y-6">
      <form action={addSlots} className="rounded-xl border border-sand-200 bg-white p-4">
        <h3 className="mb-3 font-semibold text-lagoon-900">{labels.addSlots}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">{labels.from}
            <input name="from" type="date" required min={today} className="mt-1 w-full rounded-lg border border-sand-300 px-3 py-2" />
          </label>
          <label className="text-sm">{labels.to}
            <input name="to" type="date" required min={today} className="mt-1 w-full rounded-lg border border-sand-300 px-3 py-2" />
          </label>
          <label className="text-sm">{labels.time}
            <input name="time" type="time" required defaultValue="09:00" className="mt-1 w-full rounded-lg border border-sand-300 px-3 py-2" />
          </label>
          <label className="text-sm">{labels.capacity}
            <input name="capacity" type="number" required min={1} max={500} defaultValue={20} className="mt-1 w-full rounded-lg border border-sand-300 px-3 py-2" />
          </label>
          <label className="text-sm">{labels.priceAdult}
            <input name="price_adult" type="number" min={0} step="0.01" placeholder="—" className="mt-1 w-full rounded-lg border border-sand-300 px-3 py-2" />
          </label>
          <label className="text-sm">{labels.priceChild}
            <input name="price_child" type="number" min={0} step="0.01" placeholder="—" className="mt-1 w-full rounded-lg border border-sand-300 px-3 py-2" />
          </label>
        </div>
        <button type="submit" className="mt-4 rounded-lg bg-lagoon-600 px-5 py-2 text-sm font-semibold text-white hover:bg-lagoon-700">
          {labels.save}
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-sand-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-start text-xs uppercase text-lagoon-700">
            <tr>
              <th className="px-3 py-2 text-start">{labels.from}</th>
              <th className="px-3 py-2 text-start">{labels.time}</th>
              <th className="px-3 py-2 text-start">{labels.capacity}</th>
              <th className="px-3 py-2 text-start">{labels.remaining}</th>
              <th className="px-3 py-2 text-start"></th>
            </tr>
          </thead>
          <tbody>
            {(slots ?? []).map((s) => {
              const remaining = (s.capacity ?? 0) - (s.booked_count ?? 0);
              return (
                <tr key={s.id} className="border-t border-sand-100">
                  <td className="px-3 py-2">{s.date}{s.is_blocked ? <span className="ms-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">{labels.blocked}</span> : null}</td>
                  <td className="px-3 py-2">{String(s.start_time).slice(0, 5)}</td>
                  <td className="px-3 py-2">{s.capacity}</td>
                  <td className="px-3 py-2">{remaining}</td>
                  <td className="px-3 py-2 text-end">
                    <div className="flex justify-end gap-2">
                      <form action={toggleBlock}>
                        <input type="hidden" name="slot_id" value={s.id} />
                        <input type="hidden" name="blocked" value={s.is_blocked ? "1" : "0"} />
                        <button className="text-xs font-semibold text-lagoon-700 underline" type="submit">
                          {s.is_blocked ? labels.unblock : labels.block}
                        </button>
                      </form>
                      {remaining === s.capacity && (
                        <form action={removeSlot}>
                          <input type="hidden" name="slot_id" value={s.id} />
                          <button className="text-xs font-semibold text-red-700" type="submit">✕</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {(!slots || slots.length === 0) && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-lagoon-500">—</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
