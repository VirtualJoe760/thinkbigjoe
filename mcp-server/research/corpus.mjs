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
import { SPECIES, ANIMAL_SPECIES, normaliseSpecies } from "./species.mjs";
import { loadIndex, appendIndexRows, compactIndex, maybeCompact, indexSize } from "./store.mjs";
import { classifyRelevance, RELEVANCE_LEVELS } from "./indication.mjs";
import { validateLanguage } from "./language.mjs";

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

// ---------------------------------------------------------------------------
// INDEX LEDGER — the universe of candidate documents, before anything is read
// ---------------------------------------------------------------------------
//
// The indexing layer runs FIRST and its job is enumeration, not judgement: find
// every document that could possibly bear on the question, deduplicate it to a
// stable identity, and park it with a status. Reading happens later, off this
// queue, in an order that is chosen deliberately rather than by whatever the
// search engine happened to rank first.
//
// Identity is resolved in this order — DOI, PMID, NCT, PMCID, then a normalised
// URL. The same paper reached via PubMed, OpenAlex, Europe PMC and a blog link
// collapses to one candidate with four provenance entries, which is exactly the
// overlap signal the saturation estimator needs.

const INDEX_STATUSES = ["indexed", "queued", "reading", "read", "recorded", "rejected", "unreachable"];

/** Normalise a URL for identity: drop scheme, www, trailing slash, tracking params. */
export function normaliseUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const p of [...url.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|ref|source|mc_cid|mc_eid)/i.test(p)) url.searchParams.delete(p);
    let s = `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
    if ([...url.searchParams.keys()].length) s += `?${url.searchParams.toString()}`;
    return s.toLowerCase();
  } catch {
    return String(u || "").toLowerCase();
  }
}

/** Stable identity key for a candidate document. */
export function candidateKey(c) {
  if (c.doi) return `doi:${String(c.doi).replace(/^https?:\/\/doi\.org\//i, "").toLowerCase()}`;
  if (c.pmid) return `pmid:${c.pmid}`;
  if (c.nct) return `nct:${String(c.nct).toUpperCase()}`;
  if (c.pmcid) return `pmc:${String(c.pmcid).toUpperCase()}`;
  if (c.url) return `url:${normaliseUrl(c.url)}`;
  return `t:${String(c.title || "").toLowerCase().replace(/\W+/g, "-").slice(0, 80)}`;
}

/** Absolute dir for a project's ledgers — the durable store operates on it. */
const dirOf = (p) => projectDir(p);

/**
 * Upsert a batch of candidates. Returns per-batch yield statistics — the
 * marginal-yield numbers the saturation estimator runs on. This is the single
 * most important return value in the indexing layer: it is how the driver knows
 * whether searching is still productive.
 *
 * Writes go to the append-only tail; the store folds the tail into a snapshot
 * once it grows past the compaction threshold, which is what keeps a multi-day
 * run's reads from degrading into a full history replay.
 */
export function indexCandidates(project, candidates, provenance = {}) {
  const dir = dirOf(project);
  const { map } = loadIndex(dir);
  const rows = [];
  const isSafetyQuery = /safety|toxic|interaction|contraindic|overdose|pharmacokinet|tolerab|residue/i.test(provenance.query || "");

  let fresh = 0,
    rediscovered = 0;
  const seenThisBatch = new Set();
  const freshKeys = [];

  for (const c of candidates) {
    const key = candidateKey(c);
    if (!key || key === "t:" || seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);

    if (map.has(key)) {
      rediscovered++;
      // Overlap is signal, not noise — it is what the capture-recapture estimate
      // is computed from. Stored as a single compact row, not an appended array.
      rows.push({ _seen: key, i: provenance.intent, ...(isSafetyQuery ? { s: 1 } : {}) });
      continue;
    }
    const row = {
      key,
      ts: new Date().toISOString(),
      status: "indexed",
      title: c.title || null,
      url: c.url || null,
      doi: c.doi || null,
      pmid: c.pmid || null,
      pmcid: c.pmcid || null,
      nct: c.nct || null,
      year: c.year || null,
      journal: c.journal || null,
      source_type: c.source_type || null,
      snippet: c.snippet ? String(c.snippet).slice(0, 300) : null,
      cited_by: c.cited_by ?? null,
      is_retracted: c.is_retracted ?? null,
      open_access: c.open_access ?? null,
      full_text_available: c.full_text_available ?? null,
      trial_status: c.trial_status ?? null,
      why_stopped: c.why_stopped ?? null,
      phase: c.phase ?? null,
      conditions: c.conditions ?? null,
      interventions: c.interventions ?? null,
      enrollment: c.enrollment ?? null,
      sponsor: c.sponsor ?? null,
      locations: c.locations ?? null,
      trial_contacts: c.trial_contacts ?? null,
      substance_hint: c.substance_hint || null,
      nq: 1,
      first: { engine: provenance.engine, query: provenance.query, intent: provenance.intent },
      hint_disconfirming: provenance.intent === "disconfirming",
      hint_grey: provenance.intent === "grey",
      hint_safety: isSafetyQuery,
    };
    rows.push(row);
    // Deliberately not inserted into the map here — appendIndexRows applies
    // every row to the cache, and doing it twice would double-count nq.
    // A local set guards against duplicates inside this same batch.
    map.set(key, row);
    fresh++;
    freshKeys.push(key);
  }

  appendIndexRows(dir, rows);
  maybeCompact(dir);

  const returned = seenThisBatch.size;
  return {
    returned,
    fresh,
    rediscovered,
    // Marginal yield: what fraction of what this query returned was new. As this
    // trends to zero across queries, the search space is saturating.
    marginal_yield: returned ? +(fresh / returned).toFixed(3) : 0,
    index_total: map.size,
    fresh_keys: freshKeys.slice(0, 50),
  };
}

/** Read the index as current candidate state (snapshot + tail, memoised). */
export function readIndex(project, filter = {}) {
  let out = [...loadIndex(dirOf(project)).map.values()];
  if (filter.status) out = out.filter((c) => c.status === filter.status);
  if (filter.strata) out = out.filter((c) => c.strata === filter.strata);
  if (filter.substance) out = out.filter((c) => (c.substance_hint || "").toLowerCase().includes(filter.substance.toLowerCase()));
  if (filter.source_type) out = out.filter((c) => c.source_type === filter.source_type);
  return out;
}

export function updateCandidate(project, key, patch) {
  if (patch.status && !INDEX_STATUSES.includes(patch.status))
    return { ok: false, error: `status must be one of ${INDEX_STATUSES.join(", ")}` };
  appendIndexRows(dirOf(project), [{ _update: key, patch }]);
  return { ok: true };
}

/** Batch variant — one write and one cache invalidation for many updates. */
export function updateCandidates(project, updates) {
  appendIndexRows(dirOf(project), updates.map((u) => ({ _update: u.key, patch: u.patch })));
  maybeCompact(dirOf(project));
  return { ok: true, updated: updates.length };
}

export function compactCorpus(project) {
  return compactIndex(dirOf(project), true);
}

export function storeSize(project) {
  return indexSize(dirOf(project));
}

/**
 * Capture-recapture estimate of how much of the literature has NOT been seen.
 *
 * Each query is a "capture occasion". A document found by many independent
 * queries implies dense coverage; a large population of documents found by
 * exactly one query implies there is more out there you have not touched.
 * Chao1: N̂ = S_obs + f₁²/(2f₂), where f₁ = singletons (found by exactly one
 * query) and f₂ = doubletons. This is the defensible answer to "are we done" —
 * far better than "we found a lot of results", which is a statement about
 * effort, not about coverage.
 */
export function coverageEstimate(project) {
  const { map } = loadIndex(dirOf(project));
  const S_obs = map.size;
  if (!S_obs) return { observed: 0, estimated_total: 0, unseen_estimate: 0, coverage: 0, f1_singletons: 0, f2_doubletons: 0, interpretation: "Index is empty." };

  let f1 = 0,
    f2 = 0;
  for (const c of map.values()) {
    if (c.nq === 1) f1++;
    else if (c.nq === 2) f2++;
  }

  // Chao1, with the bias-corrected form when f2 === 0 (which happens early on).
  const estimated = f2 > 0 ? S_obs + (f1 * f1) / (2 * f2) : S_obs + (f1 * (f1 - 1)) / 2;
  const coverage = estimated > 0 ? +(S_obs / estimated).toFixed(3) : 1;

  return {
    observed: S_obs,
    estimated_total: +estimated.toFixed(1),
    unseen_estimate: Math.max(0, Math.ceil(estimated - S_obs)),
    coverage,
    f1_singletons: f1,
    f2_doubletons: f2,
    interpretation:
      coverage >= 0.95
        ? "Coverage is high — the queries are re-finding each other's results, which is what saturation looks like."
        : coverage >= 0.8
          ? "Approaching saturation. A meaningful tail is still unseen; keep expanding the query matrix along under-covered axes."
          : "Far from saturation. Most documents have been found by exactly one query, which means the search space is still opening up. Do not stop indexing.",
  };
}

/** Per-source enumeration progress: how much of each source's reported total was actually paged. */
export function sourceExhaustion(project) {
  const searches = getSearches(project);
  const byEngine = {};
  for (const s of searches) {
    byEngine[s.engine] ||= { queries: 0, retrieved: 0, reported_total: 0, exhausted_queries: 0, capped_queries: 0 };
    const e = byEngine[s.engine];
    e.queries++;
    e.retrieved += s.result_count || 0;
    if (s.reported_total != null) e.reported_total += s.reported_total;
    if (s.exhausted) e.exhausted_queries++;
    if (s.hit_ceiling) e.capped_queries++;
  }
  for (const [, e] of Object.entries(byEngine))
    e.enumerated_fraction = e.reported_total ? +(e.retrieved / e.reported_total).toFixed(3) : null;
  return byEngine;
}

export function indexStats(project) {
  const { map } = loadIndex(dirOf(project));
  const byStatus = {};
  for (const s of INDEX_STATUSES) byStatus[s] = 0;
  const byStrata = {};
  const bySourceType = {};
  let read = 0,
    outstanding = 0;
  for (const c of map.values()) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    if (c.strata) byStrata[c.strata] = (byStrata[c.strata] || 0) + 1;
    const k = c.source_type || "unknown";
    bySourceType[k] = (bySourceType[k] || 0) + 1;
    if (["read", "recorded", "rejected", "unreachable"].includes(c.status)) read++;
    else outstanding++;
  }
  return {
    total: map.size,
    byStatus,
    byStrata,
    bySourceType,
    read,
    outstanding,
    ...coverageEstimate(project),
  };
}

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

  // Species is normalised from the free-text model description, or taken as
  // given when the caller states it. The free text is kept verbatim — the
  // normalised value exists for grouping, never to replace what was written.
  // Language contract: the claim is English, the quote stays in its own
  // language, and a non-English quote carries an English translation with it.
  const lang = validateLanguage(input);
  if (!lang.ok) return { ok: false, error: lang.error };

  const sp = SPECIES.includes(input.species)
    ? { species: input.species, confidence: "declared", matched: "caller-supplied" }
    : normaliseSpecies(input.model_system, input.evidence_tier);

  const f = {
    id: "",
    ts: new Date().toISOString(),
    project,
    claim: input.claim.trim(),
    verbatim_quote: input.verbatim_quote.trim(),
    verbatim_quote_english: input.verbatim_quote_english ? String(input.verbatim_quote_english).trim() : null,
    source_language: lang.source_language,
    source_language_name: lang.source_language_name,
    direction: input.direction,
    evidence_tier: input.evidence_tier,
    subject: input.subject || null, // e.g. "ivermectin", "fenbendazole"
    indication: input.indication || null, // e.g. "pancreatic adenocarcinoma"
    model_system: input.model_system || null, // "human", "mouse xenograft", "PANC-1 cell line"
    species: sp.species,
    species_confidence: sp.confidence, // declared | matched | inferred | none
    indication_relevance: null, // set just below, from the assembled record
    indication_relevance_matched: null,
    species_matched_on: sp.matched,
    strain: input.strain || null, // "BALB/c nude", "Sprague-Dawley", "Beagle"
    animal_model_type: input.animal_model_type || null, // xenograft | orthotopic | syngeneic | GEMM | chemically-induced | toxicology | PK
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
  // How on-topic is this, really? Computed from the assembled record so a
  // finding can never enter the corpus without its relevance to the target
  // condition being decided and visible.
  const rel = classifyRelevance(f, input.condition_profile || "pancreatic_adenocarcinoma");
  f.indication_relevance = rel.relevance;
  f.indication_relevance_matched = rel.matched;

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
  // Backfill derived fields for records written by an earlier version, so a
  // corpus started before a field existed still reports it rather than showing
  // every row as unclassified.
  rows = rows.map((r) => {
    if (r.indication_relevance && r.species) return r;
    const patched = { ...r };
    if (!patched.indication_relevance) {
      const rel = classifyRelevance(patched);
      patched.indication_relevance = rel.relevance;
      patched.indication_relevance_matched = rel.matched;
    }
    if (!patched.species) {
      const sp = normaliseSpecies(patched.model_system, patched.evidence_tier);
      patched.species = sp.species;
      patched.species_confidence = sp.confidence;
    }
    return patched;
  });

  if (filter.subject) rows = rows.filter((r) => (r.subject || "").toLowerCase().includes(filter.subject.toLowerCase()));
  if (filter.direction) rows = rows.filter((r) => r.direction === filter.direction);
  if (filter.evidence_tier) rows = rows.filter((r) => r.evidence_tier === filter.evidence_tier);
  if (filter.species) rows = rows.filter((r) => r.species === filter.species);
  if (filter.relevance) rows = rows.filter((r) => r.indication_relevance === filter.relevance);
  if (filter.on_target) rows = rows.filter((r) => r.indication_relevance === "target");
  if (filter.animals_only) rows = rows.filter((r) => ANIMAL_SPECIES.includes(r.species));
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
    intent: entry.intent || "confirming", // confirming | disconfirming | background | grey | non_english
    result_count: entry.result_count ?? 0,
    // Enumeration bookkeeping — how much of what exists was actually retrieved.
    reported_total: entry.reported_total ?? null, // what the source said it had
    exhausted: entry.exhausted ?? null, // paged all the way to reported_total
    hit_ceiling: entry.hit_ceiling ?? null, // stopped by an API paging cap, NOT by exhaustion
    marginal_yield: entry.marginal_yield ?? null,
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

  // Species breakdown — animal evidence is several distinct literatures, not one.
  const bySpecies = {};
  for (const f of findings) bySpecies[f.species || "unspecified"] = (bySpecies[f.species || "unspecified"] || 0) + 1;
  const animalFindings = findings.filter((f) => ANIMAL_SPECIES.includes(f.species));
  const animalSpeciesPresent = [...new Set(animalFindings.map((f) => f.species))].sort();
  const speciesUnclassified = findings.filter(
    (f) => f.species === "unspecified" || f.species_confidence === "none",
  ).length;

  // Relevance to the target condition — the number that decides whether this
  // corpus is about the question asked or merely about the substances.
  const byRelevance = {};
  for (const r of RELEVANCE_LEVELS) byRelevance[r] = 0;
  for (const f of findings) byRelevance[f.indication_relevance || "unclear"]++;
  const onTarget = byRelevance.target;
  const onTargetHuman = findings.filter((f) => f.indication_relevance === "target" && humanTiers.has(f.evidence_tier)).length;

  return {
    findings: findings.length,
    retracted: findings.filter((f) => f.retracted).length,
    byDirection,
    byTier,
    bySpecies,
    byRelevance,
    onTarget,
    onTargetHuman,
    subjects,
    humanEvidence,
    animalEvidence: animalFindings.length,
    animalSpeciesPresent,
    speciesUnclassified,
    preclinicalOnly: findings.length > 0 && humanEvidence === 0,
    searches: searches.length,
    disconfirmingSearches: searches.filter((s) => s.intent === "disconfirming").length,
    sources: getSources(project).length,
    contacts: findings.reduce((n, f) => n + (f.contacts?.length || 0), 0),
  };
}
