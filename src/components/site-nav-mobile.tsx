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

        <div className="border-t border-line p-4">
          <ButtonLink href="/book-appointment" size="lg" fullWidth>
            Book a call
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
