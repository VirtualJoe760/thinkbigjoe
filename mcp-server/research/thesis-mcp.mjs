#!/usr/bin/env node
/**
 * thesis-mcp — TOOL 2 OF 2: the treatment-thesis instrument.
 *
 * Reads the corpus produced by research-mcp (read-only — it has no path to
 * write or alter a finding) and helps an agent build an INVESTIGATIONAL
 * PROTOCOL THESIS: a structured, fully-traced argument for what a treatment
 * protocol built on this evidence would look like, what grade of evidence
 * stands behind each piece of it, and what would prove it wrong.
 *
 * The design constraint that makes this honest:
 *
 *   EVERY PARAMETER MUST TRACE TO A FINDING.
 *
 * propose_parameter will not accept a dose, a route, a schedule or a duration
 * that is not carried by a finding id already in the corpus. The agent cannot
 * invent a number, cannot round one, cannot extrapolate a mouse mg/kg into a
 * human dose without that conversion being an explicit, labelled, cited step.
 * If the literature does not contain the number, the thesis says so and the
 * parameter is rendered as an OPEN QUESTION instead of a value.
 *
 * The second constraint: the thesis is not finished until it can be killed.
 * define_falsification is mandatory — compile_thesis refuses without it. A
 * thesis that specifies no observation which would refute it is not a thesis.
 *
 * The third: a mandatory safety pass. compile_thesis refuses until every
 * substance in the protocol has an interaction/contraindication assessment
 * recorded against it.
 *
 * Output framing is fixed by the renderer: investigational hypothesis for
 * research use, with evidence grade and species provenance on every line.
 * It is not a prescription and the renderer will not render it as one.
 *
 * Tools:
 *   load_evidence        — the corpus, organised for thesis work
 *   assess_mechanism     — a mechanistic hypothesis, citing findings
 *   propose_parameter    — one protocol parameter, traced to findings (or marked open)
 *   assess_safety        — mandatory interaction / contraindication / monitoring pass
 *   define_falsification — mandatory: what observation would refute this thesis
 *   grade_thesis         — GRADE-style strength assessment of the whole argument
 *   thesis_status        — what is recorded, what is still blocking compilation
 *   compile_thesis       — render the thesis document
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  getFindings,
  getSearches,
  corpusStats,
  appendRecord,
  readRecords,
  saveReport,
  listReports,
  readReport,
  CORPUS_DIR,
} from "./corpus.mjs";

const ok = (t) => ({ content: [{ type: "text", text: t }] });
const err = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const j = (o) => JSON.stringify(o, null, 2);

const HUMAN_TIERS = new Set([
  "meta_analysis",
  "rct",
  "controlled_trial_nonrandomized",
  "cohort",
  "case_control",
  "case_series",
  "case_report",
]);

const PARAM_KINDS = [
  "agent_selection",
  "dose",
  "route",
  "schedule",
  "duration",
  "combination",
  "sequencing",
  "monitoring",
  "stopping_rule",
  "inclusion_criteria",
  "exclusion_criteria",
  "endpoint",
];

const GRADES = ["high", "moderate", "low", "very_low", "insufficient"];

// ---------------------------------------------------------------------------

const server = new Server(
  { name: "thesis-mcp", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions: `You are building an INVESTIGATIONAL THESIS from an existing evidence corpus.

You are not advocating. You are constructing an argument whose every joint is
visible, so that a reviewer can see exactly where it is strong and exactly where
it is held together by a single mouse study.

Rules:
- Every parameter you propose must cite finding ids from the corpus. If the number
  you want is not in a finding, you may not write the number. Record it as an open
  question instead — an honest gap is worth more than a fabricated value.
- Species provenance travels with the number. A dose from a mouse study is a mouse
  dose. If you convert it, the conversion is its own labelled step with its own
  citation (e.g. an allometric-scaling reference), and the result is still labelled
  as derived, not observed.
- The corpus's own asymmetries are yours to inherit, not to launder. If the corpus
  holds no human evidence, the thesis says at the top that it holds no human evidence.
- Do not use advocacy vocabulary: promising, suppressed, ignored, breakthrough,
  natural, safe, cure, proven. Use: observed, reported, not measured, unreplicated,
  contradicted by, grade low.
- Safety is not a footnote. Every substance in a proposed combination needs its
  interaction and contraindication assessment recorded, or the thesis will not compile.
- Finish by stating what would refute you. If nothing could, you have written an
  advertisement, not a thesis.`,
  },
);

const P = (extra = {}) => ({
  project: { type: "string", description: "The corpus project name used by research-mcp." },
  ...extra,
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "load_evidence",
      description:
        "Load the research corpus, organised for thesis work: findings grouped by substance and by evidence tier, the direction balance, the human vs preclinical split, the safety/harm findings pulled out separately, and the coverage gaps inherited from the research phase. Start here — the thesis may only be built from what is in this payload. Optionally loads a compiled research report too.",
      inputSchema: {
        type: "object",
        properties: P({
          subject: { type: "string", description: "Limit to one substance." },
          include_report: { type: "boolean", description: "Also return the latest compiled research report markdown." },
          full: { type: "boolean", description: "Return complete finding records including verbatim quotes." },
        }),
        required: ["project"],
      },
    },
    {
      name: "assess_mechanism",
      description:
        "Record one mechanistic hypothesis: a proposed biological pathway by which a substance might act on the target condition, with the finding ids that support it and, separately, the finding ids that contradict or fail to replicate it. Both fields are required — a mechanism with no listed contradicting evidence must state explicitly that a search for it was performed and returned nothing. Also record what has NOT been demonstrated (e.g. pathway shown in vitro but never in tissue).",
      inputSchema: {
        type: "object",
        properties: P({
          substance: { type: "string" },
          pathway: { type: "string", description: "The proposed mechanism, stated as a testable biological claim." },
          supporting_findings: { type: "array", items: { type: "string" }, description: "Finding ids from the corpus." },
          contradicting_findings: { type: "array", items: { type: "string" }, description: "Finding ids that contradict or failed to replicate. If empty, set searched_for_contradiction." },
          searched_for_contradiction: { type: "string", description: "If no contradicting findings exist, state what was searched to establish that." },
          demonstrated_in: { type: "string", description: "Highest level at which this pathway has actually been shown: in vitro / animal / human tissue / human clinical." },
          not_demonstrated: { type: "string", description: "What this mechanism has NOT been shown to do. Required." },
          plausibility_notes: { type: "string", description: "Pharmacokinetic reality check: are the concentrations that produced the in vitro effect achievable in human plasma/tissue at tolerated doses? Cite findings." },
        }),
        required: ["project", "substance", "pathway", "supporting_findings", "demonstrated_in", "not_demonstrated"],
      },
    },
    {
      name: "propose_parameter",
      description:
        "Propose ONE parameter of the investigational protocol (dose, route, schedule, duration, combination, monitoring, stopping rule, endpoint, inclusion/exclusion). Each parameter MUST cite the finding ids it derives from — the tool verifies those ids exist in the corpus and will reject the parameter if they do not. If the corpus contains no basis for the value, do not guess: set open_question=true and describe what evidence would be needed to set it. Doses derived by cross-species conversion must set derived=true and cite the conversion basis; the renderer labels them as derived, never as observed.",
      inputSchema: {
        type: "object",
        properties: P({
          kind: { type: "string", enum: PARAM_KINDS },
          substance: { type: "string" },
          value: { type: "string", description: "The proposed value with units, or omit if open_question." },
          basis_findings: { type: "array", items: { type: "string" }, description: "Finding ids this value comes from. Verified against the corpus." },
          derived: { type: "boolean", description: "True if this value was computed (e.g. allometric scaling) rather than read directly from a source." },
          derivation: { type: "string", description: "If derived: the exact arithmetic and the citation for the conversion method." },
          open_question: { type: "boolean", description: "True if the corpus provides no basis. Then value is ignored and evidence_needed is required." },
          evidence_needed: { type: "string", description: "If open_question: what study would settle it." },
          rationale: { type: "string", description: "Why this value rather than another — in terms of the cited findings only." },
          uncertainty: { type: "string", description: "The range the evidence actually supports, and what drives the spread." },
        }),
        required: ["project", "kind", "substance", "basis_findings"],
      },
    },
    {
      name: "assess_safety",
      description:
        "Mandatory per-substance safety pass. Records known contraindications, drug-drug interactions (including with standard-of-care chemotherapy and with the other substances in the proposed protocol), organ toxicity signals, monitoring parameters that would be required, and the maximum exposure with human tolerability data behind it. compile_thesis refuses until every substance appearing in a parameter has one of these recorded. Cite finding ids — including the FDA label and adverse-event findings from the research phase.",
      inputSchema: {
        type: "object",
        properties: P({
          substance: { type: "string" },
          contraindications: { type: "string" },
          interactions: { type: "string", description: "Interactions with chemotherapy agents, with other protocol substances, and with common comorbid medications." },
          organ_toxicity: { type: "string", description: "Hepatic, neuro, haem, renal signals as reported." },
          max_human_exposure_documented: { type: "string", description: "Highest dose/duration with published human tolerability data, and where it comes from." },
          monitoring_required: { type: "string", description: "Labs/imaging/clinical checks a protocol would need, and at what interval." },
          interference_with_standard_care: { type: "string", description: "Any evidence this substance antagonises, or is untested alongside, standard-of-care treatment. 'Not studied' is a valid and important answer." },
          basis_findings: { type: "array", items: { type: "string" } },
        }),
        required: ["project", "substance", "basis_findings"],
      },
    },
    {
      name: "define_falsification",
      description:
        "Mandatory. Record the observations that would refute this thesis — specific, measurable, and reachable by an actual study. Also record the study design that would test the thesis properly, and the single weakest link in the argument. compile_thesis refuses without at least one falsification criterion. A thesis that no observation could refute is not a thesis.",
      inputSchema: {
        type: "object",
        properties: P({
          criterion: { type: "string", description: "A specific observation that would refute the thesis, e.g. 'no difference in tumour volume vs vehicle at the proposed exposure in an orthotopic model'." },
          testable_by: { type: "string", description: "The study design that would produce that observation." },
          weakest_link: { type: "string", description: "The single finding or inference the whole thesis most depends on, and what happens to it if that finding fails to replicate." },
        }),
        required: ["project", "criterion", "testable_by", "weakest_link"],
      },
    },
    {
      name: "grade_thesis",
      description:
        "Record a GRADE-style overall strength assessment for the thesis, per substance and overall: high / moderate / low / very_low / insufficient, with the reasons for downgrading (risk of bias, indirectness, imprecision, inconsistency, publication bias) stated explicitly. Be blunt. A thesis resting on in vitro work and case reports is 'very_low' or 'insufficient', and saying so is the tool working correctly.",
      inputSchema: {
        type: "object",
        properties: P({
          substance: { type: "string", description: "Omit for the overall thesis grade." },
          grade: { type: "string", enum: GRADES },
          downgrade_reasons: { type: "array", items: { type: "string" } },
          justification: { type: "string" },
        }),
        required: ["project", "grade", "justification"],
      },
    },
    {
      name: "thesis_status",
      description: "What has been recorded toward the thesis and what is still blocking compile_thesis.",
      inputSchema: { type: "object", properties: P(), required: ["project"] },
    },
    {
      name: "compile_thesis",
      description:
        "Render the investigational treatment thesis. Deterministic template — no generated prose enters the output. Every parameter is printed with its evidence grade, its species provenance, and the finding ids behind it; parameters with no basis print as open questions. Refuses to compile if: no falsification criteria are recorded, any substance in a parameter lacks a safety assessment, or any parameter cites a finding id that is not in the corpus. Produces a document framed as a research hypothesis and study proposal, not as a treatment plan for any individual.",
      inputSchema: {
        type: "object",
        properties: P({
          title: { type: "string" },
          question: { type: "string", description: "The clinical question this thesis addresses, stated neutrally." },
          target_condition: { type: "string" },
        }),
        required: ["project", "title", "question"],
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
    const findings = getFindings(project);
    const byId = new Map(findings.map((f) => [f.id, f]));
    const verifyIds = (ids = []) => {
      const missing = ids.filter((i) => !byId.has(i));
      return missing.length
        ? `REJECTED: finding id(s) not in corpus: ${missing.join(", ")}. A parameter may only cite evidence that was actually recorded during the research phase. Run list_findings in research-mcp to get valid ids.`
        : null;
    };

    switch (name) {
      case "load_evidence": {
        if (!findings.length)
          return err(
            `Corpus '${project}' is empty. The thesis tool cannot generate evidence — run the research phase first (research-mcp: deep_search → read_source → record_finding → compile_report).`,
          );
        const s = corpusStats(project);
        let rows = findings;
        if (a.subject) rows = rows.filter((f) => (f.subject || "").toLowerCase().includes(a.subject.toLowerCase()));

        const bySubject = {};
        for (const f of rows) {
          const k = f.subject || "unspecified";
          bySubject[k] ||= { human: [], preclinical: [], other: [] };
          const bucket = HUMAN_TIERS.has(f.evidence_tier)
            ? "human"
            : ["animal_in_vivo", "in_vitro"].includes(f.evidence_tier)
              ? "preclinical"
              : "other";
          bySubject[k][bucket].push(
            a.full
              ? f
              : {
                  id: f.id,
                  tier: f.evidence_tier,
                  direction: f.direction,
                  model: f.model_system,
                  n: f.population_n,
                  dose: f.dose_reported,
                  route: f.route,
                  outcome: f.outcome_measure,
                  effect: f.effect_size,
                  p: f.p_value,
                  claim: f.claim,
                  limitations: f.limitations,
                  retracted: f.retracted || undefined,
                },
          );
        }

        const payload = {
          corpus: { project, ...s },
          inherited_caveats: [
            s.preclinicalOnly && "The corpus contains NO human-subject evidence. Any parameter derived from it is preclinical-only and must be labelled so throughout the thesis.",
            (s.byDirection.null || 0) === 0 && "No null findings in the corpus — the evidence base is one-sided by construction, not by demonstration.",
            (s.byDirection.harm || 0) === 0 && "No harm findings in the corpus — the safety picture is incomplete and assess_safety cannot be honestly filled from it yet.",
            s.retracted > 0 && `${s.retracted} finding(s) rest on retracted or superseded sources — exclude them from parameters or label them.`,
          ].filter(Boolean),
          by_subject: bySubject,
          safety_and_harm_findings: rows
            .filter((f) => f.direction === "harm" || f.adverse_events)
            .map((f) => ({ id: f.id, subject: f.subject, adverse_events: f.adverse_events, claim: f.claim })),
          dose_bearing_findings: rows
            .filter((f) => f.dose_reported)
            .map((f) => ({ id: f.id, subject: f.subject, tier: f.evidence_tier, model: f.model_system, dose: f.dose_reported, route: f.route })),
          rule: "Every number you put in a parameter must come from dose_bearing_findings above, or be an explicitly derived+cited conversion of one. There is no third option.",
        };
        if (a.include_report) {
          const reports = listReports(project);
          payload.latest_research_report = reports.length ? readReport(project, reports[reports.length - 1]) : null;
        }
        return ok(j(payload));
      }

      case "assess_mechanism": {
        const bad = verifyIds([...(a.supporting_findings || []), ...(a.contradicting_findings || [])]);
        if (bad) return err(bad);
        if (!a.contradicting_findings?.length && !a.searched_for_contradiction)
          return err(
            "REJECTED: no contradicting findings listed and no record of searching for them. Either cite the contradicting evidence or state what search established there is none.",
          );
        const r = appendRecord(project, "thesis-mechanisms", { ...a, project: undefined });
        return ok(j({ recorded: "mechanism", substance: a.substance, demonstrated_in: a.demonstrated_in, ts: r.ts }));
      }

      case "propose_parameter": {
        const bad = verifyIds(a.basis_findings || []);
        if (bad) return err(bad);
        if (!a.open_question && !a.value)
          return err("REJECTED: a parameter needs either a value or open_question=true. Silence is not a value.");
        if (a.open_question && !a.evidence_needed)
          return err("REJECTED: an open question must state what evidence would settle it.");
        if (!a.open_question && !(a.basis_findings || []).length)
          return err(
            "REJECTED: a value with no basis_findings is a fabricated number. Cite the finding(s) it comes from, or mark it open_question.",
          );
        if (a.derived && !a.derivation)
          return err("REJECTED: derived=true requires the derivation — the arithmetic and the citation for the conversion method.");

        // Species provenance is computed from the cited findings, not asserted.
        const basis = (a.basis_findings || []).map((i) => byId.get(i));
        const provenance = [...new Set(basis.map((f) => (HUMAN_TIERS.has(f.evidence_tier) ? "human" : f.evidence_tier)))];
        const anyHuman = basis.some((f) => HUMAN_TIERS.has(f.evidence_tier));
        const anyRetracted = basis.some((f) => f.retracted);

        const r = appendRecord(project, "thesis-parameters", {
          ...a,
          project: undefined,
          computed_provenance: provenance,
          human_evidence_behind_it: anyHuman,
          rests_on_retracted_source: anyRetracted,
        });
        return ok(
          j({
            recorded: "parameter",
            kind: a.kind,
            substance: a.substance,
            value: a.open_question ? "(OPEN QUESTION)" : a.value,
            computed_provenance: provenance,
            human_evidence_behind_it: anyHuman,
            warning: anyRetracted
              ? "This parameter rests on a source flagged as retracted. Remove it or label it."
              : !anyHuman && !a.open_question
                ? "No human evidence behind this value. It will render as preclinical-derived throughout the thesis."
                : undefined,
            ts: r.ts,
          }),
        );
      }

      case "assess_safety": {
        const bad = verifyIds(a.basis_findings || []);
        if (bad) return err(bad);
        const r = appendRecord(project, "thesis-safety", { ...a, project: undefined });
        return ok(j({ recorded: "safety_assessment", substance: a.substance, ts: r.ts }));
      }

      case "define_falsification": {
        const r = appendRecord(project, "thesis-falsification", { ...a, project: undefined });
        return ok(j({ recorded: "falsification_criterion", ts: r.ts }));
      }

      case "grade_thesis": {
        const r = appendRecord(project, "thesis-grades", { ...a, project: undefined });
        return ok(j({ recorded: "grade", scope: a.substance || "overall", grade: a.grade, ts: r.ts }));
      }

      case "thesis_status": {
        const st = statusOf(project);
        return ok(j(st));
      }

      case "compile_thesis": {
        const st = statusOf(project);
        if (st.blockers.length)
          return err(`REFUSED — the thesis is not compilable yet:\n\n- ${st.blockers.join("\n- ")}`);
        const md = renderThesis(project, a);
        const file = saveReport(project, "treatment-thesis", md);
        return ok(`✅ Thesis written to ${file}\n\n${md}`);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(`❌ ${name} failed: ${e?.message || e}`);
  }
});

// ---------------------------------------------------------------------------

function statusOf(project) {
  const findings = getFindings(project);
  const ids = new Set(findings.map((f) => f.id));
  const mechanisms = readRecords(project, "thesis-mechanisms");
  const params = readRecords(project, "thesis-parameters");
  const safety = readRecords(project, "thesis-safety");
  const fals = readRecords(project, "thesis-falsification");
  const grades = readRecords(project, "thesis-grades");

  const substancesInProtocol = [...new Set(params.map((p) => p.substance).filter(Boolean))];
  const assessed = new Set(safety.map((s) => s.substance));
  const unassessed = substancesInProtocol.filter((s) => !assessed.has(s));
  const danglingRefs = params.flatMap((p) => (p.basis_findings || []).filter((i) => !ids.has(i)));

  const blockers = [];
  if (!findings.length) blockers.push("Corpus is empty — there is no evidence to build a thesis from.");
  if (!params.length) blockers.push("No protocol parameters proposed.");
  if (!fals.length) blockers.push("No falsification criteria recorded. Run define_falsification — a thesis that cannot be refuted will not compile.");
  if (unassessed.length) blockers.push(`No safety assessment for: ${unassessed.join(", ")}. Run assess_safety for each.`);
  if (danglingRefs.length) blockers.push(`Parameters cite finding ids that are not in the corpus: ${[...new Set(danglingRefs)].join(", ")}.`);
  if (!grades.length) blockers.push("No GRADE assessment recorded. Run grade_thesis.");

  return {
    project,
    corpus_findings: findings.length,
    mechanisms: mechanisms.length,
    parameters: params.length,
    open_questions: params.filter((p) => p.open_question).length,
    parameters_without_human_evidence: params.filter((p) => !p.human_evidence_behind_it && !p.open_question).length,
    safety_assessments: safety.length,
    falsification_criteria: fals.length,
    grades: grades.length,
    substances_in_protocol: substancesInProtocol,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// Deterministic thesis renderer
// ---------------------------------------------------------------------------

function renderThesis(project, a) {
  const findings = getFindings(project);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const s = corpusStats(project);
  const mechanisms = readRecords(project, "thesis-mechanisms");
  const params = readRecords(project, "thesis-parameters");
  const safety = readRecords(project, "thesis-safety");
  const fals = readRecords(project, "thesis-falsification");
  const grades = readRecords(project, "thesis-grades");
  const searches = getSearches(project);
  const now = new Date().toISOString().slice(0, 10);

  const cite = (ids = []) =>
    ids
      .map((i) => {
        const f = byId.get(i);
        if (!f) return `[${i}?]`;
        const ref = f.source.doi || (f.source.pmid && `PMID ${f.source.pmid}`) || f.source.nct || f.source.url;
        return `[${i}: ${f.evidence_tier}, ${f.model_system || "—"} — ${ref}]`;
      })
      .join(" ");

  const L = [];
  L.push(`# ${a.title}`);
  L.push(``);
  L.push(`**Investigational thesis · research hypothesis document**`);
  L.push(``);
  L.push(`**Project:** \`${project}\` · **Compiled:** ${now} · **Evidence base:** ${s.findings} recorded findings, ${s.humanEvidence} from human subjects`);
  L.push(``);
  L.push(`> **What this document is.** A structured hypothesis about what an investigational`);
  L.push(`> protocol built on the cited evidence would look like, assembled mechanically so that`);
  L.push(`> every value can be traced to the source it came from and the strength of that source`);
  L.push(`> is visible on the same line.`);
  L.push(`>`);
  L.push(`> **What it is not.** It is not a treatment plan, it is not clinical advice, and it does`);
  L.push(`> not establish efficacy or safety for any use. Nothing here has been through the`);
  L.push(`> testing that would be needed to make it a treatment. The falsification section (§7)`);
  L.push(`> states what would refute it, and the grade (§6) states how weak the argument currently is.`);
  L.push(``);
  L.push(`## 1. Question`);
  L.push(``);
  L.push(a.question);
  if (a.target_condition) L.push(`\n**Target condition:** ${a.target_condition}`);
  L.push(``);

  // ---- inherited limitations, up front ----
  L.push(`## 2. What the underlying evidence base can and cannot support`);
  L.push(``);
  L.push(`| Property of the corpus | Value |`);
  L.push(`|---|---|`);
  L.push(`| Total findings | ${s.findings} |`);
  L.push(`| Human-subject findings | ${s.humanEvidence} |`);
  L.push(`| Benefit / harm / null / mixed | ${s.byDirection.benefit} / ${s.byDirection.harm} / ${s.byDirection.null} / ${s.byDirection.mixed} |`);
  L.push(`| Findings on retracted sources | ${s.retracted} |`);
  L.push(`| Disconfirming searches run | ${s.disconfirmingSearches} of ${searches.length} |`);
  L.push(``);
  const caveats = [
    s.preclinicalOnly && `**No human-subject evidence exists in this corpus.** Every parameter below is derived from cell-culture or animal work. The distance between those results and a human outcome is the largest single uncertainty in this document.`,
    (s.byDirection.null || 0) === 0 && `**No null results are recorded.** A literature with no negative findings is a property of the search, not of the substance. The thesis below is built on a possibly one-sided sample.`,
    (s.byDirection.harm || 0) === 0 && `**No harm findings are recorded**, which means the safety section rests on regulatory documents rather than on studies of this use.`,
    s.retracted > 0 && `**${s.retracted} finding(s) rest on retracted or superseded sources.**`,
  ].filter(Boolean);
  for (const c of caveats) L.push(`- ${c}`);
  if (!caveats.length) L.push(`- No structural asymmetries flagged in the corpus.`);
  L.push(``);

  // ---- mechanism ----
  L.push(`## 3. Mechanistic hypotheses`);
  L.push(``);
  if (!mechanisms.length) L.push(`_None recorded._`);
  for (const m of mechanisms) {
    L.push(`### ${m.substance}`);
    L.push(``);
    L.push(`**Proposed pathway.** ${m.pathway}`);
    L.push(``);
    L.push(`**Highest level at which it has actually been demonstrated:** ${m.demonstrated_in}`);
    L.push(``);
    L.push(`**Supporting evidence:** ${cite(m.supporting_findings)}`);
    L.push(``);
    L.push(
      `**Contradicting / failed-replication evidence:** ${
        m.contradicting_findings?.length ? cite(m.contradicting_findings) : `none found. Search performed: ${m.searched_for_contradiction}`
      }`,
    );
    L.push(``);
    L.push(`**Explicitly NOT demonstrated:** ${m.not_demonstrated}`);
    if (m.plausibility_notes) L.push(`\n**Exposure plausibility:** ${m.plausibility_notes}`);
    L.push(``);
  }

  // ---- the protocol ----
  L.push(`## 4. Proposed investigational protocol`);
  L.push(``);
  L.push(`Each row carries its own provenance. **observed** = the value appears in a cited source. **derived** = computed from a cited value; the arithmetic is given. **OPEN** = the evidence base does not contain a basis for this value, and none has been invented.`);
  L.push(``);
  const substances = [...new Set(params.map((p) => p.substance))];
  for (const sub of substances) {
    L.push(`### 4.${substances.indexOf(sub) + 1} ${sub}`);
    L.push(``);
    L.push(`| Parameter | Value | Provenance | Human evidence? | Basis |`);
    L.push(`|---|---|---|---|---|`);
    for (const p of params.filter((x) => x.substance === sub)) {
      const val = p.open_question ? `**OPEN — not established**` : p.value;
      const prov = p.open_question ? "—" : p.derived ? `derived (${(p.computed_provenance || []).join(", ")})` : `observed (${(p.computed_provenance || []).join(", ")})`;
      L.push(
        `| ${p.kind} | ${val} | ${prov} | ${p.open_question ? "—" : p.human_evidence_behind_it ? "yes" : "**no**"} | ${(p.basis_findings || []).join(", ") || "—"} |`,
      );
    }
    L.push(``);
    for (const p of params.filter((x) => x.substance === sub)) {
      L.push(`**${p.kind}${p.open_question ? " — OPEN QUESTION" : ""}**`);
      if (p.open_question) {
        L.push(`\nThe corpus provides no basis for this parameter. Evidence that would settle it: ${p.evidence_needed}`);
      } else {
        if (p.rationale) L.push(`\n${p.rationale}`);
        if (p.derived) L.push(`\n**Derivation:** ${p.derivation}`);
        if (p.uncertainty) L.push(`\n**Range the evidence actually supports:** ${p.uncertainty}`);
        L.push(`\n**Traced to:** ${cite(p.basis_findings)}`);
        if (p.rests_on_retracted_source) L.push(`\n⛔ **This parameter rests on a retracted source.**`);
        if (!p.human_evidence_behind_it) L.push(`\n⚠️ No human-subject evidence stands behind this value.`);
      }
      L.push(``);
    }
  }

  // ---- safety ----
  L.push(`## 5. Safety, interactions and monitoring`);
  L.push(``);
  for (const sf of safety) {
    L.push(`### ${sf.substance}`);
    L.push(``);
    const rows = [
      ["Contraindications", sf.contraindications],
      ["Interactions", sf.interactions],
      ["Organ toxicity signals", sf.organ_toxicity],
      ["Max human exposure with published tolerability data", sf.max_human_exposure_documented],
      ["Monitoring a protocol would require", sf.monitoring_required],
      ["Interaction with standard of care", sf.interference_with_standard_care],
    ];
    L.push(`| | |`);
    L.push(`|---|---|`);
    for (const [k, v] of rows) L.push(`| **${k}** | ${v || "_not recorded_"} |`);
    L.push(``);
    L.push(`Basis: ${cite(sf.basis_findings)}`);
    L.push(``);
  }

  // ---- grade ----
  L.push(`## 6. Strength of this thesis (GRADE)`);
  L.push(``);
  L.push(`| Scope | Grade | Downgraded for | Justification |`);
  L.push(`|---|---|---|---|`);
  for (const g of grades)
    L.push(`| ${g.substance || "**Overall**"} | **${g.grade}** | ${(g.downgrade_reasons || []).join(", ") || "—"} | ${g.justification} |`);
  L.push(``);

  // ---- falsification ----
  L.push(`## 7. What would refute this thesis`);
  L.push(``);
  for (const f of fals) {
    L.push(`- **Refuting observation:** ${f.criterion}`);
    L.push(`  - **Testable by:** ${f.testable_by}`);
    L.push(`  - **Weakest link:** ${f.weakest_link}`);
  }
  L.push(``);

  // ---- open questions consolidated ----
  const opens = params.filter((p) => p.open_question);
  L.push(`## 8. Open questions — what this thesis cannot currently specify`);
  L.push(``);
  if (!opens.length) L.push(`_No parameters were left open._`);
  for (const p of opens) L.push(`- **${p.substance} · ${p.kind}** — ${p.evidence_needed}`);
  L.push(``);

  L.push(`---`);
  L.push(``);
  L.push(`_Generated by thesis-mcp from corpus \`${project}\` (\`${CORPUS_DIR}/${project}/\`). Every value above traces to a finding id in that append-only ledger. This is a research hypothesis for evaluation by qualified investigators; it is not medical advice, not a treatment protocol for any individual, and not evidence of efficacy or safety._`);

  return L.join("\n");
}

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`thesis-mcp v1.0.0 ready · corpus: ${CORPUS_DIR}`);
