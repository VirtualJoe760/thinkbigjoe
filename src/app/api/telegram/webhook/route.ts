import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";

import { db, coworkJobs, prospects, outreach, replyDrafts } from "@/db";
import { sendTelegram, adminChatId } from "@/lib/telegram";
import { parseCommand, describeCommand, verticalLabel } from "@/lib/cowork-commands";

export const dynamic = "force-dynamic";

/**
 * Inbound Telegram control channel. Joe texts @thinkbigjoe_alerts_bot and this
 * turns natural commands into queued Cowork jobs. It never *runs* prospecting
 * itself — it queues intent + confirms instantly. A Cowork session drains the
 * queue (LinkedIn-sourced work stays supervised; web-sourced can run autonomously).
 *
 * Security: only the configured admin chat may issue commands, AND Telegram
 * must present the secret header we set via setWebhook.
 */
export async function POST(req: Request) {
  // 1. Verify the request actually came from Telegram (secret token header).
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) {
      return NextResponse.json({ ok: true }, { status: 200 }); // silent ignore
    }
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = (update.message || update.edited_message) as
    | { text?: string; chat?: { id?: number | string } }
    | undefined;
  const text = message?.text?.trim();
  const fromChat = message?.chat?.id != null ? String(message.chat.id) : undefined;

  // 2. Only Joe's chat may command the bot. Anything else is silently ignored.
  if (!text || !fromChat || fromChat !== adminChatId()) {
    return NextResponse.json({ ok: true });
  }

  const cmd = parseCommand(text);

  try {
    if (cmd.intent === "help") {
      await sendTelegram(HELP_TEXT, fromChat);
      return NextResponse.json({ ok: true });
    }

    if (cmd.intent === "status") {
      await sendTelegram(await buildStatus(), fromChat);
      return NextResponse.json({ ok: true });
    }

    if (cmd.intent === "find_leads") {
      const [job] = await db
        .insert(coworkJobs)
        .values({
          source: "telegram",
          rawCommand: text,
          intent: "find_leads",
          vertical: cmd.vertical,
          location: cmd.location,
          targetCount: cmd.count,
          status: "queued",
        })
        .returning({ id: coworkJobs.id });

      await sendTelegram(
        `✅ <b>Queued job #${job.id}</b>\nFind ${describeCommand(cmd)}.\n\n` +
          `I'll work it in the next Cowork session and add new prospects to your queue — ` +
          `you'll review them in /command. I'll ping you when it's done.`,
        fromChat,
      );
      return NextResponse.json({ ok: true });
    }

    if (cmd.intent === "start_prospecting") {
      const [job] = await db
        .insert(coworkJobs)
        .values({
          source: "telegram",
          rawCommand: text,
          intent: "start_prospecting",
          vertical: cmd.vertical,
          location: cmd.location,
          targetCount: cmd.count,
          status: "queued",
        })
        .returning({ id: coworkJobs.id });

      await sendTelegram(
        `✅ <b>Queued job #${job.id}</b>\nStart prospecting` +
          (cmd.vertical ? ` — ${verticalLabel(cmd.vertical)}` : "") +
          `.\n\nWhen a Cowork session is live I'll work the qualified queue at human pace ` +
          `(LinkedIn sends stay supervised). Every reply pauses + pings you here.`,
        fromChat,
      );
      return NextResponse.json({ ok: true });
    }

    // Reply-action: if a drafted reply is awaiting Joe's call, this message
    // steers it — "send" to post the draft, "pause" to mute, or any other text
    // becomes his edited version to send.
    const pending = (
      await db
        .select()
        .from(replyDrafts)
        .where(eq(replyDrafts.status, "awaiting"))
        .orderBy(desc(replyDrafts.createdAt))
        .limit(1)
    )[0];
    if (pending) {
      const lower = text.toLowerCase();
      if (/^(send|yes|go|approve|ok|sure|send it)\b/.test(lower)) {
        await db.update(replyDrafts).set({ status: "approved", finalText: pending.draft, updatedAt: new Date().toISOString() }).where(eq(replyDrafts.id, pending.id));
        await sendTelegram(`✅ Queued to send to <b>${pending.prospectName}</b>. The sender will post it shortly.`, fromChat);
        return NextResponse.json({ ok: true });
      }
      if (/^(pause|skip|stop|hold|mute|ignore|no)\b/.test(lower)) {
        await db.update(replyDrafts).set({ status: "paused", updatedAt: new Date().toISOString() }).where(eq(replyDrafts.id, pending.id));
        if (pending.prospectId) {
          await db.update(prospects).set({ paused: true, updatedAt: new Date().toISOString() }).where(eq(prospects.id, pending.prospectId));
        }
        await sendTelegram(`⏸ Paused <b>${pending.prospectName}</b> — nothing sent, that conversation is muted.`, fromChat);
        return NextResponse.json({ ok: true });
      }
      // Anything else = Joe's own version of the reply.
      await db.update(replyDrafts).set({ status: "approved", finalText: text, updatedAt: new Date().toISOString() }).where(eq(replyDrafts.id, pending.id));
      await sendTelegram(`✅ Got it — I'll send your version to <b>${pending.prospectName}</b>:\n<i>${text.slice(0, 400)}</i>`, fromChat);
      return NextResponse.json({ ok: true });
    }

    // Unknown — guide Joe to the grammar.
    await sendTelegram(
      `I didn't quite catch that. Try:\n` +
        `• <code>find 25 insurance leads in California</code>\n` +
        `• <code>find more wealth leads</code>\n` +
        `• <code>start prospecting</code>\n` +
        `• <code>status</code>`,
      fromChat,
    );
  } catch (err) {
    console.error("[telegram/webhook] failed:", err);
    await sendTelegram(
      "⚠️ Something went wrong queuing that — it's logged. Try again in a moment.",
      fromChat,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

const HELP_TEXT =
  `<b>ThinkBigJoe Alerts — commands</b>\n\n` +
  `🔎 <b>Find leads</b> (expands your prospect DB):\n` +
  `• <code>find 30 wealth leads in Texas</code>\n` +
  `• <code>find more insurance agencies</code>\n` +
  `• <code>find law firms in Florida</code>\n\n` +
  `🚀 <b>Start prospecting</b> (works the existing queue):\n` +
  `• <code>start prospecting</code>\n` +
  `• <code>start prospecting insurance</code>\n\n` +
  `📊 <code>status</code> — queue + pipeline counts\n` +
  `❓ <code>help</code> — this message\n\n` +
  `Verticals: insurance · mortgage · wealth · MSP/IT · law.\n` +
  `I queue jobs instantly; they run in a Cowork session and I ping you when done.`;

async function buildStatus(): Promise<string> {
  const [queued, prospectCount, draftCount, recent] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(coworkJobs)
      .where(eq(coworkJobs.status, "queued")),
    db.select({ n: sql<number>`count(*)::int` }).from(prospects),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(outreach)
      .where(eq(outreach.status, "draft")),
    db
      .select()
      .from(coworkJobs)
      .orderBy(desc(coworkJobs.createdAt))
      .limit(3),
  ]);

  const lines = [
    `📊 <b>Status</b>`,
    `• Jobs queued: <b>${queued[0]?.n ?? 0}</b>`,
    `• Prospects in DB: <b>${prospectCount[0]?.n ?? 0}</b>`,
    `• Drafts awaiting review: <b>${draftCount[0]?.n ?? 0}</b>`,
  ];
  if (recent.length) {
    lines.push(``, `<b>Recent jobs</b>`);
    for (const j of recent) {
      const desc =
        j.intent === "find_leads"
          ? `find ${j.targetCount || "more"} ${verticalLabel(j.vertical)}${j.location ? ` in ${j.location}` : ""}`
          : j.intent;
      lines.push(`#${j.id} · ${desc} · <i>${j.status}</i>`);
    }
  }
  return lines.join("\n");
}
