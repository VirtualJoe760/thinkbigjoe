"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { resetPassword } from "@/lib/auth-client";

export function ResetPasswordForm({
  token,
  invalid,
}: {
  token: string | null;
  invalid?: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // The link was missing/expired/already-used — better-auth redirects here with
  // ?error=INVALID_TOKEN, or there's simply no token.
  if (invalid || !token) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Link expired</h1>
        <p className="mt-2 text-sm text-ink-soft">
          This password reset link is invalid or has expired. Request a fresh one from the login
          page.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Back to login
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Password updated</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Your password has been changed. You can now sign in with it.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Sign in
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await resetPassword({ newPassword: password, token: token as string });
      if (res.error) {
        setError(
          res.error.message ??
            "Couldn't reset your password — the link may have expired. Request a new one.",
        );
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-3xl font-extrabold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Pick a strong password you don&apos;t use anywhere else.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-xl border border-line bg-background px-4 py-3 text-ink placeholder:text-ink-soft/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Confirm password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-xl border border-line bg-background px-4 py-3 text-ink placeholder:text-ink-soft/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Back to login
        </Link>
      </p>
    </div>
  );
}
