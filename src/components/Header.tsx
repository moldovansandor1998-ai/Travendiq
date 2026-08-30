import Link from "next/link";
import { Logo } from "./Logo";
import { Icon } from "./Icon";
import { LocaleMenu, MobileMenu } from "./HeaderClient";
import type { Dictionary, Locale } from "@/lib/i18n";

export function Header({ locale, t }: { locale: Locale; t: Dictionary }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-100/80 bg-white/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-3">
        <Link href={`/${locale}`} aria-label="Travendiq" className="shrink-0">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 text-sm font-semibold text-ink-700 lg:flex">
          <Link href={`/${locale}/search`} className="rounded-xl px-3.5 py-2 transition hover:bg-ink-50 hover:text-ink-950">
            {t.nav.search}
          </Link>
          <Link href={`/${locale}/search?view=map`} className="rounded-xl px-3.5 py-2 transition hover:bg-ink-50 hover:text-ink-950">
            {t.search.mapView}
          </Link>
          <Link href={`/${locale}/affiliate`} className="rounded-xl px-3.5 py-2 transition hover:bg-ink-50 hover:text-ink-950">
            Affiliate
          </Link>
        </nav>

        <div className="flex items-center gap-1.5">
          <LocaleMenu locale={locale} label={t.common.language} />
          <Link
            href={`/${locale}/provider/register`}
            className="btn-secondary btn-sm hidden md:inline-flex"
          >
            {t.nav.becomeProvider}
          </Link>
          <Link
            href={`/${locale}/auth/login`}
            className="btn-primary btn-sm hidden sm:inline-flex"
          >
            {t.nav.signIn}
          </Link>
          <MobileMenu
            locale={locale}
            labels={{
              search: t.nav.search,
              map: t.search.mapView,
              provider: t.nav.becomeProvider,
              signIn: t.nav.signIn,
              affiliate: "Affiliate",
              favorites: t.nav.favorites,
              account: t.nav.bookings,
              menu: "Menu",
            }}
          />
        </div>
      </div>
    </header>
  );
}

/** Kis jelzőikon a fejléc navigációhoz (fenti linkekben nem használt, export a jövőbeli bővítéshez). */
export function HeaderIcon({ name }: { name: string }) {
  return <Icon name={name} size={16} />;
}
