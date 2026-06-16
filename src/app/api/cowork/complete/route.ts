import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, coworkJobs } from "@/db";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * The Mac Mini runner calls this when a job finishes. Marks it done/failed with
 * a one-line summary and pings Joe on Telegram with the result. Bearer-protected.
 */
function authed(req: Request): boolean {
  const expected = process.env.COWORK_RUNNER_TOKEN;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: number; status?: string; resultSummary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = Number(body.id);
  const status = body.status === "failed" ? "failed" : "done";
  const summary = (body.resultSummary || "").slice(0, 500) || null;
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db
    .update(coworkJobs)
    .set({ status, resultSummary: summary, updatedAt: new Date().toISOString() })
    .where(eq(coworkJobs.id, id));

  const icon = status === "failed" ? "⚠️" : "✅";
  notifyTelegram(
    `${icon} <b>Job #${id} ${status}</b>${summary ? `\n${summary}` : ""}`,
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
