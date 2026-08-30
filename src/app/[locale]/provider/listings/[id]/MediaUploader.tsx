"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Media = { id: string; url: string; kind: string; sort_order: number };

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "video/mp4"];

async function compressImage(file: File): Promise<Blob> {
  if (file.type === "video/mp4" || file.size <= 900 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function MediaUploader({ listingId, media, labels, onChanged }: {
  listingId: string;
  media: Media[];
  labels: { upload: string; delete: string; uploading: string };
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    const sb = createClient();
    setError(null);
    if (!ACCEPTED.includes(file.type)) { setError("Unsupported file type"); return; }
    if (file.size > MAX_BYTES) { setError("File too large (max 10 MB)"); return; }
    setBusy(true);
    try {
      const blob = await compressImage(file);
      const ext = file.type === "video/mp4" ? "mp4" : "jpg";
      const path = `${listingId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage.from("listing-media").upload(path, blob, {
        contentType: file.type === "video/mp4" ? "video/mp4" : "image/jpeg",
        cacheControl: "31536000",
      });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from("listing-media").getPublicUrl(path);
      const nextOrder = media.length ? Math.max(...media.map((m) => m.sort_order)) + 1 : 0;
      const { error: rowErr } = await sb.from("listing_media").insert({
        listing_id: listingId,
        url: pub.publicUrl,
        kind: file.type === "video/mp4" ? "video" : "image",
        sort_order: nextOrder,
      });
      if (rowErr) throw rowErr;
      await onChanged();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(m: Media) {
    const sb = createClient();
    setBusy(true);
    setError(null);
    try {
      const marker = "/listing-media/";
      const idx = m.url.indexOf(marker);
      if (idx >= 0) {
        const path = m.url.slice(idx + marker.length);
        await sb.storage.from("listing-media").remove([path]);
      }
      const { error: delErr } = await sb.from("listing_media").delete().eq("id", m.id);
      if (delErr) throw delErr;
      await onChanged();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function move(m: Media, dir: -1 | 1) {
    const sb = createClient();
    const idx = media.findIndex((x) => x.id === m.id);
    const swap = media[idx + dir];
    if (!swap) return;
    setBusy(true);
    try {
      const { error: e1 } = await sb.from("listing_media").update({ sort_order: swap.sort_order }).eq("id", m.id);
      if (e1) throw e1;
      const { error: e2 } = await sb.from("listing_media").update({ sort_order: m.sort_order }).eq("id", swap.id);
      if (e2) throw e2;
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-xl border border-lagoon-100 bg-lagoon-50 p-4 text-sm text-lagoon-800">
        <p className="font-semibold">Képek és videók</p>
        <p className="mt-1">Legalább 3 jó minőségű kép szükséges. Az első kép lesz a program főképe. JPG, PNG, WebP vagy MP4, legfeljebb 10 MB.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {media.map((m, i) => (
          <div key={m.id} className="overflow-hidden rounded-xl border border-sand-200 bg-white">
            {m.kind === "video" ? (
              <video src={m.url} className="h-36 w-full object-cover" controls />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt="" className="h-36 w-full object-cover" />
            )}
            <div className="flex items-center justify-between px-3 py-2 text-xs">
              <div className="flex gap-1">
                <button type="button" disabled={busy || i === 0} onClick={() => move(m, -1)}
                  className="rounded border border-sand-300 px-2 py-1 disabled:opacity-30">←</button>
                <button type="button" disabled={busy || i === media.length - 1} onClick={() => move(m, 1)}
                  className="rounded border border-sand-300 px-2 py-1 disabled:opacity-30">→</button>
              </div>
              <button type="button" disabled={busy} onClick={() => remove(m)}
                className="font-semibold text-red-700">{labels.delete}</button>
            </div>
          </div>
        ))}
        <label className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-sand-300 text-sm text-lagoon-700 hover:border-lagoon-400 ${busy ? "opacity-50" : ""}`}>
          <span className="text-2xl">＋</span>
          <span>{busy ? labels.uploading : labels.upload}</span>
          <input ref={inputRef} type="file" accept={ACCEPTED.join(",")} className="hidden"
            disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
