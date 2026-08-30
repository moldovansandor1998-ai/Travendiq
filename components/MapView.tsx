"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { formatMoney } from "@/lib/utils";

/**
 * Térképes keresés – MapLibre GL, KONFIGURÁLHATÓ tile provider.
 *
 * Éles környezetben a NEXT_PUBLIC_MAP_TILE_URL KÖTELEZŐ (szerződött provider,
 * pl. MapTiler/Protomaps/saját szerver). Az OSM nyilvános demo tile szervert
 * (tile.openstreetmap.org) az OSM felhasználási feltételei TILTJÁK éles
 * alkalmazásforgalomra – ezért production buildben NEM használjuk: ilyenkor a
 * térkép helyett hibakezelt fallback jelenik meg.
 */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ??
  (process.env.NODE_ENV === "production"
    ? null // élesben nincs csendes OSM-demo fallback
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors";

export function MapView({ items, locale }: {
  items: { slug: string; title: string; lat?: number | null; lng?: number | null; priceFrom: number; currency: string }[];
  locale: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current || !TILE_URL) return;
    const pts = items.filter((i) => i.lat != null && i.lng != null);
    const center: [number, number] = pts.length
      ? [pts[0].lng!, pts[0].lat!]
      : [33.81, 27.25];

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: {
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
        },
        center,
        zoom: pts.length ? 10 : 3,
      });
    } catch {
      setFailed(true);
      return;
    }
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("error", () => setFailed(true));

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
  }, [items, locale]);

  if (!TILE_URL || failed) {
    // hibakezelt fallback: a lista továbbra is elérhető térkép nélkül
    return (
      <div className="flex h-[560px] w-full items-center justify-center rounded-2xl border border-lagoon-100 bg-sand-50 text-sm text-lagoon-500" role="note">
        {locale === "hu"
          ? "A térkép jelenleg nem érhető el – az eredmények a listában megtekinthetők."
          : "Map is currently unavailable – results are listed below."}
      </div>
    );
  }

  return <div ref={ref} className="h-[560px] w-full rounded-2xl border border-lagoon-100" role="application" aria-label="Map" />;
}
