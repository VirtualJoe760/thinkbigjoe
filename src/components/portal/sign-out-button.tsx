"use client";

import { useRouter } from "next/navigation";

import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        router.push("/login");
        router.refresh();
      }}
      className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink"
    >
      Sign out
    </button>
  );
}
