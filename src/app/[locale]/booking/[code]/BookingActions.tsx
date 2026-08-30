"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Vásárlói foglalásműveletek: lemondás (automatikus refunddal), átfoglalás. */
export function BookingActions({ bookingId, status, locale, token, freeCancelHours, labels }: {
  bookingId: string;
  status: string;
  locale: string;
  token: string | null;
  freeCancelHours: number | null;
  labels: { cancel: string; reschedule: string; cancelled: string; confirmCancel: string; review: string; freeCancelUntil: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "reschedule">("none");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("09:00");

  const canCancel = ["confirmed", "pending_confirmation"].includes(status);
  const canReschedule = status === "confirmed";
  const canReview = status === "completed";

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/bookings/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token: token ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "error");
      return false;
    }
    router.refresh();
    return true;
  }

  if (!canCancel && !canReschedule && !canReview) return null;

  return (
    <div className="mt-6 space-y-3 border-t border-lagoon-100 pt-6">
      {freeCancelHours !== null && canCancel && (
        <p className="text-xs text-lagoon-500">
          {labels.freeCancelUntil.replace("{hours}", String(freeCancelHours))}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {canCancel && (
          <button type="button" disabled={busy}
            onClick={async () => {
              if (window.confirm(labels.confirmCancel)) {
                await call({ action: "cancel", bookingId, reason: "customer" });
              }
            }}
            className="btn-secondary text-red-700">
            {labels.cancel}
          </button>
        )}
        {canReschedule && (
          <button type="button" disabled={busy} onClick={() => setMode(mode === "reschedule" ? "none" : "reschedule")}
            className="btn-secondary">
            {labels.reschedule}
          </button>
        )}
        {canReview && (
          <a href={`/${locale}/account/reviews/new?booking=${bookingId}${token ? `&token=${token}` : ""}`} className="btn-primary">
            {labels.review}
          </a>
        )}
      </div>

      {mode === "reschedule" && (
        <form className="flex flex-wrap items-end gap-2 rounded-xl bg-lagoon-50 p-4"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const ok = await call({ action: "reschedule", bookingId, newDate, newTime });
            if (ok) setMode("none");
          }}>
          <div>
            <label className="mb-1 block text-xs font-medium text-lagoon-700">Date</label>
            <input type="date" required value={newDate} onChange={(e) => setNewDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)} className="input py-2" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-lagoon-700">Time</label>
            <input type="time" required value={newTime} onChange={(e) => setNewTime(e.target.value)} className="input py-2" />
          </div>
          <button type="submit" disabled={busy} className="btn-primary py-2">OK</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
