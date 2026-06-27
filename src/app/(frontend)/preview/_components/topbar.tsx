"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, string> = {
  "/preview": "Overview",
  "/preview/pipeline": "Pipeline",
  "/preview/contacts": "Contacts",
  "/preview/calendar": "Calendar",
  "/preview/agents": "Agents",
  "/preview/contact": "Contact",
};

export function TopBar() {
  const path = usePathname();
  const key = Object.keys(TITLES).find((k) => (k === "/preview" ? path === k : path.startsWith(k)));
  const title = key ? TITLES[key] : "Command Center";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-background/90 px-5 backdrop-blur">
      <span className="text-sm font-semibold">{title}</span>

      <div className="relative ml-auto hidden max-w-xs flex-1 sm:block">
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
        </svg>
        <input
          placeholder="Search contacts…"
          className="w-full rounded-lg border border-line bg-surface py-1.5 pl-9 pr-3 text-sm outline-none placeholder:text-ink-soft/70 focus:border-brand"
        />
      </div>

      <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 sm:ml-0">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Canary<span className="hidden sm:inline"> · Insurance</span>
      </span>

      <button className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
        + Add
      </button>
    </header>
  );
}
