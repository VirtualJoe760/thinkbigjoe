/**
 * Read a Retell agent's call history straight from Retell's API.
 *
 * SINCE 2026-07-25 this is a BACKFILL/DIAGNOSTIC helper, not the review path: Ivy's agent now has a
 * webhook_url, her line has a voice_lines row on the internal TBJ site (1395), and her calls persist
 * to the `calls` table with Blob-hosted recordings like any tenant's (see api/voice/webhook +
 * scripts/backfill-ivy-calls.mjs). The dashboard reads the DB. Read-only, server-only.
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
