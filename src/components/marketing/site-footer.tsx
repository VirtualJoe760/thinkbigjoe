import Link from "next/link";

import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-ink-soft">
            Websites, AI receptionists & agentic AI for businesses ready to think big.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-ink-soft sm:flex sm:flex-row sm:gap-8">
          <Link href="/solutions" className="hover:text-ink">
            Solutions
          </Link>
          <Link href="/login" className="hover:text-ink">
            Login
          </Link>
          <Link href="/contact" className="hover:text-ink">
            Contact
          </Link>
          <Link href="/privacy-policy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms-of-service" className="hover:text-ink">
            Terms
          </Link>
          <a href="tel:+14807642121" className="font-semibold text-ink hover:text-brand">
            (480) 764-2121
          </a>
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
