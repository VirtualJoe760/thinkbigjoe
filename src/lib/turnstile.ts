/**
 * Server-side Cloudflare Turnstile verification for public endpoints
 * (better-auth's captcha plugin covers auth routes; this covers the rest,
 * e.g. the booking endpoint).
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Not configured → don't block (matches the rest of the app's defensive style).
  if (!secret) return true;
  if (!token) return false;

  try {
    const resp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          response: token,
          ...(remoteIp ? { remoteip: remoteIp } : {}),
        }),
      },
    );
    const data = await resp.json();
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] verification failed:", err);
    return false;
  }
}
