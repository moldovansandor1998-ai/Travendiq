"use client";

import Link from "next/link";
import { useState } from "react";

export function RegisterForm({ locale, labels }: {
  locale: string;
  labels: Record<"title" | "name" | "email" | "password" | "submit" | "sent" | "error" | "rateLimited" | "signIn", string>;
}) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"), email: form.get("email"),
        password: form.get("password"), locale,
      }),
    });
    setBusy(false);
    if (response.ok) return setSent(true);
    const data = await response.json().catch(() => ({}));
    setError(data.error === "rate_limited" ? labels.rateLimited : labels.error);
  }

  return (
    <div className="container-page max-w-md py-16">
      <h1 className="text-3xl font-bold text-lagoon-950">{labels.title}</h1>
      {sent ? (
        <div className="card mt-6 p-6 text-sm leading-6 text-lagoon-800">{labels.sent}</div>
      ) : (
        <form onSubmit={register} className="card mt-6 space-y-4 p-6">
          <label className="block text-sm font-medium text-lagoon-700">{labels.name}<input name="name" minLength={2} maxLength={120} required className="input mt-1" autoComplete="name" /></label>
          <label className="block text-sm font-medium text-lagoon-700">{labels.email}<input name="email" type="email" required className="input mt-1" autoComplete="email" /></label>
          <label className="block text-sm font-medium text-lagoon-700">{labels.password}<input name="password" type="password" minLength={8} maxLength={72} required className="input mt-1" autoComplete="new-password" /></label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? "…" : labels.submit}</button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-lagoon-700"><Link href={`/${locale}/auth/login`} className="font-semibold underline">{labels.signIn}</Link></p>
    </div>
  );
}
