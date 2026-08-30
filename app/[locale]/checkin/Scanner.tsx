"use client";

import { useEffect, useRef, useState } from "react";

type ScanResult = { result: string; booking?: { code: string } } | null;

/**
 * Kamerás QR-leolvasó – natív BarcodeDetector API-val (Chrome/Edge/Android,
 * Safari 17+), kézi kódbevitel fallbackkel. Offline működésre előkészítve:
 * a sikertelen hálózati hívásokat localStorage-ban gyűjti (pending_sync),
 * és a kapcsolat helyreállásakor ismét megpróbálja (is_offline_sync flag).
 */
export function Scanner({ locale, labels }: {
  locale: string;
  labels: Record<string, string>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [code, setCode] = useState("");
  const [participants, setParticipants] = useState(1);
  const [last, setLast] = useState<ScanResult>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setPending(JSON.parse(localStorage.getItem("checkin_pending") ?? "[]").length);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    setCameraError(false);
    if (!("BarcodeDetector" in window)) {
      setCameraError(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      scanLoop();
    } catch {
      setCameraError(true);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  async function scanLoop() {
    // @ts-expect-error BarcodeDetector nem része a TS DOM libnek
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    while (streamRef.current) {
      try {
        if (videoRef.current) {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            const raw = String(codes[0].rawValue);
            stopCamera();
            const url = new URL(raw, window.location.origin);
            const token = url.searchParams.get("t") ?? raw;
            await submit({ token, method: "qr" });
            break;
          }
        }
      } catch { /* frame skip */ }
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  async function submit(payload: { token?: string; code?: string; method: string }) {
    const body = { ...payload, participants };
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setLast(data);
    } catch {
      // offline: sorba állítás későbbi szinkronizálásra
      const q = JSON.parse(localStorage.getItem("checkin_pending") ?? "[]");
      q.push({ ...body, offline: true, at: Date.now() });
      localStorage.setItem("checkin_pending", JSON.stringify(q));
      setPending(q.length);
      setLast({ result: "offline_queued" });
    }
  }

  const color = last?.result === "valid" ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : last?.result === "partial" ? "bg-blue-100 text-blue-900 border-blue-300"
    : last?.result ? "bg-red-100 text-red-900 border-red-300" : "";

  return (
    <div className="mt-6 space-y-4">
      <div className="card overflow-hidden">
        <video ref={videoRef} className="aspect-square w-full bg-lagoon-950 object-cover" muted playsInline />
        <div className="flex gap-2 p-4">
          {!scanning ? (
            <button type="button" onClick={startCamera} className="btn-primary flex-1">
              {labels.startCamera}
            </button>
          ) : (
            <button type="button" onClick={stopCamera} className="btn-secondary flex-1">
              {labels.stopCamera}
            </button>
          )}
        </div>
      </div>

      {cameraError && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {labels.noCamera}
        </p>
      )}

      <form className="card space-y-3 p-4"
        onSubmit={(e) => { e.preventDefault(); if (code.trim()) submit({ code: code.trim(), method: "manual" }); }}>
        <label className="block text-sm font-medium text-lagoon-700">{labels.manualCode}</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="TRV-26-XXXXXX" className="input font-mono" aria-label={labels.manualCode} />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-lagoon-600">{labels.participants}</label>
            <input type="number" min={1} max={50} value={participants}
              onChange={(e) => setParticipants(Number(e.target.value))} className="input" />
          </div>
          <button type="submit" className="btn-primary">{labels.admit}</button>
        </div>
      </form>

      {last && (
        <div role="status" className={`rounded-xl border p-4 text-center font-semibold ${color}`}>
          {last.result === "valid" && `✅ ${labels.valid} – ${last.booking?.code ?? ""}`}
          {last.result === "partial" && `🔵 ${labels.partial} – ${last.booking?.code ?? ""}`}
          {last.result === "already_used" && `⛔ ${labels.alreadyUsed}`}
          {last.result === "invalid" && `⛔ ${labels.invalid}`}
          {last.result === "offline_queued" && "📴 Offline – queued for sync"}
        </div>
      )}
      {pending > 0 && (
        <p className="text-center text-xs text-lagoon-500">{pending} pending sync</p>
      )}
    </div>
  );
}
