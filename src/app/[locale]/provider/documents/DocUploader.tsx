"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function DocUploader({ providerId, kinds, labels }: {
  providerId: string;
  kinds: { value: string; label: string }[];
  labels: { kind: string; expires: string; upload: string; uploading: string };
}) {
  const sb = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState(kinds[0]?.value ?? "id_card");
  const [expires, setExpires] = useState("");

  async function upload(file: File) {
    setError(null);
    if (!ACCEPTED.includes(file.type)) { setError("Unsupported file type"); return; }
    if (file.size > MAX_BYTES) { setError("File too large (max 15 MB)"); return; }
    setBusy(true);
    try {
      const ext = file.type === "application/pdf" ? "pdf" : "jpg";
      const path = `${providerId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage.from("provider-docs").upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { error: rowErr } = await sb.from("provider_documents").insert({
        provider_id: providerId,
        kind,
        file_path: path,
        expires_at: expires || null,
      });
      if (rowErr) throw rowErr;
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <label className="text-sm">{labels.kind}
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input mt-1">
          {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label className="text-sm">{labels.expires}
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="input mt-1" />
      </label>
      <label className={`btn-primary mt-5 flex cursor-pointer items-center justify-center sm:col-span-2 ${busy ? "opacity-50" : ""}`}>
        {busy ? labels.uploading : labels.upload}
        <input type="file" accept={ACCEPTED.join(",")} className="hidden" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      </label>
      {error && <p className="text-sm text-red-700 sm:col-span-4">{error}</p>}
    </div>
  );
}
