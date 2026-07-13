import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { dropToSite } from "@/lib/voicemail-outreach";
import { dropVoicemail, dropCowboyCallbackUrl } from "@/lib/dropcowboy";

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
  const body = (await req.json().catch(() => ({}))) as { siteId?: number; text?: boolean; phone?: string; audioUrl?: string; recordingId?: string; noPool?: boolean };

  // Raw-number test drop (no lead, no follow-up text) — e.g. dropping to Joe's own phone.
  // Returns Drop Cowboy's raw response so we can see exactly what it did with the drop.
  // noPool:true omits pool_id → routes via Drop Cowboy's native network instead of the BYOC pool.
  if (body.phone && body.siteId == null) {
    const r = await dropVoicemail(body.phone, { foreignId: "test", audioUrl: body.audioUrl, recordingId: body.recordingId, poolId: body.noPool ? null : undefined, callbackUrl: dropCowboyCallbackUrl() });
    if ("skipped" in r) return NextResponse.json({ ok: false, message: r.reason });
    if ("error" in r) return NextResponse.json({ ok: false, message: r.error, status: r.status, raw: r.raw });
    return NextResponse.json({ ok: true, message: `Test voicemail dropped to ${body.phone}`, id: r.id, raw: r.raw });
  }

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
