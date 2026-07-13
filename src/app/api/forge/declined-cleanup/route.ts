import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Retire declined leads that were never claimed. When Joe marks a lead "Declined" it stays live a
 * few more days (in case they reconsider), then this soft-deletes it (status='deleted' → drops out
 * of Leads/Prospects). Only touches declined + unclaimed sites past the grace window.
 *
 * Auth: Bearer CRON_SECRET. Schedule daily (launchd/cron). `?days=N` overrides the window;
 * `?dry=1` reports what it would remove.
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Math.max(1, Number(url.searchParams.get("days") || process.env.DECLINED_KEEP_DAYS || 5));
  const dry = url.searchParams.get("dry") === "1";

  const cond = sql`lead_stage = 'declined' AND claimed_by_user_id IS NULL AND status <> 'deleted' AND declined_at IS NOT NULL AND declined_at < now() - (${String(days)} || ' days')::interval`;

  if (dry) {
    const rows = (await db.execute(sql`SELECT id, business_name FROM forge_sites WHERE ${cond} ORDER BY declined_at ASC`)).rows as Array<{ id: number; business_name: string }>;
    return NextResponse.json({ ok: true, dry: true, keepDays: days, wouldRemove: rows.length, sites: rows });
  }

  const removed = (await db.execute(sql`UPDATE forge_sites SET status = 'deleted', updated_at = now() WHERE ${cond} RETURNING id, business_name`)).rows as Array<{ id: number; business_name: string }>;
  return NextResponse.json({ ok: true, keepDays: days, removed: removed.length, sites: removed });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "forge/declined-cleanup" });
}
