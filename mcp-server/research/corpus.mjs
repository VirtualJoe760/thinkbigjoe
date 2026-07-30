/**
 * corpus.mjs — the shared evidence store for the two research MCP servers.
 *
 * Design rules (these are the anti-bias mechanism, not decoration):
 *
 *  1. APPEND-ONLY. Findings are written to a JSONL ledger and never edited or
 *     deleted in place. A finding that turns out to be wrong gets a retraction
 *     record appended, so the history of what the agent believed stays visible.
 *
 *  2. NOTHING WITHOUT A SOURCE. record_finding rejects any claim that lacks a
 *     resolvable source (url / doi / pmid / nct). There is no "general
 *     knowledge" path into the corpus — if the model knows it but can't cite
 *     it, it does not go in.
 *
 *  3. EVERY FINDING CARRIES A DIRECTION. benefit | harm | null | mixed. This is
 *     what lets compile_report show the real balance of evidence instead of the
 *     subset the agent found interesting, and it's what the disconfirming-search
 *     gate is checked against.
 *
 *  4. SEARCHES ARE LOGGED TOO. Every query the agent runs is recorded, so the
 *     report can state what was looked for and NOT found — absence of evidence
 *     is evidence, but only if you can prove you looked.
 *
 * Storage is plain files (JSONL) under RESEARCH_CORPUS_DIR (default
 * ~/research-corpus). No database, no network, portable, greppable, auditable.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CORPUS_DIR =
  process.env.RESEARCH_CORPUS_DIR || join(homedir(), "research-corpus");

function projectDir(project) {
  const slug = String(project || "default")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "default";
  const dir = join(CORPUS_DIR, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendJsonl(file, obj) {
  appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
  return obj;
}

const findingsFile = (p) => join(projectDir(p), "findings.jsonl");
const searchesFile = (p) => join(projectDir(p), "searches.jsonl");
const sourcesFile = (p) => join(projectDir(p), "sources.jsonl");
const reportsDir = (p) => {
  const d = join(projectDir(p), "reports");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
};

/**
 * Generic append-only sub-ledger, used by the thesis server for its own
 * records (mechanisms, parameters, safety assessments, falsification criteria)
 * without giving it any way to mutate the findings ledger.
 */
export function appendRecord(project, ledger, obj) {
  const row = { ts: new Date().toISOString(), ...obj };
  appendJsonl(join(projectDir(project), `${ledger}.jsonl`), row);
  return row;
}

export function readRecords(project, ledger) {
  return readJsonl(join(projectDir(project), `${ledger}.jsonl`));
}

export function listProjects() {
  if (!existsSync(CORPUS_DIR)) return [];
  return readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** Stable id from source + claim, so the same fact recorded twice collapses. */
function findingId(f) {
  const key = `${f.source?.doi || f.source?.pmid || f.source?.nct || f.source?.url}::${(f.claim || "").slice(0, 120)}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return "f" + Math.abs(h).toString(36);
}

export const DIRECTIONS = ["benefit", "harm", "null", "mixed", "background"];

export const EVIDENCE_TIERS = [
  "meta_analysis",
  "rct",
  "controlled_trial_nonrandomized",
  "cohort",
  "case_control",
  "case_series",
  "case_report",
  "animal_in_vivo",
  "in_vitro",
  "mechanistic_review",
  "narrative_review",
  "preprint",
  "conference_abstract",
  "regulatory_document",
  "anecdote_unverified",
];

/**
 * Validate + append a finding. Returns { ok, finding } or { ok:false, error }.
 * Validation is deliberately strict: this is the choke point that keeps
 * unsourced or direction-less assertions out of the corpus.
 */
export function recordFinding(project, input) {
  const src = input.source || {};
  if (!src.url && !src.doi && !src.pmid && !src.nct) {
    return {
      ok: false,
      error:
        "REJECTED: no resolvable source. A finding needs at least one of source.url, source.doi, source.pmid, source.nct. Unsourced claims cannot enter the corpus.",
    };
  }
  if (!input.claim || input.claim.trim().length < 10) {
    return { ok: false, error: "REJECTED: claim is missing or too short to be a factual statement." };
  }
  if (!DIRECTIONS.includes(input.direction)) {
    return {
      ok: false,
      error: `REJECTED: direction must be one of ${DIRECTIONS.join(", ")}. Every finding must be classified, including null and harm results.`,
    };
  }
  if (!EVIDENCE_TIERS.includes(input.evidence_tier)) {
    return {
      ok: false,
      error: `REJECTED: evidence_tier must be one of ${EVIDENCE_TIERS.join(", ")}.`,
    };
  }
  if (!input.verbatim_quote || input.verbatim_quote.trim().length < 20) {
    return {
      ok: false,
      error:
        "REJECTED: verbatim_quote is required (>=20 chars) and must be copied word-for-word from the source. Paraphrase belongs in `claim`; the quote is what makes the claim checkable.",
    };
  }

  const f = {
    id: "",
    ts: new Date().toISOString(),
    project,
    claim: input.claim.trim(),
    verbatim_quote: input.verbatim_quote.trim(),
    direction: input.direction,
    evidence_tier: input.evidence_tier,
    subject: input.subject || null, // e.g. "ivermectin", "fenbendazole"
    indication: input.indication || null, // e.g. "pancreatic adenocarcinoma"
    model_system: input.model_system || null, // "human", "mouse xenograft", "PANC-1 cell line"
    population_n: input.population_n ?? null,
    dose_reported: input.dose_reported || null,
    route: input.route || null,
    duration: input.duration || null,
    outcome_measure: input.outcome_measure || null,
    effect_size: input.effect_size || null,
    p_value: input.p_value || null,
    adverse_events: input.adverse_events || null,
    funding: input.funding || null,
    conflicts_of_interest: input.conflicts_of_interest || null,
    limitations: input.limitations || null,
    retracted: input.retracted === true,
    contacts: Array.isArray(input.contacts) ? input.contacts : [],
    source: {
      type: src.type || "unknown",
      title: src.title || null,
      url: src.url || null,
      doi: src.doi || null,
      pmid: src.pmid || null,
      nct: src.nct || null,
      journal: src.journal || null,
      year: src.year || null,
      authors: src.authors || null,
      publisher: src.publisher || null,
    },
    tags: Array.isArray(input.tags) ? input.tags : [],
    recorded_by: input.recorded_by || "research-agent",
  };
  f.id = findingId(f);

  const existing = getFindings(project).find((x) => x.id === f.id);
  if (existing) return { ok: true, duplicate: true, finding: existing };

  appendJsonl(findingsFile(project), f);
  return { ok: true, finding: f };
}

export function getFindings(project, filter = {}) {
  let rows = readJsonl(findingsFile(project));
  // Apply retractions: a retraction record supersedes the original.
  const retracted = new Set(rows.filter((r) => r._retracts).map((r) => r._retracts));
  rows = rows.filter((r) => !r._retracts).map((r) => (retracted.has(r.id) ? { ...r, retracted: true } : r));

  if (filter.subject) rows = rows.filter((r) => (r.subject || "").toLowerCase().includes(filter.subject.toLowerCase()));
  if (filter.direction) rows = rows.filter((r) => r.direction === filter.direction);
  if (filter.evidence_tier) rows = rows.filter((r) => r.evidence_tier === filter.evidence_tier);
  if (filter.include_retracted === false) rows = rows.filter((r) => !r.retracted);
  return rows;
}

export function retractFinding(project, id, reason) {
  return appendJsonl(findingsFile(project), {
    _retracts: id,
    ts: new Date().toISOString(),
    reason: reason || "no reason given",
  });
}

// ---------------------------------------------------------------------------
// Search log — proves what was looked for, including what came back empty
// ---------------------------------------------------------------------------

export function logSearch(project, entry) {
  return appendJsonl(searchesFile(project), {
    ts: new Date().toISOString(),
    engine: entry.engine,
    query: entry.query,
    intent: entry.intent || "confirming", // confirming | disconfirming | background
    result_count: entry.result_count ?? 0,
    notes: entry.notes || null,
  });
}

export function getSearches(project) {
  return readJsonl(searchesFile(project));
}

// ---------------------------------------------------------------------------
// Source registry — every document actually retrieved and read
// ---------------------------------------------------------------------------

export function registerSource(project, s) {
  const rows = readJsonl(sourcesFile(project));
  if (rows.some((r) => r.url === s.url)) return { duplicate: true };
  return appendJsonl(sourcesFile(project), { ts: new Date().toISOString(), ...s });
}

export function getSources(project) {
  return readJsonl(sourcesFile(project));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function saveReport(project, name, markdown) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(reportsDir(project), `${name}-${stamp}.md`);
  appendFileSync(file, markdown, "utf8");
  return file;
}

export function listReports(project) {
  const d = reportsDir(project);
  return readdirSync(d).filter((f) => f.endsWith(".md")).sort();
}

export function readReport(project, filename) {
  const file = join(reportsDir(project), filename);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// Balance / coverage stats — the honesty check both servers lean on
// ---------------------------------------------------------------------------

export function corpusStats(project) {
  const findings = getFindings(project);
  const searches = getSearches(project);
  const byDirection = {};
  for (const d of DIRECTIONS) byDirection[d] = findings.filter((f) => f.direction === d).length;
  const byTier = {};
  for (const f of findings) byTier[f.evidence_tier] = (byTier[f.evidence_tier] || 0) + 1;
  const subjects = [...new Set(findings.map((f) => f.subject).filter(Boolean))];

  const humanTiers = new Set([
    "meta_analysis",
    "rct",
    "controlled_trial_nonrandomized",
    "cohort",
    "case_control",
    "case_series",
    "case_report",
  ]);
  const humanEvidence = findings.filter((f) => humanTiers.has(f.evidence_tier)).length;

  return {
    findings: findings.length,
    retracted: findings.filter((f) => f.retracted).length,
    byDirection,
    byTier,
    subjects,
    humanEvidence,
    preclinicalOnly: findings.length > 0 && humanEvidence === 0,
    searches: searches.length,
    disconfirmingSearches: searches.filter((s) => s.intent === "disconfirming").length,
    sources: getSources(project).length,
    contacts: findings.reduce((n, f) => n + (f.contacts?.length || 0), 0),
  };
}
