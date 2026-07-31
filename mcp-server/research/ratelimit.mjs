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
  europepmc: { rps: () => 3, daily: null, note: "Europe PMC asks for considerate use; no published hard limit. Kept slow on principle." },
  clinicaltrials: { rps: () => 5, daily: null, note: "ClinicalTrials.gov v2 has no published limit; kept modest." },
  // OpenAlex now bills per request against a daily allowance: exceeding it
  // returns {"error":"Rate limit exceeded","message":"Insufficient budget …
  // Resets at midnight UTC"} with a retryAfter of several hours. That is a
  // budget, not a rate — pacing cannot fix it, only stopping can.
  openalex: { rps: () => 2, daily: 900, note: "Billed per request against a daily allowance that resets at midnight UTC. Kept well under it; when it is spent the breaker holds off until reset." },
  cyberleninka: { rps: () => 1, daily: null, note: "Russian open-access library, keyless search API. Kept gentle." },
  crossref: { rps: () => 4, daily: null, note: "Crossref polite pool with a mailto." },
  openfda: { rps: () => 3, daily: 900, note: "openFDA: 240/min and 1000/day without a key." },
  duckduckgo: { rps: () => 0.5, daily: null, note: "No API; the HTML endpoint throttles aggressively and answers a challenge page rather than a 429. One request every two seconds, and a challenge page counts as a refusal so the breaker sees it." },
  google: { rps: () => 2, daily: 95, note: "Programmable Search free tier is 100 queries/day. Stops at 95 to leave headroom." },
  yandex: { rps: () => 1, daily: null, note: "Yandex Cloud Search API is billed per request." },
  baidu: { rps: () => 1, daily: null, note: "Via SerpAPI; billed per search." },
  serpapi: { rps: () => 2, daily: null, note: "Billed per search — the daily ceiling is the plan, not the API." },
  marginalia: { rps: () => 0.4, daily: null, note: "Small volunteer-run index, free public API. Kept deliberately gentle — it throttles quickly and it is a courtesy to a volunteer service." },
  web: { rps: () => 1.5, daily: null, note: "Arbitrary pages fetched by read_source, and the web fan-out." },
  default: { rps: () => 3, daily: null, note: "Unrecognised source." },
};

const lastCall = new Map(); // source → ms timestamp

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------
//
// Retries alone are not enough over a multi-day run. When a source starts
// refusing — a temporary throttle, an outage, an anomaly page — retrying it on
// every subsequent call turns one bad minute into thousands of hostile requests,
// which is how a temporary throttle becomes a durable block.
//
// So consecutive failures open a circuit for that source: further calls return
// immediately with a structured "cooling down" result the caller logs as a
// coverage gap, and the cooldown grows with each additional failure round.
// One success closes it.
//
// State persists to the quota file, so a crash-looping process cannot reset the
// breaker and resume hammering a source that just asked it to stop.

const BREAKER_TRIP_AFTER = Number(process.env.RESEARCH_BREAKER_TRIP || 2);
const BREAKER_COOLDOWNS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

const breakers = new Map(); // source → { fails, openUntil }

function breakerState(source) {
  if (!breakers.has(source)) {
    const persisted = readQuota().breakers?.[source];
    breakers.set(source, persisted || { fails: 0, openUntil: 0 });
  }
  return breakers.get(source);
}

function persistBreakers() {
  const q = readQuota();
  q.breakers = Object.fromEntries(breakers);
  writeQuota(q);
}

export function recordFailure(source) {
  const b = breakerState(source);
  b.fails++;
  if (b.fails >= BREAKER_TRIP_AFTER) {
    const round = Math.min(BREAKER_COOLDOWNS_MS.length - 1, Math.floor(b.fails / BREAKER_TRIP_AFTER) - 1);
    b.openUntil = Date.now() + BREAKER_COOLDOWNS_MS[round];
  }
  persistBreakers();
  return b;
}

export function recordSuccess(source) {
  const b = breakerState(source);
  if (b.fails || b.openUntil) {
    b.fails = 0;
    b.openUntil = 0;
    persistBreakers();
  }
}

/** Is this source currently cooling down? */
export function breakerOpen(source) {
  const b = breakerState(source);
  if (b.openUntil && Date.now() < b.openUntil) {
    return { open: true, until: new Date(b.openUntil).toISOString(), seconds_left: Math.ceil((b.openUntil - Date.now()) / 1000), consecutive_failures: b.fails };
  }
  return { open: false };
}

export function breakerReport() {
  const out = {};
  for (const [src, b] of breakers) {
    const st = breakerOpen(src);
    out[src] = { consecutive_failures: b.fails, cooling_down: st.open, until: st.until || null };
  }
  return out;
}
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
  return { date: q.date, sources: out, breakers: breakerReport() };
}

/**
 * Wait until it is polite to call `source`, then record the call.
 * Returns { ok } or { ok:false, reason } when the day's quota is spent — the
 * caller must treat that as a logged coverage gap, never as "no results".
 */
export async function acquire(source) {
  const lim = LIMITS[source] || LIMITS.default;

  const br = breakerOpen(source);
  if (br.open)
    return {
      ok: false,
      cooling_down: true,
      reason: `${source} is cooling down after ${br.consecutive_failures} consecutive failures — ${br.seconds_left}s left. Retrying a source that is refusing is how a temporary throttle becomes a durable block. Record this as a coverage gap and move on; it will be retried automatically once the cooldown expires.`,
    };

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
  if (!gate.ok)
    return { ok: false, quota_exhausted: !gate.cooling_down, cooling_down: !!gate.cooling_down, error: gate.reason };

  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const value = await fn();
      recordSuccess(source);
      return { ok: true, value };
    } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      const retryAfter = Number(e?.retryAfter);
      const is429 = /\b429\b|too many requests/i.test(msg);
      const is5xx = /\b5\d\d\b|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(msg);
      // A 404 will not improve with retries, and must not trip the breaker —
      // that is the source answering correctly, not refusing.
      if (!is429 && !is5xx) return { ok: false, error: msg };

      const wait = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : baseDelay * 2 ** attempt + Math.random() * 400;
      if (attempt < tries - 1) await sleep(wait);
    }
  }
  // Every retry was spent and the source is still refusing: count it against
  // the breaker so a persistent failure stops being retried at all.
  const b = recordFailure(source);
  return {
    ok: false,
    error: String(last?.message || last),
    exhausted_retries: true,
    consecutive_failures: b.fails,
    cooling_down_until: b.openUntil ? new Date(b.openUntil).toISOString() : null,
  };
}
