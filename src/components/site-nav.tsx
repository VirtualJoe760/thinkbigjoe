import Link from "next/link";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { SiteNavMobile } from "@/components/site-nav-mobile";

const links = [
  { href: "/solutions", label: "Solutions" },
  { href: "/#services", label: "Services" },
  { href: "/#approach", label: "Approach" },
  { href: "/#about", label: "About" },
  { href: "/#contact", label: "Contact" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <a
            href="tel:+14807642121"
            className="hidden text-sm font-semibold text-ink transition-colors hover:text-brand lg:block"
          >
            (480) 764-2121
          </a>
          <span className="hidden h-5 w-px bg-line lg:block" aria-hidden="true" />
          <Link
            href="/login"
            className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
          >
            Login
          </Link>
          <span className="hidden md:inline-flex">
            <ButtonLink href="/book-appointment" size="sm">
              Book a call
            </ButtonLink>
          </span>
          <SiteNavMobile links={links} />
        </div>
      </nav>
    </header>
  );
}
