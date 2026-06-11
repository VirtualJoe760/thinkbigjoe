import Link from "next/link";

import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/portal/sign-out-button";

export function PortalHeader({ email }: { email: string }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/portal"
              className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              Overview
            </Link>
            <Link
              href="/portal/account"
              className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              Account
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-ink-soft sm:block">{email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
