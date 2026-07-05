import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, forgeSites, activityLog } from "@/db";
import { generateClaimCode } from "@/lib/claim-code";

export const dynamic = "force-dynamic";

/**
 * The local forge build poller (factory/forge-poll.sh, running on Joe's Mac —
 * NOT Venus) POSTs here when a build finishes. Deterministic infra reporting
 * back a result, not an LLM action — logged to activity_log for the /command/jobs
 * audit trail same as any other state-changing write. Bearer-protected with
 * CRON_SECRET, same pattern as api/cron/daily-digest.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { slug?: string; liveUrl?: string; buildStatus?: string; screenshotUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const slug = (body.slug || "").trim();
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const [existing] = await db.select().from(forgeSites).where(eq(forgeSites.slug, slug)).limit(1);
  if (!existing) {
    return NextResponse.json({ error: `no forge_sites row for slug '${slug}'` }, { status: 404 });
  }

  const clean = body.buildStatus === "clean";
  const now = new Date().toISOString();

  // Mint a claim code the first time a site builds cleanly (keep any existing
  // one so re-runs don't invalidate a code already handed to the owner).
  const claimCode =
    clean && !existing.claimCode ? generateClaimCode() : existing.claimCode;

  await db
    .update(forgeSites)
    .set({
      status: clean ? "built" : "build_failed",
      liveUrl: body.liveUrl || existing.liveUrl,
      screenshotUrl: body.screenshotUrl || existing.screenshotUrl,
      buildStatus: body.buildStatus || existing.buildStatus,
      claimCode,
      builtAt: clean ? now : existing.builtAt,
      updatedAt: now,
    })
    .where(eq(forgeSites.id, existing.id));

  await db.insert(activityLog).values({
    actor: "forge",
    eventType: clean ? "forge_site_built" : "forge_site_build_failed",
    summary: `${existing.businessName} (${slug}) — ${clean ? `built, live at ${body.liveUrl || "?"}` : `build failed`}`,
    metadata: { auto: true, target: slug, detail: { buildStatus: body.buildStatus, liveUrl: body.liveUrl, claimCode } },
  });

  return NextResponse.json({ ok: true, status: clean ? "built" : "build_failed", claimCode });
}
