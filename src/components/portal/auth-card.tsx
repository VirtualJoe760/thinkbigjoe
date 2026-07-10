"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { requestPasswordReset, signIn, signUp, sendVerificationEmail } from "@/lib/auth-client";
import { recordSignupConsent } from "@/lib/consent";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const MIN_PASSWORD = 8;

type Mode = "signin" | "signup" | "forgot";

/** Score a password 0–4 for the strength meter (length + character variety). */
function passwordScore(pw: string): number {
  if (pw.length < MIN_PASSWORD) return 0;
  let score = 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 12) score = Math.min(4, score + 1);
  return Math.min(4, score);
}
const STRENGTH = ["Too short", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = ["bg-red-400", "bg-red-400", "bg-amber-400", "bg-lime-500", "bg-green-500"];

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
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [verifySent, setVerifySent] = useState(false);
  const [resent, setResent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const anySocial = google || facebook;
  const needsCaptcha = Boolean(TURNSTILE_SITE_KEY);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setResetSent(false);
    setVerifySent(false);
    setResent(false);
    turnstileRef.current?.reset();
    setCaptchaToken(null);
  }

  async function handleResend() {
    setResent(false);
    try {
      await sendVerificationEmail({ email, callbackURL: "/email-verified" });
      setResent(true);
    } catch {
      /* best-effort — the original link still works */
      setResent(true);
    }
  }

  async function handleSocial(provider: "google" | "facebook") {
    setError(null);
    await signIn.social({ provider, callbackURL: "/portal" });
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const fetchOptions = captchaToken
        ? { headers: { "x-captcha-response": captchaToken } }
        : undefined;
      const res = await requestPasswordReset(
        { email, redirectTo: "/reset-password" },
        fetchOptions,
      );
      if (res.error) {
        setError(res.error.message ?? "Could not send the reset link. Please try again.");
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        return;
      }
      // Always show success — don't reveal whether the email has an account.
      setResetSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Signup gates: 8-char password minimum + agreeing to Terms/Privacy.
    if (mode === "signup") {
      if (password.length < MIN_PASSWORD) {
        setError(`Password must be at least ${MIN_PASSWORD} characters.`);
        return;
      }
      if (!agreedTerms) {
        setError("Please agree to the Terms of Service and Privacy Policy to continue.");
        return;
      }
    }
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
        const msg = res.error.message ?? "";
        // An unverified user trying to sign in: better-auth 403s and resends the link.
        // Guide them to their inbox instead of the useless "invalid credentials".
        const unverified =
          res.error.status === 403 ||
          (res.error as { code?: string }).code === "EMAIL_NOT_VERIFIED" ||
          /verif/i.test(msg);
        if (mode === "signin" && unverified) {
          setVerifySent(true);
          setResent(true);
        } else {
          setError(
            msg ||
              (mode === "signup" ? "Could not create your account." : "Invalid email or password."),
          );
        }
        // Turnstile tokens are single-use — refresh for the next attempt.
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        return;
      }
      if (mode === "signup") {
        // A2P / marketing consent audit trail (best-effort; doesn't block login).
        void recordSignupConsent(email, marketing);
        // Verification is required — no session yet. Send them to check their inbox
        // rather than navigating to a portal that would just bounce back to login.
        setVerifySent(true);
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

  if (mode === "forgot") {
    return (
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-extrabold tracking-tight">Reset your password</h1>
        {resetSent ? (
          <>
            <p className="mt-2 text-sm text-ink-soft">
              If an account exists for{" "}
              <span className="font-medium text-ink">{email}</span>, we&apos;ve sent a password
              reset link. Check your inbox (and your spam folder) — the link expires in 1 hour.
            </p>
            <button
              onClick={() => switchMode("signin")}
              className="mt-8 w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Back to login
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-soft">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>
            <form onSubmit={handleForgot} className="mt-8 space-y-4">
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="jane@company.com"
                autoComplete="email"
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
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-soft">
              Remembered it?{" "}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="font-semibold text-brand hover:underline"
              >
                Back to login
              </button>
            </p>
          </>
        )}
      </div>
    );
  }

  if (verifySent) {
    return (
      <div className="w-full max-w-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-2xl">📬</div>
        <h1 className="text-3xl font-extrabold tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm text-ink-soft">
          We sent a verification link to{" "}
          <span className="font-medium text-ink">{email || "your inbox"}</span>. Click it to activate your
          account — you&apos;ll be signed in and taken straight to your portal. The link expires in 24 hours.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Don&apos;t see it? Check your spam folder, or resend it below.
        </p>
        <button
          onClick={handleResend}
          className="mt-6 w-full rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          {resent ? "✓ Sent — check your inbox" : "Resend verification email"}
        </button>
        <button
          onClick={() => switchMode("signin")}
          className="mt-3 w-full rounded-full border border-line px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface"
        >
          Back to login
        </button>
      </div>
    );
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

        {mode === "signup" && password.length > 0 && (
          <div className="-mt-2">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${i < passwordScore(password) ? STRENGTH_COLOR[passwordScore(password)] : "bg-line"}`}
                />
              ))}
            </div>
            <p className={`mt-1 text-xs ${password.length < MIN_PASSWORD ? "text-red-600" : "text-ink-soft"}`}>
              {password.length < MIN_PASSWORD
                ? `At least ${MIN_PASSWORD} characters`
                : `${STRENGTH[passwordScore(password)]}${passwordScore(password) < 3 ? " — add a number, capital, or symbol" : ""}`}
            </p>
          </div>
        )}

        {mode === "signin" && (
          <div className="-mt-2 text-right">
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className="text-sm font-medium text-ink-soft hover:text-ink"
            >
              Forgot password?
            </button>
          </div>
        )}

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

        {mode === "signup" && (
          <div className="space-y-2.5">
            <label className="flex items-start gap-2.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand focus:ring-brand"
              />
              <span>
                I agree to the{" "}
                <a href="/terms-of-service" target="_blank" className="font-semibold text-brand hover:underline">Terms of Service</a>{" "}
                and{" "}
                <a href="/privacy-policy" target="_blank" className="font-semibold text-brand hover:underline">Privacy Policy</a>.
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand focus:ring-brand"
              />
              <span>
                Send me product updates and offers by email and text (optional). Msg &amp; data rates may apply;
                reply STOP to opt out.
              </span>
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={
            loading ||
            (needsCaptcha && !captchaToken) ||
            (mode === "signup" && (!agreedTerms || password.length < MIN_PASSWORD))
          }
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
          onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
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
