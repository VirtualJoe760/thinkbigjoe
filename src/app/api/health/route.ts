import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe for an EXTERNAL uptime monitor (UptimeRobot, Better Stack, a Pingdom, etc.)
 * to poll every few minutes.
 *
 * This is the one check the internal crons cannot do: if the whole app is down, the cron that
 * verifies voice-line health never runs either, so the absence of an alert looks identical to
 * everything being fine. An external poller watching THIS endpoint is what turns a total outage
 * into a page. Point one at https://thinkbigjoe.com/api/health and alert on non-200 or a missing
 * "ok": true.
 *
 * Deliberately unauthenticated and near-zero cost: one trivial DB round-trip, no tenant data, no
 * secrets, nothing enumerable. It answers exactly one question — "is the app up and can it reach
 * its database" — because a health check that does more work is a health check that invents its own
 * outages.
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  let healthy = true;

  try {
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch (err) {
    checks.database = "fail";
    healthy = false;
    console.error("[health] database unreachable:", err);
  }

  return NextResponse.json(
    { ok: healthy, checks, ts: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
