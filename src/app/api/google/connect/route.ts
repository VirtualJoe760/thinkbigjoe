import { NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "node:crypto";

import { auth } from "@/lib/auth";
import { buildAuthUrl, isGoogleOAuthConfigured, type GoogleFeature } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

/**
 * Kick off the per-client Google OAuth flow. Requires a signed-in portal user; sets a short-lived
 * CSRF nonce cookie and redirects to Google's consent screen. The callback ties the returned tokens
 * to this same session. `?siteId=` optionally records which of the user's sites is connecting.
 *
 * `?feature=calendar|contacts` asks for ONLY that feature's scopes, so the customer sees a small,
 * contextual consent screen instead of one wall of permissions. Omitting it asks for both (the old
 * behaviour). Grants are incremental — see buildAuthUrl.
 */
export async function GET(req: Request) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/portal/settings?google=unconfigured", req.url));
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.redirect(new URL("/portal", req.url));

  const url = new URL(req.url);
  const raw = url.searchParams.get("feature");
  const features: GoogleFeature[] =
    raw === "calendar" || raw === "contacts" ? [raw] : ["calendar", "contacts"];

  const nonce = crypto.randomBytes(16).toString("hex");
  const siteId = url.searchParams.get("siteId") || "";
  const res = NextResponse.redirect(buildAuthUrl(`${nonce}.${siteId}`, features));
  res.cookies.set("g_oauth_state", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
