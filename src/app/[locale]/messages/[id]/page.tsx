import { notFound, redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { messageSchema } from "@/lib/validation";
import { maskContactInfo, containsContactInfo } from "@/lib/masking";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: { params: { locale: Locale; id: string } }) {
  const { locale, id } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: conv } = await sb.from("conversations")
    .select("id, customer_id, provider_id, provider:providers(display_name)")
    .eq("id", id).maybeSingle();
  if (!conv) notFound();

  const { data: msgs } = await sb.from("messages")
    .select("id, sender_id, body, created_at, is_masked")
    .eq("conversation_id", id)
    .order("created_at")
    .limit(200);

  async function send(formData: FormData) {
    "use server";
    const sb = createClient();
    const { data: { user: u } } = await sb.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const parsed = messageSchema.safeParse({
      conversationId: id, body: formData.get("body"),
    });
    if (!parsed.success) return;
    const masked = maskContactInfo(parsed.data.body);
    await sb.from("messages").insert({
      conversation_id: id, sender_id: u.id,
      body: masked, is_masked: containsContactInfo(parsed.data.body),
    });
    redirect(`/${locale}/messages/${id}`);
  }

  const provider = conv.provider as unknown as { display_name: string } | null;

  return (
    <div className="container-page max-w-2xl py-10">
      <h1 className="text-xl font-bold text-lagoon-950">{provider?.display_name ?? "Provider"}</h1>
      <p className="mt-1 text-xs text-lagoon-500">
        {t.messages.maskingNotice}
      </p>

      <div className="card mt-4 space-y-3 p-4">
        {(msgs ?? []).map((m) => (
          <div key={m.id}
            className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
              m.sender_id === user.id
                ? "ml-auto bg-lagoon-700 text-white"
                : "bg-lagoon-100 text-lagoon-900"
            }`}>
            {m.body}
          </div>
        ))}
        {(msgs ?? []).length === 0 && <p className="text-sm text-lagoon-500">–</p>}
      </div>

      <form action={send} className="mt-4 flex gap-2">
        <input name="body" required maxLength={2000} className="input"
          placeholder={t.messages.placeholder} aria-label="Message" />
        <button className="btn-primary" type="submit">➤</button>
      </form>
    </div>
  );
}
