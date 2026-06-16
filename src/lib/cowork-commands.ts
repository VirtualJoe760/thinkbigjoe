/**
 * Natural-language parser for the Telegram control channel. Joe texts the bot
 * things like "find 30 wealth leads in Texas" or "start prospecting" and this
 * turns them into a structured job the Cowork queue can run.
 *
 * Deliberately keyword-based (no LLM call) so the webhook stays instant and
 * free — the actual lead-finding happens later when a Cowork session drains
 * the queue.
 */

export type CoworkIntent =
  | "find_leads" // expand the prospect DB with a new search
  | "start_prospecting" // begin working the existing qualified queue
  | "status" // report queue + pipeline counts
  | "help"
  | "unknown";

export type Vertical = "insurance" | "mortgage" | "wealth" | "msp" | "law" | "other";

export interface ParsedCommand {
  intent: CoworkIntent;
  vertical: Vertical | null;
  location: string | null;
  count: number | null;
}

const VERTICAL_KEYWORDS: Array<[Vertical, RegExp]> = [
  ["insurance", /\b(insurance|insurer|p&?c|underwrit|brokerage|agencies|agency)\b/i],
  ["mortgage", /\b(mortgage|loan officer|lending|lender|originat)\b/i],
  ["wealth", /\b(wealth|financial advisor|advisor|advisory|r\.?i\.?a\.?|investment manage|retirement plan)\b/i],
  ["msp", /\b(msp|managed service|it service|it provider|it consult|managed it)\b/i],
  ["law", /\b(law|lawyer|attorney|legal|litigation|counsel)\b/i],
];

function parseVertical(text: string): Vertical | null {
  for (const [v, re] of VERTICAL_KEYWORDS) {
    if (re.test(text)) return v;
  }
  return null;
}

function parseCount(text: string): number | null {
  const m = text.match(/\b(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Sanity cap — a single batch shouldn't exceed a reviewable size.
  return Math.min(n, 100);
}

function parseLocation(text: string): string | null {
  // "in Texas", "in the bay area", "near Dallas TX" — capture up to a comma,
  // period, end-of-string, or a *whole-word* connector that starts a new clause.
  // The connector words need \b on both sides so we don't truncate a location
  // that merely contains those letters (e.g. Cali-FOR-nia, Fl-OR-ida).
  const m = text.match(
    /\b(?:in|near|around|across)\s+([a-z][a-z .'-]{1,38}?)(?=\s*[.,]|\s+\b(?:that|who|which|with|for|and|to|so)\b|\s*$)/i,
  );
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

export function parseCommand(raw: string): ParsedCommand {
  const text = (raw || "").trim();
  const lower = text.toLowerCase();

  if (/^\/?(help|commands|\?)\b/.test(lower) || lower === "/start") {
    return { intent: "help", vertical: null, location: null, count: null };
  }
  if (/\b(status|queue|how many|what'?s queued|jobs?)\b/.test(lower)) {
    return { intent: "status", vertical: null, location: null, count: null };
  }

  const vertical = parseVertical(lower);
  const location = parseLocation(text);
  const count = parseCount(lower);

  // "find / get / source / pull / add ... leads / prospects / agencies ..."
  if (/\b(find|get|source|pull|add|expand|grab|look(?:ing)? for|search|scout|research|more)\b/.test(lower) &&
      /\b(lead|prospect|compan|owner|agenc|firm|advisor|broker|client)\b/.test(lower)) {
    return { intent: "find_leads", vertical, location, count };
  }
  // bare "find more" / "more leads" / "find leads"
  if (/\b(more leads|more prospects|find more|leads in|prospects in)\b/.test(lower)) {
    return { intent: "find_leads", vertical, location, count };
  }

  // "start prospecting" / "begin outreach" / "work the queue" / "run a session"
  if (/\b(start|begin|run|kick off|go|work)\b/.test(lower) &&
      /\b(prospect|outreach|session|queue|sequence|drafts?)\b/.test(lower)) {
    return { intent: "start_prospecting", vertical, location, count };
  }

  // A vertical with no verb but clearly a request → treat as find_leads
  if (vertical && /\b(lead|prospect|owner|agenc|firm|advisor)\b/.test(lower)) {
    return { intent: "find_leads", vertical, location, count };
  }

  return { intent: "unknown", vertical, location, count };
}

const VERTICAL_LABEL: Record<Vertical, string> = {
  insurance: "insurance agencies",
  mortgage: "mortgage / lending",
  wealth: "wealth management",
  msp: "MSP / IT services",
  law: "law firms",
  other: "general",
};

export function verticalLabel(v: string | null | undefined): string {
  if (!v) return "general";
  return VERTICAL_LABEL[v as Vertical] || v;
}

/** Human-readable echo of what we understood, for the bot's confirmation reply. */
export function describeCommand(p: ParsedCommand): string {
  const parts: string[] = [];
  parts.push(p.count ? `${p.count}` : "more");
  parts.push(p.vertical ? VERTICAL_LABEL[p.vertical] : "");
  parts.push("leads");
  if (p.location) parts.push(`in ${p.location}`);
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ");
}
