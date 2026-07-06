import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, siteAnalyses, rebuildRequests } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { analyzeSite } from "@/lib/site-analyzer";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // fetches several pages + a Gemini synth pass

/**
 * Analyze an existing website: pull business details, brand (logo/colors/fonts),
 * services, socials and media, and store the result in `site_analyses` for review.
 * Admin-gated for now (future: owner-triggered when someone signs up with an
 * existing site). Optionally links the analysis to a rebuild_requests row.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isAdminEmail(session.user.email)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: { url?: string; rebuildRequestId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const url = (body.url || "").trim();
  if (!url) return NextResponse.json({ ok: false, error: "Enter a website URL." }, { status: 400 });

  const analysis = await analyzeSite(url);

  const rebuildRequestId =
    Number.isFinite(body.rebuildRequestId) && Number(body.rebuildRequestId) > 0
      ? Number(body.rebuildRequestId)
      : null;

  const [row] = await db
    .insert(siteAnalyses)
    .values({
      url: analysis.url,
      finalUrl: analysis.finalUrl,
      status: analysis.ok ? "analyzed" : "failed",
      businessName: analysis.business.name || null,
      analysis,
      logoUrl: analysis.brand.logoUrl || null,
      error: analysis.ok ? null : analysis.error || "analysis failed",
      requestedByUserId: session.user.id,
      rebuildRequestId,
    })
    .returning({ id: siteAnalyses.id });

  // If this analysis came from a rebuild request, mark it analyzed.
  if (rebuildRequestId) {
    await db
      .update(rebuildRequests)
      .set({ status: "analyzed", updatedAt: new Date().toISOString() })
      .where(eq(rebuildRequests.id, rebuildRequestId));
  }

  return NextResponse.json({ ok: analysis.ok, id: row?.id, analysis, error: analysis.error });
}
