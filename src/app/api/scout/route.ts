import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { isAdminEmail } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { runScout, type ScoutVertical, type ScoutSource } from "@/lib/scout";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Accept either session-based auth (browser UI) or bearer token (Venus/cron)
  const authHeader = req.headers.get("authorization");
  const runnerToken = process.env.COWORK_RUNNER_TOKEN;

  if (authHeader && runnerToken && authHeader === `Bearer ${runnerToken}`) {
    // Venus / cron path — token auth
  } else {
    // Browser path — session auth
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session || !isAdminEmail(session.user?.email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json() as {
    vertical?: string;
    location?: string;
    sources?: string[];
    limit?: number;
  };

  const vertical = (body.vertical ?? "insurance") as ScoutVertical;
  const location = body.location ?? "United States";
  const sources = (body.sources ?? ["google_maps", "yelp"]) as ScoutSource[];
  const limit = Math.min(body.limit ?? 20, 50);

  try {
    const result = await runScout({ vertical, location, sources, limit });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
