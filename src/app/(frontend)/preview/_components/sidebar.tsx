"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: string; soon?: boolean };
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: "Work",
    items: [
      { href: "/preview", label: "Overview", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
      { href: "/preview/pipeline", label: "Pipeline", icon: "M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z" },
      { href: "/preview/contacts", label: "Contacts", icon: "M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6z" },
      { href: "/preview/calendar", label: "Calendar", icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" },
    ],
  },
  {
    title: "Workforce",
    items: [
      { href: "/preview/agents", label: "Agents", icon: "M9 2h6M12 4v2M5 8h14v11H5zM9 13h.01M15 13h.01" },
      { href: "/preview/content", label: "Content", icon: "M4 5h16v14H4zM4 16l4-4 4 4 3-3 5 5", soon: true },
      { href: "/preview/ads", label: "Ads", icon: "M3 12a9 9 0 1018 0 9 9 0 10-18 0M8 12a4 4 0 108 0 4 4 0 10-8 0M12 12h.01", soon: true },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/preview/activity", label: "Activity", icon: "M3 12h4l3 8 4-16 3 8h4", soon: true },
      { href: "/preview/settings", label: "Settings", icon: "M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M4 6l2 2M18 16l2 2M2 12h3M19 12h3M4 18l2-2M18 8l2-2", soon: true },
    ],
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-background md:flex">
      <div className="flex h-14 items-center gap-2 px-5 font-bold tracking-tight">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4" />
          </svg>
        </span>
        <span className="text-[15px] lowercase">think<span className="text-brand">big</span>joe</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {SECTIONS.map((sec) => (
          <div key={sec.title} className="mb-4">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft/70">{sec.title}</p>
            <div className="flex flex-col gap-0.5">
              {sec.items.map((it) => {
                const active = it.href === "/preview" ? path === "/preview" : path.startsWith(it.href);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active ? "bg-brand-tint text-brand" : "text-ink-soft hover:bg-surface hover:text-ink"
                    }`}
                  >
                    <Icon d={it.icon} />
                    <span className="flex-1">{it.label}</span>
                    {it.soon && <span className="rounded bg-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-soft/60">soon</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-xs font-semibold text-white">JS</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Joey Sardella</p>
            <p className="truncate text-[11px] text-ink-soft">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
