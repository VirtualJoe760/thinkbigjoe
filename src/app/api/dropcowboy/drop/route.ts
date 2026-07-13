import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { dropToSite } from "@/lib/voicemail-outreach";

export const dynamic = "force-dynamic";

/**
 * Drop a ringless voicemail to a single lead by `siteId` (optionally with the follow-up text).
 * Backs the `drop_voicemail` MCP tool + manual testing. Auth: Bearer CRON_SECRET.
 * Body: { siteId: number, text?: boolean }.
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { siteId?: number; text?: boolean };
  const id = Number(body.siteId);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, message: "siteId required" }, { status: 400 });

  const [site] = await db
    .select({
      id: forgeSites.id,
      businessName: forgeSites.businessName,
      phone: forgeSites.phone,
      ownerName: forgeSites.ownerName,
      claimCode: forgeSites.claimCode,
      liveUrl: forgeSites.liveUrl,
      slug: forgeSites.slug,
      googleRating: forgeSites.googleRating,
      reviewCount: forgeSites.reviewCount,
    })
    .from(forgeSites)
    .where(eq(forgeSites.id, id))
    .limit(1);
  if (!site) return NextResponse.json({ ok: false, message: "Lead not found" }, { status: 404 });

  const r = await dropToSite(site, { withText: body.text !== false });
  return NextResponse.json(r);
}
