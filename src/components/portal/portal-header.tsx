import { headers } from "next/headers";

import { AppHeader, type NavLink } from "@/components/app-nav";
import { SignOutButton } from "@/components/portal/sign-out-button";
import { auth } from "@/lib/auth";

const LINKS: NavLink[] = [
  { href: "/portal", label: "Overview", exact: true },
  // Sits directly after Overview on purpose: for a Tier-1 receptionist customer this is the page
  // they open, and a missed-call message they never find is the same as a lead we never took.
  { href: "/portal/calls", label: "Calls" },
  { href: "/portal/calendar", label: "Calendar" },
  { href: "/portal/newsletter", label: "Newsletter" },
  { href: "/solutions", label: "Agentic Solutions" },
  { href: "/portal/book", label: "Book a call" },
  { href: "/portal/billing", label: "Billing" },
  { href: "/portal/settings", label: "Settings" },
  { href: "/portal/account", label: "Account" },
];

export async function PortalHeader({ email, isAdmin }: { email: string; isAdmin?: boolean }) {
  const links = isAdmin
    ? [...LINKS, { href: "/command/messages", label: "Messages" }, { href: "/command", label: "Command", exact: true }]
    : LINKS;

  // The account ID lives on the session (better-auth additional field). Surfaced
  // in the nav so a customer can always read it to our phone assistant.
  const session = await auth.api.getSession({ headers: await headers() });
  const accountNumber =
    (session?.user as { accountNumber?: string | null } | undefined)?.accountNumber || null;

  return (
    <AppHeader
      links={links}
      highlightActive
      inlineOnDesktop={false}
      desktopRight={
        // The account ID stays glanceable in the bar on wide screens; everything
        // else (links, email, sign-out) lives in the hamburger drawer at every width.
        accountNumber ? (
          <span
            className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft lg:inline-flex"
            title="Your account ID — read it to our phone assistant to pull up your account"
          >
            ID <span className="font-mono font-semibold tabular-nums text-ink">{accountNumber}</span>
          </span>
        ) : undefined
      }
      drawerFooter={
        <>
          {accountNumber && (
            <p className="text-xs text-ink-soft">
              Account ID{" "}
              <span className="font-mono font-semibold tabular-nums text-ink">{accountNumber}</span>
            </p>
          )}
          <p className="truncate text-xs text-ink-soft">{email}</p>
          <SignOutButton />
        </>
      }
    />
  );
}
