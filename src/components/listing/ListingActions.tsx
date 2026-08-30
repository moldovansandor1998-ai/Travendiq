"use client";

import { FavoriteButton } from "@/components/FavoriteButton";

export function ListingActions({ listingId, favoriteLabel, shareLabel }: {
  listingId: string;
  favoriteLabel: string;
  shareLabel: string;
}) {
  async function share() {
    if (navigator.share) {
      await navigator.share({ title: document.title, url: window.location.href });
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
  }

  return (
    <div className="flex items-center gap-2">
      <FavoriteButton listingId={listingId} initial={false} label={favoriteLabel} />
      <button type="button" onClick={share} className="btn-secondary" aria-label={shareLabel}>
        ↗ <span className="hidden sm:inline">{shareLabel}</span>
      </button>
    </div>
  );
}
