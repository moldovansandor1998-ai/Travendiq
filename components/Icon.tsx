/**
 * Travendiq ikonrendszer – egységes 24×24 stroke ikonok (lucide-stílus).
 * Egy helyen karbantartható; a `name` a kategória- és UI-ikonkulcs.
 */
const PATHS: Record<string, string> = {
  // kategóriák
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z",
  boat: "M4 16.5 6.2 19h11.6L20 16.5M3 14l9-3 9 3M12 11V4m0 0 5 3-5-3Z",
  diving: "M7 20c2-1.5 8-1.5 10 0M12 3v8m0 0c-3 0-4.5 2-4.5 4.5M12 11c3 0 4.5 2 4.5 4.5M9 6.5h6",
  desert: "M3 18h18M6 18c0-4 2.5-7 6-7s6 3 6 7M17 6l1.5 3M17 6 15.5 9M17 6v5",
  ticket: "M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Zm9 0v2m0 4v2m0-8v1",
  food: "M5 3v7a2 2 0 0 0 2 2v9M5 10V3m4 0v7M5 7h4m8-4c-1.5 1-2.5 3.5-2.5 6s1 4 2.5 4V21M17 3v18",
  culture: "M4 21h16M5 21V10m14 11V10M3 10h18M12 3l9 5H3l9-5Zm-4 7v6m4-6v6m4-6v6",
  adventure: "m4 20 6-12 4 7 2-3 4 8H4Z",
  wellness: "M12 21c-4-3.5-8-6.6-8-10.4C4 7.4 6.2 5 9 5c1.4 0 2.4.7 3 1.6C12.6 5.7 13.6 5 15 5c2.8 0 5 2.4 5 5.6 0 3.8-4 6.9-8 10.4Z",
  nightlife: "M6 3h12l-6 8v7m-4 3h8M9 6h6",
  water: "M4 15c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0 2.5-1.2 3.5-.5M4 19c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0 2.5-1.2 3.5-.5M12 3s4 5 4 8a4 4 0 1 1-8 0c0-3 4-8 4-8Z",
  // UI
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3",
  "map-pin": "M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  star: "m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9L6.5 20l1-6.1L3 9.5l6.3-.9L12 3Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2",
  users: "M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19m18 0v-1.5a4 4 0 0 0-3-3.87M13.5 4.13a4 4 0 0 1 0 7.75M12.5 9.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  calendar: "M8 2v4m8-4v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  shield: "M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Zm-3-10 2.2 2.2L15.5 10",
  headset: "M4 13a8 8 0 1 1 16 0M4 13v4a2 2 0 0 0 2 2h1v-6H6m14 0v4a2 2 0 0 1-2 2h-1v-6h1m-6 8h3",
  "credit-card": "M2 8.5h20M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1 9h4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-right": "m9 6 6 6-6 6",
  heart: "M12 20.5C7.5 17 4 13.8 4 10.1 4 7.6 6 5.5 8.5 5.5c1.5 0 2.8.7 3.5 1.9.7-1.2 2-1.9 3.5-1.9C18 5.5 20 7.6 20 10.1c0 3.7-3.5 6.9-8 10.4Z",
  filter: "M4 5h16l-6.5 7.5V19l-3 2v-8.5L4 5Z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  zap: "M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2Z",
  flame: "M12 22c4 0 7-2.8 7-6.8 0-3-2-5.4-3.6-7.2-.4 1-1.1 1.9-2.4 2.3C13 7.5 13.5 4 10 2c.4 3-1 4.6-2.4 6.1C6.2 9.6 5 11.5 5 14c0 4.4 3 8 7 8Z",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 11 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z",
  award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm-3.5-1.5L7 22l5-3 5 3-1.5-8.5",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm.5 1.5L12 12l7.5-5.5",
  briefcase: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 7h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 5h18",
  camera: "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  "qr-scan": "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3m-1-4h18",
  message: "M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5m5 5H3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 1-.1 1.2l2 1.6-2 3.4-2.4-1a8 8 0 0 1-2 1.2L15 21h-3l-.5-2.6a8 8 0 0 1-2-1.2l-2.4 1-2-3.4 2-1.6A8 8 0 0 1 4 12a8 8 0 0 1 .1-1.2l-2-1.6 2-3.4 2.4 1a8 8 0 0 1 2-1.2L9 3h3l.5 2.6a8 8 0 0 1 2 1.2l2.4-1 2 3.4-2 1.6a8 8 0 0 1 .1 1.2Z",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  wallet: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm18 3h-6a2 2 0 0 0 0 4h6",
  home: "m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2v-9Z",
  accessibility: "M12 4a2 2 0 1 0 0-.01M12 8v5m0 0-3.5 6M12 13l3.5 6M7 9.5c2.5 1 7.5 1 10 0",
  translate: "M4 5h9M8.5 3v2c0 4-2.5 8-5.5 9.5M5.5 8.5c1 3 3.5 6 6.5 7.5M13 21l4.5-10L22 21m-7.7-3h6.4",
};

export function Icon({ name, size = 20, className = "", strokeWidth = 1.8 }: {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const d = PATHS[name] ?? PATHS.compass;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
