#!/usr/bin/env node
/**
 * runner.mjs — the headless runner. This is what makes the research actually finish.
 *
 * THE PROBLEM IT SOLVES. `next_action` assumes something keeps calling it. A chat
 * session is a bad candidate for that: it stops between turns, it runs out of
 * context, and it dies when the window closes. A job measured in days cannot be
 * driven by a conversation, and pretending otherwise is how a run gets to 30%
 * and silently stalls.
 *
 * THE OBSERVATION THAT FIXES IT. Almost none of this work needs a language model:
 *
 *   INDEXING   ~1,264 queries × 7 sources. The longest phase by far — hours to
 *              days — and completely deterministic. Expand the matrix, page each
 *              source to exhaustion, deduplicate. No judgement anywhere.
 *   TRIAGE     already computed by the driver, deliberately, so a model cannot
 *              bias its own read queue.
 *   SAFETY     FDA label and adverse-event data is structured. Transcribing a
 *              contraindications section is copying, not deciding.
 *   REPORTS    deterministic renderers.
 *   EXPORT     deterministic projection.
 *
 *   READING    the ONLY phase that needs judgement — deciding what a paper
 *              claims, which sentence to quote, what tier and species it is.
 *
 * So the runner executes everything else itself, continuously, under launchd,
 * and calls out to `claude -p` only for reading. And even there the model is used
 * as a pure extraction function — document text in, structured findings out —
 * while the runner keeps all tool access and applies every gate. The model never
 * drives the loop, so it cannot wander off it, and a failed extraction costs one
 * document rather than the run.
 *
 * Concurrency: a lockfile with a liveness check. Two runners on one corpus would
 * duplicate queries and corrupt the marginal-yield signal that saturation is
 * measured from.
 */

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  getFindings, recordFinding, readIndex, updateCandidate, indexStats,
  corpusStats, logSearch, indexCandidates, saveReport, CORPUS_DIR,
} from "./corpus.mjs";
import { nextAction, getRunConfig, initRun } from "./driver.mjs";
import { expandQueryMatrix, ENUMERATORS } from "./index-layer.mjs";
import { europepmcFullText, fetchPage, fdaLabel, fdaAdverseEvents, integrityCheck } from "./fetchers.mjs";
import { renderWhitePaper } from "./render-whitepaper.mjs";
import { renderVisualReport } from "./render-visual.mjs";
import { exportDataset } from "./export.mjs";

const PROJECT = process.env.RESEARCH_PROJECT || "pancreatic-alt-agents";
const QUESTION = process.env.RESEARCH_QUESTION ||
  "What does the published evidence actually say about ivermectin, methylene blue, mebendazole, and fenbendazole in pancreatic ductal adenocarcinoma — including the negative, null, and safety literature, the veterinary record, and non-English sources?";
const DEPTH = process.env.RESEARCH_DEPTH || "exhaustive";
const READ_BATCH = Number(process.env.RESEARCH_READ_BATCH || 6);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "/Users/macdaddyjoe/.local/bin/claude";
const MAX_READ_FAILURES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// ---------------------------------------------------------------------------
// Single-instance lock. Two runners on one corpus would run the same queries
// twice and corrupt the overlap statistics saturation is computed from.
// ---------------------------------------------------------------------------

const LOCK = join(CORPUS_DIR, PROJECT, "runner.lock");

function acquireLock() {
  mkdirSync(join(CORPUS_DIR, PROJECT), { recursive: true });
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, "utf8").trim());
    try {
      process.kill(pid, 0); // does not kill — just tests liveness
      log(`another runner is alive (pid ${pid}); exiting.`);
      return false;
    } catch {
      log(`stale lock from dead pid ${pid}; taking over.`);
    }
  }
  writeFileSync(LOCK, String(process.pid), "utf8");
  const release = () => { try { unlinkSync(LOCK); } catch {} };
  process.on("exit", release);
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { release(); process.exit(0); });
  return true;
}

// ---------------------------------------------------------------------------
// INDEXING — deterministic, and the phase that takes the longest
// ---------------------------------------------------------------------------

async function runIndexBatch() {
  const cfg = getRunConfig(PROJECT);
  const matrix = expandQueryMatrix({ depth: cfg.depth, substances: cfg.substances });
  const ran = new Set((await import("./corpus.mjs")).getSearches(PROJECT).map((q) => q.query));
  const pending = matrix.queries.filter((q) => !ran.has(q.query));
  if (!pending.length) return { done: true };

  const batch = pending.slice(0, 4);
  const sources = ["pubmed", "europepmc", "clinicaltrials", "openalex", "web"];

  for (const q of batch) {
    for (const src of sources) {
      try {
        const r = await ENUMERATORS[src](q.query, { max: 400 });
        const y = indexCandidates(PROJECT, r.records, { engine: src, query: q.query, intent: q.intent });
        logSearch(PROJECT, {
          engine: src, query: q.query, intent: q.intent,
          result_count: r.retrieved, reported_total: r.reported_total,
          exhausted: r.exhausted, hit_ceiling: r.hit_ceiling,
          marginal_yield: y.marginal_yield, notes: r.ceiling_reason,
        });
      } catch (e) {
        logSearch(PROJECT, { engine: src, query: q.query, intent: q.intent, result_count: 0, notes: `ERROR: ${e.message}` });
      }
    }
    log(`indexed "${q.query.slice(0, 60)}" · total ${indexStats(PROJECT).total}`);
  }
  return { done: false, ran: batch.length, remaining: pending.length - batch.length };
}

// ---------------------------------------------------------------------------
// READING — the only phase that needs a model, used as a pure extractor
// ---------------------------------------------------------------------------

const EXTRACT_SCHEMA = `{
  "findings": [
    {
      "claim": "IN ENGLISH. What was done and what was observed. Neutral. No interpretation, no framing words.",
      "verbatim_quote": "Word-for-word from the document, in ITS OWN language. Never translate. >=20 chars.",
      "verbatim_quote_english": "REQUIRED only if verbatim_quote is not English: your translation.",
      "direction": "benefit | harm | null | mixed | background",
      "evidence_tier": "meta_analysis|rct|controlled_trial_nonrandomized|cohort|case_control|case_series|case_report|animal_in_vivo|in_vitro|mechanistic_review|narrative_review|preprint|conference_abstract|regulatory_document|anecdote_unverified",
      "subject": "the substance studied",
      "indication": "the disease/condition studied, exactly — do NOT write pancreatic cancer unless it truly is",
      "model_system": "exact: 'PANC-1 cell line', 'BALB/c nude mouse xenograft', 'client-owned beagles', 'human'",
      "species": "human|mouse|rat|hamster|dog|cat|pig|sheep|cattle|horse|rabbit|non_human_primate|zebrafish|cell_line|cell_free|in_silico|unspecified",
      "strain": "if stated",
      "population_n": 0,
      "dose_reported": "EXACTLY as written, with units. Never convert or scale.",
      "route": "", "duration": "", "outcome_measure": "", "effect_size": "", "p_value": "",
      "adverse_events": "as reported, or 'none reported' / 'not assessed' — the distinction matters",
      "funding": "", "conflicts_of_interest": "", "limitations": "author-stated limitations"
    }
  ],
  "no_findings_reason": "set ONLY if findings is empty — why this document yields nothing checkable"
}`;

function extractionPrompt(doc) {
  return `You are an evidence-extraction function. Read the document below and return ONLY a JSON object matching the schema. No prose, no markdown fence, no commentary.

RULES:
- Every finding needs a verbatim_quote copied WORD-FOR-WORD from the document. If you cannot quote it, do not record it.
- The claim is ALWAYS in English. The quote stays in the document's own language; if that is not English, add verbatim_quote_english.
- Never use framing words: promising, encouraging, unfortunately, suppressed, breakthrough, debunked.
- A null or harm result matters as much as a benefit. Extract them with equal care.
- Set indication to what was ACTUALLY studied. If the paper is about colorectal cancer, say colorectal cancer. Do not stretch it toward pancreatic cancer.
- dose_reported is copied exactly, in the document's units, for the document's species. Never convert.
- Extract at most 4 findings — the most substantive, checkable ones.
- If the document contains nothing checkable, return {"findings": [], "no_findings_reason": "..."}.

SCHEMA:
${EXTRACT_SCHEMA}

DOCUMENT (${doc.label}):
${doc.text.slice(0, 45000)}`;
}

/** Run claude headless as a one-shot extractor. Returns parsed JSON or null. */
function claudeExtract(prompt) {
  return new Promise((resolve) => {
    const p = spawn(CLAUDE_BIN, ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill("SIGKILL"); resolve(null); }, 300000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      clearTimeout(timer);
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return resolve(null);
      try { resolve(JSON.parse(m[0])); } catch { resolve(null); }
    });
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

/** Fetch a candidate's readable text by the best route available. */
async function fetchDoc(c) {
  if (c.pmcid) {
    try {
      const ft = await europepmcFullText(c.pmcid);
      if (ft.text?.length > 500) return { text: ft.text, label: `${c.title || c.pmcid} (full text)` };
    } catch {}
  }
  if (c.pmid) {
    try {
      const { pubmedSearch } = await import("./fetchers.mjs");
      const r = await pubmedSearch(`${c.pmid}[uid]`, { limit: 1 });
      const rec = r.records[0];
      if (rec?.abstract) return { text: `${rec.title}\n\n${rec.abstract}`, label: `${rec.title} (abstract)` };
    } catch {}
  }
  if (c.url) {
    try {
      const p = await fetchPage(c.url, { maxChars: 45000 });
      if (p.text?.length > 800 && !p.warning) return { text: p.text, label: c.title || c.url };
      if (p.warning) return { unreachable: p.warning };
    } catch (e) { return { unreachable: e.message }; }
  }
  return { unreachable: "no readable route (no PMC id, no abstract, no fetchable URL)" };
}

async function runReadBatch() {
  const idx = readIndex(PROJECT);
  const queue = idx
    .filter((c) => ["queued", "indexed"].includes(c.status))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .slice(0, READ_BATCH);
  if (!queue.length) return { empty: true };

  let recorded = 0, failures = 0;
  for (const c of queue) {
    const doc = await fetchDoc(c);
    if (doc.unreachable) {
      updateCandidate(PROJECT, c.key, { status: "unreachable", reason: doc.unreachable, read_at: new Date().toISOString() });
      log(`  unreachable: ${(c.title || c.key).slice(0, 60)} — ${doc.unreachable.slice(0, 60)}`);
      continue;
    }

    const parsed = await claudeExtract(extractionPrompt(doc));
    if (!parsed) {
      failures++;
      log(`  extraction failed: ${(c.title || c.key).slice(0, 60)}`);
      if (failures >= MAX_READ_FAILURES) {
        log(`  ${failures} consecutive extraction failures — pausing this batch.`);
        break;
      }
      continue;
    }
    failures = 0;

    // Retraction check once per document, before anything from it is recorded.
    let retracted = false;
    if (c.doi || c.pmid) {
      try { retracted = !(await integrityCheck({ doi: c.doi, pmid: c.pmid })).clean; } catch {}
    }

    let got = 0;
    for (const f of parsed.findings || []) {
      const r = recordFinding(PROJECT, {
        ...f,
        retracted,
        source: {
          type: c.nct ? "clinical_trial_record" : "journal_article",
          title: c.title, doi: c.doi, pmid: c.pmid, nct: c.nct, url: c.url,
          journal: c.journal, year: c.year,
        },
      });
      if (r.ok) got++;
      else log(`    gate rejected: ${r.error.slice(0, 90)}`);
    }
    recorded += got;
    updateCandidate(PROJECT, c.key, {
      status: got ? "recorded" : "rejected",
      reason: got ? null : parsed.no_findings_reason || "no checkable findings",
      read_at: new Date().toISOString(),
    });
    log(`  read: ${(c.title || c.key).slice(0, 55)} → ${got} findings`);
  }
  return { read: queue.length, recorded };
}

// ---------------------------------------------------------------------------
// SAFETY — structured regulatory data, transcribed rather than judged
// ---------------------------------------------------------------------------

async function runSafety(substances) {
  for (const sub of substances) {
    try {
      const [label, ae] = await Promise.all([fdaLabel(sub), fdaAdverseEvents(sub)]);
      if (label.found && label.contraindications) {
        recordFinding(PROJECT, {
          claim: `The FDA label for ${sub} states contraindications and warnings for its approved indication.`,
          verbatim_quote: String(label.contraindications).replace(/\s+/g, " ").slice(0, 400),
          direction: "harm", evidence_tier: "regulatory_document",
          subject: sub, indication: "approved indication (not pancreatic cancer)",
          model_system: "human", species: "human",
          adverse_events: String(label.warnings || "").replace(/\s+/g, " ").slice(0, 300) || null,
          limitations: "Label data describes the approved indication and dose, not oncology use.",
          source: { type: "regulatory", title: `FDA label — ${sub}`, url: "https://labels.fda.gov/", publisher: "U.S. Food and Drug Administration" },
        });
      }
      if (ae.top_reactions?.length) {
        recordFinding(PROJECT, {
          claim: `FAERS holds ${ae.total_reports ?? "an unstated number of"} adverse-event reports naming ${sub}; the most frequently reported reactions are listed.`,
          verbatim_quote: `Most frequently reported reactions: ${ae.top_reactions.slice(0, 8).map((r) => `${r.reaction} (${r.count})`).join("; ")}`,
          direction: "harm", evidence_tier: "regulatory_document",
          subject: sub, indication: "all reported uses",
          model_system: "human", species: "human",
          limitations: "Spontaneous reporting: counts reflect reporting behaviour, not incidence, and carry no denominator.",
          source: { type: "regulatory", title: `openFDA FAERS — ${sub}`, url: "https://open.fda.gov/data/faers/", publisher: "U.S. Food and Drug Administration" },
        });
      }
      log(`  safety recorded: ${sub}`);
    } catch (e) {
      log(`  safety failed for ${sub}: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

async function main() {
  if (!acquireLock()) process.exit(0);
  initRun(PROJECT, { question: QUESTION, depth: DEPTH });
  log(`runner up · project=${PROJECT} · depth=${DEPTH} · corpus=${CORPUS_DIR}`);

  let idleRounds = 0;

  for (;;) {
    let a;
    try {
      a = nextAction(PROJECT);
    } catch (e) {
      log(`driver error: ${e.message}`);
      await sleep(30000);
      continue;
    }

    if (a.done) {
      log(`DONE — ${a.summary}`);
      try {
        const ds = exportDataset(PROJECT);
        log(`dataset exported: ${ds.dir} (${ds.files.length} files)`);
      } catch (e) { log(`export failed: ${e.message}`); }
      log("nothing left to do; sleeping 1h in case new work is queued.");
      await sleep(3600000);
      continue;
    }

    switch (a.state) {
      case "INDEXING": {
        const r = await runIndexBatch();
        if (r.done) log("query matrix exhausted");
        break;
      }
      case "TRIAGE":
        // nextAction performs triage itself; calling it again advances the state.
        break;
      case "READING": {
        const r = await runReadBatch();
        if (r.empty) {
          idleRounds++;
          log(`read queue empty but quotas unmet (round ${idleRounds}) — more indexing needed`);
          if (idleRounds > 3) { await runIndexBatch(); idleRounds = 0; }
        } else {
          idleRounds = 0;
          log(`batch: read ${r.read}, recorded ${r.recorded} findings · total ${corpusStats(PROJECT).findings}`);
        }
        break;
      }
      case "GAP_FILL":
        log(`gap: ${String(a.instruction).slice(0, 110)}`);
        // Safety gaps are fillable deterministically; the rest resolve through
        // further reading, which the next iteration will do.
        if (/safety_profile/.test(a.tool || "")) {
          await runSafety([...new Set(getFindings(PROJECT).map((f) => f.subject).filter(Boolean))]);
        }
        break;
      case "SAFETY":
        await runSafety(a.remaining || []);
        break;
      case "REPORT": {
        const md = renderWhitePaper(PROJECT, { title: `Evidence map: ${QUESTION.slice(0, 90)}` });
        log(`white paper written: ${saveReport(PROJECT, "white-paper", md)}`);
        break;
      }
      case "VISUAL": {
        const html = renderVisualReport(PROJECT, { question: QUESTION });
        const dir = join(CORPUS_DIR, PROJECT, "reports");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `visual-report-${new Date().toISOString().replace(/[:.]/g, "-")}.html`);
        writeFileSync(file, html, "utf8");
        log(`visual report written: ${file}`);
        break;
      }
      default:
        log(`unhandled state ${a.state}; waiting`);
        await sleep(20000);
    }

    await sleep(1500);
  }
}

// Only run when this file is the process entrypoint. Importing it — from a
// test, a tool, anything — must never start a runner against a live corpus.
// Learned the hard way: a test that imported this for its helpers launched a
// real run on the real project.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    log("fatal:", e);
    process.exit(1);
  });
}
