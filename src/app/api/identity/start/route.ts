import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createIdentityVerification } from "@/lib/stripe";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";

/**
 * Start a Stripe Identity check for a site the signed-in user has claimed.
 * Returns { url } — the hosted Stripe verification page to redirect to.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { siteId } = await req.json().catch(() => ({}));
  const id = Number(siteId);
  if (!Number.isFinite(id)) return Response.json({ error: "siteId required." }, { status: 400 });

  const [site] = await db.select().from(forgeSites).where(eq(forgeSites.id, id)).limit(1);
  if (!site) return Response.json({ error: "Site not found." }, { status: 404 });
  const owns = site.claimedByUserId === session.user.id || isAdminEmail(session.user.email);
  if (!owns) return Response.json({ error: "You haven't claimed this site." }, { status: 403 });
  if (site.idVerifiedAt) return Response.json({ verified: true });

  try {
    const vs = await createIdentityVerification(id, `${SITE_URL}/portal?verified=1`);
    await db.update(forgeSites).set({ idVerificationSession: vs.id }).where(eq(forgeSites.id, id));
    return Response.json({ url: vs.url });
  } catch (err) {
    console.error("[identity] start failed:", err);
    return Response.json({ error: "Couldn't start verification." }, { status: 500 });
  }
}
