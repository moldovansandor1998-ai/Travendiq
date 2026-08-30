import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ProviderLayout({ children, params }: {
  children: ReactNode;
  params: { locale: Locale };
}) {
  const { locale } = params;
  const t = getDictionary(locale);
  const pd = t.providerDash as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: provider } = user
    ? await sb.from("providers").select("id").eq("owner_id", user.id).limit(1).maybeSingle()
    : { data: null };

  const links = [
    [`/${locale}/provider/dashboard`, locale === "hu" ? "Áttekintés" : "Overview"],
    [`/${locale}/provider/bookings`, pd.navBookings],
    [`/${locale}/provider/coupons`, pd.navCoupons],
    [`/${locale}/provider/finance`, pd.navFinance],
    [`/${locale}/provider/team`, pd.navTeam],
    [`/${locale}/provider/documents`, pd.navDocuments],
    [`/${locale}/provider/settings`, pd.navSettings],
    [`/${locale}/checkin`, pd.navCheckin],
  ];

  return (
    <>
      {provider && (
        <nav className="border-b border-lagoon-100 bg-lagoon-50/70" aria-label="Provider">
          <div className="container-page flex gap-2 overflow-x-auto py-3 text-sm">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className="shrink-0 rounded-lg border border-lagoon-200 bg-white px-3 py-2 font-semibold text-lagoon-800 hover:border-lagoon-400 hover:bg-lagoon-50">
                {label}
              </Link>
            ))}
          </div>
        </nav>
      )}
      {children}
    </>
  );
}
