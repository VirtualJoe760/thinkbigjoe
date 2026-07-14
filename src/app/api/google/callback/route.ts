import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";

import { auth } from "@/lib/auth";
import { exchangeCode, fetchGoogleEmail, storeConnection } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

/**
 * Google OAuth callback. Verifies the CSRF nonce, exchanges the code for tokens, and stores them
 * against the signed-in user (google_connections). Redirects back to the portal with a status flag.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Land back on Settings — that's where both connections are managed now. (The Calendar page still
  // works; it just isn't where you grant access from any more.)
  const done = (status: string) => {
    const dest = new URL("/portal/settings", req.url);
    dest.searchParams.set("google", status);
    const res = NextResponse.redirect(dest);
    res.cookies.delete("g_oauth_state");
    return res;
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (url.searchParams.get("error") || !code) return done("error");

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.redirect(new URL("/portal", req.url));

  const [nonce, siteIdStr] = state.split(".");
  const saved = (await cookies()).get("g_oauth_state")?.value;
  if (!saved || saved !== nonce) return done("error");

  try {
    const tokens = await exchangeCode(code);
    const email = await fetchGoogleEmail(tokens.access_token);
    await storeConnection({
      userId: session.user.id,
      siteId: siteIdStr ? Number(siteIdStr) : null,
      tokens,
      googleEmail: email,
    });
    return done("connected");
  } catch (err) {
    console.error("[google:callback]", err);
    return done("error");
  }
}
