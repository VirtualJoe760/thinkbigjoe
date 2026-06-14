"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/command", label: "Overview", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/command/prospects", label: "Prospecting", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 20a8 8 0 0116 0" },
  { href: "/command/leads", label: "Leads", icon: "M4 4h16v4H4zM4 12h16v8H4z" },
  { href: "/command/appointments", label: "Appointments", icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" },
  { href: "/command/team", label: "Team", icon: "M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6zM21 20v-2a4 4 0 00-3-3.87" },
  { href: "/command/analytics", label: "Analytics", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
];

export function CommandNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map((l) => {
        const active =
          l.href === "/command" ? path === "/command" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-brand-tint text-brand" : "text-ink-soft hover:bg-surface hover:text-ink"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={l.icon} />
            </svg>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
