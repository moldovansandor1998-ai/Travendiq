"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  locale: string;
  next?: string;
  labels: {
    title: string; email: string; password: string; submit: string;
    rateLimited: string; invalidCredentials: string;
  };
}

export function LoginForm({ locale, next, labels }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, locale, next: next ?? `/${locale}/account` }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      router.replace(data.next ?? `/${locale}/account`);
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error === "rate_limited" ? labels.rateLimited : labels.invalidCredentials);
  }

  return (
    <div className="container-page max-w-md py-16">
      <h1 className="text-2xl font-bold text-lagoon-950">{labels.title}</h1>
      <form onSubmit={signIn} className="card mt-6 space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor="email">{labels.email}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor="password">{labels.password}</label>
            <input id="password" type="password" required minLength={8} maxLength={72} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {labels.submit}
          </button>
      </form>
    </div>
  );
}
