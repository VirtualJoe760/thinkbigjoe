import { NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "node:crypto";

import { auth } from "@/lib/auth";
import { buildAuthUrl, isGoogleOAuthConfigured } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

/**
 * Kick off the per-client Google OAuth flow. Requires a signed-in portal user; sets a short-lived
 * CSRF nonce cookie and redirects to Google's consent screen. The callback ties the returned tokens
 * to this same session. `?siteId=` optionally records which of the user's sites is connecting.
 */
export async function GET(req: Request) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/portal/calendar?google=unconfigured", req.url));
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.redirect(new URL("/portal", req.url));

  const nonce = crypto.randomBytes(16).toString("hex");
  const siteId = new URL(req.url).searchParams.get("siteId") || "";
  const res = NextResponse.redirect(buildAuthUrl(`${nonce}.${siteId}`));
  res.cookies.set("g_oauth_state", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
