import { AppHeader, type NavLink } from "@/components/app-nav";
import { ButtonLink } from "@/components/ui/button";

const links: NavLink[] = [
  { href: "/#services", label: "Services" },
  { href: "/#approach", label: "Approach" },
  { href: "/#how", label: "How it works" },
  { href: "/#contact", label: "Contact" },
];

const PhoneIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.4-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z" />
  </svg>
);

export function SiteNav() {
  return (
    <AppHeader
      links={links}
      desktopRight={
        <>
          <a
            href="tel:+14807642121"
            className="hidden text-sm font-semibold text-ink transition-colors hover:text-brand lg:block"
          >
            (480) 764-2121
          </a>
          <span className="hidden h-5 w-px bg-line lg:block" aria-hidden="true" />
          <ButtonLink href="/login" size="sm">
            Login
          </ButtonLink>
        </>
      }
      drawerFooter={
        <>
          <a
            href="tel:+14807642121"
            className="flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-3 text-base font-semibold text-ink transition-colors hover:bg-surface"
          >
            {PhoneIcon}
            (480) 764-2121
          </a>
          <ButtonLink href="/login" size="lg" fullWidth>
            Login
          </ButtonLink>
        </>
      }
    />
  );
}
