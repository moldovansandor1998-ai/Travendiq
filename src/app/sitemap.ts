import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travendiq.com";
  const urls: MetadataRoute.Sitemap = [
    { url: `${base}/en`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/hu`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/en/search`, changeFrequency: "hourly", priority: 0.8 },
  ];

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: listings } = await sb.from("listings").select("slug, updated_at")
      .eq("status", "published").eq("is_test", false).limit(1000);
    for (const l of listings ?? []) {
      urls.push({
        url: `${base}/en/listing/${l.slug}`,
        lastModified: l.updated_at,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
    const { data: cities } = await sb.from("cities").select("slug").eq("is_active", true);
    for (const c of cities ?? []) {
      urls.push({ url: `${base}/en/search?city=${c.slug}`, changeFrequency: "daily", priority: 0.6 });
    }
  } catch {
    // sitemap generálás build közben DB nélkül is lefusson
  }
  return urls;
}
