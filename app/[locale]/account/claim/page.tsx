import { Suspense } from "react";
import { getDictionary, type Locale } from "@/lib/i18n";
import { ClaimForm } from "./ClaimForm";

/**
 * Vendégvásárlás utáni fióklétrehozás: a vendég emailjére magic linket küldünk,
 * a fiók létrejötte után a user az email alapján átveheti a vendégfoglalásait
 * (a /api/account/claim végpontra mutató linkkel).
 */
export default function ClaimPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  return (
    <Suspense fallback={<div className="container-page max-w-md py-16" />}>
      <ClaimForm
        locale={locale}
        labels={{
          title: t.claim.title,
          subtitle: t.claim.subtitle,
          sent: t.claim.sent,
          sendLink: t.claim.sendLink,
          rateLimited: t.auth.rateLimited,
          sendFailed: t.auth.sendFailed,
        }}
      />
    </Suspense>
  );
}
