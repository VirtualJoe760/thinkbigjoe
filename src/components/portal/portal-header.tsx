import Link from "next/link";

import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/portal/sign-out-button";

export function PortalHeader({ email, isAdmin }: { email: string; isAdmin?: boolean }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Logo />
          <nav className="flex items-center gap-x-4 gap-y-1">
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
            {isAdmin && (
              <Link
                href="/command"
                className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
              >
                Command
              </Link>
            )}
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
