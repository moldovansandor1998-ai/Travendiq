"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

export function ConnectButton({ hasAccount, labels }: {
  hasAccount: boolean;
  labels: { create: string; continue: string; error: string };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { locale } = useParams<{ locale: string }>();

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "failed");
      window.location.href = data.url;
    } catch {
      setError(labels.error);
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <button onClick={start} disabled={busy} className="btn-primary disabled:opacity-50" type="button">
        {hasAccount ? labels.continue : labels.create}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
