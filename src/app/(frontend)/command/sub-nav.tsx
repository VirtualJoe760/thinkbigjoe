"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Secondary tab bar for a consolidated nav section (e.g. the Venus group). */
export function SubNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const path = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              active ? "border-brand text-brand" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

export const VENUS_TABS = [
  { href: "/command/crons", label: "Crons" },
  { href: "/command/jobs", label: "Audit log" },
  { href: "/command/team", label: "Team" },
];
