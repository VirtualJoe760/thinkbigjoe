"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/preview", label: "Home", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/preview/pipeline", label: "Pipeline", icon: "M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z" },
  { href: "/preview/contacts", label: "Contacts", icon: "M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6z" },
  { href: "/preview/calendar", label: "Calendar", icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" },
  { href: "/preview/agents", label: "Agents", icon: "M9 2h6M12 4v2M5 8h14v11H5zM9 13h.01M15 13h.01" },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((t) => {
        const active = t.href === "/preview" ? path === "/preview" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active ? "text-brand" : "text-ink-soft"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
