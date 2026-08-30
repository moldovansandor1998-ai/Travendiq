import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travendiq.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/*/admin", "/*/provider", "/*/checkout", "/*/booking"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
