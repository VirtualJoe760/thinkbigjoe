import Link from "next/link";

import { AppHeader, type NavLink } from "@/components/app-nav";
import { SignOutButton } from "@/components/portal/sign-out-button";

// The internal Command Center is admin-only and link-dense (8 workflow groups),
// so it stays drawer-primary at every width — `inlineOnDesktop={false}`. Same
// shell as the public site and the portal, just a different config.
// Grouped + dense drawer: Overview, then Pipeline · Agents · Forge · Settings.
// Array order = drawer order (AppHeader groups by first-seen `group`).
const LINKS: NavLink[] = [
  { href: "/command", label: "Overview", icon: "M3 12l9-9 9 9M5 10v10h14V10", exact: true },

  {
    href: "/command/prospects",
    label: "Prospecting",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 20a8 8 0 0116 0",
    match: ["/command/prospects", "/command/analyzer", "/command/sites"],
    group: "Pipeline",
  },
  { href: "/command/outreach", label: "Outreach", icon: "M4 6h16v12H4zM4 7l8 6 8-6", group: "Pipeline" },
  {
    href: "/command/dialer",
    label: "Dialer",
    icon: "M3 5a2 2 0 012-2h2l2 5-2 1.5a12 12 0 006.5 6.5L15 14l5 2v2a2 2 0 01-2 2A16 16 0 013 5z",
    group: "Pipeline",
  },
  { href: "/command/leads", label: "Leads", icon: "M4 4h16v4H4zM4 12h16v8H4z", group: "Pipeline" },
  { href: "/command/messages", label: "Messages", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", group: "Pipeline" },
  { href: "/command/clients", label: "Clients", icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-2a3 3 0 10-3-3", group: "Pipeline" },

  {
    href: "/command/agents",
    label: "Agents",
    icon: "M12 2a3 3 0 013 3v1a3 3 0 01-6 0V5a3 3 0 013-3zM5 21v-1a7 7 0 0114 0v1M9 11l-2 2 2 2M15 11l2 2-2 2",
    group: "Agents",
  },
  {
    href: "/command/applications",
    label: "Whitney",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4",
    group: "Agents",
  },
  {
    href: "/command/crons",
    label: "Venus",
    icon: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z",
    match: ["/command/crons", "/command/jobs", "/command/team"],
    group: "Agents",
  },

  {
    href: "/command/engine",
    label: "Engine",
    icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4",
    group: "Forge",
  },

  { href: "/command/appointments", label: "Calendar", icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z", group: "Settings" },
  {
    href: "/command/settings",
    label: "Settings",
    icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.9 7.9 0 000-2l2-1.6-2-3.4-2.4 1a7.9 7.9 0 00-1.7-1l-.4-2.6H10l-.4 2.6a7.9 7.9 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7.9 7.9 0 000 2l-2 1.6 2 3.4 2.4-1a7.9 7.9 0 001.7 1l.4 2.6h4l.4-2.6a7.9 7.9 0 001.7-1l2.4 1 2-3.4z",
    match: ["/command/settings", "/command/analytics"],
    group: "Settings",
  },
];

export function CommandHeader({ email }: { email: string }) {
  return (
    <AppHeader
      links={LINKS}
      inlineOnDesktop={false}
      highlightActive
      leading={
        <Link
          href="/portal"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink"
          aria-label="Back to portal"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Portal
        </Link>
      }
      drawerFooter={
        <>
          <p className="truncate text-xs text-ink-soft">{email}</p>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/portal" className="text-ink-soft hover:text-ink">Portal</Link>
            <Link href="/" className="text-ink-soft hover:text-ink">Site</Link>
          </div>
          <SignOutButton />
        </>
      }
    />
  );
}
