"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** DEV fizetés-szimuláció gomb – csak nem-production környezetben rendereljük. */
export function DevSimulateButton({ bookingId, token, returnPath, label }: {
  bookingId: string; token?: string; returnPath: string; label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${bookingId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dev-simulate": "1" },
      body: JSON.stringify({ token: token ?? null }),
    });
    if (res.ok) {
      router.push(returnPath);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button onClick={pay} disabled={busy} className="btn-primary w-full" type="button">
        {label}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
