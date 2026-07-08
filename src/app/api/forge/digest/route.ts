import { NextResponse } from "next/server";

import { getForgeDigest } from "@/lib/forge-stats";

export const dynamic = "force-dynamic";

/**
 * The forge digest as JSON — "where are we at": build/edit queues, throughput
 * (built/edited/outreach over 24h + 7d), and the weekly run-budget gauge. Same
 * computation the Engine cockpit + Overview render, exposed so the `forge_digest`
 * MCP tool can read it on demand. Bearer-protected with CRON_SECRET.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

export async function GET(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const digest = await getForgeDigest();
    return NextResponse.json(digest);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
