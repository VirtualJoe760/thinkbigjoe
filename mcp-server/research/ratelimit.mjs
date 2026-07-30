/**
 * ratelimit.mjs — polite, persistent, restart-proof rate limiting.
 *
 * A run measured in days makes hundreds of thousands of requests to services
 * that are provided free. Two obligations follow, and they point the same way:
 *
 *  1. Don't get the user blocked. Every one of these APIs will throttle or ban a
 *     client that hammers it, and a ban discovered on day three costs the whole
 *     run.
 *  2. Don't be a bad citizen. NCBI, Europe PMC, OpenAlex and Crossref publish
 *     rate guidance and run on public money. Honouring it is the price of using
 *     them.
 *
 * The part that matters for a long run: DAILY QUOTAS PERSIST TO DISK. An
 * in-memory counter resets when the process restarts, so a crash-looping agent
 * would silently blow through a 100/day Google quota several times over and
 * never know. Counters are keyed by UTC date and written to the corpus
 * directory, so a restart resumes the day's budget where it left off.
 *
 * Backoff is exponential with jitter and, on a 429 carrying Retry-After, honours
 * the server's own number rather than guessing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_DIR } from "./corpus.mjs";

/**
 * Per-source limits. `rps` is requests per second; `daily` is a hard ceiling for
 * a UTC day (null = none published). Values follow each service's stated
 * guidance, kept deliberately below the published maximum.
 */
export const LIMITS = {
  pubmed: { rps: () => (process.env.NCBI_API_KEY ? 8 : 2.5), daily: null, note: "NCBI E-utilities: 3/s without a key, 10/s with one. Kept below both." },
  europepmc: { rps: () => 6, daily: null, note: "Europe PMC asks for considerate use; no published hard limit." },
  clinicaltrials: { rps: () => 5, daily: null, note: "ClinicalTrials.gov v2 has no published limit; kept modest." },
  openalex: { rps: () => 8, daily: 90000, note: "OpenAlex polite pool: 10/s and 100k/day with a mailto. Kept under both." },
  crossref: { rps: () => 8, daily: null, note: "Crossref polite pool with a mailto." },
  openfda: { rps: () => 3, daily: 900, note: "openFDA: 240/min and 1000/day without a key." },
  duckduckgo: { rps: () => 0.7, daily: null, note: "No API; the HTML endpoint blocks aggressively. Deliberately slow." },
  google: { rps: () => 2, daily: 95, note: "Programmable Search free tier is 100 queries/day. Stops at 95 to leave headroom." },
  yandex: { rps: () => 1, daily: null, note: "Yandex Cloud Search API is billed per request." },
  baidu: { rps: () => 1, daily: null, note: "Via SerpAPI; billed per search." },
  serpapi: { rps: () => 2, daily: null, note: "Billed per search — the daily ceiling is the plan, not the API." },
  web: { rps: () => 0.7, daily: null, note: "Alias for the web-search fan-out." },
  default: { rps: () => 3, daily: null, note: "Unrecognised source." },
};

const lastCall = new Map(); // source → ms timestamp
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

function quotaFile() {
  if (!existsSync(CORPUS_DIR)) mkdirSync(CORPUS_DIR, { recursive: true });
  return join(CORPUS_DIR, "quota.json");
}

function readQuota() {
  try {
    const q = JSON.parse(readFileSync(quotaFile(), "utf8"));
    return q.date === today() ? q : { date: today(), counts: {} };
  } catch {
    return { date: today(), counts: {} };
  }
}

function writeQuota(q) {
  try {
    writeFileSync(quotaFile(), JSON.stringify(q), "utf8");
  } catch {
    /* a quota-file write failure must not kill a run mid-flight */
  }
}

/** Remaining calls for a source today, or Infinity when no daily cap applies. */
export function remainingToday(source) {
  const lim = LIMITS[source] || LIMITS.default;
  if (!lim.daily) return Infinity;
  return Math.max(0, lim.daily - (readQuota().counts[source] || 0));
}

export function quotaReport() {
  const q = readQuota();
  const out = {};
  for (const [name, lim] of Object.entries(LIMITS)) {
    if (name === "default") continue;
    out[name] = {
      used_today: q.counts[name] || 0,
      daily_cap: lim.daily,
      remaining: lim.daily ? Math.max(0, lim.daily - (q.counts[name] || 0)) : null,
      rps: lim.rps(),
      note: lim.note,
    };
  }
  return { date: q.date, sources: out };
}

/**
 * Wait until it is polite to call `source`, then record the call.
 * Returns { ok } or { ok:false, reason } when the day's quota is spent — the
 * caller must treat that as a logged coverage gap, never as "no results".
 */
export async function acquire(source) {
  const lim = LIMITS[source] || LIMITS.default;

  if (lim.daily) {
    const q = readQuota();
    const used = q.counts[source] || 0;
    if (used >= lim.daily)
      return {
        ok: false,
        reason: `Daily quota for ${source} is spent (${used}/${lim.daily} today, UTC). This is a coverage gap for today, not an absence of results — it resets at 00:00 UTC.`,
      };
    q.counts[source] = used + 1;
    writeQuota(q);
  }

  const minGap = 1000 / lim.rps();
  const last = lastCall.get(source) || 0;
  const wait = last + minGap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(source, Date.now());
  return { ok: true };
}

/**
 * Run `fn` under the limiter with retries. Honours Retry-After on 429, backs off
 * exponentially with jitter on 5xx and transport errors, and gives up after
 * `tries` — returning the error rather than throwing, so one dead source cannot
 * end a multi-day run.
 */
export async function limited(source, fn, { tries = 4, baseDelay = 900 } = {}) {
  const gate = await acquire(source);
  if (!gate.ok) return { ok: false, quota_exhausted: true, error: gate.reason };

  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      const retryAfter = Number(e?.retryAfter);
      const is429 = /\b429\b|too many requests/i.test(msg);
      const is5xx = /\b5\d\d\b|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(msg);
      if (!is429 && !is5xx) return { ok: false, error: msg }; // a 404 will not improve with retries

      const wait = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : baseDelay * 2 ** attempt + Math.random() * 400;
      if (attempt < tries - 1) await sleep(wait);
    }
  }
  return { ok: false, error: String(last?.message || last), exhausted_retries: true };
}
