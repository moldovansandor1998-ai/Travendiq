import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getDictionary, isLocale, isRtl, locales, type Locale } from "@/lib/i18n";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { notFound } from "next/navigation";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travendiq.com";

export const metadata: Metadata = {
  title: { default: "Travendiq – Book experiences worldwide", template: "%s | Travendiq" },
  description: "Tours, tickets, events and activities worldwide – booked in minutes.",
  metadataBase: new URL(siteUrl),
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "Travendiq",
    type: "website",
    url: "/",
    title: "Travendiq – Book experiences worldwide",
    description: "Tours, tickets, events and activities worldwide – booked in minutes.",
  },
  manifest: "/manifest.webmanifest",
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Travendiq",
  url: siteUrl,
  description: "Marketplace for tours, attractions, tickets, events and travel experiences worldwide.",
  inLanguage: ["en", "hu", "de", "fr", "es", "it", "ro", "pl", "ar"],
};

export default async function LocaleLayout(
  props: {
    children: ReactNode;
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;
  const { children } = props;

  if (!isLocale(params.locale)) notFound();
  const locale = params.locale as Locale;
  const t = getDictionary(locale);
  const dir = isRtl(locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body className="flex min-h-screen flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-lagoon-700 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <Header locale={locale} t={t} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer locale={locale} t={t} />
      </body>
    </html>
  );
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
