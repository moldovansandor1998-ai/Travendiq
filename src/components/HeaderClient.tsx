"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import type { Locale } from "@/lib/i18n";

const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hu", label: "Magyar" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "ro", label: "Română" },
  { code: "pl", label: "Polski" },
  { code: "ar", label: "العربية" },
];

/** Nyelvválasztó legördülő – megtartja az aktuális útvonalat. */
export function LocaleMenu({ locale, label }: { locale: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname() ?? `/${locale}`;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const rest = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "") || "";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className="btn-ghost !gap-1.5 uppercase"
      >
        <Icon name="globe" size={17} />
        <span className="text-[13px] font-bold">{locale}</span>
        <Icon name="chevron-down" size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="card absolute end-0 top-11 z-50 max-h-80 w-44 overflow-y-auto p-1.5 shadow-lifted animate-fadeUp"
        >
          {LOCALES.map((l) => (
            <li key={l.code}>
              <Link
                href={`/${l.code}${rest}`}
                role="option"
                aria-selected={l.code === locale}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition hover:bg-lagoon-50 ${
                  l.code === locale ? "text-lagoon-700" : "text-ink-700"
                }`}
              >
                {l.label}
                {l.code === locale && <Icon name="check" size={15} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mobil fiókmenü – hamburger + lecsúszó panel. */
export function MobileMenu({ locale, labels }: {
  locale: Locale;
  labels: {
    search: string; map: string; provider: string; signIn: string;
    affiliate: string; favorites: string; account: string; menu: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const items = [
    { href: `/${locale}/search`, label: labels.search, icon: "search" },
    { href: `/${locale}/search?view=map`, label: labels.map, icon: "map-pin" },
    { href: `/${locale}/account/favorites`, label: labels.favorites, icon: "heart" },
    { href: `/${locale}/account`, label: labels.account, icon: "ticket" },
    { href: `/${locale}/affiliate`, label: labels.affiliate, icon: "zap" },
    { href: `/${locale}/provider/register`, label: labels.provider, icon: "briefcase" },
  ];

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={labels.menu}
        aria-expanded={open}
        className="btn-ghost !px-2.5"
      >
        <Icon name="menu" size={22} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-0 max-h-[85dvh] overflow-y-auto rounded-b-3xl bg-white p-4 shadow-pop animate-fadeUp">
            <div className="flex items-center justify-between">
              <span className="text-base font-extrabold text-ink-950">Travendiq</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="btn-ghost !px-2.5">
                <Icon name="x" size={20} />
              </button>
            </div>
            <nav className="mt-4 grid gap-1">
              {items.map((i) => (
                <Link key={i.href + i.label} href={i.href} className="side-link">
                  <Icon name={i.icon} size={18} />
                  {i.label}
                </Link>
              ))}
            </nav>
            <Link href={`/${locale}/auth/login`} className="btn-primary mt-4 w-full">
              {labels.signIn}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
