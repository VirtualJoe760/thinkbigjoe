"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/logo";

// The one navbar. Every surface — public site, client portal, admin command —
// renders this same shell: a sticky h-16 bar with the logo, and a right-side
// slide-in drawer (portaled to <body> so the header's backdrop-blur can't trap
// its `fixed` positioning). Surfaces differ only in their config: which links,
// what shows on the desktop right, and what sits in the drawer footer.

export type NavLink = {
  href: string;
  label: string;
  icon?: string; // optional SVG path data (command uses icons)
  match?: string[]; // extra path prefixes that also mark this link active
  exact?: boolean; // active only on an exact path (roots like /portal, /command)
};

function linkActive(l: NavLink, path: string): boolean {
  const ms = l.match ?? [l.href];
  return ms.some((m) => (l.exact ? path === m : path === m || path.startsWith(m + "/")));
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const HAMBURGER = (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

type AppHeaderProps = {
  links: NavLink[];
  /** Show links inline in the desktop bar (public/portal). Command sets false → drawer at every width. */
  inlineOnDesktop?: boolean;
  /** Highlight the active link (portal/command). Off for the public site's anchor links. */
  highlightActive?: boolean;
  /** Right side of the desktop bar — phone + Login, or email + Sign out. */
  desktopRight?: React.ReactNode;
  /** Far-left of the bar, before the logo — e.g. command's "‹ Portal" back-link. */
  leading?: React.ReactNode;
  /** Bottom of the slide-in drawer — the same actions styled for a stacked mobile layout. */
  drawerFooter?: React.ReactNode;
};

export function AppHeader({
  links,
  inlineOnDesktop = true,
  highlightActive = false,
  desktopRight,
  leading,
  drawerFooter,
}: AppHeaderProps) {
  const [open, setOpen] = useState(false); // intent
  const [render, setRender] = useState(false); // present in the DOM
  const [shown, setShown] = useState(false); // slid into view (drives the transition)
  const path = usePathname();

  useEffect(() => setOpen(false), [path]); // close on route change

  useEffect(() => {
    if (open) {
      setRender(true);
      document.body.style.overflow = "hidden";
      const t = setTimeout(() => setShown(true), 10); // next frame → slide in
      return () => clearTimeout(t);
    }
    setShown(false);
    document.body.style.overflow = "";
    const t = setTimeout(() => setRender(false), 250); // wait for slide out
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => () => {
    document.body.style.overflow = "";
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const drawerLinkCls = (l: NavLink) =>
    `flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium transition-colors ${
      highlightActive && linkActive(l, path)
        ? "bg-brand-tint text-brand"
        : "text-ink hover:bg-surface"
    }`;

  const desktopLinkCls = (l: NavLink) =>
    highlightActive
      ? `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          linkActive(l, path) ? "bg-brand-tint text-brand" : "text-ink-soft hover:bg-surface hover:text-ink"
        }`
      : "text-sm font-medium text-ink-soft transition-colors hover:text-ink";

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-3 md:gap-6">
          {leading}
          <Logo />
          {inlineOnDesktop && (
            <div className="hidden items-center gap-6 md:flex">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className={desktopLinkCls(l)}>
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {desktopRight && (
            <div className={`items-center gap-4 ${inlineOnDesktop ? "hidden md:flex" : "flex"}`}>
              {desktopRight}
            </div>
          )}
          {/* Hamburger always sits on the right. Public/portal: mobile only (inline links on
              desktop). Command: at every width, since it's drawer-primary. */}
          <button
            onClick={() => setOpen(true)}
            className={`grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface hover:text-ink ${
              inlineOnDesktop ? "md:hidden" : ""
            }`}
            aria-label="Open menu"
            aria-expanded={open}
          >
            {HAMBURGER}
          </button>
        </div>
      </nav>

      {render && createPortal(
        <>
          <div
            className={`fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm transition-opacity duration-200 ${
              shown ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background shadow-2xl transition-transform duration-200 ease-out ${
              shown ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
              <Logo />
              <button
                onClick={() => setOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                aria-label="Close menu"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3">
              <div className="flex flex-col gap-1">
                {links.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={drawerLinkCls(l)}>
                    {l.icon && <NavIcon d={l.icon} />}
                    {l.label}
                  </Link>
                ))}
              </div>
            </nav>

            {drawerFooter && (
              <div className="shrink-0 space-y-3 border-t border-line p-4">{drawerFooter}</div>
            )}
          </div>
        </>,
        document.body,
      )}
    </header>
  );
}
