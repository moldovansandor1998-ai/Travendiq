"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function FavoriteButton({ listingId, initial, label }: {
  listingId: string; initial: boolean; label: string;
}) {
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      window.location.href = window.location.pathname.replace(/\/listing\/.*/, "/auth/login");
      return;
    }
    if (fav) {
      await sb.from("favorites").delete().eq("user_id", user.id).eq("listing_id", listingId);
    } else {
      await sb.from("favorites").upsert({ user_id: user.id, listing_id: listingId });
    }
    setFav(!fav);
    setBusy(false);
  }

  return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={fav}
      className={`btn-secondary ${fav ? "border-coral-400 text-coral-600" : ""}`}>
      {fav ? "♥" : "♡"} {label}
    </button>
  );
}
