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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const locationMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
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
  const shownBounds = userLocation
    ? [userLocation[0] - 0.08, userLocation[1] - 0.05, userLocation[0] + 0.08, userLocation[1] + 0.05]
    : fallbackBounds;
  const fallbackMapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${shownBounds.join("%2C")}&layer=mapnik${
    userLocation ? `&marker=${userLocation[1]}%2C${userLocation[0]}` : ""
  }`;

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
      mapRef.current = map;
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
    return () => {
      mapRef.current = null;
      locationMarkerRef.current = null;
      map.remove();
    };
  }, [pts, locale]);

  function locateUser() {
    setLocationError(false);
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position: [number, number] = [coords.longitude, coords.latitude];
        setUserLocation(position);
        const map = mapRef.current;
        if (map) {
          locationMarkerRef.current?.remove();
          locationMarkerRef.current = new maplibregl.Marker({ color: "#f97316" })
            .setLngLat(position)
            .addTo(map);
          map.flyTo({ center: position, zoom: 13 });
        }
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocationError(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  const locationButton = (
    <div className="absolute bottom-4 left-4 z-10">
      <button type="button" onClick={locateUser} disabled={locating}
        className="rounded-xl border border-lagoon-200 bg-white px-4 py-2 text-sm font-semibold text-lagoon-900 shadow-md hover:bg-sand-50 disabled:opacity-60">
        {locating ? (locale === "hu" ? "Helyzet keresése…" : "Locating…") : (locale === "hu" ? "Saját helyzet" : "My location")}
      </button>
      {locationError && <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-red-700 shadow">
        {locale === "hu" ? "A helyzet nem érhető el. Engedélyezd a helymeghatározást." : "Location is unavailable. Allow location access."}
      </p>}
    </div>
  );

  if (failed) {
    return (
      <div className="relative">
        <iframe className="h-[560px] w-full rounded-2xl border border-lagoon-100"
          src={fallbackMapUrl} title={locale === "hu" ? "Keresési térkép" : "Search map"}
          loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
        {locationButton}
      </div>
    );
  }

  return <div className="relative">
    <div ref={ref} className="h-[560px] w-full rounded-2xl border border-lagoon-100" role="application" aria-label="Map" />
    {locationButton}
  </div>;
}
