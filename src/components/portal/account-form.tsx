"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function AccountForm({
  initialName,
  email,
}: {
  initialName: string;
  email: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const { error } = await authClient.updateUser({ name });
    if (error) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-6 space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setStatus("idle");
          }}
          className="w-full rounded-xl border border-line bg-background px-4 py-3 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
        <input
          type="email"
          value={email}
          disabled
          className="w-full cursor-not-allowed rounded-xl border border-line bg-surface px-4 py-3 text-ink-soft"
        />
      </label>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "saving" || name.trim() === ""}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : "Save changes"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-green-600">Saved</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-600">Couldn&apos;t save</span>
        )}
      </div>
    </form>
  );
}
