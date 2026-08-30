"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Manuális reversal-rendezés űrlap (resolve_reversal admin művelet).
 * A beküldött összeg CSAK a reversal fennálló összege lehet – a szerver
 * (resolve_reversal_manually, 00024) a túl-/alul-/ismételt rendezést elutasítja.
 */
export function ReversalResolveForm({ reversalId, expectedAmount, currency, labels }: {
  reversalId: string;
  expectedAmount: number; // cent – megjelenítve, előtöltve, módosíthatatlan
  currency: string;
  labels: {
    reference: string; date: string; amount: string; note: string;
    confirm: string; success: string; error: string;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "resolve_reversal",
          reversalId,
          reference: String(fd.get("reference") ?? ""),
          resolvedDate: String(fd.get("resolvedDate") ?? ""),
          amount: expectedAmount, // a szerver úgyis a fennálló összeget kényszeríti
          note: String(fd.get("note") ?? ""),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed");
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.error);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="mt-2 text-xs font-medium text-emerald-700">{labels.success}</p>;
  }

  return (
    <form onSubmit={submit}
      className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-lagoon-200 bg-lagoon-50/60 p-2">
      <input name="reference" required minLength={3} maxLength={120}
        placeholder={labels.reference} className="input w-44 py-1 text-xs" />
      <input name="resolvedDate" required type="date" className="input w-36 py-1 text-xs" />
      {/* az összeg NEM szerkeszthető: mindig a fennálló reversal-összeg */}
      <span className="rounded-lg border border-lagoon-200 bg-white px-2 py-1 text-xs font-semibold text-lagoon-900">
        {labels.amount}: {(expectedAmount / 100).toFixed(2)} {currency}
      </span>
      <input name="note" required minLength={3} maxLength={500}
        placeholder={labels.note} className="input w-52 py-1 text-xs" />
      <button disabled={busy} type="submit"
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {busy ? "…" : labels.confirm}
      </button>
      {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
    </form>
  );
}
