"use client";

import { useEffect } from "react";

export function MetaProviderRegistration({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;

    const report = () => {
      const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
      if (!fbq) return false;
      fbq("track", "Lead", { content_name: "provider_application" });
      const url = new URL(window.location.href);
      url.searchParams.delete("registered");
      window.history.replaceState({}, "", url.toString());
      return true;
    };

    if (report()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (report() || attempts >= 20) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return null;
}
