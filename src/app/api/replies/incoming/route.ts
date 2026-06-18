import { NextResponse } from "next/server";
import { or, eq, ilike } from "drizzle-orm";

import { db, prospects, replyDrafts } from "@/db";
import { draftReply } from "@/lib/draft-reply";
import { sendTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * The Sentinel POSTs a detected LinkedIn reply here. We match the prospect,
 * draft a humble response (Anthropic), store it as a pending reply_draft, and
 * Telegram Joe the draft with inline instructions. Joe then replies in Telegram
 * (send / pause / a new version) — handled by /api/telegram/webhook.
 * Bearer-protected with COWORK_RUNNER_TOKEN (same as the runner endpoints).
 */
function authed(req: Request): boolean {
  const expected = process.env.COWORK_RUNNER_TOKEN;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; profileUrl?: string; message?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const name = (body.name || "").trim();
  const message = (body.message || "").trim();
  if (!name || !message) return NextResponse.json({ error: "name + message required" }, { status: 400 });

  // Match the prospect (by profile URL, else by name).
  const matched = (
    await db
      .select()
      .from(prospects)
      .where(
        body.profileUrl
          ? or(eq(prospects.profileUrl, body.profileUrl), ilike(prospects.name, name))
          : ilike(prospects.name, name),
      )
      .limit(1)
  )[0];

  const label = matched
    ? `${matched.name} — ${matched.title || ""}${matched.company ? `, ${matched.company}` : ""} (${matched.vertical || "?"})`
    : name;

  const draft = await draftReply({ prospect: label, theirMessage: message });

  if (!draft) {
    // No key / drafting failed → notify-only, no actionable row.
    await sendTelegram(`💬 <b>${name} replied on LinkedIn</b>\n<i>${message.slice(0, 400)}</i>\n\nOpen LinkedIn to respond (AI draft unavailable).`);
    return NextResponse.json({ ok: true, drafted: false });
  }

  const [row] = await db
    .insert(replyDrafts)
    .values({
      prospectId: matched?.id ?? null,
      prospectName: name,
      theirMessage: message,
      draft,
      status: "awaiting",
    })
    .returning({ id: replyDrafts.id });

  await sendTelegram(
    `💬 <b>${name} replied</b>\n<i>${message.slice(0, 400)}</i>\n\n` +
      `✍️ <b>Suggested reply:</b>\n${draft}\n\n` +
      `Reply here: <b>send</b> · <b>pause</b> · or just type your own version.`,
  );

  return NextResponse.json({ ok: true, drafted: true, id: row.id });
}
