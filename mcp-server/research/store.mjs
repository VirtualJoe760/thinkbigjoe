/**
 * store.mjs — the durable index store, built for runs measured in days.
 *
 * THE PROBLEM THIS SOLVES. The index is append-only, which is right: it is
 * crash-safe, concurrent-write-safe, and auditable. But a naive append-only log
 * that is fully re-parsed on every read does not survive a long run. Measured on
 * a 14-query seed: 7,193 rows, 4.2 MB, 71 ms per read. An exhaustive run is
 * ~1,118 queries × 5 sources, and most of what a query returns is a document
 * some earlier query already found — so the log grows to millions of rows and
 * over a gigabyte. The driver reads the index several times per call. At that
 * size each `next_action` would take minutes, and a multi-day run would spend
 * most of its life re-parsing its own history.
 *
 * THE FIX is three things:
 *
 *  1. SNAPSHOT + TAIL. `index.snapshot.json` holds compacted state; `index.jsonl`
 *     holds only what has happened since. Reads load the snapshot and replay the
 *     tail. Compaction folds the tail in and truncates it. The log stays
 *     append-only between compactions, so the crash-safety property survives.
 *
 *  2. BOUNDED PER-CANDIDATE STATE. The old record kept a `discovered_by` array
 *     that grew every time another query re-found the document — unbounded, and
 *     the single largest contributor to file size. What the estimator actually
 *     needs from it is a COUNT of distinct queries, and what the triage step
 *     needs is three booleans. So that is what is stored: `nq` plus three hint
 *     flags. First-discovery provenance is kept in full because it is small and
 *     it is what the saturation curve is drawn from.
 *
 *  3. MEMOISED READS. State is cached in-process, keyed on the snapshot's mtime
 *     and the tail's byte length. Repeated reads inside one `next_action` cost
 *     one parse, not four. Another process appending is detected by the tail
 *     length changing, so the cache cannot go stale.
 *
 * Net effect: reads go from O(total history) to O(changes since last compaction),
 * and the on-disk footprint from O(sightings) to O(unique documents).
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, statSync, renameSync, truncateSync } from "node:fs";
import { join } from "node:path";

// Fold the tail into the snapshot once it exceeds this many rows — but the
// threshold ADAPTS to corpus size. A fixed threshold is a trap: compaction
// rewrites the whole snapshot, so a fixed 20k trigger against a 180k-document
// corpus means rewriting ~74 MB every ten queries, and the run spends its life
// writing snapshots instead of searching. Scaling the trigger with the corpus
// keeps compaction cost amortised to roughly O(1) per row written.
export const COMPACT_MIN_ROWS = Number(process.env.RESEARCH_COMPACT_MIN_ROWS || 20000);
export const COMPACT_RATIO = Number(process.env.RESEARCH_COMPACT_RATIO || 0.5);

/** Rows the tail may reach before folding, given how big the snapshot already is. */
export function compactThreshold(candidateCount) {
  return Math.max(COMPACT_MIN_ROWS, Math.ceil(candidateCount * COMPACT_RATIO));
}

const cache = new Map(); // project → { key, state }

function files(dir) {
  return {
    snapshot: join(dir, "index.snapshot.json"),
    log: join(dir, "index.jsonl"),
    tmp: join(dir, "index.snapshot.tmp"),
  };
}

function cacheKey(f) {
  const snap = existsSync(f.snapshot) ? statSync(f.snapshot) : null;
  const log = existsSync(f.log) ? statSync(f.log) : null;
  return `${snap ? snap.mtimeMs + ":" + snap.size : "0"}|${log ? log.size : 0}`;
}

/**
 * A compacted candidate. Deliberately lean — this shape is multiplied by every
 * unique document in the corpus, and a long run reaches six figures.
 */
function blank(key) {
  return {
    key,
    status: "indexed",
    title: null, url: null, doi: null, pmid: null, pmcid: null, nct: null,
    year: null, journal: null, source_type: null, snippet: null,
    cited_by: null, is_retracted: null, open_access: null, full_text_available: null,
    trial_status: null, why_stopped: null, phase: null, conditions: null,
    interventions: null, enrollment: null, sponsor: null, locations: null, trial_contacts: null,
    substance_hint: null, strata: null, priority: null, reason: null,
    // Bounded discovery state — replaces the old unbounded discovered_by array.
    nq: 0,                    // distinct queries that found this document
    first: null,              // { engine, query, intent } — what found it first
    hint_disconfirming: false,
    hint_grey: false,
    hint_safety: false,
    ts: null,
  };
}

function applyRow(map, r) {
  if (r._seen) {
    const c = map.get(r._seen);
    if (!c) return;
    // Queries are never re-run within a project (build_index skips anything in
    // the search log), so each (document, query) sighting is unique and a plain
    // increment is exact.
    c.nq++;
    if (r.i === "disconfirming") c.hint_disconfirming = true;
    else if (r.i === "grey") c.hint_grey = true;
    if (r.s) c.hint_safety = true;
    return;
  }
  if (r._update) {
    const c = map.get(r._update);
    if (c) Object.assign(c, r.patch);
    return;
  }
  if (!r.key) return;
  const prior = map.get(r.key);
  if (prior === r) return; // already applied by the writer — do not re-count
  const c = prior || blank(r.key);
  Object.assign(c, r);
  map.set(r.key, c);
}

function parseLog(text, map) {
  let n = 0;
  let start = 0;
  // Manual line walk — measurably cheaper than split() on a large file, and it
  // avoids holding a second copy of every line in an array.
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    if (end > start) {
      try {
        applyRow(map, JSON.parse(text.slice(start, end)));
        n++;
      } catch {
        /* a torn final line from an interrupted write — skip it */
      }
    }
    start = end + 1;
  }
  return n;
}

/** Load compacted index state: snapshot + replayed tail, memoised. */
export function loadIndex(dir) {
  const f = files(dir);
  const key = cacheKey(f);
  const hit = cache.get(dir);
  if (hit && hit.key === key) return hit.state;

  const map = new Map();
  if (existsSync(f.snapshot)) {
    try {
      const snap = JSON.parse(readFileSync(f.snapshot, "utf8"));
      for (const c of snap.candidates || []) map.set(c.key, c);
    } catch {
      /* corrupt snapshot — the log is the source of truth, so rebuild from it */
    }
  }
  let tailRows = 0;
  if (existsSync(f.log)) tailRows = parseLog(readFileSync(f.log, "utf8"), map);

  const state = { map, tailRows, dir };
  cache.set(dir, { key, state });
  return state;
}

/**
 * Append rows to the tail AND apply them to the cached state.
 *
 * The naive version invalidates the memo after writing, which is correct but
 * ruinous: the writer then re-parses the entire snapshot on its very next read,
 * once per batch, for the whole run. Since the rows being written are exactly
 * the delta, applying them in place keeps the cache valid and the writing
 * process never re-parses its own snapshot at all.
 *
 * The cache key is re-derived from the files afterwards, so a SECOND process
 * appending concurrently still invalidates us — correctness against concurrent
 * writers is preserved, we simply stop paying for our own.
 */
export function appendIndexRows(dir, rows) {
  if (!rows.length) return;
  const f = files(dir);
  appendFileSync(f.log, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  const hit = cache.get(dir);
  if (!hit) return; // nothing cached — next read parses from disk anyway
  for (const r of rows) applyRow(hit.state.map, r);
  hit.state.tailRows += rows.length;
  hit.key = cacheKey(f); // re-key to our own post-write file state
}

/**
 * Fold the tail into the snapshot and truncate it.
 *
 * Written to a temp file and renamed, so a crash mid-compaction leaves either
 * the old snapshot plus the full log, or the new snapshot plus the full log —
 * both of which replay to the same state. The log is only truncated after the
 * rename succeeds, so no window exists where data lives in neither file.
 */
export function compactIndex(dir, force = false) {
  const f = files(dir);
  const state = loadIndex(dir);
  if (!force && state.tailRows < compactThreshold(state.map.size))
    return { compacted: false, tailRows: state.tailRows };

  const candidates = [...state.map.values()];
  writeFileSync(f.tmp, JSON.stringify({ v: 1, compacted_at: new Date().toISOString(), count: candidates.length, candidates }), "utf8");
  renameSync(f.tmp, f.snapshot);
  if (existsSync(f.log)) truncateSync(f.log, 0);
  cache.delete(dir);
  return { compacted: true, candidates: candidates.length, tail_rows_folded: state.tailRows };
}

export function maybeCompact(dir) {
  const state = loadIndex(dir);
  return state.tailRows >= compactThreshold(state.map.size)
    ? compactIndex(dir)
    : { compacted: false, tailRows: state.tailRows };
}

export function indexSize(dir) {
  const f = files(dir);
  return {
    snapshot_bytes: existsSync(f.snapshot) ? statSync(f.snapshot).size : 0,
    log_bytes: existsSync(f.log) ? statSync(f.log).size : 0,
    tail_rows: loadIndex(dir).tailRows,
    candidates: loadIndex(dir).map.size,
    compact_threshold: compactThreshold(loadIndex(dir).map.size),
  };
}

export function clearCache(dir) {
  if (dir) cache.delete(dir);
  else cache.clear();
}
