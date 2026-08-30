"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PayoutActions({ payoutId, hasConnect, showHold, labels }: {
  payoutId: string;
  hasConnect: boolean;
  showHold: boolean;
  labels: {
    releaseStripe: string; releaseManual: string; hold: string;
    reference: string; date: string; note: string; confirm: string; cancel: string;
    error: string;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed");
      router.refresh();
      setManualOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {hasConnect && (
          <button type="button" disabled={busy}
            onClick={() => post({ action: "release", payoutId, method: "stripe" })}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {labels.releaseStripe}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setManualOpen((v) => !v)}
          className="rounded-lg bg-lagoon-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {labels.releaseManual}
        </button>
        {showHold && (
          <button type="button" disabled={busy}
            onClick={() => post({ action: "hold", payoutId })}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {labels.hold}
          </button>
        )}
      </div>
      {manualOpen && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-lg border border-sand-200 bg-sand-50 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void post({
              action: "release_manual", payoutId, method: "manual",
              reference: String(fd.get("reference") ?? ""),
              paidDate: String(fd.get("paidDate") ?? ""),
              note: String(fd.get("note") ?? ""),
            });
          }}
        >
          <input name="reference" required minLength={6} placeholder={labels.reference} className="input w-40 py-1 text-xs" />
          <input name="paidDate" required type="date" className="input w-36 py-1 text-xs" />
          <input name="note" required minLength={3} placeholder={labels.note} className="input w-44 py-1 text-xs" />
          <button disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" type="submit">
            {labels.confirm}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
