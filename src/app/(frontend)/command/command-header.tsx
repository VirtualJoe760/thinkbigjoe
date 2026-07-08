"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

// Consolidated to 6 workflow groups. `match` lists every path that should
// highlight this item (Prospecting folds in the analyzer; Venus groups
// crons/audit/team; Settings groups automation/analytics).
const LINKS: Array<{ href: string; label: string; icon: string; match?: string[] }> = [
  { href: "/command", label: "Overview", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  {
    href: "/command/engine",
    label: "Engine",
    icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4",
  },
  {
    href: "/command/prospects",
    label: "Prospecting",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 20a8 8 0 0116 0",
    match: ["/command/prospects", "/command/analyzer", "/command/sites"],
  },
  { href: "/command/outreach", label: "Outreach", icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
  { href: "/command/leads", label: "Leads", icon: "M4 4h16v4H4zM4 12h16v8H4z" },
  { href: "/command/appointments", label: "Appointments", icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" },
  {
    href: "/command/crons",
    label: "Venus",
    icon: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z",
    match: ["/command/crons", "/command/jobs", "/command/team"],
  },
  {
    href: "/command/settings",
    label: "Settings",
    icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.9 7.9 0 000-2l2-1.6-2-3.4-2.4 1a7.9 7.9 0 00-1.7-1l-.4-2.6H10l-.4 2.6a7.9 7.9 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7.9 7.9 0 000 2l-2 1.6 2 3.4 2.4-1a7.9 7.9 0 001.7 1l.4 2.6h4l.4-2.6a7.9 7.9 0 001.7-1l2.4 1 2-3.4z",
    match: ["/command/settings", "/command/automation", "/command/analytics"],
  },
];

const isActive = (l: { href: string; match?: string[] }, path: string) =>
  (l.match || [l.href]).some((m) => (m === "/command" ? path === "/command" : path.startsWith(m)));

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function CommandHeader({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  // Close on navigation
  useEffect(() => { setOpen(false); }, [path]);
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const current = LINKS.find((l) => isActive(l, path));

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-background px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface hover:text-ink"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Logo />
        </div>
        {current && (
          <span className="text-sm font-medium text-ink-soft">{current.label}</span>
        )}
        <div className="w-9" />
      </header>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-background shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <Logo />
          <button
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface hover:text-ink"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => {
              const active = isActive(l, path);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? "bg-brand-tint text-brand" : "text-ink-soft hover:bg-surface hover:text-ink"
                  }`}
                >
                  <Icon d={l.icon} />
                  {l.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-line p-4">
          <p className="truncate text-xs text-ink-soft">{email}</p>
          <div className="mt-2 flex items-center gap-4 text-xs">
            <a href="/portal" className="text-ink-soft hover:text-ink">Portal</a>
            <a href="/" className="text-ink-soft hover:text-ink">Site</a>
          </div>
        </div>
      </div>
    </>
  );
}
