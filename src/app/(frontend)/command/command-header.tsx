"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

const LINKS = [
  { href: "/command", label: "Overview", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/command/prospects", label: "Prospecting", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 20a8 8 0 0116 0" },
  { href: "/command/analyzer", label: "Site analyzer", icon: "M11 4a7 7 0 105.29 12.29l4.2 4.2 1.42-1.42-4.2-4.2A7 7 0 0011 4z" },
  { href: "/command/leads", label: "Leads", icon: "M4 4h16v4H4zM4 12h16v8H4z" },
  { href: "/command/automation", label: "Automation", icon: "M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3M12 9a3 3 0 100 6 3 3 0 000-6z" },
  { href: "/command/crons", label: "Venus crons", icon: "M12 8v4l3 3M12 2a10 10 0 100 20 10 10 0 000-20z" },
  { href: "/command/jobs", label: "Audit log", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" },
  { href: "/command/appointments", label: "Appointments", icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" },
  { href: "/command/team", label: "Team", icon: "M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6zM21 20v-2a4 4 0 00-3-3.87" },
  { href: "/command/analytics", label: "Analytics", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
];

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

  const current = LINKS.find((l) =>
    l.href === "/command" ? path === "/command" : path.startsWith(l.href)
  );

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
              const active = l.href === "/command" ? path === "/command" : path.startsWith(l.href);
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
