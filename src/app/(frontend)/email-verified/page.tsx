"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Logo } from "@/components/logo";

// Where better-auth redirects after a successful email verification (callbackURL).
// Confirms success, then bounces to the portal — with a manual button in case the
// auto-redirect doesn't fire.
export default function EmailVerifiedPage() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.push("/portal"), 2200);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <Logo />
      <div className="mt-10 grid h-16 w-16 place-items-center rounded-full bg-green-100">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Email verified 🎉</h1>
      <p className="mt-3 max-w-sm text-ink-soft">
        You&apos;re all set. Taking you to your account&hellip;
      </p>
      <Link
        href="/portal"
        className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        Go to my account →
      </Link>
      <p className="mt-4 text-xs text-ink-soft">
        Not redirected automatically? Tap the button above.
      </p>
    </div>
  );
}
