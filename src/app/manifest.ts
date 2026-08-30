import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Travendiq",
    short_name: "Travendiq",
    description: "Book experiences, tours and tickets worldwide",
    start_url: "/en",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#2a7685",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
