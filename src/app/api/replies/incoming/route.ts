import { NextResponse } from "next/server";
import { or, eq, ilike, asc } from "drizzle-orm";

import { db, prospects, replyDrafts, conversations } from "@/db";
import { draftReply, type ConversationMessage } from "@/lib/draft-reply";
import { sendTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Venus (or any authorized caller) POSTs a detected LinkedIn reply here.
 * We match the prospect, save the inbound message to conversations, update
 * prospect status to 'replied', fetch prior thread for context, draft a
 * response with full history, store the draft, and Telegram Joe.
 * Bearer-protected with COWORK_RUNNER_TOKEN.
 */
function authed(req: Request): boolean {
  const expected = process.env.COWORK_RUNNER_TOKEN;
  if (!expected) return false;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") === expected;
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; profileUrl?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const message = (body.message || "").trim();
  if (!name || !message) {
    return NextResponse.json({ error: "name + message required" }, { status: 400 });
  }

  // Match the prospect by profile URL then name.
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

  // Save the inbound message to the conversation thread.
  if (matched) {
    await db.insert(conversations).values({
      prospectId: matched.id,
      direction: "inbound",
      body: message,
      platform: "linkedin",
    });

    // Move prospect to 'replied' status if they aren't already further along.
    const skipStatuses = ["invited", "prepped", "meeting", "won", "lost", "disqualified"];
    if (!skipStatuses.includes(String(matched.status))) {
      await db
        .update(prospects)
        .set({ status: "replied", updatedAt: new Date().toISOString() })
        .where(eq(prospects.id, matched.id));
    }
  }

  // Fetch prior conversation for context.
  const history: ConversationMessage[] = matched
    ? (
        await db
          .select({ direction: conversations.direction, body: conversations.body })
          .from(conversations)
          .where(eq(conversations.prospectId, matched.id))
          .orderBy(asc(conversations.createdAt))
          .limit(20)
      ).map((r) => ({ direction: r.direction as "inbound" | "outbound", body: r.body }))
    : [];

  const label = matched
    ? `${matched.name}${matched.title ? ` — ${matched.title}` : ""}${matched.company ? `, ${matched.company}` : ""}${matched.vertical ? ` (${matched.vertical})` : ""}`
    : name;

  const draft = await draftReply({ prospect: label, theirMessage: message, history });

  if (!draft) {
    await sendTelegram(
      `💬 <b>${name} replied on LinkedIn</b>\n<i>${message.slice(0, 400)}</i>\n\nOpen LinkedIn to respond (AI draft unavailable).`,
    );
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

  const profileLink = matched?.profileUrl
    ? `\n🔗 <a href="${matched.profileUrl}">LinkedIn profile</a>`
    : "";
  const reviewLink = matched
    ? `\n📋 Review: thinkbigjoe.com/command/${matched.id}`
    : "";

  await sendTelegram(
    `💬 <b>${name} replied</b>${matched?.company ? ` · ${matched.company}` : ""}\n` +
      `<i>${message.slice(0, 300)}</i>\n\n` +
      `✍️ <b>Suggested reply:</b>\n${draft}` +
      profileLink +
      reviewLink +
      `\n\nReply here: <b>send</b> · <b>pause</b> · or type your own version.`,
  );

  return NextResponse.json({ ok: true, drafted: true, id: row.id });
}
