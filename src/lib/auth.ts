import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { captcha } from "better-auth/plugins";
import { Pool } from "pg";

import { sendResetPasswordEmail, sendWelcomeEmail, sendAdminAlert, sendVerificationEmail } from "./email";
import { notifyTelegram } from "./telegram";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  // On Vercel, derive the stable production URL automatically.
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined) ||
  "http://localhost:3000";

/**
 * Origins better-auth accepts requests + redirects from. By default it trusts
 * ONLY `baseURL`, which breaks the moment the app is reached at any other
 * origin — the custom domain vs the Vercel URL, www vs apex, or the dev server
 * on a non-3000 port. Missing origins surface as "Invalid origin" on sign-in,
 * password reset, etc. Wildcards (e.g. *.vercel.app) are supported.
 */
const trustedOrigins = Array.from(
  new Set(
    [
      baseURL,
      process.env.BETTER_AUTH_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL &&
        `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
      process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
      "https://thinkbigjoe.com",
      "https://www.thinkbigjoe.com",
      "https://*.vercel.app", // Vercel preview deployments
      "http://localhost:3000",
      "http://localhost:3003",
    ].filter((v): v is string => Boolean(v)),
  ),
);

const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);
const facebookEnabled = Boolean(
  process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET,
);
const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;

/**
 * Client-portal auth (clients log in here). Separate from Payload's auth,
 * which powers the CMS admin + staff. better-auth stores its own tables
 * (user/session/account/verification) in the same Neon Postgres.
 */
// better-auth's DB pool (also reused by the signup hook to stamp an account number).
// Direct (unpooled) endpoint so the search_path startup option sticks, and the tables
// live in the isolated `better_auth` schema (Payload's dev `push` owns `public` and
// would DROP tables it doesn't recognize).
const authPool = new Pool({
  connectionString:
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URI ||
    "",
  options: "-c search_path=better_auth",
});

export const auth = betterAuth({
  baseURL,
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
  database: authPool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8, // 8-char minimum (enforced client-side too, with a strength meter)
    // Password recovery: better-auth generates a one-time token + link; we
    // email it. The link lands on /reset-password?token=… (see reset page).
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
    sendResetPassword: async ({ user, url }) => {
      try {
        await sendResetPasswordEmail(user.email, url, user.name);
      } catch (err) {
        console.error("[auth] reset-password email failed:", err);
      }
    },
    // NOTE: not requiring verification to sign in (would lock out unverified users +
    // add signup friction). Flip requireEmailVerification: true here to make it mandatory.
  },
  // Email verification — sends a "verify your email" link on sign-up. Better-auth
  // handles the verify endpoint + marks emailVerified; the link auto-signs them in.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24h
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await sendVerificationEmail(user.email, url, user.name);
      } catch (err) {
        console.error("[auth] verification email failed:", err);
      }
    },
  },
  socialProviders: {
    ...(googleEnabled
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : {}),
    ...(facebookEnabled
      ? {
          facebook: {
            clientId: process.env.FACEBOOK_CLIENT_ID as string,
            clientSecret: process.env.FACEBOOK_CLIENT_SECRET as string,
          },
        }
      : {}),
  },
  // Every account carries a human-friendly account number (100001, 100002, …) —
  // the DB assigns it via a column default (see scripts/db/add-account-numbers.mjs),
  // so it's read-only here (`input: false`): better-auth never sets it, just returns
  // it on the session as `user.accountNumber`. Customers read it to the voice agent.
  user: {
    additionalFields: {
      accountNumber: { type: "string", required: false, input: false, fieldName: "account_number" },
    },
  },
  // Send a no-reply welcome / account-confirmation email on signup
  // (fires for email/password and social sign-ups alike).
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Guarantee an account number even if better-auth's INSERT bypassed the
          // column default — idempotent (only fills a NULL).
          try {
            await authPool.query(
              `UPDATE "user" SET account_number = nextval('account_number_seq')::text WHERE id = $1 AND account_number IS NULL`,
              [user.id],
            );
          } catch (err) {
            console.error("[auth] account-number assign failed:", err);
          }
          try {
            await sendWelcomeEmail(user.email, user.name);
          } catch (err) {
            console.error("[auth] welcome email failed:", err);
          }
          notifyTelegram(
            `👤 <b>New signup</b>\n${user.name ? `${user.name} · ` : ""}${user.email}`,
          ).catch(() => {});
          sendAdminAlert({
            subject: `New signup — ${user.name || user.email}`,
            heading: "New account created 👤",
            message: `${user.name ? `${user.name} (${user.email})` : user.email} just created an account.`,
            ctaUrl: `${process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com"}/command/leads`,
            ctaLabel: "Open leads",
          }).catch((err) => console.error("[auth] admin signup alert failed:", err));
        },
      },
    },
  },
  plugins: [
    // Cloudflare Turnstile bot protection on auth endpoints (sign-up etc.).
    // Only enabled once the secret key is configured.
    ...(turnstileSecret
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: turnstileSecret,
          }),
        ]
      : []),
    // nextCookies must stay last.
    nextCookies(),
  ],
});

/** Which social providers are configured — used to gate the login UI. */
export const socialProviderStatus = {
  google: googleEnabled,
  facebook: facebookEnabled,
};
