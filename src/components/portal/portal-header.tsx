"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/portal/sign-out-button";

const LINKS = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/book", label: "Book a call" },
  { href: "/portal/account", label: "Account" },
];

export function PortalHeader({ email, isAdmin }: { email: string; isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => { setOpen(false); }, [path]); // close on navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const links = isAdmin ? [...LINKS, { href: "/command", label: "Command" }] : LINKS;
  const isOn = (href: string) => (href === "/portal" ? path === "/portal" : path.startsWith(href));

  const linkCls = (href: string, big?: boolean) =>
    `rounded-lg px-3 ${big ? "py-2.5" : "py-2"} text-sm font-medium transition-colors ${
      isOn(href) ? "bg-brand-tint text-brand" : "text-ink-soft hover:bg-surface hover:text-ink"
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={linkCls(l.href)}>{l.label}</Link>
            ))}
          </nav>
        </div>

        {/* Desktop: email + sign out */}
        <div className="hidden items-center gap-4 md:flex">
          <span className="hidden text-sm text-ink-soft lg:block">{email}</span>
          <SignOutButton />
        </div>

        {/* Mobile: hamburger */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="grid h-10 w-10 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface hover:text-ink md:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {open && (
        <div className="border-t border-line bg-background md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={linkCls(l.href, true)}>{l.label}</Link>
            ))}
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line px-3 pt-3">
              <span className="truncate text-xs text-ink-soft">{email}</span>
              <SignOutButton />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
