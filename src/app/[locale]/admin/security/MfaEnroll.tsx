"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function MfaEnroll({ labels }: {
  labels: { enroll: string; scan: string; code: string; verify: string; error: string };
}) {
  const sb = createClient();
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Travendiq Admin" });
      if (e || !data) throw e ?? new Error("enroll failed");
      setFactorId(data.id);
      setQr(data.totp.qr_code);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { data: challenge, error: ce } = await sb.auth.mfa.challenge({ factorId });
      if (ce || !challenge) throw ce ?? new Error("challenge failed");
      const { error: ve } = await sb.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
      if (ve) throw ve;
      await sb.from("profiles").update({ two_factor_enabled: true });
      router.refresh();
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  }

  if (!factorId) {
    return (
      <div>
        <button onClick={enroll} disabled={busy} className="btn-primary disabled:opacity-50" type="button">
          {labels.enroll}
        </button>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-lagoon-700">{labels.scan}</p>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`} alt="TOTP QR" className="mt-3 h-44 w-44 rounded-lg border border-sand-200" />
      )}
      <div className="mt-4 flex items-center gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric" placeholder={labels.code} className="input max-w-[10rem] text-center tracking-widest" />
        <button onClick={verify} disabled={busy || code.length !== 6} className="btn-primary disabled:opacity-50" type="button">
          {labels.verify}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
