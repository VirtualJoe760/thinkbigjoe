import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Once-a-day heartbeat to Joe on Telegram: what's queued, what came in, what's
 * waiting on him. Triggered by Vercel Cron (see vercel.json). Vercel adds an
 * `Authorization: Bearer <CRON_SECRET>` header automatically when CRON_SECRET
 * is set, so we verify that.
 */
function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === expected;
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as
    | { rows?: { n: number }[] }
    | { n: number }[];
  const list = Array.isArray(rows) ? rows : rows.rows || [];
  return Number(list[0]?.n ?? 0);
}

export async function GET(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [jobsQueued, newLeads, newProspects, drafts, upcoming] = await Promise.all([
    scalar(sql`SELECT count(*)::int AS n FROM cowork_jobs WHERE status = 'queued'`),
    scalar(sql`SELECT count(*)::int AS n FROM leads WHERE created_at > now() - interval '24 hours'`),
    scalar(sql`SELECT count(*)::int AS n FROM prospects WHERE created_at > now() - interval '24 hours'`),
    scalar(sql`SELECT count(*)::int AS n FROM outreach WHERE status = 'draft'`),
    scalar(
      sql`SELECT count(*)::int AS n FROM leads WHERE status = 'booked' AND booked_slot > now()::text`,
    ),
  ]);

  const lines = [
    `☀️ <b>ThinkBigJoe — daily digest</b>`,
    ``,
    `🆕 New leads (24h): <b>${newLeads}</b>`,
    `🔎 New prospects (24h): <b>${newProspects}</b>`,
    `📝 Drafts awaiting your review: <b>${drafts}</b>`,
    `⏳ Cowork jobs queued: <b>${jobsQueued}</b>`,
    `📅 Upcoming booked calls: <b>${upcoming}</b>`,
    ``,
    drafts > 0
      ? `Review at thinkbigjoe.com/command`
      : `All clear — text me a command anytime to queue more.`,
  ];

  await notifyTelegram(lines.join("\n"));
  return NextResponse.json({ ok: true });
}
