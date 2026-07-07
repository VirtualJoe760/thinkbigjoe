import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db, forgeSites } from "@/db";
import { generatePreview } from "@/lib/forge-preview";

// Generate the pre-sale showroom preview for a prospect. Bearer-protected with CRON_SECRET,
// the same shared secret the forge poller uses. Called by the MCP tool, the preview-engine
// cron, or manually. Body: { siteId } or { slug }.
export async function POST(req: NextRequest) {
  const authz = req.headers.get("authorization");
  if (authz !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { siteId?: number; slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  let siteId = body.siteId;
  if (!siteId && body.slug) {
    const [s] = await db
      .select({ id: forgeSites.id })
      .from(forgeSites)
      .where(eq(forgeSites.slug, body.slug))
      .limit(1);
    siteId = s?.id;
  }
  if (!siteId) {
    return NextResponse.json({ ok: false, error: "siteId or slug required" }, { status: 400 });
  }

  const result = await generatePreview(siteId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
