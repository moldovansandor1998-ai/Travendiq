import Link from "next/link";
import { Logo } from "./Logo";
import type { Dictionary, Locale } from "@/lib/i18n";

export function Footer({ locale, t }: { locale: Locale; t: Dictionary }) {
  const legal = [
    ["terms", t.footer.terms], ["privacy", t.footer.privacy], ["cookies", t.footer.cookies],
    ["provider-terms", t.footer.providerTerms], ["refund-policy", t.footer.refundPolicy],
    ["prohibited", t.footer.prohibited], ["complaints", t.footer.complaints], ["imprint", t.footer.imprint],
  ] as const;
  return (
    <footer className="mt-20 border-t border-lagoon-100 bg-white">
      <div className="container-page grid gap-10 py-12 md:grid-cols-3">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-lagoon-600">{t.footer.disclaimer}</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-lagoon-900">{t.footer.legal}</h3>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-lagoon-600">
            {legal.map(([slug, label]) => (
              <li key={slug}>
                <Link href={`/${locale}/legal/${slug}`} className="hover:text-lagoon-500">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-lagoon-900">{t.footer.newsletter}</h3>
          <form action="/api/newsletter" method="post" className="mt-3 flex gap-2">
            <input type="email" name="email" required placeholder="email@example.com" className="input" aria-label="Email" />
            <input type="hidden" name="locale" value={locale} />
            <button className="btn-secondary" type="submit">{t.footer.subscribe}</button>
          </form>
        </div>
      </div>
      <div className="border-t border-lagoon-100 py-4 text-center text-xs text-lagoon-500">
        © {new Date().getFullYear()} Travendiq · travendiq.com
      </div>
    </footer>
  );
}
