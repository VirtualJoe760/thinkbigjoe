import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, editRequests, forgeSites, activityLog } from "@/db";

export const dynamic = "force-dynamic";

/**
 * The local edit-apply poller (factory/edit-poll.mjs on Joe's Mac) POSTs here
 * after it applies a client's click-to-edit request to the site source and
 * rebuilds/deploys. Bearer CRON_SECRET, same pattern as api/forge/register.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { editId?: number; status?: string; liveUrl?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const editId = Number(body.editId);
  if (!Number.isFinite(editId)) return NextResponse.json({ error: "editId required" }, { status: 400 });

  const applied = body.status === "applied";
  const now = new Date().toISOString();

  const [row] = await db
    .update(editRequests)
    .set({ status: applied ? "applied" : "failed", updatedAt: now })
    .where(eq(editRequests.id, editId))
    .returning({ id: editRequests.id, siteId: editRequests.siteId });
  if (!row) return NextResponse.json({ error: `no edit_request #${editId}` }, { status: 404 });

  const [site] = await db
    .select({ businessName: forgeSites.businessName })
    .from(forgeSites)
    .where(eq(forgeSites.id, row.siteId))
    .limit(1);

  await db.insert(activityLog).values({
    actor: "forge",
    eventType: applied ? "edit_applied" : "edit_failed",
    summary: `${site?.businessName ?? `site #${row.siteId}`} — edit request #${editId} ${applied ? "applied + redeployed" : "failed to apply"}`,
    metadata: { auto: true, target: String(row.siteId), detail: { editId, liveUrl: body.liveUrl, note: body.note } },
  });

  return NextResponse.json({ ok: true, status: applied ? "applied" : "failed" });
}
