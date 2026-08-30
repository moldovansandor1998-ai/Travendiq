"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BookingRowActions({ bookingId, status, labels }: {
  bookingId: string; status: string;
  labels: { accept: string; reject: string; complete: string; noShow: string; cancel: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: string) {
    setBusy(true);
    await fetch("/api/provider/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, action }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {status === "pending_confirmation" && (
        <>
          <button type="button" disabled={busy} onClick={() => act("accept")}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
            {labels.accept}
          </button>
          <button type="button" disabled={busy} onClick={() => act("reject")}
            className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800">
            {labels.reject}
          </button>
        </>
      )}
      {status === "confirmed" && (
        <>
          <button type="button" disabled={busy} onClick={() => act("complete")}
            className="rounded-lg bg-lagoon-700 px-3 py-1.5 text-xs font-semibold text-white">
            {labels.complete}
          </button>
          <button type="button" disabled={busy} onClick={() => act("no_show")}
            className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
            {labels.noShow}
          </button>
          <button type="button" disabled={busy} onClick={() => act("cancel")}
            className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800">
            {labels.cancel}
          </button>
        </>
      )}
    </div>
  );
}
