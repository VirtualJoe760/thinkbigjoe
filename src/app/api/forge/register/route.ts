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

  // "clean" from the local build isn't enough — a site is only "ready for
  // outreach" if its live URL actually serves (Vercel deploys can fail even when
  // the local build passed, e.g. lockfile/rootDir). Verify the deploy is really up.
  let liveOk = false;
  const liveUrl = body.liveUrl || existing.liveUrl;
  if (body.buildStatus === "clean" && liveUrl) {
    try {
      const res = await fetch(liveUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(12000) });
      const text = res.ok ? await res.text() : "";
      // A broken deploy is usually a 404 (alias unassigned), but Vercel platform
      // error pages can also return 200 — reject those by their signature too.
      liveOk =
        res.ok &&
        !/DEPLOYMENT_NOT_FOUND|DEPLOYMENT_DISABLED|404: NOT_FOUND|The deployment could not be found|This deployment (can not|cannot) be found|Application error: a (client|server)-side exception/i.test(
          text,
        );
    } catch {
      liveOk = false;
    }
  }
  const clean = body.buildStatus === "clean" && liveOk;
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

  const failReason = clean
    ? ""
    : body.buildStatus === "clean" && !liveOk
      ? ` — build was clean but the live URL isn't serving (deploy failed): ${liveUrl || "?"}`
      : ` — build failed`;
  await db.insert(activityLog).values({
    actor: "forge",
    eventType: clean ? "forge_site_built" : "forge_site_build_failed",
    summary: `${existing.businessName} (${slug})${clean ? ` — built + verified live at ${liveUrl}` : failReason}`,
    metadata: { auto: true, target: slug, detail: { buildStatus: body.buildStatus, liveUrl, liveOk, claimCode } },
  });

  return NextResponse.json({ ok: true, status: clean ? "built" : "build_failed", claimCode });
}
