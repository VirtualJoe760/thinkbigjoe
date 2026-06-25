"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { signIn, signUp } from "@/lib/auth-client";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Mode = "signin" | "signup";

export function AuthCard({
  google,
  facebook,
}: {
  google: boolean;
  facebook: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const anySocial = google || facebook;
  const needsCaptcha = Boolean(TURNSTILE_SITE_KEY);

  async function handleSocial(provider: "google" | "facebook") {
    setError(null);
    await signIn.social({ provider, callbackURL: "/portal" });
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const fetchOptions = captchaToken
        ? { headers: { "x-captcha-response": captchaToken } }
        : undefined;
      const res =
        mode === "signup"
          ? await signUp.email({ name, email, password }, fetchOptions)
          : await signIn.email({ email, password }, fetchOptions);
      if (res.error) {
        setError(
          res.error.message ??
            (mode === "signup"
              ? "Could not create your account."
              : "Invalid email or password."),
        );
        // Turnstile tokens are single-use — refresh for the next attempt.
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        return;
      }
      router.push("/portal");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-3xl font-extrabold tracking-tight">
        {mode === "signup" ? "Create your account" : "Login"}
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        {mode === "signup"
          ? "Track your project and manage billing in one place."
          : "Sign in to view your project progress and billing."}
      </p>

      {anySocial && (
        <div className="mt-8 space-y-3">
          {google && (
            <button
              type="button"
              onClick={() => handleSocial("google")}
              className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-background px-5 py-3 text-sm font-semibold transition-colors hover:bg-surface"
            >
              <GoogleIcon className="h-5 w-5" />
              Continue with Google
            </button>
          )}
          {facebook && (
            <button
              type="button"
              onClick={() => handleSocial("facebook")}
              className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-background px-5 py-3 text-sm font-semibold transition-colors hover:bg-surface"
            >
              <FacebookIcon className="h-5 w-5" />
              Continue with Facebook
            </button>
          )}
        </div>
      )}

      {anySocial && (
        <div className="my-6 flex items-center gap-4 text-xs font-medium text-ink-soft">
          <span className="h-px flex-1 bg-line" />
          OR
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      <form onSubmit={handleEmail} className="space-y-4">
        {mode === "signup" && (
          <Field
            label="Name"
            type="text"
            value={name}
            onChange={setName}
            placeholder="Jane Doe"
            autoComplete="name"
          />
        )}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="jane@company.com"
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
        />

        {needsCaptcha && (
          <Turnstile
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY as string}
            onSuccess={setCaptchaToken}
            onError={() => setCaptchaToken(null)}
            onExpire={() => setCaptchaToken(null)}
            options={{ theme: "light" }}
          />
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || (needsCaptcha && !captchaToken)}
          className="w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {loading
            ? "Please wait…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
          }}
          className="font-semibold text-brand hover:underline"
        >
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-xl border border-line bg-background px-4 py-3 text-ink placeholder:text-ink-soft/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
    </label>
  );
}

function GoogleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function FacebookIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12Z"
      />
    </svg>
  );
}
