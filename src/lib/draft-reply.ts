/**
 * Drafts a humble, on-tone LinkedIn reply for Joe using the Anthropic API.
 * No-ops (returns null) without ANTHROPIC_API_KEY so nothing breaks; callers
 * fall back to a notify-only ping. Tone validated 2026-06-17.
 */
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_DRAFT_MODEL || "claude-sonnet-4-6";

const SYSTEM = `You draft short LinkedIn replies as Joe Sardella, founder of ThinkBigJoe — an AI consulting studio that builds agentic software and MCP integrations for businesses (focus: finance, insurance, healthcare, real estate). Joe is also a software engineer and realtor.

Voice: humble, grateful, genuinely curious, warm, concise — like a real person, not a salesperson. The goal is to EARN A REAL CONVERSATION, never to pitch. Rules:
- 1–3 short sentences. No corporate speak, no buzzword salad, no hard sell.
- Don't pitch services unprompted. If they ask what you do, answer plainly and briefly, then ask ONE genuine question about THEIR work/business.
- Match their energy; mirror emojis only if they used them.
- Sound like Joe texting a peer, not a vendor.
Output ONLY the reply text — no preamble, no quotes.`;

export function isDraftingConfigured(): boolean {
  return Boolean(KEY);
}

export async function draftReply(opts: {
  prospect: string; // "Name — Title, Company (vertical)"
  theirMessage: string;
}): Promise<string | null> {
  if (!KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Prospect: ${opts.prospect}\nThey just replied to me on LinkedIn:\n"""${opts.theirMessage}"""\n\nDraft my reply.`,
          },
        ],
      }),
    });
    if (!r.ok) {
      console.error("[draft-reply] API error:", r.status, await r.text().catch(() => ""));
      return null;
    }
    const j = (await r.json()) as { content?: { text?: string }[] };
    return j.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("[draft-reply] error:", err);
    return null;
  }
}
