import Link from "next/link";

/**
 * The portal's OS shell — content on the left, navigation rail on the RIGHT (house style),
 * with the customer's website pinned to the rail: the one thing SalesAi-style dashboards
 * can't show, kept visible on every portal visit.
 *
 * Ring model (docs/PORTAL_REDESIGN.md → "Command is a ring"): this shell is Ring 1. The nav
 * lists every surface a customer has today; Agents is where Ring 2 grows in. Joe's /command
 * modules stay behind isAdmin and migrate into this same shell later — one shell, three rings.
 *
 * Server component on purpose: it renders from props, no client state. On phones the rail
 * collapses to a horizontal pill strip ABOVE the content (thumb-reachable, no layout shift).
 */
export type ShellSite = {
  id: number;
  businessName: string;
  liveUrl: string | null;
};

const NAV: { href: string; label: string; icon: string }[] = [
  { href: "/portal/dashboard", label: "Scoreboard", icon: "📊" },
  { href: "/portal/calls", label: "Calls", icon: "📞" },
  { href: "/portal/agents", label: "Agents", icon: "🤖" },
  { href: "/portal/calendar", label: "Calendar", icon: "📅" },
  { href: "/portal/billing", label: "Billing", icon: "💳" },
];

export function PortalShell({
  active,
  site,
  children,
}: {
  /** href of the active nav item. */
  active: string;
  /** The selected site — drives the rail's website card. Null = no claimed site yet. */
  site: ShellSite | null;
  children: React.ReactNode;
}) {
  const nav = (orientation: "rail" | "strip") => (
    <nav
      className={
        orientation === "rail"
          ? "flex flex-col gap-1"
          : "flex gap-2 overflow-x-auto pb-1"
      }
      aria-label="Portal"
    >
      {NAV.map((n) => {
        const on = n.href === active;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={
              orientation === "rail"
                ? `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                    on ? "bg-brand-tint text-brand" : "text-ink-soft hover:bg-surface hover:text-ink"
                  }`
                : `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    on ? "border-brand bg-brand-tint text-brand" : "border-line bg-background text-ink-soft"
                  }`
            }
          >
            <span aria-hidden>{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  const siteCard = site && (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="relative mb-2.5 h-14 overflow-hidden rounded-lg bg-gradient-to-br from-brand to-brand-dark">
        <div className="absolute inset-x-2.5 top-6 -bottom-2 rounded-t-md bg-white/90" />
      </div>
      <p className="truncate text-xs font-bold">{site.businessName}</p>
      {site.liveUrl ? (
        <p className="text-[11px] font-semibold text-green-700">● Live</p>
      ) : (
        <p className="text-[11px] font-semibold text-ink-soft">Being built</p>
      )}
      <Link
        href={`/portal/edit/${site.id}`}
        className="mt-2.5 inline-flex w-full items-center justify-center rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-ink/90"
      >
        ✏️ Edit my site
      </Link>
      {site.liveUrl && (
        <a
          href={site.liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex w-full items-center justify-center rounded-full border border-line bg-background px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface"
        >
          View site →
        </a>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      {/* Phone: pill strip on top, plus a slim site bar — the website (and its Edit entry point)
          must survive the collapse; only the rail's LAYOUT is a desktop luxury, not its content. */}
      <div className="mb-5 flex flex-col gap-3 lg:hidden">
        {nav("strip")}
        {site && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{site.businessName}</p>
              {site.liveUrl ? (
                <p className="text-[11px] font-semibold text-green-700">● Live</p>
              ) : (
                <p className="text-[11px] font-semibold text-ink-soft">Being built</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/portal/edit/${site.id}`}
                className="inline-flex items-center justify-center rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                ✏️ Edit
              </Link>
              {site.liveUrl && (
                <a
                  href={site.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full border border-line bg-background px-3.5 py-1.5 text-xs font-semibold text-ink"
                >
                  View →
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_236px] lg:gap-8">
        <div className="min-w-0">{children}</div>

        <aside className="hidden lg:block">
          <div className="sticky top-6 flex flex-col gap-5">
            {nav("rail")}
            {siteCard}
          </div>
        </aside>
      </div>
    </div>
  );
}
