"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

interface Props {
  locale: string;
  labels: {
    title: string; subtitle: string; sent: string;
    sendLink: string; rateLimited: string; sendFailed: string;
  };
}

/**
 * A magic-link küldés a SZERVEROLDALI /api/auth/login végpontra megy
 * (megosztott rate limit), a next paraméter a claim-végpontra mutat.
 */
export function ClaimForm({ locale, labels }: Props) {
  const sp = useSearchParams();
  const [email, setEmail] = useState(sp.get("email") ?? "");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email, locale,
        next: `/api/account/claim?locale=${locale}`,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSent(true);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error === "rate_limited" ? labels.rateLimited : labels.sendFailed);
  }

  return (
    <div className="container-page max-w-md py-16">
      <h1 className="text-2xl font-bold text-lagoon-950">{labels.title}</h1>
      <p className="mt-2 text-sm text-lagoon-600">{labels.subtitle}</p>
      {sent ? (
        <div className="card mt-6 p-6 text-sm text-lagoon-800">{labels.sent}</div>
      ) : (
        <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="input" placeholder="email@example.com" aria-label="Email" />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {labels.sendLink}
          </button>
        </form>
      )}
    </div>
  );
}
