#!/usr/bin/env node
/**
 * research-mcp — TOOL 1 OF 2: the deep research instrument.
 *
 * This server does ONE job: help an AI agent find, read, verify and record
 * FACTS, with a citation attached to every one, and then emit a report that is
 * assembled mechanically from those recorded facts.
 *
 * The report generator is deterministic template code, not a model prompt.
 * That is the point. The agent cannot editorialise its way into the report —
 * it can only put findings into the corpus, and the corpus renders itself.
 * Anything that looks like a conclusion in the output is a count of findings,
 * not an opinion about them.
 *
 * Bias controls, in the order they bite:
 *
 *   1. record_finding rejects any claim with no resolvable source.
 *   2. record_finding rejects any claim with no verbatim quote.
 *   3. Every finding must be classified benefit / harm / null / mixed.
 *   4. Every source is integrity-checked (retraction, correction, EoC) before
 *      it can back a finding.
 *   5. deep_search fires a mirrored DISCONFIRMING query set alongside every
 *      search, so the negative literature arrives in the same breath as the
 *      positive. You cannot only-search-for-yes.
 *   6. compile_report refuses to render until disconfirming searches exist,
 *      and always prints the direction balance and the coverage gaps at the
 *      top — including which engines never ran.
 *
 * Tools:
 *   deep_search        — one query across Google, DuckDuckGo, PubMed, Europe PMC,
 *                        ClinicalTrials.gov and OpenAlex, plus auto-disconfirming
 *   read_source        — fetch and read any page in full; extracts contacts + citations
 *   get_full_text      — open-access full text + its complete reference list
 *   expand_citations   — walk the citation graph backward and forward
 *   find_trials        — trials with investigator/coordinator contact details
 *   check_integrity    — retraction / correction / expression-of-concern check
 *   safety_profile     — FDA label + adverse-event signal for a substance
 *   record_finding     — enter one sourced fact into the corpus (the choke point)
 *   list_findings      — read the corpus back
 *   retract_finding    — supersede a finding that turned out to be wrong
 *   research_status    — coverage, balance, and what is still missing
 *   compile_report     — render the research report from recorded findings
 *
 * Corpus lives at RESEARCH_CORPUS_DIR (default ~/research-corpus/<project>/).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  recordFinding,
  getFindings,
  retractFinding,
  logSearch,
  getSearches,
  registerSource,
  getSources,
  saveReport,
  corpusStats,
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

const ok = (text) => ({ content: [{ type: "text", text }] });
const err = (text) => ({ content: [{ type: "text", text }], isError: true });
const j = (o) => JSON.stringify(o, null, 2);

// ---------------------------------------------------------------------------
// The disconfirming mirror — built into search, not left to the agent's virtue
// ---------------------------------------------------------------------------

const DISCONFIRM_TEMPLATES = [
  (q) => `${q} no benefit`,
  (q) => `${q} negative results`,
  (q) => `${q} failed trial OR terminated`,
  (q) => `${q} toxicity adverse events`,
  (q) => `${q} retracted OR "expression of concern"`,
  (q) => `${q} criticism OR rebuttal OR "methodological flaws"`,
];

function disconfirmingQueries(query, n = 3) {
  return DISCONFIRM_TEMPLATES.slice(0, n).map((t) => t(query));
}

// ---------------------------------------------------------------------------

const server = new Server(
  { name: "research-mcp", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions: `You are operating as a RESEARCH INSTRUMENT, not a commentator.

Your output is a record of what sources say, not what you think about it.

Rules that are not negotiable:
- Never state a fact you cannot cite. If you cannot cite it, it does not exist for
  this project.
- Never write "this suggests", "promising", "encouraging", "unfortunately",
  "despite the evidence", "mainstream medicine", "big pharma", "debunked", or any
  other framing word. Report the design, the n, the dose, the outcome, the
  effect size, the p-value, the funding, and the stated limitations. Let those speak.
- A negative or null result is exactly as important as a positive one and is
  recorded with the same care. If you record ten benefit findings and zero null
  findings, you have not finished searching — you have found a biased sample.
- Preclinical is not clinical. A result in a cell line or a mouse is recorded with
  evidence_tier in_vitro / animal_in_vivo and never described in human terms.
- Anecdotes and testimonials ARE data about what has been claimed. Record them —
  with evidence_tier anecdote_unverified, and note explicitly that no verification
  was possible. Never launder one into a stronger tier.
- Capture contact details whenever a source exposes them: corresponding authors,
  trial coordinators, principal investigators, sponsoring institutions.
- Check every source for retraction before recording a finding from it.

Work depth-first. A search result is a starting point, never an endpoint: open the
paper, read the full text, then walk its references backward to the primary source
and its citations forward to the replications and rebuttals.`,
  },
);

// ---------------------------------------------------------------------------
// Tool list
// ---------------------------------------------------------------------------

const P = (extra = {}) => ({
  project: {
    type: "string",
    description: "Project/corpus name, e.g. 'pancreatic-alt-agents'. All findings are filed under it.",
  },
  ...extra,
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "deep_search",
      description:
        "Run ONE research question across every configured layer at once: Google + DuckDuckGo (surface), and PubMed, Europe PMC, ClinicalTrials.gov and OpenAlex (primary literature). Automatically fires a mirrored set of DISCONFIRMING queries (no benefit / negative results / toxicity / retracted / criticism) so the negative literature arrives alongside the positive — this is not optional and cannot be turned off. Every query run is logged to the corpus so the final report can state what was searched for and found nothing. Returns raw results only; nothing enters the corpus until you read a source and call record_finding.",
      inputSchema: {
        type: "object",
        properties: P({
          query: { type: "string", description: "The research question, in the terms the literature would use." },
          layers: {
            type: "array",
            items: { type: "string", enum: ["google", "duckduckgo", "pubmed", "europepmc", "clinicaltrials", "openalex", "scholar"] },
            description: "Which layers to hit. Default: all of them. Narrow only when you have a reason.",
          },
          limit: { type: "number", description: "Results per layer (default 25)." },
          disconfirming_depth: { type: "number", description: "How many disconfirming variants to also run, 0-6 (default 3)." },
        }),
        required: ["project", "query"],
      },
    },
    {
      name: "read_source",
      description:
        "Fetch a URL and read it in full — not the snippet, the document. Returns the extracted text, every outbound citation link (DOI / PubMed / ClinicalTrials / preprint servers) so you can keep descending, and any contact details on the page (emails, phone numbers, corresponding-author lines). Registers the document in the corpus source registry. Call this before recording any finding from a web page.",
      inputSchema: {
        type: "object",
        properties: P({
          url: { type: "string" },
          max_chars: { type: "number", description: "Text cap, default 60000." },
        }),
        required: ["project", "url"],
      },
    },
    {
      name: "get_full_text",
      description:
        "Retrieve the complete open-access full text of an article from Europe PMC by PMC id, together with its ENTIRE reference list (title, DOI, PMID, year for each). Use this to get past the abstract — methods, dosing, adverse events and limitations live in the full text and almost never in the abstract. The reference list is the input to expand_citations.",
      inputSchema: {
        type: "object",
        properties: P({ pmcid: { type: "string", description: "e.g. PMC7250583" } }),
        required: ["project", "pmcid"],
      },
    },
    {
      name: "expand_citations",
      description:
        "The depth engine. Given a DOI, PMID or OpenAlex id, walk the citation graph in both directions: BACKWARD to everything the paper was built on (this is how you reach the primary source under a claim a blog post or review is paraphrasing) and FORWARD to everything that has cited it since (this is how you find replications, failures to replicate, retractions, and published rebuttals that no search engine will surface). Use this repeatedly — a claim you have not traced to its primary source is not researched.",
      inputSchema: {
        type: "object",
        properties: P({
          id: { type: "string", description: "DOI (10.xxxx/...), PMID, or OpenAlex work id." },
          direction: { type: "string", enum: ["backward", "forward", "both"], description: "Default both." },
          limit: { type: "number", description: "Max works per direction, default 50." },
        }),
        required: ["project", "id"],
      },
    },
    {
      name: "find_trials",
      description:
        "Search ClinicalTrials.gov (v2 API) and return full study records INCLUDING contact information: central contacts with phone and email, overall officials / principal investigators with affiliations, and per-site facility contacts. Also returns status, why_stopped for halted trials, phase, enrolment, interventions, primary outcomes, sponsor, collaborators and whether results were ever posted. Terminated and withdrawn trials are as important to record as completed ones.",
      inputSchema: {
        type: "object",
        properties: P({
          query: { type: "string", description: "e.g. 'ivermectin pancreatic cancer'." },
          status: {
            type: "string",
            description: "Optional filter: RECRUITING, COMPLETED, TERMINATED, WITHDRAWN, SUSPENDED, NOT_YET_RECRUITING, ACTIVE_NOT_RECRUITING, UNKNOWN.",
          },
          limit: { type: "number", description: "Default 50." },
        }),
        required: ["project", "query"],
      },
    },
    {
      name: "check_integrity",
      description:
        "Check whether a paper has been retracted, corrected, or had an expression of concern issued, using Crossref update-to records and OpenAlex retraction flags. Run this on any source before you record a finding from it. A retracted paper can still be recorded — as a finding about what was once claimed and then withdrawn — but it must never be recorded as live evidence.",
      inputSchema: {
        type: "object",
        properties: P({ doi: { type: "string" }, pmid: { type: "string" } }),
        required: ["project"],
      },
    },
    {
      name: "safety_profile",
      description:
        "Pull the regulatory and pharmacovigilance picture for a substance: the FDA label (approved indications, dosing, contraindications, warnings, interactions, clinical pharmacology) and the FAERS adverse-event report counts by reaction. This is the harm side of the ledger and must be gathered for every substance under study, not only the efficacy side.",
      inputSchema: {
        type: "object",
        properties: P({ substance: { type: "string", description: "Generic name, e.g. 'ivermectin'." } }),
        required: ["project", "substance"],
      },
    },
    {
      name: "record_finding",
      description:
        "Enter ONE sourced fact into the corpus. This is the only way anything reaches the report. Rejected if: no resolvable source (url/doi/pmid/nct), no verbatim quote of at least 20 characters copied word-for-word from the source, no direction classification, or no evidence tier. Record the study as it is, not as it would be convenient: the actual model system (cell line / mouse / human), the actual n, the actual dose and route as reported, the actual outcome measure, the funding, and the limitations the authors themselves stated. Record null and harm findings with the same diligence as benefit findings.",
      inputSchema: {
        type: "object",
        properties: P({
          claim: { type: "string", description: "The factual statement, in neutral language. What was done and what was observed. No interpretation." },
          verbatim_quote: { type: "string", description: "Word-for-word text from the source that supports the claim. Required." },
          direction: { type: "string", enum: DIRECTIONS, description: "benefit | harm | null | mixed | background. Classify honestly." },
          evidence_tier: { type: "string", enum: EVIDENCE_TIERS, description: "What kind of evidence this actually is." },
          subject: { type: "string", description: "Substance or intervention, e.g. 'fenbendazole'." },
          indication: { type: "string", description: "Disease/condition studied." },
          model_system: { type: "string", description: "'human', 'BALB/c mouse xenograft', 'PANC-1 cell line', etc. Be exact." },
          population_n: { type: "number", description: "Number of subjects/animals/replicates." },
          dose_reported: { type: "string", description: "Dose EXACTLY as the source reports it, with units. Never convert, never estimate." },
          route: { type: "string", description: "oral, IP, IV, topical..." },
          duration: { type: "string" },
          outcome_measure: { type: "string", description: "What was actually measured (OS, PFS, tumour volume, IC50, apoptosis %...)." },
          effect_size: { type: "string", description: "As reported: HR, RR, % change, IC50 value." },
          p_value: { type: "string" },
          adverse_events: { type: "string", description: "Adverse events reported, or 'none reported' / 'not assessed' — the distinction matters." },
          funding: { type: "string" },
          conflicts_of_interest: { type: "string" },
          limitations: { type: "string", description: "Limitations stated by the authors, plus any you can observe from the design." },
          retracted: { type: "boolean", description: "Set true if check_integrity flagged it." },
          contacts: {
            type: "array",
            description: "Contact details exposed by the source: corresponding authors, PIs, trial coordinators, institutions.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                role: { type: "string" },
                affiliation: { type: "string" },
                email: { type: "string" },
                phone: { type: "string" },
                url: { type: "string" },
              },
            },
          },
          source: {
            type: "object",
            description: "Where this came from. At least one of url/doi/pmid/nct is required.",
            properties: {
              type: { type: "string", description: "journal_article | preprint | clinical_trial_record | regulatory | conference_abstract | case_report | news | testimonial | other" },
              title: { type: "string" },
              url: { type: "string" },
              doi: { type: "string" },
              pmid: { type: "string" },
              nct: { type: "string" },
              journal: { type: "string" },
              year: { type: "string" },
              authors: { type: "string" },
              publisher: { type: "string" },
            },
          },
          tags: { type: "array", items: { type: "string" } },
        }),
        required: ["project", "claim", "verbatim_quote", "direction", "evidence_tier", "source"],
      },
    },
    {
      name: "list_findings",
      description: "Read the corpus back, optionally filtered by subject, direction or evidence tier. Use before recording to avoid duplicates, and to check your own balance mid-run.",
      inputSchema: {
        type: "object",
        properties: P({
          subject: { type: "string" },
          direction: { type: "string", enum: DIRECTIONS },
          evidence_tier: { type: "string", enum: EVIDENCE_TIERS },
          full: { type: "boolean", description: "Return complete records instead of one-line summaries." },
        }),
        required: ["project"],
      },
    },
    {
      name: "retract_finding",
      description: "Supersede a finding you recorded that turned out to be wrong, misattributed, or based on a retracted source. The original stays in the ledger with a retraction appended — the corpus is append-only so the history of what was believed remains auditable.",
      inputSchema: {
        type: "object",
        properties: P({ finding_id: { type: "string" }, reason: { type: "string" } }),
        required: ["project", "finding_id", "reason"],
      },
    },
    {
      name: "research_status",
      description:
        "Coverage and balance report for the corpus: how many findings, split by direction and by evidence tier, which subjects are covered, how much human vs preclinical evidence exists, how many disconfirming searches were run, and an explicit list of GAPS that would block a report. Call this before compile_report.",
      inputSchema: { type: "object", properties: P(), required: ["project"] },
    },
    {
      name: "compile_report",
      description:
        "Render the research report from recorded findings. The report is assembled by deterministic template code — it contains no generated prose, no interpretation and no conclusions, only: a coverage/limitations section stating what was and was not searched, the direction balance, an evidence table per substance ordered by evidence tier, every finding with its verbatim quote and citation, a contacts appendix, a full source bibliography, and the complete search log. Refuses to render if no disconfirming searches were run. This report is the input to the separate thesis tool.",
      inputSchema: {
        type: "object",
        properties: P({
          title: { type: "string", description: "Report title." },
          scope: { type: "string", description: "One neutral paragraph: what question this corpus was assembled to answer. Descriptive only." },
        }),
        required: ["project", "title"],
      },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const a = req.params.arguments || {};
  const project = a.project;

  try {
    switch (name) {
      // ---------------------------------------------------------------- search
      case "deep_search": {
        const layers = a.layers?.length
          ? a.layers
          : ["google", "duckduckgo", "pubmed", "europepmc", "clinicaltrials", "openalex"];
        const limit = a.limit || 25;
        const depth = a.disconfirming_depth ?? 3;

        const runOne = async (query, intent) => {
          const bundle = { query, intent, layers: {} };
          const jobs = layers.map(async (layer) => {
            try {
              let r;
              if (layer === "google") {
                const g = await googleSearch(query, { limit });
                r = g.unavailable ? { unavailable: g.unavailable, results: [] } : { results: g.results };
              } else if (layer === "scholar") {
                const g = await googleSearch(query, { limit, scholar: true });
                r = g.unavailable ? { unavailable: g.unavailable, results: [] } : { results: g.results };
              } else if (layer === "duckduckgo") {
                r = { results: await duckduckgoSearch(query, { limit }) };
              } else if (layer === "pubmed") {
                const p = await pubmedSearch(query, { limit });
                r = { total_in_db: p.total, results: p.records };
              } else if (layer === "europepmc") {
                const p = await europepmcSearch(query, { limit });
                r = { total_in_db: p.total, results: p.records };
              } else if (layer === "clinicaltrials") {
                const p = await clinicalTrialsSearch(query, { limit });
                r = { total_in_db: p.total, results: p.records };
              } else if (layer === "openalex") {
                const p = await openalexSearch(query, { limit });
                r = { total_in_db: p.total, results: p.records };
              }
              logSearch(project, {
                engine: layer,
                query,
                intent,
                result_count: r.results?.length || 0,
                notes: r.unavailable || null,
              });
              bundle.layers[layer] = r;
            } catch (e) {
              logSearch(project, { engine: layer, query, intent, result_count: 0, notes: `ERROR: ${e.message}` });
              bundle.layers[layer] = { error: String(e.message || e), results: [] };
            }
          });
          await Promise.all(jobs);
          return bundle;
        };

        const confirming = await runOne(a.query, "confirming");
        const disconfirming = [];
        for (const dq of disconfirmingQueries(a.query, depth)) {
          disconfirming.push(await runOne(dq, "disconfirming"));
        }

        const zeroResult = [];
        for (const b of [confirming, ...disconfirming])
          for (const [layer, r] of Object.entries(b.layers))
            if (!r.results?.length) zeroResult.push(`${layer}: "${b.query}" → ${r.unavailable || r.error || "0 results"}`);

        return ok(
          j({
            primary_query: confirming,
            disconfirming_queries: disconfirming,
            searched_and_found_nothing: zeroResult,
            reminder:
              "These are pointers, not evidence. Open the sources with read_source / get_full_text, run check_integrity, then record_finding with a verbatim quote. Record the null and harm results from the disconfirming set too.",
          }),
        );
      }

      // ------------------------------------------------------------------ read
      case "read_source": {
        const page = await fetchPage(a.url, { maxChars: a.max_chars || 60000 });
        registerSource(project, { url: page.url, contentType: page.contentType, read_at: new Date().toISOString() });
        return ok(j(page));
      }

      case "get_full_text": {
        const ft = await europepmcFullText(a.pmcid);
        registerSource(project, { url: `https://europepmc.org/article/PMC/${a.pmcid}`, type: "fulltext", read_at: new Date().toISOString() });
        return ok(
          j({
            ...ft,
            text: ft.text.slice(0, 120000),
            note: "The reference list above is the input to expand_citations — trace the claims you care about back to their primary sources.",
          }),
        );
      }

      case "expand_citations": {
        const r = await openalexExpand(a.id, { direction: a.direction || "both", limit: a.limit || 50 });
        return ok(
          j({
            ...r,
            note: "backward = what this paper rests on (find the primary source). forward = who cited it since (find replications, failures, rebuttals, retractions). Check is_retracted on every record.",
          }),
        );
      }

      case "find_trials": {
        const r = await clinicalTrialsSearch(a.query, { limit: a.limit || 50, status: a.status });
        const contacts = r.records.flatMap((s) => [
          ...s.central_contacts.map((c) => ({ ...c, nct: s.nct, trial: s.title })),
          ...s.overall_officials.map((c) => ({ ...c, nct: s.nct, trial: s.title })),
        ]);
        return ok(
          j({
            ...r,
            extracted_contacts: contacts,
            note: "Record TERMINATED and WITHDRAWN trials too — why_stopped is often the most informative field on the page.",
          }),
        );
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
            note: "Record the contraindications and interaction data as findings with direction='harm' or 'background'. A substance profile with no harm findings recorded is an incomplete profile.",
          }),
        );
      }

      // -------------------------------------------------------------- corpus
      case "record_finding": {
        const r = recordFinding(project, a);
        if (!r.ok) return err(r.error);
        const s = corpusStats(project);
        const nudges = [];
        if (s.byDirection.null === 0 && s.findings >= 5)
          nudges.push("No null findings recorded yet. Search explicitly for studies that found no effect before compiling.");
        if (s.byDirection.harm === 0 && s.findings >= 5)
          nudges.push("No harm findings recorded yet. Run safety_profile for each substance and record contraindications and adverse events.");
        if (s.preclinicalOnly && s.findings >= 5)
          nudges.push("Corpus is entirely preclinical so far — no human evidence recorded. This must be stated plainly in the report.");
        return ok(
          j({
            recorded: r.duplicate ? "duplicate (already in corpus)" : "ok",
            id: r.finding.id,
            balance: s.byDirection,
            total: s.findings,
            attention: nudges,
          }),
        );
      }

      case "list_findings": {
        const rows = getFindings(project, {
          subject: a.subject,
          direction: a.direction,
          evidence_tier: a.evidence_tier,
        });
        if (a.full) return ok(j(rows));
        return ok(
          j({
            count: rows.length,
            findings: rows.map((f) => ({
              id: f.id,
              subject: f.subject,
              direction: f.direction,
              tier: f.evidence_tier,
              model: f.model_system,
              n: f.population_n,
              claim: f.claim.slice(0, 200),
              cite: f.source.doi || f.source.pmid || f.source.nct || f.source.url,
              retracted: f.retracted || undefined,
            })),
          }),
        );
      }

      case "retract_finding": {
        retractFinding(project, a.finding_id, a.reason);
        return ok(`Finding ${a.finding_id} superseded. Reason recorded: ${a.reason}`);
      }

      case "research_status": {
        const s = corpusStats(project);
        const gaps = [];
        if (s.findings === 0) gaps.push("Corpus is empty.");
        if (s.disconfirmingSearches === 0)
          gaps.push("BLOCKER: no disconfirming searches logged. compile_report will refuse.");
        if (s.byDirection.null === 0) gaps.push("No null/no-effect findings recorded.");
        if (s.byDirection.harm === 0) gaps.push("No harm/safety findings recorded.");
        if (s.preclinicalOnly) gaps.push("No human-subject evidence of any tier in the corpus.");
        if (s.contacts === 0) gaps.push("No contact details captured from any source.");
        const googleRan = getSearches(project).some((x) => x.engine === "google" && !/^ERROR|not configured/i.test(x.notes || ""));
        if (!googleRan) gaps.push("Google layer never returned results (unconfigured or failing) — coverage is DuckDuckGo-only on the surface layer.");
        return ok(j({ corpus_dir: CORPUS_DIR, project, ...s, gaps }));
      }

      // -------------------------------------------------------------- report
      case "compile_report": {
        const s = corpusStats(project);
        if (s.findings === 0) return err("Nothing to compile — the corpus is empty.");
        if (s.disconfirmingSearches === 0)
          return err(
            "REFUSED: no disconfirming searches are logged for this project. A report built only from confirming searches is a biased sample by construction. Run deep_search (which fires disconfirming variants automatically) and record what it finds — including the null and harm results — then compile.",
          );
        const md = renderReport(project, a.title, a.scope, s);
        const file = saveReport(project, "research-report", md);
        return ok(`✅ Report written to ${file}\n\n${md}`);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(`❌ ${name} failed: ${e?.message || e}`);
  }
});

// ---------------------------------------------------------------------------
// Deterministic report renderer — no model prose reaches this output
// ---------------------------------------------------------------------------

const TIER_ORDER = EVIDENCE_TIERS;
const tierRank = (t) => {
  const i = TIER_ORDER.indexOf(t);
  return i === -1 ? 999 : i;
};

function renderReport(project, title, scope, s) {
  const findings = getFindings(project);
  const searches = getSearches(project);
  const sources = getSources(project);
  const now = new Date().toISOString().slice(0, 10);

  const L = [];
  L.push(`# ${title}`);
  L.push(``);
  L.push(`**Project:** \`${project}\` · **Compiled:** ${now} · **Findings:** ${s.findings} · **Sources read:** ${sources.length} · **Searches run:** ${searches.length}`);
  L.push(``);
  L.push(`> This document is generated mechanically from a citation-locked evidence corpus.`);
  L.push(`> It contains no interpretation, recommendation, or conclusion. Every statement below`);
  L.push(`> is a record of what a named source said, with the quote that says it. Where the`);
  L.push(`> corpus is thin or one-sided, that is stated rather than smoothed over.`);
  L.push(``);

  if (scope) {
    L.push(`## 1. Scope`);
    L.push(``);
    L.push(scope);
    L.push(``);
  }

  // ---- coverage + limitations FIRST, deliberately ----
  L.push(`## 2. Coverage and limitations of this corpus`);
  L.push(``);
  const engines = [...new Set(searches.map((x) => x.engine))];
  const failed = searches.filter((x) => /ERROR|not configured|unavailable/i.test(x.notes || ""));
  L.push(`- **Layers searched:** ${engines.join(", ") || "none"}`);
  L.push(`- **Queries run:** ${searches.length} total — ${s.disconfirmingSearches} of them explicitly disconfirming (searching for null results, failed trials, toxicity, retractions and published criticism).`);
  L.push(`- **Human-subject evidence in corpus:** ${s.humanEvidence} of ${s.findings} findings.${s.preclinicalOnly ? " **The corpus contains no human-subject evidence at all.** Every finding below is from cell culture, animal models, or non-clinical sources." : ""}`);
  L.push(`- **Retracted or superseded sources flagged:** ${s.retracted}`);
  if (failed.length) {
    L.push(`- **Coverage gaps — searches that could not run:**`);
    for (const f of [...new Set(failed.map((x) => `${x.engine}: ${x.notes}`))].slice(0, 10)) L.push(`  - ${f}`);
  }
  const empty = searches.filter((x) => x.result_count === 0 && !/ERROR/i.test(x.notes || ""));
  if (empty.length) {
    L.push(`- **Searched and found nothing** (absence of evidence, recorded as such):`);
    for (const e of empty.slice(0, 25)) L.push(`  - \`${e.engine}\` — "${e.query}"`);
    if (empty.length > 25) L.push(`  - …and ${empty.length - 25} more (see the full search log in §7).`);
  }
  L.push(``);

  // ---- balance ----
  L.push(`## 3. Balance of the evidence recorded`);
  L.push(``);
  L.push(`| Direction | Findings |`);
  L.push(`|---|---|`);
  for (const d of DIRECTIONS) L.push(`| ${d} | ${s.byDirection[d] || 0} |`);
  L.push(``);
  L.push(`| Evidence tier | Findings |`);
  L.push(`|---|---|`);
  for (const [t, n] of Object.entries(s.byTier).sort((x, y) => tierRank(x[0]) - tierRank(y[0])))
    L.push(`| ${t} | ${n} |`);
  L.push(``);
  if ((s.byDirection.null || 0) === 0 || (s.byDirection.harm || 0) === 0) {
    L.push(`> ⚠️ **Asymmetry notice.** This corpus contains ${s.byDirection.null || 0} null findings and ${s.byDirection.harm || 0} harm findings. A body of literature with no null and no harm results is characteristic of an incomplete search, not of an effect. Treat the balance above as a property of the search, not of the substances.`);
    L.push(``);
  }

  // ---- per-substance evidence tables ----
  L.push(`## 4. Evidence by substance`);
  L.push(``);
  const subjects = [...new Set(findings.map((f) => f.subject || "unspecified"))].sort();
  for (const subj of subjects) {
    const rows = findings
      .filter((f) => (f.subject || "unspecified") === subj)
      .sort((x, y) => tierRank(x.evidence_tier) - tierRank(y.evidence_tier));
    L.push(`### 4.${subjects.indexOf(subj) + 1} ${subj}`);
    L.push(``);
    const dir = {};
    for (const d of DIRECTIONS) dir[d] = rows.filter((r) => r.direction === d).length;
    L.push(`${rows.length} findings — benefit ${dir.benefit}, harm ${dir.harm}, null ${dir.null}, mixed ${dir.mixed}, background ${dir.background}.`);
    L.push(``);
    L.push(`| Tier | Model system | n | Dose as reported | Outcome measure | Result | Direction | Citation |`);
    L.push(`|---|---|---|---|---|---|---|---|`);
    for (const r of rows) {
      const cite = r.source.doi
        ? `[${r.source.doi}](https://doi.org/${r.source.doi})`
        : r.source.pmid
          ? `[PMID ${r.source.pmid}](https://pubmed.ncbi.nlm.nih.gov/${r.source.pmid}/)`
          : r.source.nct
            ? `[${r.source.nct}](https://clinicaltrials.gov/study/${r.source.nct})`
            : `[link](${r.source.url})`;
      L.push(
        `| ${r.evidence_tier}${r.retracted ? " **(RETRACTED)**" : ""} | ${r.model_system || "—"} | ${r.population_n ?? "—"} | ${r.dose_reported || "—"} | ${r.outcome_measure || "—"} | ${[r.effect_size, r.p_value].filter(Boolean).join(", ") || "—"} | ${r.direction} | ${cite} |`,
      );
    }
    L.push(``);
  }

  // ---- full findings with verbatim quotes ----
  L.push(`## 5. Findings in full, with source text`);
  L.push(``);
  L.push(`Each entry reproduces the quote the finding rests on, so every claim can be checked against its source without leaving this document.`);
  L.push(``);
  let n = 0;
  for (const subj of subjects) {
    const rows = findings
      .filter((f) => (f.subject || "unspecified") === subj)
      .sort((x, y) => tierRank(x.evidence_tier) - tierRank(y.evidence_tier));
    for (const f of rows) {
      n++;
      L.push(`#### F${n} · ${f.subject || "—"} · ${f.evidence_tier} · direction: **${f.direction}**${f.retracted ? " · ⛔ RETRACTED SOURCE" : ""}`);
      L.push(``);
      L.push(`${f.claim}`);
      L.push(``);
      L.push(`> ${f.verbatim_quote.replace(/\n/g, "\n> ")}`);
      L.push(``);
      const meta = [
        f.indication && `**Indication:** ${f.indication}`,
        f.model_system && `**Model:** ${f.model_system}`,
        f.population_n != null && `**n:** ${f.population_n}`,
        f.dose_reported && `**Dose (as reported):** ${f.dose_reported}`,
        f.route && `**Route:** ${f.route}`,
        f.duration && `**Duration:** ${f.duration}`,
        f.outcome_measure && `**Outcome:** ${f.outcome_measure}`,
        f.effect_size && `**Effect:** ${f.effect_size}`,
        f.p_value && `**p:** ${f.p_value}`,
      ].filter(Boolean);
      if (meta.length) L.push(meta.join(" · "));
      if (f.adverse_events) L.push(`\n**Adverse events:** ${f.adverse_events}`);
      if (f.limitations) L.push(`\n**Stated limitations:** ${f.limitations}`);
      if (f.funding) L.push(`\n**Funding:** ${f.funding}`);
      if (f.conflicts_of_interest) L.push(`\n**Declared conflicts:** ${f.conflicts_of_interest}`);
      const src = f.source;
      const bits = [src.authors, src.title, src.journal, src.year].filter(Boolean).join(". ");
      const ids = [
        src.doi && `DOI: ${src.doi}`,
        src.pmid && `PMID: ${src.pmid}`,
        src.nct && `NCT: ${src.nct}`,
        src.url && src.url,
      ]
        .filter(Boolean)
        .join(" · ");
      L.push(`\n**Source [${f.id}]:** ${bits}${bits ? ". " : ""}${ids}`);
      L.push(``);
    }
  }

  // ---- contacts ----
  L.push(`## 6. Contacts`);
  L.push(``);
  const contacts = findings.flatMap((f) =>
    (f.contacts || []).map((c) => ({ ...c, from: f.source.title || f.source.url, id: f.id })),
  );
  if (!contacts.length) {
    L.push(`No contact details were captured. If publications, trials or reported cases were reviewed, their corresponding authors, principal investigators or coordinators were not recorded — this is a gap in the corpus, not an absence of contacts.`);
  } else {
    L.push(`| Name | Role | Affiliation | Email | Phone | Source |`);
    L.push(`|---|---|---|---|---|---|`);
    const seen = new Set();
    for (const c of contacts) {
      const k = `${c.name}|${c.email}|${c.phone}`;
      if (seen.has(k)) continue;
      seen.add(k);
      L.push(`| ${c.name || "—"} | ${c.role || "—"} | ${c.affiliation || "—"} | ${c.email || "—"} | ${c.phone || "—"} | ${c.from || c.url || "—"} |`);
    }
    L.push(``);
    L.push(`_These are professional contact details published by the sources themselves (journal corresponding-author lines, trial registry contact blocks). They are recorded for research correspondence._`);
  }
  L.push(``);

  // ---- search log ----
  L.push(`## 7. Full search log`);
  L.push(``);
  L.push(`Every query run against every layer, so the search itself is reproducible and its blind spots are visible.`);
  L.push(``);
  L.push(`| Layer | Intent | Query | Results |`);
  L.push(`|---|---|---|---|`);
  for (const q of searches)
    L.push(`| ${q.engine} | ${q.intent} | ${q.query.replace(/\|/g, "\\|")} | ${q.result_count}${q.notes ? ` — ${q.notes.slice(0, 80)}` : ""} |`);
  L.push(``);

  // ---- bibliography ----
  L.push(`## 8. Bibliography`);
  L.push(``);
  const biblio = [...new Map(findings.map((f) => [f.source.doi || f.source.pmid || f.source.nct || f.source.url, f.source])).values()];
  biblio.sort((a, b) => String(a.year).localeCompare(String(b.year)));
  biblio.forEach((src, i) => {
    const bits = [src.authors, src.title, src.journal, src.year].filter(Boolean).join(". ");
    const ids = [src.doi && `https://doi.org/${src.doi}`, src.pmid && `https://pubmed.ncbi.nlm.nih.gov/${src.pmid}/`, src.nct && `https://clinicaltrials.gov/study/${src.nct}`, src.url]
      .filter(Boolean)
      .join(" · ");
    L.push(`${i + 1}. ${bits} ${ids}`);
  });
  L.push(``);
  L.push(`---`);
  L.push(``);
  L.push(`_Generated by research-mcp from corpus \`${project}\`. Corpus ledger: \`${CORPUS_DIR}/${project}/findings.jsonl\` (append-only). This report is a record of published claims and their evidence tiers. It is not medical advice and does not establish efficacy or safety for any use._`);

  return L.join("\n");
}

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`research-mcp v1.0.0 ready · corpus: ${CORPUS_DIR}`);
