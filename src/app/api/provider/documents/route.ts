import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const KINDS = new Set(["id_card", "company_reg", "license", "insurance", "bank_statement"]);
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const locale = req.headers.get("referer")?.includes("/en/") ? "en" : "hu";
  const fail = () => NextResponse.redirect(new URL(`/${locale}/provider/documents?error=upload`, req.url), 303);
  if (req.headers.get("sec-fetch-site") === "cross-site") return fail();
  const session = createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/${locale}/auth/login`, req.url), 303);
  const form = await req.formData().catch(() => null);
  if (!form) return fail();
  const providerId = String(form.get("provider_id") ?? "");
  const kind = String(form.get("kind") ?? "");
  const expires = String(form.get("expires") ?? "");
  const file = form.get("document");
  if (!(file instanceof File) || !KINDS.has(kind) || !TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) return fail();

  const svc = createServiceClient();
  const { data: provider } = await svc.from("providers").select("id").eq("id", providerId).eq("owner_id", user.id).maybeSingle();
  if (!provider) return fail();
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const path = `${provider.id}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await svc.storage.from("provider-docs").upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) { console.error("[provider/documents] storage:", uploadError.message); return fail(); }
  const { error: rowError } = await svc.from("provider_documents").insert({ provider_id: provider.id, kind, file_path: path, expires_at: expires || null });
  if (rowError) {
    console.error("[provider/documents] row:", rowError.message);
    await svc.storage.from("provider-docs").remove([path]);
    return fail();
  }
  return NextResponse.redirect(new URL(`/${locale}/provider/documents?uploaded=1`, req.url), 303);
}
