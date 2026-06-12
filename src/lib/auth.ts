import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { captcha } from "better-auth/plugins";
import { Pool } from "pg";

import { sendWelcomeEmail } from "./email";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  // On Vercel, derive the stable production URL automatically.
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined) ||
  "http://localhost:3000";

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
export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: new Pool({
    // Use Neon's DIRECT (unpooled) endpoint so the search_path startup option
    // sticks — the pooled (pgbouncer) endpoint strips it.
    connectionString:
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URI ||
      "",
    // Isolate better-auth's tables in their own schema. Payload's dev `push`
    // manages the `public` schema and will DROP tables it doesn't own, so
    // keeping these out of `public` protects them.
    options: "-c search_path=better_auth",
  }),
  emailAndPassword: {
    enabled: true,
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
  // Send a no-reply welcome / account-confirmation email on signup
  // (fires for email/password and social sign-ups alike).
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await sendWelcomeEmail(user.email, user.name);
          } catch (err) {
            console.error("[auth] welcome email failed:", err);
          }
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
