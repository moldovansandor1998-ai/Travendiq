"use client";

import Link from "next/link";
import { useState } from "react";

type Labels = Record<"title" | "name" | "email" | "password" | "submit" | "sent" | "error" | "rateLimited" | "signIn" | "weakPassword" | "compromisedPassword" | "accountExists" | "passwordHelp", string>;

export function RegisterForm({ locale, labels }: { locale: string; labels: Labels }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password"), locale }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok === true) { setSent(true); return; }
      if (data.error === "rate_limited") setError(labels.rateLimited);
      else if (data.error === "compromised_password") setError(labels.compromisedPassword);
      else if (data.error === "weak_password") setError(labels.weakPassword);
      else if (data.error === "account_exists") setError(labels.accountExists);
      else setError(labels.error);
    } catch { setError(labels.error); }
    finally { setBusy(false); }
  }

  return (
    <div className="container-page max-w-md py-16">
      <h1 className="text-3xl font-bold text-lagoon-950">{labels.title}</h1>
      {sent ? <div className="card mt-6 p-6 text-sm leading-6 text-lagoon-800">{labels.sent}</div> : (
        <form onSubmit={register} className="card mt-6 space-y-4 p-6">
          <label className="block text-sm font-medium text-lagoon-700">{labels.name}<input name="name" minLength={2} maxLength={120} required className="input mt-1" autoComplete="name" /></label>
          <label className="block text-sm font-medium text-lagoon-700">{labels.email}<input name="email" type="email" required className="input mt-1" autoComplete="email" /></label>
          <label className="block text-sm font-medium text-lagoon-700">{labels.password}<input name="password" type="password" minLength={8} maxLength={72} required className="input mt-1" autoComplete="new-password" /><span className="mt-1 block text-xs font-normal text-lagoon-600">{labels.passwordHelp}</span></label>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? "…" : labels.submit}</button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-lagoon-700"><Link href={`/${locale}/auth/login`} className="font-semibold underline">{labels.signIn}</Link></p>
    </div>
  );
}
