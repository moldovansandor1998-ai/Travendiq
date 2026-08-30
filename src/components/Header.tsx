import Link from "next/link";
import { Logo } from "./Logo";
import { Icon } from "./Icon";
import { LocaleMenu, MobileMenu } from "./HeaderClient";
import type { Dictionary, Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function Header({ locale, t }: { locale: Locale; t: Dictionary }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  let hasProvider = false;
  if (user) {
    const [{ data: admin }, { data: provider }] = await Promise.all([
      sb.rpc("is_admin"),
      sb.from("providers").select("id").eq("owner_id", user.id).limit(1).maybeSingle(),
    ]);
    isAdmin = admin === true;
    hasProvider = !!provider;
  }

  async function signOut() {
    "use server";
    const auth = createClient();
    await auth.auth.signOut();
    redirect(`/${locale}`);
  }

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
            href={hasProvider ? `/${locale}/provider/dashboard` : `/${locale}/provider/register`}
            className="btn-secondary btn-sm hidden md:inline-flex"
          >
            {hasProvider ? (locale === "hu" ? "Szolgáltatói felület" : "Provider dashboard") : t.nav.becomeProvider}
          </Link>
          {isAdmin && (
            <Link href={`/${locale}/admin`} className="btn-secondary btn-sm hidden sm:inline-flex">
              Admin
            </Link>
          )}
          {user ? (
            <>
              <Link href={`/${locale}/account`} className="btn-secondary btn-sm hidden sm:inline-flex">
                {locale === "hu" ? "Fiókom" : "My account"}
              </Link>
              <form action={signOut} className="hidden sm:block">
                <button type="submit" className="btn-primary btn-sm">{t.nav.signOut}</button>
              </form>
            </>
          ) : (
            <>
              <Link href={`/${locale}/auth/register`} className="btn-secondary btn-sm hidden sm:inline-flex">
                {locale === "hu" ? "Partner regisztráció" : "Partner sign up"}
              </Link>
              <Link href={`/${locale}/auth/login`} className="btn-primary btn-sm hidden sm:inline-flex">
                {t.nav.signIn}
              </Link>
            </>
          )}
          <MobileMenu
            locale={locale}
            authenticated={!!user}
            isAdmin={isAdmin}
            hasProvider={hasProvider}
            labels={{
              search: t.nav.search,
              map: t.search.mapView,
              provider: t.nav.becomeProvider,
              signIn: t.nav.signIn,
              signUp: locale === "hu" ? "Partner regisztráció" : "Partner sign up",
              affiliate: "Affiliate",
              favorites: t.nav.favorites,
              account: t.nav.bookings,
              menu: "Menu",
              signOut: t.nav.signOut,
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
