import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";

/**
 * Jogi oldalak. Csak JÓVÁHAGYOTT (legal_approved) és publikált tartalom
 * jelenhet meg – tervezet/helykitöltő szöveg technikailag nem kerülhet ki
 * az éles felületre (404).
 */
export default async function LegalPage({
  params,
}: { params: { locale: Locale; slug: string } }) {
  const supabase = createClient();
  const { data: page } = await supabase
    .from("pages")
    .select("title, body_md, updated_at")
    .eq("slug", params.slug)
    .eq("locale", params.locale)
    .eq("is_published", true)
    .eq("legal_approved", true)
    .maybeSingle();

  const fallback = page ?? (await supabase.from("pages")
    .select("title, body_md, updated_at")
    .eq("slug", params.slug).eq("locale", "en")
    .eq("is_published", true).eq("legal_approved", true).maybeSingle()).data;

  if (!fallback) notFound();

  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="text-3xl font-bold text-lagoon-950">{fallback.title}</h1>
      <div className="prose-sm mt-6 whitespace-pre-line text-[15px] leading-relaxed text-lagoon-800">
        {fallback.body_md}
      </div>
    </div>
  );
}
