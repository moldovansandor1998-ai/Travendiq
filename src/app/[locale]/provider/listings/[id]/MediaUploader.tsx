"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Media = { id: string; url: string; kind: string; sort_order: number };
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm"];

export function MediaUploader({ listingId, media, labels }: {
  listingId: string; media: Media[];
  labels: { upload: string; delete: string; uploading: string };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(files: File[]) {
    setError(null); setMessage(null);
    if (!files.length) return;
    if (files.some((file) => !ACCEPTED.includes(file.type))) { setError("Nem támogatott fájltípus."); return; }
    if (files.some((file) => file.size > MAX_BYTES)) { setError("Egy fájl legfeljebb 10 MB lehet."); return; }
    setBusy(true);
    try {
      const body = new FormData(); files.forEach((file) => body.append("files", file));
      const response = await fetch(`/api/provider/listings/${listingId}/media`, { method: "POST", body });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "A feltöltés nem sikerült.");
      setMessage(`${files.length} fájl sikeresen feltöltve.`); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "A feltöltés nem sikerült."); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function remove(m: Media) {
    const sb = createClient(); setBusy(true); setError(null); setMessage(null);
    try {
      const marker = "/listing-media/"; const idx = m.url.indexOf(marker);
      if (idx >= 0) await sb.storage.from("listing-media").remove([m.url.slice(idx + marker.length)]);
      const { error: delErr } = await sb.from("listing_media").delete().eq("id", m.id);
      if (delErr) throw delErr; router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "A törlés nem sikerült."); }
    finally { setBusy(false); }
  }

  async function move(m: Media, dir: -1 | 1) {
    const sb = createClient(); const idx = media.findIndex((x) => x.id === m.id); const swap = media[idx + dir];
    if (!swap) return; setBusy(true); setError(null);
    try {
      const { error: e1 } = await sb.from("listing_media").update({ sort_order: swap.sort_order }).eq("id", m.id); if (e1) throw e1;
      const { error: e2 } = await sb.from("listing_media").update({ sort_order: m.sort_order }).eq("id", swap.id); if (e2) throw e2;
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "A sorrend mentése nem sikerült."); }
    finally { setBusy(false); }
  }

  return <div>
    <div className="mb-5 rounded-xl border border-lagoon-200 bg-lagoon-50 p-5 text-sm text-lagoon-900">
      <p className="font-semibold">Képek és videók feltöltése</p>
      <p className="mt-1">Legalább 3 jó minőségű kép szükséges. Több képet egyszerre is kiválaszthatsz; az első lesz a program főképe.</p>
      <p className="mt-1 text-xs text-lagoon-700">JPG, PNG, WebP, AVIF, MP4 vagy WebM · fájlonként maximum 10 MB</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {media.map((m, i) => <div key={m.id} className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        {m.kind === "video" ? <video src={m.url} className="h-44 w-full object-cover" controls /> :
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.url} alt={`Programkép ${i + 1}`} className="h-44 w-full object-cover" />}
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <span className="font-medium">{i === 0 ? "Főkép" : `${i + 1}. kép`}</span>
          <div className="flex gap-1">
            <button type="button" disabled={busy || i === 0} onClick={() => move(m, -1)} className="rounded border px-2 py-1 disabled:opacity-30">←</button>
            <button type="button" disabled={busy || i === media.length - 1} onClick={() => move(m, 1)} className="rounded border px-2 py-1 disabled:opacity-30">→</button>
            <button type="button" disabled={busy} onClick={() => remove(m)} className="rounded px-2 py-1 font-semibold text-red-700">{labels.delete}</button>
          </div>
        </div>
      </div>)}
      <label className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-lagoon-300 bg-white p-6 text-center text-lagoon-800 hover:bg-lagoon-50 ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <span className="text-4xl">＋</span><span className="mt-2 font-semibold">{busy ? labels.uploading : labels.upload}</span>
        <span className="mt-1 text-xs">Kattints ide vagy válassz több fájlt</span>
        <input ref={inputRef} type="file" multiple accept={ACCEPTED.join(",")} className="hidden" disabled={busy}
          onChange={(e) => void upload(Array.from(e.target.files ?? []))} />
      </label>
    </div>
    {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
  </div>;
}
