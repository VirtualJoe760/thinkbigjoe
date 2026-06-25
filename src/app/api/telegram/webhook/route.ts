import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";

import { db, prospects, outreach, replyDrafts, activityLog } from "@/db";
import { sendTelegram, adminChatId } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Inbound Telegram control channel. Joe texts @thinkbigjoe_alerts_bot and this
 * either responds with pipeline status, handles reply-draft approvals, or
 * acknowledges scouting/prospecting requests that Venus handles automatically
 * via her OpenClaw crons (scout at 2am, outreach every hour).
 *
 * Security: only the configured admin chat may issue commands, AND Telegram
 * must present the secret header we set via setWebhook.
 */

// ---------------------------------------------------------------------------
// Minimal intent parser — just enough to give a sensible reply
// ---------------------------------------------------------------------------
const VERTICAL_KEYWORDS: [string, RegExp][] = [
  ["insurance", /\b(insurance|insurer|p&?c|underwrit|brokerage|agencies|agency)\b/i],
  ["mortgage", /\b(mortgage|loan officer|lending|lender|originat)\b/i],
  ["wealth", /\b(wealth|financial advisor|advisory|r\.?i\.?a\.?|investment manage|retirement plan)\b/i],
  ["msp", /\b(msp|managed service|it service|it provider|it consult|managed it)\b/i],
  ["law", /\b(law|lawyer|attorney|legal|litigation|counsel)\b/i],
];

const VERTICAL_LABEL: Record<string, string> = {
  insurance: "insurance agencies",
  mortgage: "mortgage / lending",
  wealth: "wealth management",
  msp: "MSP / IT services",
  law: "law firms",
};

function parseVertical(text: string) {
  for (const [v, re] of VERTICAL_KEYWORDS) if (re.test(text)) return v;
  return null;
}

function parseCount(text: string) {
  const m = text.match(/\b(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : null;
}

function parseLocation(text: string) {
  const m = text.match(
    /\b(?:in|near|around|across)\s+([a-z][a-z .'-]{1,38}?)(?=\s*[.,]|\s+\b(?:that|who|which|with|for|and|to|so)\b|\s*$)/i,
  );
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

type Intent = "help" | "status" | "find_leads" | "start_prospecting" | "unknown";

function parseIntent(raw: string): { intent: Intent; vertical: string | null; location: string | null; count: number | null } {
  const lower = raw.toLowerCase();
  if (/^\/?(help|commands|\?)\b/.test(lower) || lower === "/start")
    return { intent: "help", vertical: null, location: null, count: null };
  if (/\b(status|pipeline|how many|what'?s queued|queue)\b/.test(lower))
    return { intent: "status", vertical: null, location: null, count: null };
  const vertical = parseVertical(lower);
  const location = parseLocation(raw);
  const count = parseCount(lower);
  if (
    /\b(find|get|source|pull|add|expand|grab|look(?:ing)? for|search|scout|research|more)\b/.test(lower) &&
    /\b(lead|prospect|compan|owner|agenc|firm|advisor|broker|client)\b/.test(lower)
  ) return { intent: "find_leads", vertical, location, count };
  if (/\b(more leads|more prospects|find more|leads in|prospects in)\b/.test(lower))
    return { intent: "find_leads", vertical, location, count };
  if (
    /\b(start|begin|run|kick off|go|work)\b/.test(lower) &&
    /\b(prospect|outreach|session|queue|sequence|drafts?)\b/.test(lower)
  ) return { intent: "start_prospecting", vertical, location, count };
  if (vertical && /\b(lead|prospect|owner|agenc|firm|advisor)\b/.test(lower))
    return { intent: "find_leads", vertical, location, count };
  return { intent: "unknown", vertical, location, count };
}

// ---------------------------------------------------------------------------
// Status query — Venus-native metrics, no cowork_jobs
// ---------------------------------------------------------------------------
async function buildStatus(): Promise<string> {
  const [prospectCount, draftCount, approvedCount, sentWeek, followupsDue, recentActivity] =
    await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(prospects),
      db.select({ n: sql<number>`count(*)::int` }).from(outreach).where(eq(outreach.status, "draft")),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(outreach)
        .where(sql`step = 'connection' AND status = 'approved'`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(outreach)
        .where(sql`status = 'sent' AND sent_at > now() - interval '7 days'`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(sql`follow_ups` as unknown as typeof outreach)
        .where(sql`status = 'pending' AND scheduled_for <= now()`),
      db
        .select({ eventType: activityLog.eventType, summary: activityLog.summary, createdAt: activityLog.createdAt })
        .from(activityLog)
        .orderBy(desc(activityLog.createdAt))
        .limit(3),
    ]);

  const lines = [
    `📊 <b>Venus pipeline</b>`,
    `• Prospects in DB: <b>${prospectCount[0]?.n ?? 0}</b>`,
    `• Drafts awaiting your review: <b>${draftCount[0]?.n ?? 0}</b>`,
    `• Approved and ready to send: <b>${approvedCount[0]?.n ?? 0}</b>`,
    `• Sent this week: <b>${sentWeek[0]?.n ?? 0}</b>`,
    `• Follow-ups due: <b>${followupsDue[0]?.n ?? 0}</b>`,
  ];
  if (recentActivity.length) {
    lines.push(``, `<b>Recent activity</b>`);
    for (const a of recentActivity) {
      lines.push(`• ${a.summary}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) return NextResponse.json({ ok: true }, { status: 200 });
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

  if (!text || !fromChat || fromChat !== adminChatId()) {
    return NextResponse.json({ ok: true });
  }

  const cmd = parseIntent(text);

  try {
    // Help
    if (cmd.intent === "help") {
      await sendTelegram(HELP_TEXT, fromChat);
      return NextResponse.json({ ok: true });
    }

    // Status
    if (cmd.intent === "status") {
      await sendTelegram(await buildStatus(), fromChat);
      return NextResponse.json({ ok: true });
    }

    // Scout request — Venus handles this automatically on her 2am cron
    if (cmd.intent === "find_leads") {
      const vertLabel = cmd.vertical ? VERTICAL_LABEL[cmd.vertical] ?? cmd.vertical : "your target verticals";
      const countHint = cmd.count ? `${cmd.count} ` : "";
      const locHint = cmd.location ? ` in ${cmd.location}` : "";
      await sendTelegram(
        `🔍 <b>Noted.</b> Venus will scout ${countHint}${vertLabel}${locHint} in her next run tonight at 2am — new prospects land in your review queue and I'll ping you when she's done.\n\nReview queue: thinkbigjoe.com/command`,
        fromChat,
      );
      return NextResponse.json({ ok: true });
    }

    // Outreach request — Venus's hourly cron handles the queue
    if (cmd.intent === "start_prospecting") {
      const vertLabel = cmd.vertical ? ` (${VERTICAL_LABEL[cmd.vertical] ?? cmd.vertical})` : "";
      await sendTelegram(
        `📤 <b>Venus is on it${vertLabel}.</b> She sends approved connections every hour automatically and pings you after each batch.\n\nApprove pending drafts at: thinkbigjoe.com/command`,
        fromChat,
      );
      return NextResponse.json({ ok: true });
    }

    // Reply-draft handling — Joe sends/pauses/edits a pending reply
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
        await db
          .update(replyDrafts)
          .set({ status: "approved", finalText: pending.draft, updatedAt: new Date().toISOString() })
          .where(eq(replyDrafts.id, pending.id));
        await sendTelegram(
          `✅ Approved — Venus will send to <b>${pending.prospectName}</b> in her next outreach window.`,
          fromChat,
        );
        return NextResponse.json({ ok: true });
      }
      if (/^(pause|skip|stop|hold|mute|ignore|no)\b/.test(lower)) {
        await db
          .update(replyDrafts)
          .set({ status: "paused", updatedAt: new Date().toISOString() })
          .where(eq(replyDrafts.id, pending.id));
        if (pending.prospectId) {
          await db
            .update(prospects)
            .set({ paused: true, updatedAt: new Date().toISOString() })
            .where(eq(prospects.id, pending.prospectId));
        }
        await sendTelegram(
          `⏸ Paused <b>${pending.prospectName}</b> — nothing sent, that conversation is muted.`,
          fromChat,
        );
        return NextResponse.json({ ok: true });
      }
      // Joe's own reply text
      await db
        .update(replyDrafts)
        .set({ status: "approved", finalText: text, updatedAt: new Date().toISOString() })
        .where(eq(replyDrafts.id, pending.id));
      await sendTelegram(
        `✅ Got it — Venus will send your version to <b>${pending.prospectName}</b>:\n<i>${text.slice(0, 400)}</i>`,
        fromChat,
      );
      return NextResponse.json({ ok: true });
    }

    // Unknown
    await sendTelegram(
      `I didn't catch that. Try:\n` +
        `• <code>status</code> — pipeline snapshot\n` +
        `• <code>find 25 insurance leads in California</code> — queue for Venus's next scout\n` +
        `• <code>start prospecting</code> — Venus sends hourly, just make sure drafts are approved\n` +
        `• <code>help</code> — this message`,
      fromChat,
    );
  } catch (err) {
    console.error("[telegram/webhook] failed:", err);
    await sendTelegram(
      "⚠️ Something went wrong — it's logged. Try again in a moment.",
      fromChat,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

const HELP_TEXT =
  `<b>ThinkBigJoe — Venus commands</b>\n\n` +
  `📊 <code>status</code> — live pipeline snapshot\n\n` +
  `🔍 <b>Scout new leads</b> (Venus picks them up tonight at 2am):\n` +
  `• <code>find 30 wealth leads in Texas</code>\n` +
  `• <code>find more insurance agencies</code>\n` +
  `• <code>find law firms in Florida</code>\n\n` +
  `📤 <b>Send connections</b> (Venus runs every hour automatically):\n` +
  `• <code>start prospecting</code> — approve drafts at /command and she'll send them\n\n` +
  `💬 <b>Reply drafts</b> — when Venus flags a warm reply, text back:\n` +
  `• <code>send</code> or <code>yes</code> — post the AI draft\n` +
  `• <code>pause</code> — mute that thread\n` +
  `• Anything else — Venus sends your version instead\n\n` +
  `Verticals: insurance · mortgage · wealth · MSP/IT · law\n` +
  `Review queue: thinkbigjoe.com/command`;
