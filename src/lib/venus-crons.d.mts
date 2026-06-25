// Type declarations for the plain-JS Venus cron manifest (venus-crons.mjs).
// Keeps the manifest importable by both Node scripts and the typed Next.js app.

export interface VenusCron {
  /** Human-readable job name. Unique — used as the sync match key. */
  name: string;
  /** OpenClaw cron UUID (for reference; sync matches by name). */
  id: string;
  /** 5-field cron expression. */
  schedule: string;
  /** Stagger window (e.g. "5m") or "exact" for no stagger. */
  stagger: string;
  /** One-line description of what this cron does. */
  summary: string;
  /** MCP tools this cron calls (must exist in mcp-server/tbj-mcp.mjs). */
  tools: string[];
  /** UI surfaces this cron's output feeds. */
  uiSurface: string[];
  /** activity_log event_type values this cron emits (for last-run lookup). */
  eventTypes: string[];
  /** The exact system-event prompt Venus runs. */
  prompt: string;
}

export const VENUS_CRONS: VenusCron[];
export default VENUS_CRONS;
