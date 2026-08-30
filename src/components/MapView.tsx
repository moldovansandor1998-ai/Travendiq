"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { formatMoney } from "@/lib/utils";

/**
 * Térképes keresés – MapLibre GL, konfigurálható tile providerrel.
 * Saját raster URL hiányában az OpenFreeMap nyilvános MapLibre-stílusát használja.
 */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? null;
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors";

export function MapView({ items, locale }: {
  items: { slug: string; title: string; lat?: number | null; lng?: number | null; priceFrom: number; currency: string }[];
  locale: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const pts = useMemo(() => items.filter((i) => i.lat != null && i.lng != null), [items]);

  const fallbackBounds = pts.length
    ? (() => {
        const lngs = pts.map((p) => p.lng!);
        const lats = pts.map((p) => p.lat!);
        const padding = 0.08;
        return [
          Math.min(...lngs) - padding,
          Math.min(...lats) - padding,
          Math.max(...lngs) + padding,
          Math.max(...lats) + padding,
        ];
      })()
    : [-12, 32, 42, 64];
  const fallbackMapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${fallbackBounds.join("%2C")}&layer=mapnik`;

  useEffect(() => {
    if (!ref.current) return;
    const center: [number, number] = pts.length
      ? [pts[0].lng!, pts[0].lat!]
      : [33.81, 27.25];

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: TILE_URL ? {
          version: 8,
          sources: {
            base: {
              type: "raster",
              tiles: [TILE_URL],
              tileSize: 256,
              attribution: ATTRIBUTION,
            },
          },
          layers: [{ id: "base", type: "raster", source: "base" }],
        } : STYLE_URL,
        center,
        zoom: pts.length ? 10 : 3,
      });
    } catch {
      setFailed(true);
      return;
    }
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // Egy hiányzó sprite/glyph vagy átmeneti tile-hiba nem teszi használhatatlanná
    // az egész térképet. A MapLibre ezeket is `error` eseményként jelzi, ezért
    // nem cseréljük le automatikusan a már létrejött térképet a fallbackre.

    for (const p of pts) {
      const el = document.createElement("div");
      el.style.cssText =
        "background:#2a7685;color:#fff;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer";
      el.textContent = formatMoney(p.priceFrom, p.currency, locale);
      new maplibregl.Marker({ element: el })
        .setLngLat([p.lng!, p.lat!])
        .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(
          `<a href="/${locale}/listing/${p.slug}" style="font-weight:600;color:#132c34">${p.title.replace(/</g, "&lt;")}</a>`
        ))
        .addTo(map);
    }
    return () => map.remove();
  }, [pts, locale]);

  if (failed) {
    return (
      <iframe
        className="h-[560px] w-full rounded-2xl border border-lagoon-100"
        src={fallbackMapUrl}
        title={locale === "hu" ? "Keresési térkép" : "Search map"}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  return <div ref={ref} className="h-[560px] w-full rounded-2xl border border-lagoon-100" role="application" aria-label="Map" />;
}
