import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { isLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AdminLayout(
  props: {
    children: ReactNode;
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  if (!isLocale(params.locale)) notFound();
  const locale = params.locale;
  await requireAdmin(locale);
  const hu = locale === "hu";
  const links = [
    [`/${locale}/admin`, hu ? "Áttekintés" : "Overview"],
    [`/${locale}/admin/providers`, hu ? "Szolgáltatók" : "Providers"],
    [`/${locale}/admin/listings`, hu ? "Programok" : "Listings"],
    [`/${locale}/admin/bookings`, hu ? "Foglalások" : "Bookings"],
    [`/${locale}/admin/kyc`, "KYC"],
    [`/${locale}/admin/users`, hu ? "Felhasználók" : "Users"],
    [`/${locale}/admin/payouts`, hu ? "Kifizetések" : "Payouts"],
    [`/${locale}/admin/coupons`, hu ? "Kuponok" : "Coupons"],
    [`/${locale}/admin/newsletter`, hu ? "Hírlevél" : "Newsletter"],
    [`/${locale}/admin/cms`, "CMS"],
    [`/${locale}/admin/logs`, hu ? "Naplók" : "Logs"],
  ];

  return (
    <>
      <nav className="border-b border-ink-100 bg-ink-950 text-white" aria-label="Admin">
        <div className="container-page flex gap-2 overflow-x-auto py-3 text-sm">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 font-semibold hover:bg-white/15">
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </>
  );
}
