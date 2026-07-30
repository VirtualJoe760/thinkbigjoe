/**
 * progress.mjs — elapsed time, measured throughput, and an honest ETA.
 *
 * THE TRAP with estimating a multi-day run: wall-clock elapsed divided by work
 * done is nearly meaningless. A run that goes overnight, or waits while the
 * operator is asleep, or sits idle between Cowork turns, accumulates hours of
 * wall clock against zero work. Divide by that and the ETA says four days when
 * the real remaining work is forty minutes of activity.
 *
 * So throughput is measured over ACTIVE time only. The gaps between consecutive
 * logged events are collected, anything longer than IDLE_GAP is classified as
 * idle rather than slow, and the rate is the MEDIAN of what remains — median
 * rather than mean because a handful of slow queries against a rate-limited
 * source should not drag the whole estimate.
 *
 * Two clocks are therefore reported and they mean different things:
 *   elapsed_wall   — how long since the run started, including sleep
 *   elapsed_active — how much of that was actually spent working
 *
 * And the ETA is given as a range with its basis stated, because a point
 * estimate implies a precision this does not have. Where there is not enough
 * data to estimate at all, it says so instead of guessing.
 */

import { getSearches, readIndex, getFindings, indexStats, coverageEstimate } from "./corpus.mjs";
import { expandQueryMatrix } from "./index-layer.mjs";

/** A gap longer than this is the operator being away, not the work being slow. */
export const IDLE_GAP_MS = 5 * 60 * 1000;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function humanDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "unknown";
  if (ms < 1000) return "under a second";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = ms / 3600000;
  if (h < 48) return `${h.toFixed(1)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}

/**
 * Split a timestamp series into active intervals and idle gaps.
 * @returns { intervals, activeMs, idleMs, idleGaps }
 */
function timing(timestamps) {
  const ts = timestamps.map((t) => new Date(t).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const intervals = [];
  let activeMs = 0,
    idleMs = 0,
    idleGaps = 0;
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (d > IDLE_GAP_MS) {
      idleMs += d;
      idleGaps++;
    } else {
      intervals.push(d);
      activeMs += d;
    }
  }
  return { intervals, activeMs, idleMs, idleGaps, first: ts[0] ?? null, last: ts[ts.length - 1] ?? null };
}

/**
 * Elapsed time and a phase-aware estimate of what is left.
 *
 * @param project corpus name
 * @param cfg     run config (for the depth, quotas and start time)
 * @param state   the driver's current state string
 */
export function estimateProgress(project, cfg, state) {
  const now = Date.now();
  const started = cfg?.started ? new Date(cfg.started).getTime() : null;

  const searches = getSearches(project);
  const idx = readIndex(project);
  const findings = getFindings(project);
  const ix = indexStats(project);

  // ---- clocks ----------------------------------------------------------
  const searchTiming = timing(searches.map((s) => s.ts));
  const readTiming = timing(idx.map((c) => c.read_at).filter(Boolean));
  const findingTiming = timing(findings.map((f) => f.ts));

  const elapsedWall = started ? now - started : null;
  const activeMs = searchTiming.activeMs + readTiming.activeMs + findingTiming.activeMs;
  const idleMs = elapsedWall != null ? Math.max(0, elapsedWall - activeMs) : null;

  // ---- measured rates --------------------------------------------------
  // Recent window, so a rate that changes mid-run (a slow source, a raised
  // batch size) is reflected rather than averaged away.
  const recent = (xs, n) => xs.slice(-n);
  const secPerQuery = median(recent(searchTiming.intervals, 120));
  const secPerRead = median(recent(readTiming.intervals, 60));
  const secPerFinding = median(recent(findingTiming.intervals, 60));

  // ---- remaining work --------------------------------------------------
  const matrix = expandQueryMatrix({ depth: cfg?.depth || "standard", substances: cfg?.substances });
  const ran = new Set(searches.map((q) => q.query));
  const queriesLeft = matrix.queries.filter((q) => !ran.has(q.query)).length;

  const quotas = cfg?.read_quota || {};
  let readsLeft = 0;
  for (const [k, quota] of Object.entries(quotas)) {
    const inStrata = idx.filter((c) => c.strata === k);
    const done = inStrata.filter((c) => ["read", "recorded", "rejected", "unreachable"].includes(c.status)).length;
    readsLeft += Math.max(0, Math.min(quota, inStrata.length) - done);
  }

  // ---- per-phase estimates --------------------------------------------
  const phases = [];
  const est = (label, units, perUnit, note) => {
    if (!units) return;
    phases.push({
      phase: label,
      remaining_units: units,
      ms_per_unit: perUnit,
      estimate_ms: perUnit != null ? units * perUnit : null,
      estimate: perUnit != null ? humanDuration(units * perUnit) : "not yet measurable",
      basis: note,
    });
  };

  est("INDEXING", queriesLeft, secPerQuery, `${queriesLeft} of ${matrix.query_count} queries left, at the median observed pace per query`);
  est("READING", readsLeft, secPerRead ?? secPerFinding, `${readsLeft} documents still needed to meet the per-stratum read quotas`);
  // The tail phases are short and bounded; a nominal allowance is more useful
  // than pretending they are free.
  if (state && ["INDEXING", "TRIAGE", "READING", "GAP_FILL"].includes(state))
    phases.push({ phase: "SAFETY + REPORTS", remaining_units: 1, estimate_ms: 10 * 60 * 1000, estimate: "~10 min", basis: "nominal allowance for the safety pass and rendering both reports" });

  const totalMs = phases.reduce((a, p) => a + (p.estimate_ms || 0), 0);
  const measurable = phases.every((p) => p.estimate_ms != null) && phases.length > 0;

  // A range, not a point. ±40% is honest for a process whose remaining work
  // depends on how much literature the next few hundred queries turn up.
  const lo = totalMs * 0.6,
    hi = totalMs * 1.6;

  return {
    started: cfg?.started || null,
    now: new Date(now).toISOString(),

    elapsed_wall: elapsedWall != null ? humanDuration(elapsedWall) : "unknown",
    elapsed_wall_ms: elapsedWall,
    elapsed_active: humanDuration(activeMs),
    elapsed_active_ms: activeMs,
    idle: idleMs != null ? humanDuration(idleMs) : "unknown",
    idle_gaps: searchTiming.idleGaps + readTiming.idleGaps + findingTiming.idleGaps,

    throughput: {
      per_query: secPerQuery != null ? humanDuration(secPerQuery) : "not yet measurable",
      per_document_read: secPerRead != null ? humanDuration(secPerRead) : "not yet measurable",
      per_finding_recorded: secPerFinding != null ? humanDuration(secPerFinding) : "not yet measurable",
      note: "Median over active intervals. Gaps longer than 5 minutes are counted as idle, not as slow work — otherwise an overnight pause would make the estimate meaningless.",
    },

    work_remaining: { queries: queriesLeft, documents_to_read: readsLeft },

    estimate: measurable
      ? {
          remaining: humanDuration(totalMs),
          range: `${humanDuration(lo)} – ${humanDuration(hi)}`,
          eta_if_continuous: new Date(now + totalMs).toISOString(),
          confidence: searches.length < 20 ? "low — too few queries measured so far to be trusted" : searches.length < 100 ? "moderate" : "reasonable",
          caveat:
            "This is ACTIVE working time, not wall-clock. If the session pauses, add the pause. The range is wide on purpose: how long reading takes depends on how much literature the remaining queries turn up, which is not knowable in advance.",
        }
      : {
          remaining: "not yet measurable",
          reason:
            "Not enough completed work to measure a rate. The estimate appears once a meaningful number of queries have run.",
        },

    phases,
    completion: {
      queries: `${searches.length} / ${matrix.query_count} (${((searches.length / Math.max(1, matrix.query_count)) * 100).toFixed(0)}%)`,
      documents_read: `${ix.read} / ${ix.total} indexed`,
      findings: findings.length,
      coverage: `${(coverageEstimate(project).coverage * 100).toFixed(1)}%`,
    },
  };
}
