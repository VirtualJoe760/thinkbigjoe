/**
 * Read a Retell agent's call history straight from Retell's API.
 *
 * This is how the admin reviews IVY'S OWN calls — TBJ's receptionist line. Ivy's calls don't flow
 * into our `calls` table the way a customer receptionist's do (her number has no voice_lines row and
 * she runs the sales-concierge tools, not take_message), so the source of truth for "what did Ivy
 * say, what did the caller say" is Retell itself. Read-only, server-only (uses RETELL_API_KEY).
 *
 * Deliberately NOT cached hard: a few calls a day, an admin looking occasionally. A short fetch is
 * fine and always-fresh beats a stale cache for a review surface.
 */

export type RetellCall = {
  id: string;
  fromNumber: string | null;
  toNumber: string | null;
  startedAt: string | null; // ISO
  durationSec: number | null;
  transcript: string | null;
  summary: string | null;
  sentiment: string | null;
  /** Retell's own read of whether the call achieved its goal, when analysed. */
  successful: boolean | null;
  inVoicemail: boolean | null;
};

/** ms-since-epoch → ISO, guarding the 1970 trap (Retell sends milliseconds). */
function iso(ms: unknown): string | null {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * Recent calls for one Retell agent, newest first. Returns [] on any failure rather than throwing —
 * this feeds a dashboard section, and an admin's whole page shouldn't 500 because Retell hiccuped.
 * The caller can show an "unavailable right now" note when it's empty for the wrong reason, but an
 * empty list is a safe default.
 */
export async function listAgentCalls(agentId: string, limit = 20): Promise<RetellCall[]> {
  const key = process.env.RETELL_API_KEY;
  if (!key) {
    console.warn("[retell-calls] RETELL_API_KEY not set — cannot list calls");
    return [];
  }

  try {
    const res = await fetch("https://api.retellai.com/v2/list-calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filter_criteria: { agent_id: [agentId] },
        limit: Math.max(1, Math.min(100, limit)),
        sort_order: "descending",
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.error(`[retell-calls] list-calls ${res.status}`);
      return [];
    }
    const data = await res.json();
    const calls: any[] = Array.isArray(data) ? data : (data.calls ?? []);
    return calls.map((c) => {
      const analysis = c.call_analysis ?? {};
      return {
        id: String(c.call_id ?? ""),
        fromNumber: c.from_number ?? null,
        toNumber: c.to_number ?? null,
        startedAt: iso(c.start_timestamp),
        // duration_ms → seconds; Retell has no seconds field.
        durationSec:
          typeof c.duration_ms === "number" ? Math.round(c.duration_ms / 1000) : null,
        transcript: typeof c.transcript === "string" && c.transcript.trim() ? c.transcript : null,
        summary: analysis.call_summary ?? null,
        sentiment: analysis.user_sentiment ?? null,
        successful: typeof analysis.call_successful === "boolean" ? analysis.call_successful : null,
        inVoicemail: typeof analysis.in_voicemail === "boolean" ? analysis.in_voicemail : null,
      } satisfies RetellCall;
    });
  } catch (err) {
    console.error("[retell-calls] fetch failed:", err);
    return [];
  }
}
