"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";

type NavLink = { href: string; label: string };

// Mobile slide-in nav for the public site. Below md the desktop links are
// hidden; this hamburger + drawer restores them so phones aren't a dead-end.
export function SiteNavMobile({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface hover:text-ink"
        aria-label="Open menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}

      <div
        role="dialog"
        aria-modal="true"
        className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
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
          <div className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-xl px-3 py-3 text-base font-medium text-ink transition-colors hover:bg-surface"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/login"
              className="rounded-xl px-3 py-3 text-base font-medium text-ink-soft transition-colors hover:bg-surface"
            >
              Login
            </Link>
          </div>
        </nav>

        <div className="space-y-3 border-t border-line p-4">
          <a
            href="tel:+14807642121"
            className="flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-3 text-base font-semibold text-ink transition-colors hover:bg-surface"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.4-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z" />
            </svg>
            (480) 764-2121
          </a>
          <ButtonLink href="/book-appointment" size="lg" fullWidth>
            Book a call
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
