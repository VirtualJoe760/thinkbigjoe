import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * The Mac Mini runner polls this to claim the next queued Cowork job. Atomically
 * flips the oldest `queued` row to `running` and returns it (SKIP LOCKED so two
 * pollers never grab the same job). Protected by a bearer token only the runner
 * knows (COWORK_RUNNER_TOKEN).
 */
function authed(req: Request): boolean {
  const expected = process.env.COWORK_RUNNER_TOKEN;
  if (!expected) return false; // fail closed — no token configured = no access
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = (await db.execute(sql`
    UPDATE cowork_jobs
       SET status = 'running', updated_at = now()
     WHERE id = (
       SELECT id FROM cowork_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, source, raw_command, intent, vertical, location, target_count, status, created_at
  `)) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];

  // neon-http returns an array; drizzle may wrap it — normalize.
  const list = Array.isArray(rows) ? rows : rows.rows || [];
  const job = list[0] || null;

  return NextResponse.json({ job });
}
