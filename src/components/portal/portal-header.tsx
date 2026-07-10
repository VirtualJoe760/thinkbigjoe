import { AppHeader, type NavLink } from "@/components/app-nav";
import { SignOutButton } from "@/components/portal/sign-out-button";

const LINKS: NavLink[] = [
  { href: "/portal", label: "Overview", exact: true },
  { href: "/solutions", label: "Agentic Solutions" },
  { href: "/portal/book", label: "Book a call" },
  { href: "/portal/billing", label: "Billing" },
  { href: "/portal/account", label: "Account" },
];

export function PortalHeader({ email, isAdmin }: { email: string; isAdmin?: boolean }) {
  const links = isAdmin ? [...LINKS, { href: "/command", label: "Command", exact: true }] : LINKS;

  return (
    <AppHeader
      links={links}
      highlightActive
      desktopRight={
        <>
          <span className="hidden text-sm text-ink-soft lg:block">{email}</span>
          <SignOutButton />
        </>
      }
      drawerFooter={
        <>
          <p className="truncate text-xs text-ink-soft">{email}</p>
          <SignOutButton />
        </>
      }
    />
  );
}
