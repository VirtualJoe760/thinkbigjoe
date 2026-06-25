import Link from "next/link";

import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-ink-soft">
            Agentic AI & MCP development for businesses ready to think big.
          </p>
        </div>

        <div className="flex flex-col gap-2 text-sm text-ink-soft sm:flex-row sm:gap-8">
          <Link href="/solutions" className="hover:text-ink">
            Solutions
          </Link>
          <Link href="/#services" className="hover:text-ink">
            Services
          </Link>
          <Link href="/login" className="hover:text-ink">
            Login
          </Link>
          <Link href="/#contact" className="hover:text-ink">
            Contact
          </Link>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-ink-soft">
          © {new Date().getFullYear()} ThinkBigJoe. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
