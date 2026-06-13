"use client";

import { signOut } from "@/lib/auth-client";

export function SignOut() {
  return (
    <button
      onClick={() =>
        signOut().finally(() => {
          window.location.href = "/login";
        })
      }
      className="font-medium text-ink-soft hover:text-ink"
    >
      Sign out
    </button>
  );
}
