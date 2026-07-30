#!/usr/bin/env node
/**
 * research-mcp — TOOL 1 OF 2: the deep research instrument.
 *
 * Pipeline, in the order the driver enforces it:
 *
 *   INDEX  →  TRIAGE  →  READ  →  GAP-FILL  →  SAFETY  →  WHITE PAPER  →  VISUAL
 *
 * The indexing layer runs FIRST and separately from reading. Its job is
 * enumeration: expand one question into hundreds of deliberate queries, page
 * every source to the bottom rather than to the bottom of page one, and park
 * every unique document in an append-only index with a stable identity. Only
 * then does anything get read, and the read order is computed — stratified so
 * that null results, safety literature and trial records cannot be crowded out
 * by whatever a search engine ranked highest.
 *
 * `next_action` is the driver. An autonomous run calls it, does exactly what it
 * says, and calls it again. It returns done:true only when both deliverables
 * exist on disk. State is recomputed from the ledgers every call, so a crashed
 * or resumed session picks up precisely where the corpus actually is.
 *
 * Everything the agent produces is gated at record_finding, which rejects any
 * claim without a resolvable source, a verbatim quotation, a direction, and a
 * tier. The reports are rendered by deterministic template code — the agent
 * cannot editorialise into them, it can only put findings in the ledger, and the
 * ledger renders itself.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  recordFinding,
  getFindings,
  retractFinding,
  logSearch,
  getSearches,
  registerSource,
  getSources,
  saveReport,
  listReports,
  corpusStats,
  indexCandidates,
  readIndex,
  updateCandidate,
  indexStats,
  coverageEstimate,
  sourceExhaustion,
  DIRECTIONS,
  EVIDENCE_TIERS,
  CORPUS_DIR,
} from "./corpus.mjs";

import {
  duckduckgoSearch,
  googleSearch,
  pubmedSearch,
  europepmcSearch,
  europepmcFullText,
  clinicalTrialsSearch,
  openalexSearch,
  openalexExpand,
  integrityCheck,
  fdaAdverseEvents,
  fdaLabel,
  fetchPage,
} from "./fetchers.mjs";

import { expandQueryMatrix, ENUMERATORS, TERMS } from "./index-layer.mjs";
import { nextAction, initRun, getRunConfig } from "./driver.mjs";
import { estimateProgress } from "./progress.mjs";
import { renderWhitePaper } from "./render-whitepaper.mjs";
import { renderVisualReport } from "./render-visual.mjs";
import { exportDataset } from "./export.mjs";
import { matchProfile, PROFILE_SCHEMA } from "./patient-match.mjs";
import { SPECIES, SPECIES_LABEL, ANIMAL_SPECIES, SPECIES_CAVEAT } from "./species.mjs";

const ok = (text) => ({ content: [{ type: "text", text }] });
const err = (text) => ({ content: [{ type: "text", text }], isError: true });
const j = (o) => JSON.stringify(o, null, 2);

const DISCONFIRM = [
  (q) => `${q} no significant difference`,
  (q) => `${q} failed OR "did not improve"`,
  (q) => `${q} terminated OR withdrawn trial`,
  (q) => `${q} toxicity adverse events`,
  (q) => `${q} retracted OR "expression of concern"`,
  (q) => `${q} criticism OR rebuttal OR "methodological flaws"`,
];

// ---------------------------------------------------------------------------

const server = new Server(
  { name: "research-mcp", version: "2.0.0" },
  {
    capabilities: { tools: {} },
    instructions: `You are operating as a RESEARCH INSTRUMENT, not a commentator.

Your output is a record of what sources say, not what you think about it.

THE LOOP: call next_action, do exactly what it says, call next_action again.
Repeat until it returns done:true. It will not return done:true until both the
white paper and the visual report exist. Do not stop before then, do not
substitute your own judgement about whether enough has been found, and do not
stop because results are starting to look repetitive — repetition is the signal
the saturation estimator is measuring, and it is being counted for you.

Rules that are not negotiable:

- Never state a fact you cannot cite. If you cannot cite it, it does not exist
  for this project.
- Never write "this suggests", "promising", "encouraging", "unfortunately",
  "mainstream medicine", "big pharma", "debunked", or any other framing word.
  Report the design, the species, the n, the dose, the outcome, the effect size,
  the p-value, the funding, and the stated limitations. Let those speak.
- A negative or null result is exactly as important as a positive one. If you
  have recorded ten benefit findings and zero null findings, you have not
  finished searching — you have found a biased sample.
- SPECIES IS ALWAYS RECORDED. "Animal study" is not a category. A mouse xenograft
  and a licensed canine tolerability study answer different questions. For these
  substances the veterinary record — dog, cattle, horse, sheep — is the best
  characterised safety data that exists, and it is invisible to any search that
  pairs the drug with "cancer". Record the species, the strain, and the model type.
- Preclinical is not clinical. Concentration in a well is not a dose in a body.
- Anecdotes ARE data about what has been claimed. Record them at
  anecdote_unverified and never launder one into a stronger tier.
- Capture contact details wherever a source exposes them.
- Check every source for retraction before recording a finding from it.
- EVERYTHING YOU WRITE IS IN ENGLISH. The claim, the model description, the
  limitations — all English, always. Non-English sources are valuable and you
  should search them, but when you record from one: leave verbatim_quote in the
  source's own language (never translate it — a translated quote is no longer
  verbatim and cannot be checked against the source) and put your English
  translation in verbatim_quote_english. The gate rejects a non-English claim,
  and rejects a non-English quote that arrives without a translation.
- Call run_progress whenever you want elapsed time and an estimate of what is
  left. It reports active working time separately from wall clock, so an
  overnight pause does not corrupt the estimate.

Work depth-first. A search result is a starting point, never an endpoint: open
the paper, read the full text, then walk its references backward to the primary
source and its citations forward to the replications and rebuttals.`,
  },
);

const P = (extra = {}) => ({
  project: { type: "string", description: "Project/corpus name, e.g. 'pancreatic-alt-agents'. All work is filed under it." },
  ...extra,
});

// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ================= DRIVER =================
    {
      name: "next_action",
      description:
        "★ THE MAIN LOOP. Returns the single next thing to do, with the exact tool and arguments, plus progress counts and why the run is not finished. Call it, do what it says, call it again. It returns done:true ONLY when the white paper and the visual report both exist on disk. State is recomputed from the ledgers on every call, so a crashed or resumed session continues exactly where the corpus is — there is no checkpoint to lose. Do not decide for yourself that research is complete; this tool decides, from computable coverage and quota predicates.",
      inputSchema: { type: "object", properties: P(), required: ["project"] },
    },
    {
      name: "start_run",
      description:
        "Open a research run: record the question, the substances, and the depth (quick | standard | exhaustive). Sets the saturation targets and read quotas the driver enforces. Call once at the beginning, then hand over to next_action.",
      inputSchema: {
        type: "object",
        properties: P({
          question: { type: "string", description: "The research question in plain terms." },
          substances: { type: "array", items: { type: "string" }, description: "Substances to cover. Defaults to the built-in table (ivermectin, methylene blue, mebendazole, fenbendazole, benzimidazole class)." },
          depth: { type: "string", enum: ["quick", "standard", "exhaustive"], description: "Query-matrix size. standard ≈ 440 queries, exhaustive ≈ 1120." },
          coverage_target: { type: "number", description: "Chao1 coverage required before indexing may finish (default 0.9)." },
          force: { type: "boolean", description: "Overwrite an existing run config." },
        }),
        required: ["project", "question"],
      },
    },

    // ================= INDEXING LAYER =================
    {
      name: "build_index",
      description:
        "★ THE INDEXING LAYER — run this FIRST, before reading anything. Expands the research question into the full deliberate query matrix (substance synonyms including the misspellings people actually type, indication synonyms, mechanism terms, study designs, outcomes, combination partners, a species/veterinary axis, a mandatory disconfirming axis, and a grey-literature axis), then runs each query against every source and pages it TO EXHAUSTION — not to the end of page one. Records for each query whether it reached the end of the source or hit the source's paging ceiling, because those are different facts. Deduplicates everything to a stable identity (DOI/PMID/NCT/normalised URL) and returns marginal-yield statistics so saturation can be measured. Nothing is read or judged here; this is enumeration only.",
      inputSchema: {
        type: "object",
        properties: P({
          depth: { type: "string", enum: ["quick", "standard", "exhaustive"], description: "Matrix size. Ignored when resume:true." },
          resume: { type: "boolean", description: "Continue the existing matrix from where it stopped. This is what next_action calls." },
          batch_size: { type: "number", description: "Queries to run this call (default 8). Each query fans out across all sources." },
          sources: { type: "array", items: { type: "string", enum: ["pubmed", "europepmc", "clinicaltrials", "openalex", "web"] }, description: "Defaults to all." },
          max_per_query: { type: "number", description: "Cap on records pulled per query per source (default 500). Raising it deepens enumeration and costs time." },
          substances: { type: "array", items: { type: "string" } },
        }),
        required: ["project"],
      },
    },
    {
      name: "run_progress",
      description:
        "★ Elapsed time and estimated time remaining. Reports two clocks that mean different things: wall-clock since the run started, and ACTIVE working time with idle gaps excluded — a run that pauses overnight would otherwise report a meaningless rate. Throughput is the median over active intervals, remaining work is counted from the query matrix and the unmet read quotas, and the estimate is given as a range with its basis stated. Says 'not yet measurable' rather than guessing when too little has been done.",
      inputSchema: { type: "object", properties: P(), required: ["project"] },
    },
    {
      name: "index_status",
      description:
        "The state of the index: how many unique documents, by status and stratum, how much of each source was actually enumerated versus how much it said it held, and the capture-recapture (Chao1) estimate of how much reachable literature has NOT been seen. The coverage figure — not the raw document count — is what says whether searching is done. A large index with low coverage means the space is still opening up.",
      inputSchema: { type: "object", properties: P(), required: ["project"] },
    },
    {
      name: "read_queue",
      description:
        "The next documents to read, in computed priority order. Priority is NOT citation rank — sorting by citations reads the famous positive papers first and, on any real budget, means null results and safety literature never get read at all. Disconfirming, safety and trial records are boosted deliberately to counteract that.",
      inputSchema: {
        type: "object",
        properties: P({
          limit: { type: "number", description: "Default 10." },
          strata: { type: "string", enum: ["human_trial", "disconfirming", "safety", "human_other", "preclinical", "grey"], description: "Restrict to one stratum." },
        }),
        required: ["project"],
      },
    },
    {
      name: "mark_read",
      description:
        "Mark an indexed document as dealt with, so the read queue advances. Status: 'recorded' (findings were extracted), 'rejected' (read and not relevant — say why), 'unreachable' (paywall, dead link, bot wall — the content is unknown and will be reported as a gap, not as an absence).",
      inputSchema: {
        type: "object",
        properties: P({
          key: { type: "string", description: "Candidate key from read_queue." },
          status: { type: "string", enum: ["read", "recorded", "rejected", "unreachable"] },
          reason: { type: "string", description: "Required for 'rejected' and 'unreachable'." },
        }),
        required: ["project", "key", "status"],
      },
    },

    // ================= RETRIEVAL =================
    {
      name: "deep_search",
      description:
        "One question across every layer at once — Google + DuckDuckGo (surface) and PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex (primary literature) — with a mirrored DISCONFIRMING query set fired automatically alongside it. Use for targeted follow-up during gap-filling; use build_index for systematic enumeration. Everything found is added to the index.",
      inputSchema: {
        type: "object",
        properties: P({
          query: { type: "string" },
          layers: { type: "array", items: { type: "string", enum: ["google", "duckduckgo", "pubmed", "europepmc", "clinicaltrials", "openalex", "scholar"] } },
          limit: { type: "number", description: "Per layer, default 25." },
          disconfirming_depth: { type: "number", description: "Disconfirming variants to also run, 0–6 (default 3)." },
        }),
        required: ["project", "query"],
      },
    },
    {
      name: "read_source",
      description:
        "Fetch a URL and read it in full — the document, not the snippet. Returns extracted text, every outbound citation link (DOI / PubMed / trial registry / preprint server) so you can keep descending, and any contact details on the page. Warns loudly when a page is client-rendered or bot-walled instead of quietly returning navigation chrome.",
      inputSchema: { type: "object", properties: P({ url: { type: "string" }, max_chars: { type: "number" } }), required: ["project", "url"] },
    },
    {
      name: "get_full_text",
      description:
        "Complete open-access full text from Europe PMC by PMC id, plus its ENTIRE reference list. Methods, dosing, species, adverse events and author-stated limitations live in the full text and almost never in the abstract. The reference list is the input to expand_citations.",
      inputSchema: { type: "object", properties: P({ pmcid: { type: "string", description: "e.g. PMC7250583" } }), required: ["project", "pmcid"] },
    },
    {
      name: "expand_citations",
      description:
        "The depth engine. Walks the citation graph BACKWARD from a paper (what it rests on — reaches the primary source under a claim a review or blog post is paraphrasing) and FORWARD (who cited it since — reaches replications, failures to replicate, and published rebuttals no search engine ranks). A claim you have not traced to its primary source is not researched.",
      inputSchema: {
        type: "object",
        properties: P({ id: { type: "string", description: "DOI, PMID, or OpenAlex id." }, direction: { type: "string", enum: ["backward", "forward", "both"] }, limit: { type: "number" } }),
        required: ["project", "id"],
      },
    },
    {
      name: "find_trials",
      description:
        "ClinicalTrials.gov v2 with full contact blocks: central contacts with phone and email, principal investigators with affiliations, per-site facility contacts. Also status, why_stopped for halted trials, phase, enrolment, interventions, outcomes, sponsor, and whether results were ever posted. Record TERMINATED and WITHDRAWN trials — why_stopped is often the most informative field on the page.",
      inputSchema: { type: "object", properties: P({ query: { type: "string" }, status: { type: "string" }, limit: { type: "number" } }), required: ["project", "query"] },
    },
    {
      name: "check_integrity",
      description: "Retraction / correction / expression-of-concern check via Crossref update-to records and OpenAlex flags. Run before recording any finding. A retracted paper may still be recorded — as a finding about what was claimed and then withdrawn — but never as live evidence.",
      inputSchema: { type: "object", properties: P({ doi: { type: "string" }, pmid: { type: "string" } }), required: ["project"] },
    },
    {
      name: "safety_profile",
      description:
        "The regulatory and pharmacovigilance picture for a substance: FDA label (indications, dosing, contraindications, warnings, interactions, clinical pharmacology) plus FAERS adverse-event counts by reaction. This is the harm side of the ledger and must be gathered for every substance, not only the efficacy side.",
      inputSchema: { type: "object", properties: P({ substance: { type: "string" } }), required: ["project", "substance"] },
    },

    // ================= THE LEDGER =================
    {
      name: "record_finding",
      description:
        "★ THE ONLY WAY ANYTHING REACHES A REPORT. Enter one sourced fact. Rejected if: no resolvable source (url/doi/pmid/nct), no verbatim quote of at least 20 characters copied word-for-word, no direction, or no evidence tier. Record the study as it is: the actual species and strain, the actual model type, the actual n, the actual dose and route AS REPORTED (never converted), the actual outcome measure, the funding, and the author-stated limitations. Record null and harm findings with the same diligence as benefit findings.",
      inputSchema: {
        type: "object",
        properties: P({
          claim: { type: "string", description: "The factual statement, ALWAYS IN ENGLISH, in neutral language — what was done and what was observed. No interpretation. Rejected if written in another language: the report is an English document." },
          verbatim_quote: { type: "string", description: "Word-for-word from the source, in the SOURCE'S OWN LANGUAGE. Never translate this — a translated quote is no longer verbatim and cannot be checked against the source." },
          verbatim_quote_english: { type: "string", description: "REQUIRED when verbatim_quote is not in English: your English translation of it. The report renders this as the body text and keeps the original beneath it." },
          direction: { type: "string", enum: DIRECTIONS, description: "benefit | harm | null | mixed | background. Classify honestly." },
          evidence_tier: { type: "string", enum: EVIDENCE_TIERS },
          subject: { type: "string", description: "Substance, e.g. 'fenbendazole'." },
          indication: { type: "string" },
          model_system: { type: "string", description: "Free text, exact: 'PANC-1 cell line', 'BALB/c nude mouse xenograft', 'client-owned beagles', 'human'." },
          species: { type: "string", enum: SPECIES, description: "Normalised species. Auto-derived from model_system when omitted, but state it explicitly when you know it — 'animal study' is not a category." },
          strain: { type: "string", description: "'BALB/c nude', 'Sprague-Dawley', 'Syrian golden', 'Beagle'." },
          animal_model_type: { type: "string", description: "xenograft | orthotopic | syngeneic | GEMM | chemically-induced | spontaneous | toxicology | pharmacokinetic | field study" },
          population_n: { type: "number" },
          dose_reported: { type: "string", description: "EXACTLY as the source reports it, with units. Never convert, never estimate, never scale between species." },
          route: { type: "string" },
          duration: { type: "string" },
          outcome_measure: { type: "string", description: "What was actually measured (OS, PFS, tumour volume, IC50, apoptosis %, serum level…)." },
          effect_size: { type: "string" },
          p_value: { type: "string" },
          adverse_events: { type: "string", description: "As reported, or 'none reported' / 'not assessed' — the distinction matters." },
          funding: { type: "string" },
          conflicts_of_interest: { type: "string" },
          limitations: { type: "string", description: "Author-stated limitations plus any observable from the design." },
          retracted: { type: "boolean" },
          contacts: {
            type: "array",
            description: "Contact details the source publishes: corresponding authors, PIs, trial coordinators.",
            items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, affiliation: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, url: { type: "string" } } },
          },
          source: {
            type: "object",
            description: "At least one of url/doi/pmid/nct required.",
            properties: {
              type: { type: "string" }, title: { type: "string" }, url: { type: "string" }, doi: { type: "string" },
              pmid: { type: "string" }, nct: { type: "string" }, journal: { type: "string" }, year: { type: "string" },
              authors: { type: "string" }, publisher: { type: "string" },
            },
          },
          tags: { type: "array", items: { type: "string" } },
        }),
        required: ["project", "claim", "verbatim_quote", "direction", "evidence_tier", "source"],
      },
    },
    {
      name: "list_findings",
      description: "Read the corpus back, filtered by substance, direction, evidence tier, or species. Use before recording to avoid duplicates and to check your own balance mid-run.",
      inputSchema: {
        type: "object",
        properties: P({
          subject: { type: "string" },
          direction: { type: "string", enum: DIRECTIONS },
          evidence_tier: { type: "string", enum: EVIDENCE_TIERS },
          species: { type: "string", enum: SPECIES },
          animals_only: { type: "boolean", description: "Only whole-animal studies (excludes human, cell line, in silico)." },
          full: { type: "boolean" },
        }),
        required: ["project"],
      },
    },
    {
      name: "species_breakdown",
      description:
        "The animal evidence, categorised by species — with each species' interpretive caveat attached. Animal work is several distinct literatures: rodent tumour models, the hamster chemically-induced model, and the licensed veterinary safety record in dogs, cattle, horses and sheep, which for the benzimidazoles is the best-characterised tolerability data that exists. Also flags findings whose species could not be classified from the recorded model description.",
      inputSchema: { type: "object", properties: P({ subject: { type: "string" } }), required: ["project"] },
    },
    {
      name: "retract_finding",
      description: "Supersede a finding that turned out to be wrong, misattributed, or based on a retracted source. The original stays in the ledger with a retraction appended — the corpus is append-only so the history of what was believed stays auditable.",
      inputSchema: { type: "object", properties: P({ finding_id: { type: "string" }, reason: { type: "string" } }), required: ["project", "finding_id", "reason"] },
    },
    {
      name: "research_status",
      description: "Coverage and balance: findings by direction, tier and species, human vs preclinical vs veterinary, disconfirming searches run, and an explicit list of gaps that would block a report.",
      inputSchema: { type: "object", properties: P(), required: ["project"] },
    },

    // ================= DELIVERABLES =================
    {
      name: "compile_whitepaper",
      description:
        "★ Render the WHITE PAPER — a systematic-review-style scientific document following PRISMA 2020 structure (with the flow diagram and its four stages of counts) and GRADE. Assembled by deterministic template code: no generated prose, no interpretation, no conclusions. In place of a Conclusions section it renders 'What this body of evidence does not establish', derived from the corpus. Refuses if no disconfirming searches were run.",
      inputSchema: { type: "object", properties: P({ title: { type: "string" }, objective: { type: "string", description: "One neutral sentence. Descriptive only." } }), required: ["project"] },
    },
    {
      name: "compile_visual_report",
      description:
        "★ Render the VISUAL REPORT — one self-contained HTML page (no external requests, inline SVG, light and dark themes, mobile-responsive, printable) built for a human to grasp in ninety seconds. Includes the evidence matrix with a hard line drawn under the human-subject tiers, a diverging benefit/harm balance, the saturation curve, the PRISMA flow, a species panel, the coverage gaps, a filterable findings table with verbatim quotes on expand, and the contacts directory. Designed so it is impossible to come away thinking the evidence is stronger than it is.",
      inputSchema: { type: "object", properties: P({ title: { type: "string" }, question: { type: "string" }, out_path: { type: "string", description: "Optional explicit output path." } }), required: ["project"] },
    },
    {
      name: "compile_report",
      description: "Alias of compile_whitepaper, kept for compatibility.",
      inputSchema: { type: "object", properties: P({ title: { type: "string" }, scope: { type: "string" } }), required: ["project"] },
    },

    // ================= RETENTION / PUBLISHING =================
    {
      name: "export_dataset",
      description:
        "★ THE DATA RETENTION LAYER. Projects the corpus into a stable, versioned, denormalised JSON dataset a website can consume directly — no database, no server, no joins. Emits manifest.json (schema version + content hash + consumer contract), findings.json, substances.json (with pre-computed honesty flags per substance so a site cannot render one without its caveat), sources.json, trials.json, contacts.json, coverage.json (the corpus's own limitations, for the site to display), searches.json, search-index.json (client-side filtering), schema.json, and thesis.json when a thesis exists. Output is deterministic — re-exporting an unchanged corpus produces byte-identical files, so the dataset can live in git and its diffs mean something. Every id is stable and URL-safe, so a permalink minted today still resolves after a re-run.",
      inputSchema: { type: "object", properties: P({ out_dir: { type: "string", description: "Default <corpus>/<project>/dataset." }, license: { type: "string" } }), required: ["project"] },
    },
    {
      name: "match_patient_context",
      description:
        "Match the corpus against one person's clinical context, for the site's 'tell us about your situation' flow. Returns: the evidence that applies to them grouped by substance and split human / preclinical / anecdote; interaction and contraindication flags raised against THEIR OWN medication and condition list, each with the verbatim quote and citation behind it; and the trials matching their diagnosis and location WITH the coordinator's phone and email. Also returns an explicit 'what this cannot tell you' list. It does NOT return a dose, a schedule, or a protocol for that person — it returns the literature and the phone numbers, so they and their clinician can read it together. STATELESS: the context is used in memory to filter and is never stored, logged, or transmitted.",
      inputSchema: {
        type: "object",
        properties: P({
          diagnosis: { type: "string" },
          stage: { type: "string" },
          biomarkers: { type: "array", items: { type: "string" } },
          prior_treatments: { type: "array", items: { type: "string" } },
          current_medications: { type: "array", items: { type: "string" }, description: "Generic names. Used only to raise interaction flags." },
          conditions: { type: "array", items: { type: "string" } },
          allergies: { type: "array", items: { type: "string" } },
          substances_of_interest: { type: "array", items: { type: "string" } },
          country: { type: "string" },
          region: { type: "string" },
          age_years: { type: "number" },
        }),
        required: ["project"],
      },
    },
  ],
}));

// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const a = req.params.arguments || {};
  const project = a.project;

  try {
    switch (name) {
      // ------------------------------------------------------------- driver
      case "next_action":
        return ok(j(nextAction(project)));

      case "start_run": {
        const cfg = initRun(project, {
          question: a.question,
          substances: a.substances,
          depth: a.depth || "standard",
          coverage_target: a.coverage_target,
          force: a.force,
        });
        const matrix = expandQueryMatrix({ depth: cfg.depth, substances: cfg.substances });
        return ok(
          j({
            run: cfg,
            query_matrix: { total: matrix.query_count, by_intent: matrix.by_intent, by_axis: matrix.by_axis },
            next: "Call next_action and follow it. Do not start reading before it tells you to — indexing runs first, and its exit condition is measured, not felt.",
          }),
        );
      }

      // ------------------------------------------------------------ indexing
      case "build_index": {
        const cfg = getRunConfig(project);
        const depth = a.depth || cfg.depth || "standard";
        const matrix = expandQueryMatrix({ depth, substances: a.substances || cfg.substances });
        const ran = new Set(getSearches(project).map((q) => q.query));
        const pending = matrix.queries.filter((q) => !ran.has(q.query));
        const batch = pending.slice(0, a.batch_size || 8);
        if (!batch.length)
          return ok(j({ done: true, message: `All ${matrix.query_count} queries in the ${depth} matrix have run.`, ...indexStats(project) }));

        const sources = a.sources?.length ? a.sources : ["pubmed", "europepmc", "clinicaltrials", "openalex", "web"];
        const maxPer = a.max_per_query || 500;
        const results = [];

        for (const q of batch) {
          const perQuery = { query: q.query, intent: q.intent, axis: q.axis, sources: {} };
          for (const src of sources) {
            const fn = ENUMERATORS[src];
            if (!fn) continue;
            try {
              const r = await fn(q.query, { max: maxPer });
              const yieldStats = indexCandidates(project, r.records, { engine: src, query: q.query, intent: q.intent });
              logSearch(project, {
                engine: src,
                query: q.query,
                intent: q.intent,
                result_count: r.retrieved,
                reported_total: r.reported_total,
                exhausted: r.exhausted,
                hit_ceiling: r.hit_ceiling,
                marginal_yield: yieldStats.marginal_yield,
                notes: r.ceiling_reason,
              });
              perQuery.sources[src] = {
                retrieved: r.retrieved,
                reported_total: r.reported_total,
                exhausted: r.exhausted,
                hit_ceiling: r.hit_ceiling,
                new_to_index: yieldStats.fresh,
                marginal_yield: yieldStats.marginal_yield,
              };
            } catch (e) {
              logSearch(project, { engine: src, query: q.query, intent: q.intent, result_count: 0, notes: `ERROR: ${e.message}` });
              perQuery.sources[src] = { error: String(e.message || e) };
            }
          }
          results.push(perQuery);
        }

        const ix = indexStats(project);
        return ok(
          j({
            ran: results,
            queries_remaining: pending.length - batch.length,
            index: { total: ix.total, coverage: ix.coverage, estimated_total: ix.estimated_total, unseen_estimate: ix.unseen_estimate },
            interpretation: ix.interpretation,
            next: "Call next_action. It will keep you indexing until coverage and marginal yield say the space is saturated.",
          }),
        );
      }

      case "run_progress": {
        const cfg = getRunConfig(project);
        const na = nextAction(project);
        return ok(j({ state: na.state, done: na.done, ...estimateProgress(project, cfg, na.state) }));
      }

      case "index_status": {
        const ix = indexStats(project);
        return ok(j({ project, corpus_dir: CORPUS_DIR, ...ix, per_source: sourceExhaustion(project) }));
      }

      case "read_queue": {
        const idx = readIndex(project);
        const q = idx
          .filter((c) => ["queued", "indexed"].includes(c.status))
          .filter((c) => !a.strata || c.strata === a.strata)
          .sort((x, y) => (y.priority || 0) - (x.priority || 0))
          .slice(0, a.limit || 10);
        return ok(
          j({
            count: q.length,
            queue: q.map((c) => ({ key: c.key, priority: c.priority, strata: c.strata, title: c.title, pmcid: c.pmcid, pmid: c.pmid, nct: c.nct, doi: c.doi, url: c.url })),
            how: "For each: get_full_text if a PMC id exists, else read_source. Then check_integrity. Then record_finding for every checkable statement — including null and harm results. Then mark_read.",
          }),
        );
      }

      case "mark_read": {
        if (["rejected", "unreachable"].includes(a.status) && !a.reason)
          return err(`REJECTED: status '${a.status}' requires a reason. A document dropped without a recorded reason is indistinguishable from one never seen.`);
        const r = updateCandidate(project, a.key, { status: a.status, reason: a.reason || null, read_at: new Date().toISOString() });
        if (!r.ok) return err(r.error);
        const ix = indexStats(project);
        return ok(j({ marked: a.key, status: a.status, read: ix.read, outstanding: ix.outstanding }));
      }

      // ----------------------------------------------------------- retrieval
      case "deep_search": {
        const layers = a.layers?.length ? a.layers : ["google", "duckduckgo", "pubmed", "europepmc", "clinicaltrials", "openalex"];
        const limit = a.limit || 25;
        const depth = a.disconfirming_depth ?? 3;

        const runOne = async (query, intent) => {
          const bundle = { query, intent, layers: {} };
          await Promise.all(
            layers.map(async (layer) => {
              try {
                let recs = [];
                let r;
                if (layer === "google" || layer === "scholar") {
                  const g = await googleSearch(query, { limit, scholar: layer === "scholar" });
                  r = g.unavailable ? { unavailable: g.unavailable, results: [] } : { results: g.results };
                  recs = (g.results || []).map((x) => ({ source_type: "web", url: x.url, title: x.title, snippet: x.snippet }));
                } else if (layer === "duckduckgo") {
                  const d = await duckduckgoSearch(query, { limit });
                  r = d.unavailable ? { unavailable: d.unavailable, results: [] } : { results: d.results };
                  recs = (d.results || []).map((x) => ({ source_type: "web", url: x.url, title: x.title, snippet: x.snippet }));
                } else if (layer === "pubmed") {
                  const p = await pubmedSearch(query, { limit });
                  r = { total_in_db: p.total, results: p.records };
                  recs = p.records;
                } else if (layer === "europepmc") {
                  const p = await europepmcSearch(query, { limit });
                  r = { total_in_db: p.total, results: p.records };
                  recs = p.records;
                } else if (layer === "clinicaltrials") {
                  const p = await clinicalTrialsSearch(query, { limit });
                  r = { total_in_db: p.total, results: p.records };
                  recs = p.records;
                } else if (layer === "openalex") {
                  const p = await openalexSearch(query, { limit });
                  r = { total_in_db: p.total, results: p.records };
                  recs = p.records;
                }
                const y = indexCandidates(project, recs, { engine: layer, query, intent });
                logSearch(project, { engine: layer, query, intent, result_count: recs.length, marginal_yield: y.marginal_yield, notes: r.unavailable || null });
                bundle.layers[layer] = { ...r, new_to_index: y.fresh };
              } catch (e) {
                logSearch(project, { engine: layer, query, intent, result_count: 0, notes: `ERROR: ${e.message}` });
                bundle.layers[layer] = { error: String(e.message || e), results: [] };
              }
            }),
          );
          return bundle;
        };

        const confirming = await runOne(a.query, "confirming");
        const disconfirming = [];
        for (const t of DISCONFIRM.slice(0, depth)) disconfirming.push(await runOne(t(a.query), "disconfirming"));

        const zero = [];
        for (const b of [confirming, ...disconfirming])
          for (const [layer, r] of Object.entries(b.layers))
            if (!r.results?.length) zero.push(`${layer}: "${b.query}" → ${r.unavailable || r.error || "0 results"}`);

        return ok(
          j({
            primary_query: confirming,
            disconfirming_queries: disconfirming,
            searched_and_found_nothing: zero,
            reminder: "Pointers, not evidence. Open the sources, run check_integrity, then record_finding with a verbatim quote — including the null and harm results from the disconfirming set.",
          }),
        );
      }

      case "read_source": {
        const page = await fetchPage(a.url, { maxChars: a.max_chars || 60000 });
        registerSource(project, { url: page.url, contentType: page.contentType, read_at: new Date().toISOString() });
        return ok(j(page));
      }

      case "get_full_text": {
        const ft = await europepmcFullText(a.pmcid);
        registerSource(project, { url: `https://europepmc.org/article/PMC/${a.pmcid}`, type: "fulltext", read_at: new Date().toISOString() });
        return ok(j({ ...ft, text: ft.text.slice(0, 120000), note: "The reference list is the input to expand_citations. Trace the claims you care about back to their primary sources." }));
      }

      case "expand_citations": {
        const r = await openalexExpand(a.id, { direction: a.direction || "both", limit: a.limit || 50 });
        indexCandidates(
          project,
          [...r.backward, ...r.forward].map((w) => ({ ...w, url: w.url })),
          { engine: "openalex-citations", query: `expand:${a.id}`, intent: "confirming" },
        );
        return ok(j({ ...r, note: "backward = what this rests on (find the primary source). forward = who cited it since (replications, failures, rebuttals, retractions). Check is_retracted on every record." }));
      }

      case "find_trials": {
        const r = await clinicalTrialsSearch(a.query, { limit: a.limit || 50, status: a.status });
        indexCandidates(project, r.records, { engine: "clinicaltrials", query: a.query, intent: "confirming" });
        const contacts = r.records.flatMap((st) => [
          ...st.central_contacts.map((c) => ({ ...c, nct: st.nct, trial: st.title })),
          ...st.overall_officials.map((c) => ({ ...c, nct: st.nct, trial: st.title })),
        ]);
        return ok(j({ ...r, extracted_contacts: contacts, note: "Record TERMINATED and WITHDRAWN trials too — why_stopped is often the most informative field on the page." }));
      }

      case "check_integrity": {
        if (!a.doi && !a.pmid) return err("Provide doi or pmid.");
        return ok(j(await integrityCheck({ doi: a.doi, pmid: a.pmid })));
      }

      case "safety_profile": {
        const [label, ae] = await Promise.all([fdaLabel(a.substance), fdaAdverseEvents(a.substance)]);
        return ok(
          j({
            label,
            adverse_events: ae,
            note: "Record the contraindications and interaction data as findings (direction 'harm' or 'background', tier 'regulatory_document'). Also search the VETERINARY record for this substance — for the benzimidazoles the licensed dog/cattle/horse tolerability data is the best-characterised safety evidence that exists, and it never appears in an oncology search.",
          }),
        );
      }

      // -------------------------------------------------------------- ledger
      case "record_finding": {
        const r = recordFinding(project, a);
        if (!r.ok) return err(r.error);
        const s = corpusStats(project);
        const nudges = [];
        if (s.byDirection.null === 0 && s.findings >= 5) nudges.push("No null findings yet. Search explicitly for studies reporting no effect before compiling.");
        if (s.byDirection.harm === 0 && s.findings >= 5) nudges.push("No harm findings yet. Run safety_profile for each substance and record contraindications and adverse events.");
        if (s.preclinicalOnly && s.findings >= 5) nudges.push("Corpus is entirely preclinical — no human evidence. This will be stated plainly at the top of the report.");
        if (r.finding.species_confidence === "none")
          nudges.push(`Species could not be determined from model_system "${r.finding.model_system || "(empty)"}". Set species explicitly — unclassified species become a reported gap.`);
        return ok(
          j({
            recorded: r.duplicate ? "duplicate (already in corpus)" : "ok",
            id: r.finding.id,
            species: r.finding.species,
            species_confidence: r.finding.species_confidence,
            balance: s.byDirection,
            total: s.findings,
            attention: nudges,
          }),
        );
      }

      case "list_findings": {
        const rows = getFindings(project, { subject: a.subject, direction: a.direction, evidence_tier: a.evidence_tier, species: a.species, animals_only: a.animals_only });
        if (a.full) return ok(j(rows));
        return ok(
          j({
            count: rows.length,
            findings: rows.map((f) => ({
              id: f.id, subject: f.subject, direction: f.direction, tier: f.evidence_tier,
              species: f.species, strain: f.strain, model: f.model_system, n: f.population_n,
              dose: f.dose_reported, claim: f.claim.slice(0, 180),
              cite: f.source.doi || f.source.pmid || f.source.nct || f.source.url,
              retracted: f.retracted || undefined,
            })),
          }),
        );
      }

      case "species_breakdown": {
        const rows = getFindings(project, { subject: a.subject });
        const bySpecies = {};
        for (const f of rows) {
          const k = f.species || "unspecified";
          bySpecies[k] ||= { label: SPECIES_LABEL[k] || k, is_animal: ANIMAL_SPECIES.includes(k), count: 0, caveat: SPECIES_CAVEAT[k] || null, strains: new Set(), model_types: new Set(), directions: {}, findings: [] };
          const b = bySpecies[k];
          b.count++;
          if (f.strain) b.strains.add(f.strain);
          if (f.animal_model_type) b.model_types.add(f.animal_model_type);
          b.directions[f.direction] = (b.directions[f.direction] || 0) + 1;
          b.findings.push({ id: f.id, subject: f.subject, tier: f.evidence_tier, dose: f.dose_reported, route: f.route, n: f.population_n, outcome: f.outcome_measure, direction: f.direction });
        }
        for (const k of Object.keys(bySpecies)) {
          bySpecies[k].strains = [...bySpecies[k].strains];
          bySpecies[k].model_types = [...bySpecies[k].model_types];
        }
        const unclassified = rows.filter((f) => f.species === "unspecified" || f.species_confidence === "none");
        return ok(
          j({
            total_findings: rows.length,
            animal_findings: rows.filter((f) => ANIMAL_SPECIES.includes(f.species)).length,
            animal_species_present: [...new Set(rows.filter((f) => ANIMAL_SPECIES.includes(f.species)).map((f) => f.species))],
            by_species: bySpecies,
            unclassified: unclassified.map((f) => ({ id: f.id, model_system: f.model_system, tier: f.evidence_tier })),
            note: "Veterinary species (dog, cattle, horse, sheep) carry licensed tolerability and pharmacokinetic data for the benzimidazoles. If those rows are empty, that literature has not been searched — it does not appear in oncology queries.",
          }),
        );
      }

      case "retract_finding": {
        retractFinding(project, a.finding_id, a.reason);
        return ok(`Finding ${a.finding_id} superseded. Reason recorded: ${a.reason}`);
      }

      case "research_status": {
        const s = corpusStats(project);
        const ix = indexStats(project);
        const gaps = [];
        if (s.findings === 0) gaps.push("Corpus is empty.");
        if (s.disconfirmingSearches === 0) gaps.push("BLOCKER: no disconfirming searches logged. compile_whitepaper will refuse.");
        if (s.byDirection.null === 0) gaps.push("No null/no-effect findings recorded.");
        if (s.byDirection.harm === 0) gaps.push("No harm/safety findings recorded.");
        if (s.preclinicalOnly) gaps.push("No human-subject evidence of any tier.");
        if (s.animalEvidence === 0) gaps.push("No animal (in vivo) evidence recorded.");
        if (s.speciesUnclassified > 0) gaps.push(`${s.speciesUnclassified} findings have an unclassified species.`);
        if (s.contacts === 0) gaps.push("No contact details captured from any source.");
        const googleRan = getSearches(project).some((x) => x.engine === "google" && !/error|not configured/i.test(x.notes || ""));
        if (!googleRan) gaps.push("Google layer never returned results — surface coverage is DuckDuckGo-only.");
        return ok(j({ corpus_dir: CORPUS_DIR, project, ...s, index: { total: ix.total, read: ix.read, outstanding: ix.outstanding, coverage: ix.coverage }, gaps }));
      }

      // -------------------------------------------------------- deliverables
      case "compile_whitepaper":
      case "compile_report": {
        const s = corpusStats(project);
        if (s.findings === 0) return err("Nothing to compile — the corpus is empty.");
        if (s.disconfirmingSearches === 0)
          return err(
            "REFUSED: no disconfirming searches are logged. A report built only from confirming searches is a biased sample by construction. Run build_index or deep_search (both fire disconfirming queries) and record what they find — including the null and harm results — then compile.",
          );
        const md = renderWhitePaper(project, { title: a.title, objective: a.objective || a.scope });
        const file = saveReport(project, "white-paper", md);
        return ok(`✅ White paper written to ${file}\n\n${md.slice(0, 4000)}${md.length > 4000 ? `\n\n… (${md.length} chars total, full document at the path above)` : ""}`);
      }

      case "compile_visual_report": {
        const s = corpusStats(project);
        if (s.findings === 0) return err("Nothing to render — the corpus is empty.");
        const html = renderVisualReport(project, { title: a.title, question: a.question });
        const dir = join(CORPUS_DIR, project, "reports");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const file = a.out_path || join(dir, `visual-report-${new Date().toISOString().replace(/[:.]/g, "-")}.html`);
        writeFileSync(file, html, "utf8");
        return ok(
          j({
            written: file,
            bytes: Buffer.byteLength(html),
            self_contained: true,
            panels: ["KPI row", "evidence matrix (human/non-human divider)", "direction balance (diverging)", "saturation curve", "PRISMA flow", "coverage gaps", "findings table with verbatim quotes", "contacts directory"],
            open_with: `open "${file}"`,
          }),
        );
      }

      // ------------------------------------------------------------ dataset
      case "export_dataset": {
        const r = exportDataset(project, { out_dir: a.out_dir, license: a.license });
        return ok(j({ ...r, note: "Deterministic output — re-exporting an unchanged corpus produces byte-identical files. Pin manifest.schema_version in any consumer, and honour manifest.consumer_contract.required_display." }));
      }

      case "match_patient_context": {
        const { project: _p, ...profile } = a;
        const r = matchProfile(project, profile);
        return ok(j(r));
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(`❌ ${name} failed: ${e?.message || e}`);
  }
});

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`research-mcp v2.0.0 ready · corpus: ${CORPUS_DIR}`);
