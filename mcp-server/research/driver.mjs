/**
 * driver.mjs — the never-stop state machine.
 *
 * An autonomous run fails in exactly two ways. It stops early, declaring victory
 * at forty percent coverage because the last few searches felt repetitive. Or it
 * churns, re-searching an exhausted space forever because nothing told it the
 * space was exhausted. Both are failures of bookkeeping, not of intelligence,
 * so both are fixed with bookkeeping.
 *
 * `nextAction(project)` is the whole contract. The agent calls it, does exactly
 * what it says, and calls it again. It returns `done: true` only when both
 * deliverables physically exist on disk. Until then it always returns a concrete
 * next instruction naming a specific tool and specific arguments.
 *
 * THE STATE IS NOT STORED. It is recomputed from the ledgers on every call. A
 * crashed session, a new session, a different model, a week later — all resume
 * exactly where the corpus actually is, because the corpus IS the state. There
 * is no progress file to corrupt and no checkpoint to fall out of sync.
 *
 * Guards against the two failure modes:
 *
 *   Premature stop — every state's exit condition is a computable predicate over
 *   ledger counts, not a judgement. INDEXING cannot exit while estimated
 *   coverage is below target. READING cannot exit while any stratum is below its
 *   quota, which is what stops an agent reading the fifty most-cited papers and
 *   calling the literature surveyed.
 *
 *   Infinite churn — every state carries a budget and an attempt counter derived
 *   from the search log. When a target cannot be reached within its attempts, the
 *   driver does not retry forever: it writes the gap to the ledger and advances.
 *   A logged gap appears in the report's limitations. Giving up is allowed;
 *   giving up quietly is not.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  getFindings,
  getSearches,
  readIndex,
  updateCandidates,
  corpusStats,
  indexStats,
  coverageEstimate,
  appendRecord,
  readRecords,
  listReports,
  CORPUS_DIR,
  EVIDENCE_TIERS,
} from "./corpus.mjs";
import { expandQueryMatrix } from "./index-layer.mjs";
import { quotaReport } from "./ratelimit.mjs";
import { storeSize } from "./corpus.mjs";

/**
 * Heartbeat. A run that lasts days is invisible without one: there is no way to
 * tell "still working" from "wedged four hours ago" by looking at a log tail.
 * Every next_action writes the current state, progress counters and a timestamp
 * to run-status.json, so a human — or a monitoring script — can answer "is it
 * alive and is it moving" with a single file read, from outside the process.
 */
function heartbeat(project, state, progress, extra = {}) {
  try {
    const dir = join(CORPUS_DIR, project);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, "run-status.json");
    let prior = {};
    try {
      prior = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* first beat */
    }
    const now = new Date().toISOString();
    writeFileSync(
      file,
      JSON.stringify(
        {
          project,
          state,
          updated: now,
          first_seen: prior.first_seen || now,
          beats: (prior.beats || 0) + 1,
          progress,
          // Movement since the last beat — the number that distinguishes a slow
          // run from a stuck one.
          delta_since_last_beat: prior.progress
            ? {
                queries: (progress.queries_run || 0) - (prior.progress.queries_run || 0),
                documents: (progress.documents_indexed || 0) - (prior.progress.documents_indexed || 0),
                read: (progress.documents_read || 0) - (prior.progress.documents_read || 0),
                findings: (progress.findings || 0) - (prior.progress.findings || 0),
              }
            : null,
          store: storeSize(project),
          quota: quotaReport(),
          ...extra,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    /* the heartbeat must never be able to break the run it is reporting on */
  }
}

const HUMAN_TIERS = [
  "meta_analysis",
  "rct",
  "controlled_trial_nonrandomized",
  "cohort",
  "case_control",
  "case_series",
  "case_report",
];

export const STATES = ["INDEXING", "TRIAGE", "READING", "GAP_FILL", "SAFETY", "REPORT", "VISUAL", "DONE"];

/** Tunables. A run config is stored once at start and read back every call. */
export const DEFAULT_TARGETS = {
  coverage_target: 0.9, // Chao1 coverage before indexing may exit
  marginal_yield_window: 12, // queries in the rolling window
  marginal_yield_floor: 0.03, // below this, the window is saturated
  min_queries: 40, // never exit INDEXING on fewer than this
  read_quota: {
    // minimum documents READ per stratum before READING may exit
    human_trial: 25,
    disconfirming: 30, // deliberately high — this is the stratum a ranked list buries
    safety: 15,
    human_other: 20,
    preclinical: 30,
    grey: 10,
  },
  max_attempts_per_gap: 3,
};

// ---------------------------------------------------------------------------

export function initRun(project, cfg = {}) {
  const existing = readRecords(project, "run-config")[0];
  if (existing && !cfg.force) return existing;
  const row = {
    ...DEFAULT_TARGETS,
    ...cfg,
    question: cfg.question || null,
    substances: cfg.substances || null,
    depth: cfg.depth || "standard",
    started: new Date().toISOString(),
  };
  appendRecord(project, "run-config", row);
  return row;
}

export function getRunConfig(project) {
  const rows = readRecords(project, "run-config");
  return rows.length ? { ...DEFAULT_TARGETS, ...rows[rows.length - 1] } : { ...DEFAULT_TARGETS, depth: "standard" };
}

// ---------------------------------------------------------------------------
// Stratification — what kind of document is this, for quota purposes
// ---------------------------------------------------------------------------

export function stratify(c) {
  // Reads the bounded hint flags the store maintains, not an unbounded
  // provenance array — this runs over every candidate on every triage pass.
  if (c.nct) return "human_trial";
  if (c.hint_disconfirming) return "disconfirming";
  if (c.hint_safety) return "safety";
  if (c.hint_grey || c.source_type === "web") return "grey";
  return "preclinical"; // refined once read; a pre-read guess only
}

/**
 * Priority score for the read queue.
 *
 * Deliberately NOT citation-ranked. Sorting by citations reads the famous
 * positive papers first and, on any real time budget, means the null results and
 * the safety literature are the ones that never get read. The strata boosts
 * below exist to counteract exactly that.
 */
export function priorityOf(candidate, strata) {
  let p = 50;
  if (strata === "disconfirming") p += 30; // the literature a ranked list hides
  if (strata === "safety") p += 25;
  if (strata === "human_trial") p += 28;
  if (strata === "grey") p += 5;
  if (candidate.is_retracted) p += 40; // must be recorded AS retracted
  if (candidate.full_text_available) p += 12; // full text beats an abstract
  if (candidate.open_access) p += 6;
  if (candidate.pmid || candidate.doi || candidate.nct) p += 8; // resolvable identity
  if (candidate.year && Number(candidate.year) >= 2015) p += 4;
  // A gentle citation nudge only, never the dominant term.
  if (candidate.cited_by) p += Math.min(8, Math.log10(candidate.cited_by + 1) * 4);
  return Math.round(p);
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

export function nextAction(project) {
  const cfg = getRunConfig(project);
  const findings = getFindings(project);
  const searches = getSearches(project);
  const idx = readIndex(project);
  const s = corpusStats(project);
  const ix = indexStats(project);
  const cov = coverageEstimate(project);
  const gaps = readRecords(project, "gaps");

  const reports = listReports(project);
  const hasWhitePaper = reports.some((r) => r.startsWith("white-paper") || r.startsWith("research-report"));
  const hasVisual = existsSync(join(CORPUS_DIR, project, "reports")) && reports.some((r) => r.startsWith("visual-report"));

  const st = (k) => idx.filter((c) => c.status === k).length;
  const matrix = expandQueryMatrix({ depth: cfg.depth, substances: cfg.substances });
  const ranQueries = new Set(searches.map((q) => q.query));
  const pending = matrix.queries.filter((q) => !ranQueries.has(q.query));

  const progress = {
    state: null,
    queries_run: searches.length,
    queries_planned: matrix.query_count,
    documents_indexed: ix.total,
    documents_read: ix.read,
    documents_outstanding: ix.outstanding,
    findings: s.findings,
    coverage: cov.coverage,
    balance: s.byDirection,
  };

  // ---------------------------------------------------------------- 1. INDEX
  const window = searches.slice(-cfg.marginal_yield_window);
  const windowYield = window.length
    ? window.reduce((a, q) => a + (q.marginal_yield ?? 1), 0) / window.length
    : 1;
  const indexingDone =
    searches.length >= cfg.min_queries &&
    pending.length === 0 &&
    (cov.coverage >= cfg.coverage_target || windowYield < cfg.marginal_yield_floor);

  if (!indexingDone) {
    const batch = pending.slice(0, 8);
    if (!batch.length && searches.length < cfg.min_queries) {
      return act("INDEXING", progress, {
        instruction:
          `The planned query matrix is exhausted but only ${searches.length} queries have run (minimum ${cfg.min_queries}). Widen the matrix: call build_index with depth:"exhaustive", or add substances/indications the current matrix does not cover.`,
        tool: "build_index",
        args: { project, depth: "exhaustive" },
      });
    }
    return act("INDEXING", progress, {
      instruction:
        `Indexing is not finished. ${pending.length} of ${matrix.query_count} planned queries have not run. ` +
        `Estimated coverage is ${(cov.coverage * 100).toFixed(1)}% (target ${(cfg.coverage_target * 100).toFixed(0)}%), ` +
        `and the last ${window.length} queries averaged ${(windowYield * 100).toFixed(1)}% new results ` +
        `(saturation floor ${(cfg.marginal_yield_floor * 100).toFixed(0)}%). ` +
        `Run the next batch — do NOT start reading yet, and do NOT stop because results look repetitive; repetition IS the signal being measured.`,
      tool: "build_index",
      args: { project, resume: true, batch_size: 8 },
      next_queries: batch.map((q) => `[${q.intent}] ${q.query}`),
      why_not_done: {
        queries_remaining: pending.length,
        coverage: cov.coverage,
        coverage_target: cfg.coverage_target,
        rolling_marginal_yield: +windowYield.toFixed(3),
        documents_found_by_exactly_one_query: cov.f1_singletons,
      },
    });
  }

  // --------------------------------------------------------------- 2. TRIAGE
  const untriaged = idx.filter((c) => c.status === "indexed");
  if (untriaged.length) {
    // Triage is deterministic — the driver performs it rather than asking the
    // agent to, because a model scoring its own read queue is exactly where
    // preference for confirming literature would re-enter.
    // One batched write for the whole triage pass. Triaging 100k candidates
    // one append at a time would be 100k fsync-ish calls and 100k cache busts.
    const updates = untriaged.map((c) => {
      const strata = stratify(c);
      return { key: c.key, patch: { strata, priority: priorityOf(c, strata), status: "queued" } };
    });
    updateCandidates(project, updates);
    const n = updates.length;
    return act("TRIAGE", progress, {
      instruction: `Triaged ${n} newly indexed documents into read strata and assigned read priorities. Call next_action again to begin reading.`,
      tool: "next_action",
      args: { project },
      note: "Priority is computed, not model-judged: disconfirming, safety and trial records are boosted precisely because a citation-ranked queue buries them.",
    });
  }

  // -------------------------------------------------------------- 3. READING
  const readByStrata = {};
  for (const k of Object.keys(cfg.read_quota)) {
    const inStrata = idx.filter((c) => c.strata === k);
    const doneN = inStrata.filter((c) => ["read", "recorded", "rejected", "unreachable"].includes(c.status)).length;
    readByStrata[k] = { available: inStrata.length, read: doneN, quota: Math.min(cfg.read_quota[k], inStrata.length) };
  }
  const shortStrata = Object.entries(readByStrata).filter(([, v]) => v.read < v.quota);

  if (shortStrata.length) {
    const [worstK] = shortStrata.sort((a, b) => a[1].read / (a[1].quota || 1) - b[1].read / (b[1].quota || 1))[0];
    const queue = idx
      .filter((c) => c.strata === worstK && ["queued", "indexed"].includes(c.status))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, 5);
    return act("READING", progress, {
      instruction:
        `Reading is not finished. Stratum "${worstK}" has ${readByStrata[worstK].read} of ${readByStrata[worstK].quota} required documents read. ` +
        `Read the queue below — for each: get_full_text if a PMC id exists, otherwise read_source; then check_integrity; then record_finding for every checkable factual statement, including null and harm results. ` +
        `Mark each document with mark_read when finished so the queue advances.`,
      tool: "read_source / get_full_text → record_finding → mark_read",
      args: { project },
      read_queue: queue.map((c) => ({
        key: c.key,
        priority: c.priority,
        title: c.title,
        pmcid: c.pmcid,
        pmid: c.pmid,
        nct: c.nct,
        doi: c.doi,
        url: c.url,
      })),
      strata_progress: readByStrata,
      why_not_done: `Quotas unmet in: ${shortStrata.map(([k, v]) => `${k} (${v.read}/${v.quota})`).join(", ")}`,
    });
  }

  // ------------------------------------------------------------- 4. GAP FILL
  const openGaps = detectGaps(s, cov, ix, findings);
  const attempted = (name) => gaps.filter((g) => g.gap === name).length;
  const liveGap = openGaps.find((g) => attempted(g.name) < cfg.max_attempts_per_gap);

  if (liveGap) {
    appendRecord(project, "gaps", { gap: liveGap.name, attempt: attempted(liveGap.name) + 1, detail: liveGap.detail });
    return act("GAP_FILL", progress, {
      instruction: `${liveGap.detail} ${liveGap.remedy}`,
      tool: liveGap.tool,
      args: { project, ...(liveGap.args || {}) },
      attempt: `${attempted(liveGap.name) + 1} of ${cfg.max_attempts_per_gap}`,
      note: "If this gap cannot be closed after the maximum attempts, the driver records it as an unresolved limitation and moves on. It will appear in the report's limitations section — a logged gap is acceptable, a silent one is not.",
    });
  }
  const unresolved = openGaps.filter((g) => attempted(g.name) >= cfg.max_attempts_per_gap);

  // --------------------------------------------------------------- 5. SAFETY
  const substances = [...new Set(findings.map((f) => f.subject).filter(Boolean))];
  const noSafety = substances.filter(
    (sub) => !findings.some((f) => f.subject === sub && (f.direction === "harm" || f.adverse_events || f.evidence_tier === "regulatory_document")),
  );
  if (noSafety.length) {
    return act("SAFETY", progress, {
      instruction:
        `No safety or regulatory finding has been recorded for: ${noSafety.join(", ")}. ` +
        `Call safety_profile for each, then record_finding for the contraindications, the interaction data and the adverse-event signal — direction "harm" or "background", evidence_tier "regulatory_document". ` +
        `A substance profile with no harm side recorded misrepresents the substance.`,
      tool: "safety_profile",
      args: { project, substance: noSafety[0] },
      remaining: noSafety,
    });
  }

  // --------------------------------------------------------------- 6. REPORT
  if (!hasWhitePaper) {
    return act("REPORT", progress, {
      instruction: `Indexing, reading, gap-filling and the safety pass are complete. Compile the white paper now.`,
      tool: "compile_whitepaper",
      args: { project, title: cfg.question ? `Evidence map: ${cfg.question}` : undefined },
      unresolved_gaps: unresolved.map((g) => g.name),
    });
  }

  // --------------------------------------------------------------- 7. VISUAL
  if (!hasVisual) {
    return act("VISUAL", progress, {
      instruction: `The white paper exists. Now compile the visual report — the human-readable companion.`,
      tool: "compile_visual_report",
      args: { project },
    });
  }

  // ----------------------------------------------------------------- 8. DONE
  heartbeat(project, "DONE", { ...progress, state: "DONE" }, { deliverables: reports });
  return {
    state: "DONE",
    done: true,
    progress,
    deliverables: reports,
    dataset_hint: "Run export_dataset to project this corpus into the versioned JSON dataset a website can consume.",
    unresolved_gaps: unresolved.map((g) => ({ gap: g.name, detail: g.detail })),
    summary:
      `${s.findings} findings from ${ix.read} documents read, out of ${ix.total} indexed. ` +
      `Estimated search coverage ${(cov.coverage * 100).toFixed(1)}%. ` +
      `Balance: ${Object.entries(s.byDirection).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
  };

  function act(state, prog, body) {
    const progress = { ...prog, state };
    heartbeat(project, state, progress, { instruction: body.instruction, why_not_done: body.why_not_done });
    return { state, done: false, progress, ...body };
  }
}

// ---------------------------------------------------------------------------

function detectGaps(s, cov, ix, findings) {
  const g = [];
  if ((s.byDirection.null || 0) === 0)
    g.push({
      name: "no_null_findings",
      detail: "The corpus contains zero null findings — no study reporting no effect.",
      remedy:
        'Run deep_search with queries aimed squarely at null results ("no significant difference", "failed to inhibit", "lack of efficacy", "did not improve survival") for each substance, and record what comes back even when it is thin.',
      tool: "deep_search",
      args: { disconfirming_depth: 6 },
    });
  if ((s.byDirection.harm || 0) === 0)
    g.push({
      name: "no_harm_findings",
      detail: "The corpus contains zero harm findings — the safety side of the ledger is empty.",
      remedy: "Call safety_profile for each substance and record the contraindications, interactions and adverse-event signal as findings.",
      tool: "safety_profile",
    });
  if (s.findings > 0 && s.humanEvidence === 0)
    g.push({
      name: "no_human_evidence",
      detail: "No human-subject finding of any tier has been recorded.",
      remedy:
        'Search specifically for human data — case reports, case series, phase I/II trials, pharmacokinetics in humans — and record whatever exists. If genuinely none exists, that is itself the most important finding in the report and must be established by search, not assumed.',
      tool: "find_trials",
    });
  if (s.contacts === 0 && findings.length > 0)
    g.push({
      name: "no_contacts",
      detail: "No contact details have been captured from any source.",
      remedy: "Call find_trials and record the central contacts and overall officials; capture corresponding-author emails from PubMed affiliation strings when recording findings.",
      tool: "find_trials",
    });
  if (ix.outstanding > ix.total * 0.5 && ix.total > 20)
    g.push({
      name: "index_mostly_unread",
      detail: `${ix.outstanding} of ${ix.total} indexed documents remain unread (more than half).`,
      remedy: "Continue reading the priority queue before compiling.",
      tool: "next_action",
    });
  return g;
}
