/**
 * Incident reporting — the thing that turns a silent 2am failure into a Telegram Joe actually sees.
 *
 * The audit found the whole app has no error tracking: every failure path ends at console.error in
 * Vercel logs nobody reads, so a customer's dead phone line is discovered when the customer calls
 * Joe — and per the same audit, the customer's escalation path may not reach him either.
 *
 * This is deliberately NOT Sentry. Sentry is the right tool at scale, but it needs an account, a
 * DSN, and a per-event quota, and at <20 customers a Telegram ping to the phone Joe already watches
 * is both simpler and more likely to be read. When call volume makes Telegram noisy, swap the
 * transport here — every caller goes through reportIncident(), so it's a one-file change.
 *
 * WHAT TO REPORT. Only things a human must act on: a customer's line is misconfigured, a payment
 * webhook threw, a call couldn't be persisted. NOT routine 4xx, NOT an unknown caller, NOT a
 * validation bounce — those are normal and would train Joe to ignore the channel, which is the same
 * failure mode as no alerting at all.
 */
import { notifyTelegram } from "@/lib/telegram";

export type IncidentSeverity = "critical" | "warn";

/**
 * Per-key throttle so a broken loop can't fire a thousand identical alerts. In-memory and therefore
 * per-serverless-instance — a deliberate floor, not a guarantee: it's enough to stop a hot loop
 * within one invocation, and the alerts worth sending (cron summaries, a webhook that threw once)
 * don't repeat fast enough for cross-instance dedupe to matter.
 */
const lastSent = new Map<string, number>();
const THROTTLE_MS = 5 * 60_000;

function throttled(key: string): boolean {
  const now = Date.now();
  const prev = lastSent.get(key) ?? 0;
  if (now - prev < THROTTLE_MS) return true;
  lastSent.set(key, now);
  if (lastSent.size > 500) lastSent.clear(); // crude ceiling; this is a backstop, not a store
  return false;
}

/**
 * Report an incident. Always logs; alerts unless throttled. Never throws — a monitor that can crash
 * the thing it monitors is worse than no monitor, so the Telegram send is caught and swallowed.
 *
 * `dedupeKey` collapses repeats: pass something stable per failure mode (e.g. `voice-inbound-throw`)
 * so a storm of the same error is one alert, not hundreds.
 */
export async function reportIncident(
  severity: IncidentSeverity,
  message: string,
  opts: { dedupeKey?: string; detail?: unknown } = {},
): Promise<void> {
  const tag = severity === "critical" ? "🔴 CRITICAL" : "🟠";
  console.error(`[incident:${severity}] ${message}`, opts.detail ?? "");

  const key = opts.dedupeKey ?? message;
  if (throttled(key)) return;

  try {
    const detailLine =
      opts.detail !== undefined ? `\n<code>${String(safeDetail(opts.detail)).slice(0, 300)}</code>` : "";
    await notifyTelegram(`${tag} <b>${escapeHtml(message)}</b>${detailLine}`);
  } catch (err) {
    // The alert transport itself failed. Nothing left to do but log — do NOT rethrow into the
    // caller's error path, which is usually already handling a failure.
    console.error("[incident] failed to send alert:", err);
  }
}

function safeDetail(d: unknown): string {
  if (d instanceof Error) return `${d.name}: ${d.message}`;
  if (typeof d === "string") return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
