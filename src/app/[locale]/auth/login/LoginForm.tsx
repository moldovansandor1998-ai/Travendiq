"use client";

import { useState } from "react";

interface Props {
  locale: string;
  labels: {
    title: string; email: string; submit: string;
    sent: string; rateLimited: string; sendFailed: string;
  };
}

/**
 * Bejelentkezés magic-linkkel. A küldés a SZERVEROLDALI /api/auth/login
 * végpontra megy (megosztott rate limit), nem közvetlenül a böngészőből.
 */
export function LoginForm({ locale, labels }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, locale }),
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
      {sent ? (
        <div className="card mt-6 p-6 text-sm text-lagoon-800">{labels.sent}</div>
      ) : (
        <form onSubmit={signIn} className="card mt-6 space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor="email">{labels.email}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {labels.submit}
          </button>
        </form>
      )}
    </div>
  );
}
