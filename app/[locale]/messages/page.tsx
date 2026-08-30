import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);

  const { data: convs } = await sb.from("conversations")
    .select(`id, created_at, booking:bookings(code),
      provider:providers(display_name),
      messages(body, created_at)`)
    .or(`customer_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="container-page max-w-2xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">
        {t.messages.title}
      </h1>
      <div className="card mt-6 divide-y divide-lagoon-100">
        {(convs ?? []).map((c) => {
          const provider = c.provider as unknown as { display_name: string } | null;
          const booking = c.booking as unknown as { code: string } | null;
          const msgs = (c.messages ?? []) as { body: string; created_at: string }[];
          const last = msgs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          return (
            <Link key={c.id} href={`/${locale}/messages/${c.id}`}
              className="block p-4 transition hover:bg-lagoon-50">
              <p className="font-semibold text-lagoon-900">
                {provider?.display_name ?? "Provider"}
                {booking && <span className="ml-2 font-mono text-xs text-lagoon-500">{booking.code}</span>}
              </p>
              {last && <p className="mt-1 line-clamp-1 text-sm text-lagoon-600">{last.body}</p>}
            </Link>
          );
        })}
        {(convs ?? []).length === 0 && (
          <p className="p-6 text-sm text-lagoon-500">
            {t.messages.empty}
          </p>
        )}
      </div>
    </div>
  );
}
