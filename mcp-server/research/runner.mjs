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
import { recordFailure, breakerOpen } from "./ratelimit.mjs";
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
// Ceiling on how many documents will ever be sent to the model. Each is one
// `claude -p` spawn, so this is the run's cost bound.
const MAX_DOCUMENTS = Number(process.env.RESEARCH_MAX_DOCUMENTS || 1200);
// No single source may stall the loop. Retries and per-request timeouts compose
// badly — a 45s timeout with four retries is three minutes of silence for ONE
// source on ONE query, and with ~1,264 queries that is days of dead time. This
// is the outer bound: past it the source is abandoned for that query, the gap is
// logged, and the loop moves on.
const SOURCE_TIMEOUT_MS = Number(process.env.RESEARCH_SOURCE_TIMEOUT_MS || 60000);

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} exceeded ${ms / 1000}s — abandoned for this query`)), ms))]);

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
  // Completion is keyed on (engine, query), not query alone. Keying on the query
  // meant one source erroring transiently marked the whole query done and that
  // source's coverage was silently lost with no way to notice.
  const searches = (await import("./corpus.mjs")).getSearches(PROJECT);
  // A pair is "settled" if it succeeded OR failed in a way that cannot recover.
  // Keying retries on transient failures only — otherwise a source that returns
  // 400 for a query shape it will never understand keeps that query pending
  // forever and the runner re-runs every source for it on every batch.
  const TERMINAL = /HTTP 4(0[0-9]|1[0-9]|2[0-8])\b|unsupported|not configured|disabled/i;
  const settled = new Set(
    searches
      .filter((q) => {
        const n = q.notes || "";
        if (!/^ERROR/.test(n)) return true;           // succeeded
        return TERMINAL.test(n);                       // failed permanently
      })
      .map((q) => `${q.engine}::${q.query}`),
  );
  const okPairs = settled;
  const SOURCES = ["pubmed", "europepmc", "clinicaltrials", "openalex", "web"];
  const pubmedSyntax = (q) => /\[(MeSH Terms|tiab|Title\/Abstract|Substance Name|All Fields)\]/i.test(q);
  const targetsFor = (q) => (pubmedSyntax(q) ? ["pubmed", "europepmc"] : SOURCES);
  const pending = matrix.queries.filter((q) => targetsFor(q.query).some((src) => !okPairs.has(`${src}::${q.query}`)));
  if (!pending.length) return { done: true };

  const batch = pending.slice(0, 4);

  // PubMed field tags ([MeSH Terms], [tiab]) are PubMed syntax. ClinicalTrials.gov
  // answers 400 and OpenAlex treats them as literal text, so routing them there
  // is a guaranteed wasted call.
  const isPubmedSyntax = (q) => /\[(MeSH Terms|tiab|Title\/Abstract|Substance Name|All Fields)\]/i.test(q);

  for (const q of batch) {
    const targets = isPubmedSyntax(q.query) ? ["pubmed", "europepmc"] : SOURCES;
    for (const src of SOURCES) {
      if (!targets.includes(src)) {
        logSearch(PROJECT, { engine: src, query: q.query, intent: q.intent, result_count: 0, notes: "ERROR: unsupported query syntax for this source (PubMed field tags)" });
        continue;
      }
      if (okPairs.has(`${src}::${q.query}`)) continue; // already succeeded
      // Skip a source that is cooling down rather than paying its timeout again.
      const br = breakerOpen(src);
      if (br.open) {
        logSearch(PROJECT, { engine: src, query: q.query, intent: q.intent, result_count: 0, notes: `cooling down (${br.seconds_left}s left)` });
        continue;
      }
      const t0 = Date.now();
      try {
        const r = await withTimeout(ENUMERATORS[src](q.query, { max: 400 }), SOURCE_TIMEOUT_MS, src);
        const y = indexCandidates(PROJECT, r.records, { engine: src, query: q.query, intent: q.intent });
        // Per-source logging: a query fans out across five sources, and without
        // this the log is silent for however long the slowest one takes. On a
        // run measured in days that is the difference between "working" and
        // "apparently hung".
        log(`  ${src.padEnd(15)} ${((Date.now() - t0) / 1000).toFixed(1)}s → ${r.retrieved} (${y.fresh} new)  "${q.query.slice(0, 42)}"`);
        logSearch(PROJECT, {
          engine: src, query: q.query, intent: q.intent,
          result_count: r.retrieved, reported_total: r.reported_total,
          exhausted: r.exhausted, hit_ceiling: r.hit_ceiling,
          marginal_yield: y.marginal_yield, notes: r.ceiling_reason,
        });
      } catch (e) {
        // A source that blew the outer time budget is refusing in slow motion.
        // Feed it to the breaker so it gets skipped for a cooldown instead of
        // costing the full timeout on every remaining query.
        if (/exceeded .*s — abandoned/.test(e.message)) recordFailure(src);
        log(`  ${src.padEnd(15)} ${((Date.now() - t0) / 1000).toFixed(1)}s → ERROR ${String(e.message).slice(0, 70)}`);
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
    let out = "", err = "", settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} done(null); }, 300000);
    // Without these, a spawn failure or a broken pipe is an uncaught exception
    // that takes the whole runner down — and launchd KeepAlive turns that into a
    // crash loop. A failure here must cost one document, never the run.
    p.on("error", () => done(null));
    p.stdin.on("error", () => {});
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return done(null);
      try { done(JSON.parse(m[0])); } catch { done(null); }
    });
    try { p.stdin.write(prompt); p.stdin.end(); } catch { done(null); }
  });
}

/**
 * Normalise for quote comparison: collapse whitespace, unify curly quotes and
 * dashes, drop case. Publishers vary these; a reader would still call it the
 * same sentence.
 */
const normaliseForQuote = (t) =>
  String(t || "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Does this quote actually appear in the document?
 *
 * Nothing else in the pipeline checks this. The verbatim quote is the single
 * mechanism that makes a claim checkable by a third party — if the model
 * paraphrases instead of copying, every downstream guarantee is hollow and
 * nothing would ever detect it. So the runner checks, and a quote that is not
 * in the document is dropped rather than recorded.
 */
function quoteIsReal(quote, docText) {
  const q = normaliseForQuote(quote);
  if (q.length < 20) return false;
  const hay = normaliseForQuote(docText);
  if (hay.includes(q)) return true;
  // Tolerate a trimmed tail (models often stop mid-sentence) but require a
  // substantial contiguous prefix to be present verbatim.
  const prefix = q.slice(0, Math.max(40, Math.floor(q.length * 0.6)));
  return hay.includes(prefix);
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

async function runReadBatch(driverQueue) {
  const idx = readIndex(PROJECT);
  const byKey = new Map(idx.map((c) => [c.key, c]));

  // Prefer the driver's stratum-targeted queue: it aims at whichever quota is
  // furthest behind, so null-result and safety literature get read rather than
  // whatever sits highest on one global list. Falling back to the global list
  // would read far more documents than the quotas actually require.
  let queue = (driverQueue || []).map((q) => byKey.get(q.key)).filter(Boolean);
  if (!queue.length) {
    queue = idx
      .filter((c) => ["queued", "indexed"].includes(c.status))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  queue = queue.slice(0, READ_BATCH);
  if (!queue.length) return { empty: true };

  // Hard ceiling on model spend across the whole run.
  const readSoFar = idx.filter((c) => ["read", "recorded", "rejected"].includes(c.status)).length;
  if (readSoFar >= MAX_DOCUMENTS) {
    log(`document budget reached (${readSoFar}/${MAX_DOCUMENTS}) — no further extraction`);
    return { empty: true, budget_exhausted: true };
  }

  let recorded = 0, failures = 0;
  for (const c of queue) {
    const doc = await fetchDoc(c);
    if (doc.unreachable) {
      updateCandidate(PROJECT, c.key, { status: "unreachable", reason: doc.unreachable, read_at: new Date().toISOString() });
      log(`  unreachable: ${(c.title || c.key).slice(0, 60)} — ${doc.unreachable.slice(0, 60)}`);
      continue;
    }

    const parsed = await claudeExtract(extractionPrompt(doc));

    // A malformed response is a TRANSIENT failure, not a verdict on the document.
    // Marking it "rejected" would be indistinguishable from a genuinely empty
    // paper; leaving it untouched would re-select it every batch forever. So it
    // gets an attempt counter and is retired only after repeated failures.
    const wellFormed = parsed && Array.isArray(parsed.findings);
    if (!wellFormed) {
      failures++;
      const attempts = (c.extract_attempts || 0) + 1;
      updateCandidate(PROJECT, c.key, { extract_attempts: attempts });
      if (attempts >= 3) {
        updateCandidate(PROJECT, c.key, { status: "rejected", reason: `extraction failed ${attempts} times`, read_at: new Date().toISOString() });
        log(`  giving up after ${attempts} extraction attempts: ${(c.title || c.key).slice(0, 55)}`);
      } else {
        log(`  extraction failed (attempt ${attempts}): ${(c.title || c.key).slice(0, 55)}`);
      }
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

    let got = 0, fabricated = 0;
    for (const f of parsed.findings) {
      if (!f || typeof f !== "object") continue;
      // The quote must actually be in the document. This is the check that keeps
      // "verbatim" meaningful.
      if (!quoteIsReal(f.verbatim_quote, doc.text)) {
        fabricated++;
        continue;
      }
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
      reason: got ? null : fabricated ? `${fabricated} quote(s) not found in the document` : parsed.no_findings_reason || "no checkable findings",
      read_at: new Date().toISOString(),
    });
    log(`  read: ${(c.title || c.key).slice(0, 50)} → ${got} findings${fabricated ? ` (${fabricated} dropped: quote not in document)` : ""}`);
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
        const r = await runReadBatch(a.read_queue);
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
        // Stable filename on purpose: a timestamped one meant a repeat wrote a
        // new file every pass instead of overwriting, filling the directory.
        const file = join(dir, "visual-report.html");
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
