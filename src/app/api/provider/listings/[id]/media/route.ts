import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm"]);

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  const { data: provider } = await auth.from("providers").select("id").eq("owner_id", user.id).maybeSingle();
  if (!provider) return NextResponse.json({ error: "Nincs szolgáltatói hozzáférés." }, { status: 403 });
  const { data: listing } = await auth.from("listings").select("id").eq("id", params.id).eq("provider_id", provider.id).maybeSingle();
  if (!listing) return NextResponse.json({ error: "A program nem található." }, { status: 404 });
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (!files.length) return NextResponse.json({ error: "Válassz legalább egy fájlt." }, { status: 400 });
  if (files.length > 10) return NextResponse.json({ error: "Egyszerre legfeljebb 10 fájl tölthető fel." }, { status: 400 });
  for (const file of files) {
    if (!ACCEPTED.has(file.type)) return NextResponse.json({ error: `Nem támogatott fájl: ${file.name}` }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `Túl nagy fájl: ${file.name} (maximum 10 MB)` }, { status: 400 });
  }
  const svc = createServiceClient();
  const { data: existing } = await svc.from("listing_media").select("sort_order").eq("listing_id", params.id)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  let order = (existing?.sort_order ?? -1) + 1;
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || (file.type.startsWith("video/") ? "mp4" : "jpg");
    const path = `${params.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await svc.storage.from("listing-media").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, cacheControl: "31536000" });
    if (uploadError) return NextResponse.json({ error: `A feltöltés nem sikerült: ${uploadError.message}` }, { status: 500 });
    const { data: publicUrl } = svc.storage.from("listing-media").getPublicUrl(path);
    const { error: rowError } = await svc.from("listing_media").insert({ listing_id: params.id, url: publicUrl.publicUrl, kind: file.type.startsWith("video/") ? "video" : "image", sort_order: order++ });
    if (rowError) {
      await svc.storage.from("listing-media").remove([path]);
      return NextResponse.json({ error: `A kép mentése nem sikerült: ${rowError.message}` }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, uploaded: files.length });
}
