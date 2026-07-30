/**
 * render-whitepaper.mjs — the white-paper renderer.
 *
 * Emits a systematic-review-style scientific white paper in markdown, built
 * mechanically from the corpus. Structure follows PRISMA 2020 (identification →
 * screening → eligibility → inclusion, with the counts each stage requires) and
 * GRADE for certainty of evidence.
 *
 * The renderer is template code on purpose. In a normal white paper the author
 * interprets; here the author is forbidden to, so the document is assembled from
 * the ledger and the only "judgement" it expresses is arithmetic: counts,
 * proportions, tier ranks, and coverage estimates.
 *
 * Consequently there is no Discussion section and no Conclusions section in the
 * usual sense. What replaces them: "Limitations of this review", "What this body
 * of evidence does not establish", and the open-questions register. A reader
 * looking for a verdict will not find one, which is the correct outcome.
 */

import {
  getFindings,
  getSearches,
  getSources,
  corpusStats,
  indexStats,
  readIndex,
  coverageEstimate,
  sourceExhaustion,
  DIRECTIONS,
  EVIDENCE_TIERS,
  CORPUS_DIR,
} from "./corpus.mjs";
import { ANIMAL_SPECIES, SPECIES_LABEL, SPECIES_CAVEAT } from "./species.mjs";
import { relevanceStats, RELEVANCE_LABEL, RELEVANCE_NOTE, RELEVANCE_LEVELS, CONDITION_PROFILES } from "./indication.mjs";

const tierRank = (t) => {
  const i = EVIDENCE_TIERS.indexOf(t);
  return i === -1 ? 999 : i;
};

const HUMAN_TIERS = new Set([
  "meta_analysis",
  "rct",
  "controlled_trial_nonrandomized",
  "cohort",
  "case_control",
  "case_series",
  "case_report",
]);

const TIER_LABEL = {
  meta_analysis: "Meta-analysis / systematic review",
  rct: "Randomised controlled trial",
  controlled_trial_nonrandomized: "Controlled trial (non-randomised)",
  cohort: "Cohort study",
  case_control: "Case-control study",
  case_series: "Case series",
  case_report: "Case report",
  animal_in_vivo: "Animal (in vivo)",
  in_vitro: "Cell culture (in vitro)",
  mechanistic_review: "Mechanistic review",
  narrative_review: "Narrative review",
  preprint: "Preprint (not peer reviewed)",
  conference_abstract: "Conference abstract",
  regulatory_document: "Regulatory document",
  anecdote_unverified: "Unverified anecdote / testimonial",
};

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

function citation(src) {
  const bits = [src.authors, src.title, src.journal, src.year].filter(Boolean).join(". ");
  const ids = [
    src.doi && `doi:${src.doi}`,
    src.pmid && `PMID:${src.pmid}`,
    src.nct && src.nct,
    !src.doi && !src.pmid && !src.nct && src.url,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${bits}${bits && ids ? ". " : ""}${ids}`;
}

function citeLink(src) {
  if (src.doi) return `[doi:${src.doi}](https://doi.org/${src.doi})`;
  if (src.pmid) return `[PMID ${src.pmid}](https://pubmed.ncbi.nlm.nih.gov/${src.pmid}/)`;
  if (src.nct) return `[${src.nct}](https://clinicaltrials.gov/study/${src.nct})`;
  return `[source](${src.url})`;
}

export function renderWhitePaper(project, opts = {}) {
  const findings = getFindings(project);
  const searches = getSearches(project);
  const sources = getSources(project);
  const idx = readIndex(project);
  const s = corpusStats(project);
  const ix = indexStats(project);
  const cov = coverageEstimate(project);
  const exh = sourceExhaustion(project);
  const now = new Date().toISOString().slice(0, 10);

  const title = opts.title || `Evidence map: ${[...new Set(findings.map((f) => f.subject))].filter(Boolean).join(", ")}`;
  const subjects = [...new Set(findings.map((f) => f.subject || "unspecified"))].sort();
  const L = [];

  // =========================================================================
  // Title block
  // =========================================================================
  L.push(`# ${title}`);
  L.push(``);
  L.push(`**A systematic evidence map, assembled without interpretation**`);
  L.push(``);
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Corpus | \`${project}\` |`);
  L.push(`| Compiled | ${now} |`);
  L.push(`| Records indexed | ${ix.total} |`);
  L.push(`| Records read in full | ${ix.read} |`);
  L.push(`| Findings extracted | ${s.findings} |`);
  L.push(`| Findings from human subjects | ${s.humanEvidence} (${pct(s.humanEvidence, s.findings)}) |`);
  L.push(`| **Findings about the target condition** | **${s.onTarget} (${pct(s.onTarget, s.findings)})** |`);
  L.push(`| …of those, in human subjects | ${s.onTargetHuman} |`);
  L.push(`| Search queries executed | ${searches.length} |`);
  L.push(`| Estimated index coverage | ${(cov.coverage * 100).toFixed(1)}% of the estimated reachable literature |`);
  L.push(``);
  L.push(`---`);
  L.push(``);

  // =========================================================================
  // Structured summary — facts only
  // =========================================================================
  L.push(`## Structured summary`);
  L.push(``);
  L.push(`**Objective.** ${opts.objective || "To identify, index and characterise the published evidence relating the substances below to the target condition, without appraising whether that evidence supports use."}`);
  L.push(``);
  L.push(`**Data sources.** ${[...new Set(searches.map((x) => x.engine))].join(", ") || "none recorded"}.`);
  L.push(``);
  L.push(`**Eligibility.** Any document making a checkable factual statement about one of the substances under study in relation to the target condition or its mechanisms, at any evidence tier from meta-analysis to unverified anecdote. Unverified anecdote is included deliberately and is tiered as such — excluding it would hide a category of claim the reader needs to know exists; promoting it would misrepresent it.`);
  L.push(``);
  L.push(`**Data extracted.** For each finding: a verbatim quotation from the source, the direction of the reported result, the evidence tier, the model system, sample size, dose and route exactly as reported, outcome measure, effect size, p-value, adverse events, funding, declared conflicts, and author-stated limitations.`);
  L.push(``);
  const dirLine = DIRECTIONS.map((d) => `${s.byDirection[d] || 0} ${d}`).join(", ");
  const sourceCount = new Set(findings.map((f) => f.source.doi || f.source.pmid || f.source.nct || f.source.url).filter(Boolean)).size;
  L.push(`**Results.** ${s.findings} findings were extracted from ${sourceCount} distinct sources, out of ${ix.read} documents examined and ${ix.total} indexed: ${dirLine}. ${s.humanEvidence} of ${s.findings} findings (${pct(s.humanEvidence, s.findings)}) derive from human subjects; ${s.animalEvidence} from whole-animal studies across ${s.animalSpeciesPresent.length} species.`);
  L.push(``);
  L.push(`**Interpretation.** None is offered. This document reports what the literature contains and at what evidence tier. It makes no claim about efficacy, safety, or suitability for any use, and the absence of such a claim is a design property of the method, not an omission.`);
  L.push(``);

  // =========================================================================
  // 1. Methods — search strategy
  // =========================================================================
  L.push(`## 1. Methods`);
  L.push(``);
  L.push(`### 1.1 Protocol`);
  L.push(``);
  L.push(`Findings were entered into an append-only ledger through a validating interface which rejects any claim lacking (a) a resolvable identifier — DOI, PMID, trial registration number, or URL; (b) a verbatim quotation of at least 20 characters copied from the source; (c) a direction classification; and (d) an evidence tier. No claim can enter this document by any other route, and no claim can be edited after entry — corrections are appended as retractions, leaving the original visible.`);
  L.push(``);
  L.push(`### 1.2 Information sources`);
  L.push(``);
  L.push(`| Source | Queries | Records retrieved | Reported available | Enumerated | Stopped by API ceiling |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const [engine, e] of Object.entries(exh)) {
    L.push(
      `| ${engine} | ${e.queries} | ${e.retrieved} | ${e.reported_total || "—"} | ${e.enumerated_fraction != null ? (e.enumerated_fraction * 100).toFixed(1) + "%" : "—"} | ${e.capped_queries || 0} |`,
    );
  }
  L.push(``);
  L.push(`"Enumerated" is the fraction of what a source said it held that was actually retrieved. Where it is below 100%, the remainder was not examined. Where "stopped by API ceiling" is non-zero, the source refused to page further and the unretrieved remainder is unknowable through that interface — this is a limit of the instrument, not evidence that nothing more exists.`);
  L.push(``);

  L.push(`### 1.3 Search strategy`);
  L.push(``);
  const byIntent = {};
  for (const q of searches) byIntent[q.intent] = (byIntent[q.intent] || 0) + 1;
  L.push(`${searches.length} queries were executed across ${Object.keys(exh).length} sources:`);
  L.push(``);
  for (const [intent, n] of Object.entries(byIntent).sort((a, b) => b[1] - a[1]))
    L.push(`- **${intent}**: ${n} queries (${pct(n, searches.length)})`);
  L.push(``);
  L.push(`Disconfirming queries — those constructed specifically to surface null results, terminated trials, toxicity reports, retractions and published criticism — are generated automatically alongside every confirming query and cannot be disabled. A corpus assembled only from confirming queries is a biased sample by construction; the proportion above is therefore a quality measure of the search itself.`);
  L.push(``);
  L.push(`The complete query list appears in Appendix A.`);
  L.push(``);

  const nonEnglish = findings.filter((f) => f.source_language && f.source_language !== "en" && f.source_language !== "und");
  L.push(`### 1.4 Language`);
  L.push(``);
  L.push(`This document is written in English. Where a source was published in another language, the quotation is reproduced **in its original language** — translating it would make it no longer verbatim, and a verbatim quotation is what allows a reader to check a claim against its source. An English translation is printed above each such quotation.`);
  L.push(``);
  if (nonEnglish.length) {
    const byLang = {};
    for (const f of nonEnglish) byLang[f.source_language_name || f.source_language] = (byLang[f.source_language_name || f.source_language] || 0) + 1;
    L.push(`${nonEnglish.length} of ${findings.length} findings come from non-English sources:`);
    L.push(``);
    for (const [lang, n] of Object.entries(byLang).sort((a, b) => b[1] - a[1])) L.push(`- ${lang}: ${n}`);
  } else {
    L.push(`All findings in this corpus come from English-language sources. Given that a meaningful share of repurposed-drug oncology work is published in Chinese and Russian venues, this is more likely a limit of the search than a property of the literature — see the coverage table in §1.2 for which non-English sources were reachable.`);
  }
  L.push(``);

  L.push(`### 1.5 Assessment of search completeness`);
  L.push(``);
  L.push(`Completeness was estimated by capture-recapture on query overlap. Each query is treated as a capture occasion; a document found by many independent queries indicates dense coverage, while a large population of documents found by exactly one query indicates unexplored space. The Chao1 estimator gives:`);
  L.push(``);
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Documents observed | ${cov.observed} |`);
  L.push(`| Found by exactly one query (f₁) | ${cov.f1_singletons} |`);
  L.push(`| Found by exactly two queries (f₂) | ${cov.f2_doubletons} |`);
  L.push(`| Estimated reachable total | ${cov.estimated_total} |`);
  L.push(`| Estimated not yet seen | ${cov.unseen_estimate} |`);
  L.push(`| **Estimated coverage** | **${(cov.coverage * 100).toFixed(1)}%** |`);
  L.push(``);
  L.push(`${cov.interpretation}`);
  L.push(``);
  L.push(`This estimator addresses the reachable literature — what these sources can return. It cannot estimate what was never indexed by any source searched, what is published in languages not queried, or what was never published at all. Unpublished negative results are, by their nature, invisible to every method in this document.`);
  L.push(``);

  // =========================================================================
  // 2. PRISMA flow
  // =========================================================================
  L.push(`## 2. Study selection (PRISMA flow)`);
  L.push(``);
  const nIdentified = ix.total;
  const nDup = idx.reduce((n, c) => n + Math.max(0, (c.nq || 1) - 1), 0);
  const nRead = ix.read;
  const nRecorded = idx.filter((c) => c.status === "recorded").length;
  const nRejected = idx.filter((c) => c.status === "rejected").length;
  const nUnreachable = idx.filter((c) => c.status === "unreachable").length;
  const nOutstanding = ix.outstanding;

  L.push("```mermaid");
  L.push(`flowchart TD`);
  L.push(`  A["Records identified through database<br/>and web searching<br/><b>n = ${nIdentified + nDup}</b>"] --> B`);
  L.push(`  B["Duplicate records removed<br/>by DOI / PMID / NCT / URL identity<br/><b>n = ${nDup}</b>"] --> C`);
  L.push(`  C["Unique records indexed<br/><b>n = ${nIdentified}</b>"] --> D`);
  L.push(`  D["Records retrieved and read in full<br/><b>n = ${nRead}</b>"] --> E`);
  L.push(`  C --> F["Records indexed but not yet read<br/><b>n = ${nOutstanding}</b>"]`);
  L.push(`  D --> G["Records yielding extracted findings<br/><b>n = ${nRecorded}</b>"]`);
  L.push(`  D --> H["Records read and excluded<br/><b>n = ${nRejected}</b>"]`);
  L.push(`  D --> I["Records unreachable<br/>(paywall, dead link, bot wall)<br/><b>n = ${nUnreachable}</b>"]`);
  L.push(`  G --> J["Findings extracted<br/><b>n = ${s.findings}</b>"]`);
  L.push("```");
  L.push(``);
  if (nOutstanding > 0) {
    L.push(`> ⚠️ **${nOutstanding} indexed records (${pct(nOutstanding, nIdentified)} of the index) have not been read.** This review is therefore incomplete with respect to its own index. The findings below describe the ${pct(nRead, nIdentified)} that was read, and the unread remainder is not characterised.`);
    L.push(``);
  }
  if (nUnreachable > 0) {
    L.push(`> ${nUnreachable} records could not be retrieved (paywall, dead link, or bot protection). Their content is unknown and they are neither included nor excluded on the merits.`);
    L.push(``);
  }

  // =========================================================================
  // 3. Results — characteristics
  // =========================================================================
  L.push(`## 3. Results`);
  L.push(``);
  const relKey = opts.condition_profile || "pancreatic_adenocarcinoma";
  const cond = CONDITION_PROFILES[relKey];
  const rs = relevanceStats(findings, relKey);
  const onTarget = findings.filter((f) => f.indication_relevance === "target");
  const onTargetHuman = onTarget.filter((f) => HUMAN_TIERS.has(f.evidence_tier));
  const onTargetControlled = onTarget.filter((f) => ["meta_analysis", "rct", "controlled_trial_nonrandomized"].includes(f.evidence_tier));

  L.push(`### 3.1 Relevance to the target condition`);
  L.push(``);
  L.push(`A search pairing these substances with "cancer" returns a large literature about other cancers, and a larger one about the substances' original non-oncology uses. Separating those is the single most consequential step in this review: the distance between "there is a substantial literature on this drug and cancer" and "there are ${onTarget.length} findings on this drug and ${cond.label.toLowerCase()}" is where a repurposing case is usually overstated.`);
  L.push(``);
  L.push(`| Relevance | Findings | Share | What it means |`);
  L.push(`|---|---|---|---|`);
  for (const k of RELEVANCE_LEVELS)
    L.push(`| ${k === "target" ? `**${RELEVANCE_LABEL[k]}**` : RELEVANCE_LABEL[k]} | ${rs.by[k]} | ${pct(rs.by[k], rs.total)} | ${RELEVANCE_NOTE[k]} |`);
  L.push(``);
  L.push(`**${rs.headline}**`);
  L.push(``);
  L.push(`Narrowing to ${cond.label.toLowerCase()} only:`);
  L.push(``);
  L.push(`| | Findings |`);
  L.push(`|---|---|`);
  L.push(`| About ${cond.label.toLowerCase()} | ${onTarget.length} |`);
  L.push(`| …of those, in human subjects | ${onTargetHuman.length} |`);
  L.push(`| …of those, a controlled trial | ${onTargetControlled.length} |`);
  L.push(``);
  if (onTarget.length === 0)
    L.push(`> **No finding in this corpus concerns ${cond.label.toLowerCase()}.** Every study recorded examines these substances in another disease or outside oncology. Nothing here describes what happens in the target condition.`);
  else if (onTargetControlled.length === 0)
    L.push(`> **No controlled trial in ${cond.label.toLowerCase()} appears in this corpus.** Without a control group, an observed change cannot be distinguished from the natural course of the disease, from concurrent treatment, or from selection of which patients are reported. Every statement below about the target condition rests on uncontrolled observation, animal models, or cell culture.`);
  L.push(``);
  L.push(`This classification is about subject matter, not quality. A well-conducted study of a different cancer is still a study of a different cancer.`);
  L.push(``);

  L.push(`### 3.2 Composition of the evidence base`);
  L.push(``);
  L.push(`| Evidence tier | Findings | Share | Human subjects |`);
  L.push(`|---|---|---|---|`);
  for (const t of EVIDENCE_TIERS) {
    const n = s.byTier[t] || 0;
    if (!n) continue;
    L.push(`| ${TIER_LABEL[t] || t} | ${n} | ${pct(n, s.findings)} | ${HUMAN_TIERS.has(t) ? "yes" : "no"} |`);
  }
  L.push(``);
  if (s.preclinicalOnly) {
    L.push(`> **This corpus contains no human-subject evidence of any tier.** Every finding below comes from cell culture, animal models, mechanistic reasoning, or regulatory documents concerning other indications. No statement in this document describes an observed effect in a person with the target condition.`);
    L.push(``);
  }

  L.push(`### 3.3 Direction of reported results`);
  L.push(``);
  L.push(`| Direction | Findings | Share |`);
  L.push(`|---|---|---|`);
  for (const d of DIRECTIONS) L.push(`| ${d} | ${s.byDirection[d] || 0} | ${pct(s.byDirection[d] || 0, s.findings)} |`);
  L.push(``);
  L.push(`Direction records what a source reported, not whether it is true. The distribution above is a joint property of the literature **and** of the search that found it; it is not a measure of whether these substances work.`);
  L.push(``);
  if ((s.byDirection.null || 0) === 0 || (s.byDirection.harm || 0) === 0) {
    L.push(`> ⚠️ **Asymmetry.** This corpus records ${s.byDirection.null || 0} null findings and ${s.byDirection.harm || 0} harm findings. Bodies of literature which genuinely contain no null and no harm results are rare; incomplete searches which appear to contain none are common. Read the balance above as a statement about the search until disconfirming coverage is demonstrably complete.`);
    L.push(``);
  }

  L.push(`### 3.4 Evidence by substance`);
  L.push(``);
  for (const subj of subjects) {
    const rows = findings.filter((f) => (f.subject || "unspecified") === subj).sort((a, b) => tierRank(a.evidence_tier) - tierRank(b.evidence_tier));
    const human = rows.filter((r) => HUMAN_TIERS.has(r.evidence_tier)).length;
    const dir = {};
    for (const d of DIRECTIONS) dir[d] = rows.filter((r) => r.direction === d).length;

    L.push(`#### 3.4.${subjects.indexOf(subj) + 1} ${subj}`);
    L.push(``);
    const onTgt = rows.filter((r) => r.indication_relevance === "target");
    L.push(`${rows.length} findings, of which **${onTgt.length} concern the target condition** (${pct(onTgt.length, rows.length)}); ${human} are from human subjects. Direction: ${DIRECTIONS.map((d) => `${dir[d]} ${d}`).join(", ")}. Highest evidence tier present: **${TIER_LABEL[rows[0]?.evidence_tier] || "—"}**.`);
    L.push(``);
    L.push(`| # | Relevance | Tier | Species | n | Dose as reported | Outcome measure | Result | Direction | Source |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---|`);
    rows.forEach((r, i) => {
      L.push(
        `| ${i + 1} | ${r.indication_relevance === "target" ? "**target**" : r.indication_relevance} | ${TIER_LABEL[r.evidence_tier] || r.evidence_tier}${r.retracted ? " ⛔" : ""} | ${SPECIES_LABEL[r.species] || r.species || "—"} | ${r.population_n ?? "—"} | ${r.dose_reported || "—"} | ${r.outcome_measure || "—"} | ${[r.effect_size, r.p_value].filter(Boolean).join("; ") || "—"} | ${r.direction} | ${citeLink(r.source)} |`,
      );
    });
    L.push(``);
  }

  // =========================================================================
  // 3.4 Animal evidence by species
  // =========================================================================
  const animalFindings = findings.filter((f) => ANIMAL_SPECIES.includes(f.species));
  L.push(`### 3.5 Animal evidence, by species`);
  L.push(``);
  if (!animalFindings.length) {
    L.push(`No whole-animal study is recorded in this corpus.`);
    L.push(``);
  } else {
    L.push(`"Animal evidence" is not one category. Rodent tumour models, chemically-induced models, and the licensed veterinary safety record answer different questions and are reported separately below. For the benzimidazole anthelmintics in particular, the veterinary literature — dog, cattle, horse, sheep — is the best-characterised tolerability and pharmacokinetic evidence that exists for these compounds, and it does not appear in searches that pair the drug with an oncology term.`);
    L.push(``);
    L.push(`| Species | Findings | Strains recorded | Model types | Direction (benefit/harm/null/mixed) |`);
    L.push(`|---|---|---|---|---|`);
    const speciesPresent = [...new Set(animalFindings.map((f) => f.species))].sort(
      (a, b) => ANIMAL_SPECIES.indexOf(a) - ANIMAL_SPECIES.indexOf(b),
    );
    for (const sp of speciesPresent) {
      const rows = animalFindings.filter((f) => f.species === sp);
      const d = (k) => rows.filter((r) => r.direction === k).length;
      L.push(
        `| **${SPECIES_LABEL[sp] || sp}** | ${rows.length} | ${[...new Set(rows.map((r) => r.strain).filter(Boolean))].join(", ") || "—"} | ${[...new Set(rows.map((r) => r.animal_model_type).filter(Boolean))].join(", ") || "—"} | ${d("benefit")}/${d("harm")}/${d("null")}/${d("mixed")} |`,
      );
    }
    L.push(``);
    L.push(`**What each species result can support:**`);
    L.push(``);
    for (const sp of speciesPresent) if (SPECIES_CAVEAT[sp]) L.push(`- **${SPECIES_LABEL[sp]}** — ${SPECIES_CAVEAT[sp]}`);
    L.push(``);

    // Dose provenance table — deliberately NOT a plot. Doses arrive as free text
    // in each source's own units for each source's own species; parsing them
    // into a shared axis would manufacture comparability that does not exist.
    const dosed = animalFindings.filter((f) => f.dose_reported);
    if (dosed.length) {
      L.push(`**Doses reported in animal work, by species.** Reproduced exactly as each source states them. No unit conversion and no cross-species scaling has been applied; a dose below is a dose in that species and nothing else.`);
      L.push(``);
      L.push(`| Species | Strain | Dose as reported | Route | Duration | n | Outcome | Source |`);
      L.push(`|---|---|---|---|---|---|---|---|`);
      for (const f of dosed.sort((a, b) => ANIMAL_SPECIES.indexOf(a.species) - ANIMAL_SPECIES.indexOf(b.species)))
        L.push(
          `| ${SPECIES_LABEL[f.species] || f.species} | ${f.strain || "—"} | ${f.dose_reported} | ${f.route || "—"} | ${f.duration || "—"} | ${f.population_n ?? "—"} | ${f.outcome_measure || "—"} | ${citeLink(f.source)} |`,
        );
      L.push(``);
    }
  }
  const unclassified = findings.filter((f) => f.species === "unspecified" || f.species_confidence === "none");
  if (unclassified.length) {
    L.push(`> ${unclassified.length} finding(s) could not be assigned a species from the model description recorded. They are excluded from the species tables above and are listed here as a data-quality gap: ${unclassified.map((f) => `\`${f.id}\``).join(", ")}.`);
    L.push(``);
  }

  // =========================================================================
  // 4. Risk of bias / integrity
  // =========================================================================
  L.push(`## 4. Risk of bias and source integrity`);
  L.push(``);
  const retracted = findings.filter((f) => f.retracted);
  const noFunding = findings.filter((f) => !f.funding).length;
  const noCoi = findings.filter((f) => !f.conflicts_of_interest).length;
  const noLimits = findings.filter((f) => !f.limitations).length;
  const preprints = findings.filter((f) => f.evidence_tier === "preprint").length;
  const anecdotes = findings.filter((f) => f.evidence_tier === "anecdote_unverified").length;

  L.push(`| Signal | Count | Share of findings |`);
  L.push(`|---|---|---|`);
  L.push(`| Findings resting on retracted or superseded sources | ${retracted.length} | ${pct(retracted.length, s.findings)} |`);
  L.push(`| Findings with no funding statement recorded | ${noFunding} | ${pct(noFunding, s.findings)} |`);
  L.push(`| Findings with no conflict-of-interest statement recorded | ${noCoi} | ${pct(noCoi, s.findings)} |`);
  L.push(`| Findings with no author-stated limitations recorded | ${noLimits} | ${pct(noLimits, s.findings)} |`);
  L.push(`| Findings from preprints (not peer reviewed) | ${preprints} | ${pct(preprints, s.findings)} |`);
  L.push(`| Findings from unverified anecdote or testimonial | ${anecdotes} | ${pct(anecdotes, s.findings)} |`);
  L.push(``);
  if (retracted.length) {
    L.push(`**Retracted sources appearing in this document:**`);
    L.push(``);
    for (const r of retracted) L.push(`- ${citation(r.source)} — cited by finding \`${r.id}\`. Retained in the record so that the claim's history is visible; it must not be read as live evidence.`);
    L.push(``);
  }
  if (anecdotes) {
    L.push(`Unverified anecdotes are included because their existence is itself a fact worth recording — the client's question explicitly encompasses reported experiences. They are tiered at the bottom of the hierarchy and no attempt has been made to verify them. An anecdote establishes that a claim was made, and nothing further.`);
    L.push(``);
  }

  // =========================================================================
  // 5. Findings in full
  // =========================================================================
  L.push(`## 5. Extracted findings in full`);
  L.push(``);
  L.push(`Each entry reproduces the quotation the finding rests on, so that every statement in this review can be checked against its source without leaving the document.`);
  L.push(``);
  let n = 0;
  for (const subj of subjects) {
    const rows = findings.filter((f) => (f.subject || "unspecified") === subj).sort((a, b) => tierRank(a.evidence_tier) - tierRank(b.evidence_tier));
    for (const f of rows) {
      n++;
      L.push(`### F${n} · ${f.subject || "—"} · ${TIER_LABEL[f.evidence_tier] || f.evidence_tier} · ${f.direction}${f.retracted ? " · ⛔ RETRACTED SOURCE" : ""}`);
      L.push(``);
      L.push(f.claim);
      L.push(``);
      if (f.verbatim_quote_english) {
        L.push(`> ${f.verbatim_quote_english.replace(/\n/g, "\n> ")}`);
        L.push(`>`);
        L.push(`> *— translated from ${f.source_language_name || "the original"}. Original as published:*`);
        L.push(`>`);
        L.push(`> ${f.verbatim_quote.replace(/\n/g, "\n> ")}`);
      } else {
        L.push(`> ${f.verbatim_quote.replace(/\n/g, "\n> ")}`);
      }
      L.push(``);
      const meta = [
        f.indication && `**Indication:** ${f.indication}`,
        f.model_system && `**Model:** ${f.model_system}`,
        f.population_n != null && `**n:** ${f.population_n}`,
        f.dose_reported && `**Dose as reported:** ${f.dose_reported}`,
        f.route && `**Route:** ${f.route}`,
        f.duration && `**Duration:** ${f.duration}`,
        f.outcome_measure && `**Outcome:** ${f.outcome_measure}`,
        f.effect_size && `**Effect:** ${f.effect_size}`,
        f.p_value && `**p:** ${f.p_value}`,
      ].filter(Boolean);
      if (meta.length) L.push(meta.join(" · "));
      L.push(``);
      if (f.adverse_events) L.push(`**Adverse events:** ${f.adverse_events}`);
      if (f.limitations) L.push(`**Author-stated limitations:** ${f.limitations}`);
      if (f.funding) L.push(`**Funding:** ${f.funding}`);
      if (f.conflicts_of_interest) L.push(`**Declared conflicts:** ${f.conflicts_of_interest}`);
      L.push(`**Source:** ${citation(f.source)}`);
      L.push(``);
    }
  }

  // =========================================================================
  // 6. What this does not establish
  // =========================================================================
  L.push(`## 6. What this body of evidence does not establish`);
  L.push(``);
  L.push(`This section exists in place of a Conclusions section. Its contents are derived from the corpus, not from opinion.`);
  L.push(``);
  const notEstablished = [];
  if (rs.by.target === 0)
    notEstablished.push(`No finding in this corpus concerns ${cond.label.toLowerCase()} at all. The literature recorded here is about these substances in other settings, and says nothing about the target condition.`);
  else if (onTargetControlled.length === 0)
    notEstablished.push(`No controlled trial in ${cond.label.toLowerCase()} exists in this corpus. ${onTarget.length} findings concern the target condition and all of them are uncontrolled observation, animal work, or cell culture — designs which cannot separate an effect of the substance from the natural course of the disease.`);
  if (s.preclinicalOnly)
    notEstablished.push(`No finding in this corpus describes an outcome in a human being with the target condition. Activity in cell culture and animal models has historically translated to human benefit in a small minority of cases; this corpus contains no information about which case this is.`);
  for (const subj of subjects) {
    const rows = findings.filter((f) => (f.subject || "unspecified") === subj);
    const human = rows.filter((r) => HUMAN_TIERS.has(r.evidence_tier));
    const controlled = rows.filter((r) => ["meta_analysis", "rct", "controlled_trial_nonrandomized"].includes(r.evidence_tier));
    if (!controlled.length)
      notEstablished.push(`**${subj}**: no controlled trial of any kind appears in this corpus. Uncontrolled observations cannot separate an effect of the substance from the natural course of disease, concurrent treatment, or selection of who is reported.`);
    else if (!human.length)
      notEstablished.push(`**${subj}**: no human-subject evidence appears in this corpus.`);
  }
  if ((s.byDirection.harm || 0) === 0)
    notEstablished.push(`No harm findings were recorded, which means this corpus does not characterise the safety of any substance in it at the doses discussed. Absence of recorded harm is not evidence of safety; it is evidence that harm was not recorded.`);
  if (cov.coverage < 0.95)
    notEstablished.push(`Search coverage is estimated at ${(cov.coverage * 100).toFixed(1)}%, with approximately ${cov.unseen_estimate} reachable documents not yet seen. The composition of what is missing is unknown, and there is no basis for assuming it resembles what was found.`);
  if (nOutstanding > 0)
    notEstablished.push(`${nOutstanding} indexed documents were never read. Their contents are not represented anywhere in this review.`);
  for (const x of notEstablished) L.push(`- ${x}`);
  if (!notEstablished.length) L.push(`- No structural gaps were detected by the automated checks. This is not the same as there being none.`);
  L.push(``);

  // =========================================================================
  // 7. Limitations of the method
  // =========================================================================
  L.push(`## 7. Limitations of this review`);
  L.push(``);
  L.push(`- **Publication bias is not correctable here.** Studies finding nothing are less often written up and less often indexed. Every method in this document operates on what was published; none can recover what was not.`);
  L.push(`- **Search-engine ceilings.** Web search interfaces cap how deep results can be paged. Where a query hit that ceiling it is recorded in §1.2; the unretrieved remainder is unknowable through that interface.`);
  L.push(`- **Extraction is single-pass.** Conventional systematic reviews use two independent extractors and reconcile disagreements. This corpus was extracted once. The verbatim-quotation requirement makes every extraction checkable against its source, which mitigates but does not replace duplicate extraction.`);
  L.push(`- **No meta-analysis was performed.** Effect sizes are reported as each source reported them. They are not pooled, because pooling across heterogeneous designs, species and outcome measures would manufacture a precision the underlying studies do not support.`);
  L.push(`- **Language coverage** is limited to the languages queried (Appendix A).`);
  L.push(`- **The tier hierarchy is a hierarchy of design, not of truth.** A well-conducted cell study is not made wrong by sitting low in it, and a poorly-conducted trial is not made right by sitting high.`);
  L.push(``);

  // =========================================================================
  // Appendices
  // =========================================================================
  L.push(`## Appendix A — Complete search strategy`);
  L.push(``);
  L.push(`Every query executed, in order, with the count returned. Queries returning zero results are retained: a query that found nothing is evidence about the literature, and removing it would misrepresent the search.`);
  L.push(``);
  L.push(`| # | Source | Intent | Query | Returned | Reported total | Ceiling hit |`);
  L.push(`|---|---|---|---|---|---|---|`);
  searches.forEach((q, i) => {
    L.push(
      `| ${i + 1} | ${q.engine} | ${q.intent} | \`${String(q.query).replace(/\|/g, "\\|")}\` | ${q.result_count} | ${q.reported_total ?? "—"} | ${q.hit_ceiling ? "yes" : "—"} |`,
    );
  });
  L.push(``);

  L.push(`## Appendix B — Contacts`);
  L.push(``);
  const contacts = findings.flatMap((f) => (f.contacts || []).map((c) => ({ ...c, from: f.source.title || f.source.url, fid: f.id })));
  if (!contacts.length) {
    L.push(`No contact details were captured.`);
  } else {
    L.push(`Professional contact details published by the sources themselves — journal corresponding-author lines and trial-registry contact blocks — recorded for research correspondence.`);
    L.push(``);
    L.push(`| Name | Role | Affiliation | Email | Phone | From |`);
    L.push(`|---|---|---|---|---|---|`);
    const seen = new Set();
    for (const c of contacts) {
      const k = `${c.name}|${c.email}|${c.phone}`;
      if (seen.has(k)) continue;
      seen.add(k);
      L.push(`| ${c.name || "—"} | ${c.role || "—"} | ${c.affiliation || "—"} | ${c.email || "—"} | ${c.phone || "—"} | ${c.from || "—"} |`);
    }
  }
  L.push(``);

  L.push(`## Appendix C — References`);
  L.push(``);
  const biblio = [...new Map(findings.map((f) => [f.source.doi || f.source.pmid || f.source.nct || f.source.url, f.source])).values()];
  biblio.sort((a, b) => String(b.year || "").localeCompare(String(a.year || "")));
  biblio.forEach((src, i) => L.push(`${i + 1}. ${citation(src)}`));
  L.push(``);

  L.push(`---`);
  L.push(``);
  L.push(`_Assembled by research-mcp from corpus \`${project}\` (\`${CORPUS_DIR}/${project}/\`). Every statement traces to a line in an append-only ledger. This document reports what sources say; it is not medical advice and does not establish efficacy or safety for any use._`);

  return L.join("\n");
}
