import { sql } from "drizzle-orm";

import { db } from "@/db";

/**
 * The SMS reply agent — a casual, human texter that answers prospects who reply to
 * our first-touch, and books them a call. Runs on Gemini with function-calling; the
 * booking tools reuse the SAME voice endpoints Ivy uses (/api/voice/availability,
 * /api/voice/book), so there's one booking path. Driven from the inbound SMS webhook.
 */
const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
const MODEL = process.env.GEMINI_SMS_MODEL || "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://thinkbigjoe.com";
const VOICE_SECRET = process.env.RETELL_WEBHOOK_SECRET;

export function isSmsAgentConfigured(): boolean {
  return Boolean(KEY);
}

export type SmsProspect = {
  id: number;
  businessName: string;
  ownerName: string | null;
  claimCode: string | null;
  site: string;
  phone: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Part = Record<string, any>;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "check_availability",
        description:
          "Get real open 30-minute call slots (Mon–Fri, Pacific). Call this BEFORE offering any times — never invent times.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "book_call",
        description:
          "Book the 30-minute call once you have the person's name, email, and a chosen slot's exact start time from check_availability.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "The person's full name." },
            email: { type: "STRING", description: "Their email (confirm spelling if unsure)." },
            start_time: { type: "STRING", description: "The exact ISO 'start' value from check_availability." },
          },
          required: ["name", "email", "start_time"],
        },
      },
    ],
  },
];

async function callVoice(path: string, body: object): Promise<Record<string, unknown>> {
  if (!VOICE_SECRET) return { error: "booking not configured" };
  try {
    const r = await fetch(`${SITE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VOICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    return (await r.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function execTool(name: string, args: Record<string, unknown>, p: SmsProspect): Promise<Record<string, unknown>> {
  if (name === "check_availability") {
    const r = await callVoice("/api/voice/availability", { type: "regular" });
    return { message: r.message ?? null, slots: r.slots ?? [] };
  }
  if (name === "book_call") {
    const r = await callVoice("/api/voice/book", {
      name: args.name,
      email: args.email,
      start_time: args.start_time,
      phone: p.phone,
      type: "regular",
      reason: `SMS lead — ${p.businessName}`,
    });
    return { booked: r.booked ?? false, message: r.message ?? null };
  }
  return { error: "unknown tool" };
}

/** Prior turns for this prospect (their texts + ours), oldest → newest, for context. */
async function historyTurns(siteId: number): Promise<Array<{ role: string; parts: Part[] }>> {
  const rows = (
    await db.execute(sql`
      SELECT event_type AS et, metadata->'detail'->>'note' AS note
      FROM activity_log
      WHERE event_type IN ('sms_outreach_sent','sms_inbound','sms_outbound')
        AND (metadata->'detail'->>'siteId') = ${String(siteId)}
      ORDER BY created_at ASC
      LIMIT 24`)
  ).rows as Array<{ et: string; note: string | null }>;
  return rows
    .filter((r) => r.note)
    .map((r) => ({ role: r.et === "sms_inbound" ? "user" : "model", parts: [{ text: String(r.note) }] }));
}

/**
 * Generate the agent's next text back to a prospect. Returns the message to send,
 * or null if not configured / it produced nothing.
 */
export async function smsAgentReply(p: SmsProspect, incoming: string): Promise<string | null> {
  if (!KEY) return null;

  const system = `You're texting a local business owner on behalf of ThinkBigJoe — an agency that builds websites and AI tools for local businesses. Text like a real, warm, casual human — NOT a robot, NOT corporate. Every message SHORT: 1–2 sentences, lowercase-friendly, no hard sell. Never claim to be a specific named person and never use a fake name.

What's true: we already built ${p.businessName} a free website — ${p.site}. They can make it theirs by creating a free account at https://thinkbigjoe.com and claiming it with code ${p.claimCode || "(their claim code)"}.

When you share a link, always paste the FULL url exactly as given, including the "https://" — e.g. "${p.site}", never a shortened "thinkbigjoe.com/…". Full urls are what make it a tappable, clickable link in their texts.

Your goal: get them onto a quick 30-minute call with Joe to walk through the site and how the AI can help.

How to book — this is important:
- The MOMENT they show any interest in talking or a call, do NOT ask an open-ended "what day/time works?". Instead call check_availability first, then propose the SOONEST specific open slot in a friendly way, e.g. "awesome — does tomorrow at 10am work? i've also got 11 if that's better".
- Our call hours are 10am–5pm Pacific, Monday–Friday, with a lunch break at noon. Only ever offer real times returned by check_availability — never invent a time.
- If THEY suggest a day/time, call check_availability and book the matching open slot (or gently offer the closest open one if theirs is taken).
- Offer just 1–2 concrete times at a time so it feels human, not like a menu.
- Once they pick a time, get their name + email, then call book_call. After it books, confirm warmly and tell them a calendar invite is on the way.

We open with a voicemail + a text, so they already have the site link. The moment they reply with any interest, hand over their claim code (${p.claimCode || "their claim code"}) so they can create a free account at https://thinkbigjoe.com and claim the site — then steer toward a quick call to make changes and take it live. If they're not interested or say stop, be gracious and back off.`;

  const contents: Array<{ role: string; parts: Part[] }> = [
    ...(await historyTurns(p.id)),
    { role: "user", parts: [{ text: incoming }] },
  ];

  for (let i = 0; i < 5; i++) {
    let json: { candidates?: Array<{ content?: { parts?: Part[] } }> };
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: TOOLS,
          generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      json = await res.json();
    } catch {
      return null;
    }
    const parts: Part[] = json?.candidates?.[0]?.content?.parts ?? [];
    const fnPart = parts.find((x) => x.functionCall);
    if (fnPart) {
      const result = await execTool(fnPart.functionCall.name, fnPart.functionCall.args || {}, p);
      // Preserve the whole model part (incl. thoughtSignature), then the tool result.
      contents.push({ role: "model", parts: [fnPart] });
      contents.push({ role: "function", parts: [{ functionResponse: { name: fnPart.functionCall.name, response: result } }] });
      continue;
    }
    const text = parts
      .map((x) => (typeof x.text === "string" ? x.text : ""))
      .join("")
      .trim();
    return text || null;
  }
  return null;
}
