/**
 * export.mjs — the data retention layer.
 *
 * The JSONL ledgers are the working format: append-only, greppable, safe under
 * concurrent writes. They are not a good shape to build a website on. This
 * module projects them into a stable, versioned, denormalised JSON dataset that
 * a static site (or any downstream consumer) can read directly with no joins,
 * no database and no server.
 *
 * The contract that makes this dataset durable:
 *
 *   - SCHEMA_VERSION is stamped into the manifest. Consumers pin it. Breaking
 *     changes bump the major and are listed in CHANGELOG below.
 *   - Every entity has a STABLE, URL-SAFE id. A finding's id is derived from its
 *     source and claim, so the same fact re-exported keeps the same id and a
 *     permalink minted today still resolves after a re-run.
 *   - Output is DETERMINISTIC: keys sorted, arrays ordered by stable sort keys,
 *     no timestamps inside record bodies. Re-exporting an unchanged corpus
 *     produces byte-identical files, so the dataset can live in git and its
 *     diffs mean something.
 *   - Files are SPLIT BY CONSUMER, not by table. A page that lists substances
 *     should not have to download every verbatim quote in the corpus.
 *   - PROVENANCE TRAVELS. Every exported record keeps its verbatim quote,
 *     citation and evidence tier. A consumer cannot accidentally render a claim
 *     stripped of what backs it, because the backing is in the same object.
 *
 * CHANGELOG
 *   1.0.0 — initial: manifest, findings, sources, substances, trials, contacts,
 *           searches, coverage, search-index.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  getFindings,
  getSearches,
  getSources,
  readIndex,
  corpusStats,
  indexStats,
  coverageEstimate,
  sourceExhaustion,
  readRecords,
  EVIDENCE_TIERS,
  DIRECTIONS,
  CORPUS_DIR,
} from "./corpus.mjs";

export const SCHEMA_VERSION = "1.0.0";

const HUMAN_TIERS = [
  "meta_analysis",
  "rct",
  "controlled_trial_nonrandomized",
  "cohort",
  "case_control",
  "case_series",
  "case_report",
];

/** Tier → a coarse strength band a website can render without re-deriving it. */
const TIER_BAND = {
  meta_analysis: "human_controlled",
  rct: "human_controlled",
  controlled_trial_nonrandomized: "human_controlled",
  cohort: "human_observational",
  case_control: "human_observational",
  case_series: "human_uncontrolled",
  case_report: "human_uncontrolled",
  animal_in_vivo: "preclinical",
  in_vitro: "preclinical",
  mechanistic_review: "secondary",
  narrative_review: "secondary",
  preprint: "unreviewed",
  conference_abstract: "unreviewed",
  regulatory_document: "regulatory",
  anecdote_unverified: "anecdote",
};

export const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unspecified";

/** Deterministic key-sorted stringify so re-exports are byte-identical. */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object" && v.constructor === Object) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = stable(v[k]);
    return out;
  }
  return v;
}

function writeJson(dir, name, data) {
  const body = JSON.stringify(stable(data), null, 2) + "\n";
  writeFileSync(join(dir, name), body, "utf8");
  return { file: name, bytes: Buffer.byteLength(body) };
}

/** FNV-1a — a short content hash so a consumer can detect a changed dataset. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// ---------------------------------------------------------------------------

function projectFinding(f) {
  const src = f.source || {};
  const permalink = src.doi
    ? `https://doi.org/${src.doi}`
    : src.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${src.pmid}/`
      : src.nct
        ? `https://clinicaltrials.gov/study/${src.nct}`
        : src.url || null;
  return {
    id: f.id,
    substance: f.subject || null,
    substance_slug: slug(f.subject),
    indication: f.indication || null,
    claim: f.claim,
    verbatim_quote: f.verbatim_quote,
    direction: f.direction,
    evidence_tier: f.evidence_tier,
    evidence_band: TIER_BAND[f.evidence_tier] || "other",
    evidence_rank: EVIDENCE_TIERS.indexOf(f.evidence_tier),
    human_subjects: HUMAN_TIERS.includes(f.evidence_tier),
    model_system: f.model_system || null,
    population_n: f.population_n ?? null,
    dose_reported: f.dose_reported || null,
    dose_is_verbatim: true, // never converted or normalised on export
    route: f.route || null,
    duration: f.duration || null,
    outcome_measure: f.outcome_measure || null,
    effect_size: f.effect_size || null,
    p_value: f.p_value || null,
    adverse_events: f.adverse_events || null,
    funding: f.funding || null,
    conflicts_of_interest: f.conflicts_of_interest || null,
    limitations: f.limitations || null,
    retracted: !!f.retracted,
    tags: f.tags || [],
    contacts: f.contacts || [],
    source: {
      type: src.type || null,
      title: src.title || null,
      authors: src.authors || null,
      journal: src.journal || null,
      year: src.year || null,
      doi: src.doi || null,
      pmid: src.pmid || null,
      nct: src.nct || null,
      url: src.url || null,
      permalink,
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Project the whole corpus into a publishable dataset.
 * Returns { dir, files, manifest }.
 */
export function exportDataset(project, opts = {}) {
  const outDir = opts.out_dir || join(CORPUS_DIR, project, "dataset");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const findings = getFindings(project).map(projectFinding);
  findings.sort((a, b) => a.evidence_rank - b.evidence_rank || a.id.localeCompare(b.id));

  const s = corpusStats(project);
  const ix = indexStats(project);
  const cov = coverageEstimate(project);
  const exh = sourceExhaustion(project);
  const searches = getSearches(project);
  const idx = readIndex(project);

  const files = [];

  // ---- substances: the entity a website is organised around ----
  const substanceNames = [...new Set(findings.map((f) => f.substance).filter(Boolean))].sort();
  const substances = substanceNames.map((name) => {
    const rows = findings.filter((f) => f.substance === name);
    const byDirection = {};
    for (const d of DIRECTIONS) byDirection[d] = rows.filter((r) => r.direction === d).length;
    const byTier = {};
    for (const r of rows) byTier[r.evidence_tier] = (byTier[r.evidence_tier] || 0) + 1;
    const human = rows.filter((r) => r.human_subjects);
    const controlled = rows.filter((r) => r.evidence_band === "human_controlled");
    const doses = rows.filter((r) => r.dose_reported).map((r) => ({
      finding_id: r.id,
      dose: r.dose_reported,
      route: r.route,
      model_system: r.model_system,
      human_subjects: r.human_subjects,
      evidence_tier: r.evidence_tier,
      source: r.source.permalink,
    }));
    return {
      id: slug(name),
      name,
      finding_count: rows.length,
      human_finding_count: human.length,
      controlled_trial_finding_count: controlled.length,
      highest_evidence_tier: rows.length ? rows[0].evidence_tier : null,
      by_direction: byDirection,
      by_tier: byTier,
      // Pre-computed honesty flags so a website cannot render this substance
      // without the caveat that applies to it.
      flags: {
        no_human_evidence: human.length === 0,
        no_controlled_trial: controlled.length === 0,
        no_harm_findings_recorded: byDirection.harm === 0,
        no_null_findings_recorded: byDirection.null === 0,
        rests_on_retracted_sources: rows.some((r) => r.retracted),
        anecdote_only: rows.length > 0 && rows.every((r) => r.evidence_band === "anecdote"),
      },
      doses_reported: doses,
      finding_ids: rows.map((r) => r.id),
    };
  });
  files.push(writeJson(outDir, "substances.json", { schema_version: SCHEMA_VERSION, substances }));

  // ---- findings: the bulk table ----
  files.push(writeJson(outDir, "findings.json", { schema_version: SCHEMA_VERSION, count: findings.length, findings }));

  // ---- sources / bibliography ----
  const sourceMap = new Map();
  for (const f of findings) {
    const key = f.source.doi || f.source.pmid || f.source.nct || f.source.url;
    if (!key) continue;
    if (!sourceMap.has(key)) sourceMap.set(key, { id: slug(key), ...f.source, finding_ids: [] });
    sourceMap.get(key).finding_ids.push(f.id);
  }
  const sourceList = [...sourceMap.values()].sort((a, b) => String(b.year || "").localeCompare(String(a.year || "")));
  files.push(writeJson(outDir, "sources.json", { schema_version: SCHEMA_VERSION, count: sourceList.length, sources: sourceList }));

  // ---- trials, split out: a site will want its own trial-finder page ----
  const trials = idx
    .filter((c) => c.nct)
    .map((c) => ({
      id: c.nct,
      nct: c.nct,
      title: c.title || null,
      url: c.url || `https://clinicaltrials.gov/study/${c.nct}`,
      status: c.trial_status || null,
      phase: c.phase || null,
      conditions: c.conditions || [],
      interventions: c.interventions || [],
      enrollment: c.enrollment ?? null,
      why_stopped: c.why_stopped || null,
      sponsor: c.sponsor || null,
      locations: c.locations || [],
      contacts: c.trial_contacts || [],
      substance_hint: c.substance_hint || null,
      indexed_at: c.ts,
    }))
    .sort((a, b) => String(a.nct).localeCompare(String(b.nct)));
  files.push(writeJson(outDir, "trials.json", { schema_version: SCHEMA_VERSION, count: trials.length, trials }));

  // ---- contacts directory ----
  const contactSeen = new Set();
  const contacts = [];
  for (const f of findings)
    for (const c of f.contacts || []) {
      const k = `${c.name}|${c.email}|${c.phone}`;
      if (contactSeen.has(k)) continue;
      contactSeen.add(k);
      contacts.push({
        id: slug(`${c.name}-${c.affiliation || ""}`),
        ...c,
        source_permalink: f.source.permalink,
        source_title: f.source.title,
        finding_id: f.id,
        provenance: "published by the source itself (corresponding-author line or trial registry contact block)",
      });
    }
  for (const t of trials)
    for (const c of t.contacts || []) {
      const k = `${c.name}|${c.email}|${c.phone}`;
      if (contactSeen.has(k)) continue;
      contactSeen.add(k);
      contacts.push({
        id: slug(`${c.name}-${t.nct}`),
        ...c,
        source_permalink: t.url,
        source_title: t.title,
        nct: t.nct,
        provenance: "ClinicalTrials.gov registry contact block",
      });
    }
  contacts.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  files.push(writeJson(outDir, "contacts.json", { schema_version: SCHEMA_VERSION, count: contacts.length, contacts }));

  // ---- method + coverage: a site MUST be able to render its own limitations ----
  files.push(
    writeJson(outDir, "coverage.json", {
      schema_version: SCHEMA_VERSION,
      corpus: {
        findings: s.findings,
        human_evidence: s.humanEvidence,
        preclinical_only: s.preclinicalOnly,
        by_direction: s.byDirection,
        by_tier: s.byTier,
        retracted: s.retracted,
      },
      index: { total: ix.total, read: ix.read, outstanding: ix.outstanding, by_status: ix.byStatus },
      search_completeness: cov,
      per_source: exh,
      queries_run: searches.length,
      disconfirming_queries: s.disconfirmingSearches,
      caveats: [
        s.preclinicalOnly && "No human-subject evidence of any tier is present in this corpus.",
        s.byDirection.null === 0 && "No null findings are recorded; the evidence base is one-sided by construction of the search.",
        s.byDirection.harm === 0 && "No harm findings are recorded; safety is not characterised by this corpus.",
        ix.outstanding > 0 && `${ix.outstanding} indexed documents were never read and are not represented anywhere in this dataset.`,
        cov.coverage < 0.95 && `Estimated search coverage is ${(cov.coverage * 100).toFixed(1)}%; approximately ${cov.unseen_estimate} reachable documents remain unseen.`,
        "Publication bias is not correctable by any method used here. Studies that found nothing are less often published and less often indexed.",
      ].filter(Boolean),
    }),
  );

  // ---- full search log ----
  files.push(
    writeJson(outDir, "searches.json", {
      schema_version: SCHEMA_VERSION,
      count: searches.length,
      searches: searches.map((q, i) => ({
        seq: i + 1,
        engine: q.engine,
        query: q.query,
        intent: q.intent,
        result_count: q.result_count,
        reported_total: q.reported_total ?? null,
        hit_ceiling: !!q.hit_ceiling,
        exhausted: !!q.exhausted,
        notes: q.notes || null,
      })),
    }),
  );

  // ---- lightweight client-side search index ----
  const searchIndex = findings.map((f) => ({
    id: f.id,
    s: f.substance_slug,
    t: f.evidence_tier,
    d: f.direction,
    h: f.human_subjects ? 1 : 0,
    // Tokenised text for a trivial client-side filter; no stemming, no library.
    text: [f.claim, f.substance, f.indication, f.model_system, f.outcome_measure, f.source.title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .slice(0, 500),
  }));
  files.push(writeJson(outDir, "search-index.json", { schema_version: SCHEMA_VERSION, records: searchIndex }));

  // ---- thesis artefacts, if a thesis was built ----
  const thesisParams = readRecords(project, "thesis-parameters");
  if (thesisParams.length) {
    files.push(
      writeJson(outDir, "thesis.json", {
        schema_version: SCHEMA_VERSION,
        note: "Investigational hypothesis artefacts. Every parameter traces to finding ids in findings.json. Parameters with open_question=true have NO evidential basis and carry no value.",
        mechanisms: readRecords(project, "thesis-mechanisms"),
        parameters: thesisParams,
        safety: readRecords(project, "thesis-safety"),
        falsification: readRecords(project, "thesis-falsification"),
        grades: readRecords(project, "thesis-grades"),
      }),
    );
  }

  // ---- machine-readable schema, so a consumer can validate ----
  files.push(writeJson(outDir, "schema.json", datasetSchema()));

  // ---- manifest last: it hashes the others ----
  const manifest = {
    schema_version: SCHEMA_VERSION,
    project,
    generated: opts.generated_at || new Date().toISOString().slice(0, 10),
    generator: "research-mcp/export.mjs",
    license: opts.license || "Facts and citations are not copyrightable; verbatim quotations are reproduced under fair-use for citation. Check each source's terms before republishing its text at length.",
    counts: {
      findings: findings.length,
      substances: substances.length,
      sources: sourceList.length,
      trials: trials.length,
      contacts: contacts.length,
      searches: searches.length,
      indexed_documents: ix.total,
    },
    files: files.map((f) => f.file).sort(),
    content_hash: hash(JSON.stringify(stable({ findings, substances, sourceList, trials, contacts }))),
    consumer_contract: {
      pin: "Pin schema_version. A major bump means field removals or meaning changes.",
      required_display: [
        "Never render a claim without its evidence_tier and human_subjects flag.",
        "Never render a dose_reported without its model_system — a dose beside a mouse model is a mouse dose.",
        "Surface substances[].flags on any page about that substance; they are pre-computed so they cannot be forgotten.",
        "Surface coverage.json caveats anywhere the dataset is summarised.",
      ],
    },
  };
  writeJson(outDir, "manifest.json", manifest);

  return { dir: outDir, files: [...files.map((f) => f.file), "manifest.json"].sort(), manifest };
}

// ---------------------------------------------------------------------------

function datasetSchema() {
  return {
    schema_version: SCHEMA_VERSION,
    $comment:
      "Shape reference for consumers of this dataset. Deliberately plain — describes the fields and their meaning rather than being a strict JSON Schema validator.",
    finding: {
      id: "string — stable across re-exports; safe to use in a permalink",
      substance: "string|null",
      substance_slug: "string — url-safe join key to substances[].id",
      claim: "string — neutral factual statement, no interpretation",
      verbatim_quote: "string — word-for-word from the source; ALWAYS render alongside the claim",
      direction: DIRECTIONS,
      evidence_tier: EVIDENCE_TIERS,
      evidence_band: ["human_controlled", "human_observational", "human_uncontrolled", "preclinical", "secondary", "unreviewed", "regulatory", "anecdote"],
      evidence_rank: "number — 0 is strongest design; sort ascending",
      human_subjects: "boolean — false means cells, animals, or argument",
      model_system: "string|null — e.g. 'PANC-1 cell line', 'BALB/c mouse xenograft', 'human'",
      dose_reported: "string|null — EXACTLY as the source reported it, never converted",
      dose_is_verbatim: "always true — this dataset performs no unit or species conversion",
      retracted: "boolean — source withdrawn; never render as live evidence",
      source: "object with permalink",
    },
    substance: {
      id: "string — url-safe",
      flags: "object of pre-computed honesty flags; render them, do not recompute",
      doses_reported: "array — every dose in the corpus for this substance, each with its model_system",
    },
    coverage: "The dataset's own limitations. A consumer that renders findings without rendering these is misrepresenting the corpus.",
  };
}
