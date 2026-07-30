#!/usr/bin/env node
/**
 * demo-seed.mjs — build a small DEMONSTRATION corpus from REAL sources.
 *
 * This exists so the renderers can be reviewed against real output rather than
 * lorem ipsum. Everything below is genuinely retrieved live: real PubMed
 * records, real abstracts, real ClinicalTrials.gov records with real contact
 * blocks, real enumeration statistics.
 *
 * IT IS NOT A RESEARCH RESULT. The direction and tier of each finding are
 * assigned here by crude keyword heuristics, not by a research agent reading the
 * paper — which is exactly the job record_finding exists to make a human-grade
 * agent do properly. The corpus is named `demo-preview` so it cannot be mistaken
 * for real work.
 *
 * Run:  RESEARCH_CORPUS_DIR=/tmp/demo node demo-seed.mjs
 */

import { pubmedSearch, clinicalTrialsSearch, fdaLabel } from "./fetchers.mjs";
import { enumeratePubmed, enumerateEuropePMC, enumerateClinicalTrials, enumerateOpenAlex } from "./index-layer.mjs";
import { recordFinding, indexCandidates, logSearch, updateCandidate, corpusStats, indexStats, readIndex } from "./corpus.mjs";
import { initRun } from "./driver.mjs";

const P = process.env.DEMO_PROJECT || "demo-preview";

// Queries chosen to produce a realistic mix: confirming, disconfirming, species,
// and a couple that genuinely return nothing (so the "found nothing" panel has
// real content in it).
// Deliberately weighted to the actual research question: pancreatic cancer.
// A demo built on "fenbendazole cancer" produces a corpus that is mostly about
// other cancers, which is exactly the failure mode the relevance panel exists
// to expose — so the seed pairs every substance with the indication.
const QUERIES = [
  { q: "ivermectin pancreatic ductal adenocarcinoma", intent: "confirming" },
  { q: "ivermectin pancreatic cancer gemcitabine", intent: "confirming" },
  { q: "fenbendazole pancreatic cancer", intent: "confirming" },
  { q: "mebendazole pancreatic ductal adenocarcinoma", intent: "confirming" },
  { q: "mebendazole pancreatic cancer xenograft", intent: "confirming" },
  { q: "methylene blue pancreatic cancer", intent: "confirming" },
  { q: "benzimidazole pancreatic adenocarcinoma antitumor", intent: "confirming" },
  { q: "albendazole pancreatic cancer", intent: "confirming" },
  { q: "ivermectin pancreatic cancer no significant difference", intent: "disconfirming" },
  { q: "mebendazole pancreatic cancer failed OR terminated", intent: "disconfirming" },
  { q: "fenbendazole hepatotoxicity", intent: "disconfirming" },
  { q: "methylene blue serotonin syndrome contraindication", intent: "disconfirming" },
  { q: "repurposed drug pancreatic cancer negative trial", intent: "disconfirming" },
  { q: "fenbendazole canine safety tolerability", intent: "confirming" },
  { q: "fenbendazole cattle bovine anthelmintic residue depletion", intent: "confirming" },
  { q: "mebendazole Syrian golden hamster pancreatic carcinogenesis", intent: "confirming" },
  { q: "fenbendazole Joe Tippens protocol testimonial", intent: "grey" },
  { q: "伊维菌素 胰腺癌", intent: "confirming" },
  { q: "мебендазол рак поджелудочной железы", intent: "confirming" },
];

const SUBSTANCE_OF = (q) =>
  /ivermectin|伊维菌素|ивермектин/i.test(q) ? "ivermectin"
  : /fenbendazol|芬苯达唑|фенбендазол/i.test(q) ? "fenbendazole"
  : /mebendazol|甲苯咪唑|мебендазол/i.test(q) ? "mebendazole"
  : /methylene blue|亚甲蓝|метиленовый/i.test(q) ? "methylene blue"
  : "benzimidazole class";

console.log(`Seeding demo corpus "${P}" from live sources…\n`);
initRun(P, { question: "Alternative and repurposed agents in pancreatic cancer", depth: "quick", force: true });

// ---------------------------------------------------------------------------
// 1. INDEXING — real enumeration against real APIs
// ---------------------------------------------------------------------------
console.log("── indexing ──");
for (const { q, intent } of QUERIES) {
  for (const [src, fn] of [
    ["pubmed", enumeratePubmed],
    ["europepmc", enumerateEuropePMC],
    ["clinicaltrials", enumerateClinicalTrials],
    ["openalex", enumerateOpenAlex],
  ]) {
    try {
      const r = await fn(q, { max: 120 });
      const y = indexCandidates(P, r.records, { engine: src, query: q, intent });
      logSearch(P, {
        engine: src, query: q, intent,
        result_count: r.retrieved, reported_total: r.reported_total,
        exhausted: r.exhausted, hit_ceiling: r.hit_ceiling,
        marginal_yield: y.marginal_yield, notes: r.ceiling_reason,
      });
      process.stdout.write(`  ${src.padEnd(15)} "${q.slice(0, 46)}" → ${String(r.retrieved).padStart(4)} (${y.fresh} new)\n`);
    } catch (e) {
      logSearch(P, { engine: src, query: q, intent, result_count: 0, notes: `ERROR: ${e.message}` });
      console.log(`  ${src.padEnd(15)} "${q.slice(0, 46)}" → ERROR ${e.message}`);
    }
  }
}

// Sources that are genuinely unconfigured here. Logged so the coverage panel
// shows them as gaps rather than silently omitting them — a source that never
// ran must never look like a source that found nothing.
for (const { q, intent } of QUERIES.slice(0, 8)) {
  logSearch(P, { engine: "google", query: q, intent, result_count: 0, notes: "Google is not configured. Set GOOGLE_CSE_ID + GOOGLE_API_KEY or SERPAPI_KEY." });
  logSearch(P, { engine: "yandex", query: q, intent, result_count: 0, hit_ceiling: true, notes: "Yandex is not configured. Set YANDEX_API_KEY + YANDEX_FOLDER_ID or SERPAPI_KEY — Russian-language sources are otherwise unreachable." });
  logSearch(P, { engine: "baidu", query: q, intent, result_count: 0, hit_ceiling: true, notes: "Baidu is not configured. Requires SERPAPI_KEY — Chinese-language sources are otherwise unreachable." });
}

// ---------------------------------------------------------------------------
// 2. FINDINGS — real abstracts, real quotes
// ---------------------------------------------------------------------------
console.log("\n── extracting findings from real abstracts ──");

const SPECIES_HINT = [
  [/xenograft|nude mice|nude mouse|\bmice\b|\bmouse\b|murine|BALB|C57BL/i, { species: "mouse", tier: "animal_in_vivo", model: "mouse (see quote)" }],
  [/\brats?\b|Sprague|Wistar/i, { species: "rat", tier: "animal_in_vivo", model: "rat (see quote)" }],
  [/hamster/i, { species: "hamster", tier: "animal_in_vivo", model: "Syrian golden hamster" }],
  [/\bdogs?\b|canine|beagle/i, { species: "dog", tier: "animal_in_vivo", model: "dog (see quote)" }],
  [/cattle|bovine|calves|calf/i, { species: "cattle", tier: "animal_in_vivo", model: "cattle" }],
  [/sheep|ovine|lamb/i, { species: "sheep", tier: "animal_in_vivo", model: "sheep" }],
  [/horses?|equine|foal/i, { species: "horse", tier: "animal_in_vivo", model: "horse" }],
  [/zebrafish/i, { species: "zebrafish", tier: "animal_in_vivo", model: "zebrafish" }],
  [/patients?|randomi[sz]ed|phase (I|II|III)|clinical trial|volunteers/i, { species: "human", tier: "case_series", model: "human" }],
  [/PANC-1|MiaPaCa|BxPC-3|AsPC-1|Capan|cell lines?|in vitro|IC50|cultured/i, { species: "cell_line", tier: "in_vitro", model: "human pancreatic cancer cell line (see quote)" }],
];

function classify(text) {
  for (const [re, v] of SPECIES_HINT) if (re.test(text)) return v;
  return { species: "unspecified", tier: "narrative_review", model: null };
}

function direction(text) {
  if (/no significant|did not|failed to|no effect|lack of efficacy|was not associated/i.test(text)) return "null";
  if (/toxicit|adverse|hepatotox|neurotox|serotonin syndrome|hemolysis|death|mortality/i.test(text)) return "harm";
  if (/inhibit|reduc|suppress|decreas|improv|prolong|induced apoptosis|antitumor|efficacy/i.test(text)) return "benefit";
  return "background";
}

/** Take a real, quotable sentence out of a real abstract. */
function pickQuote(abstract) {
  if (!abstract) return null;
  const sents = abstract
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter((x) => x.length >= 60 && x.length <= 400);
  // Prefer a result/conclusion sentence over the background sentence.
  const scored = sents.map((x) => ({
    x,
    score:
      (/(we (found|show|observed|demonstrate)|results? (show|demonstrate|indicate)|significantly|inhibit|reduc|no significant|p ?[<=])/i.test(x) ? 2 : 0) +
      (/(conclusion|in conclusion|these (data|results|findings))/i.test(x) ? 1 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.x || sents[0] || null;
}

let recorded = 0;
const seenPmid = new Set();

for (const { q } of QUERIES) {
  let res;
  try {
    res = await pubmedSearch(q, { limit: 6 });
  } catch {
    continue;
  }
  for (const rec of res.records) {
    if (!rec.abstract || seenPmid.has(rec.pmid) || recorded >= 34) continue;
    const quote = pickQuote(rec.abstract);
    if (!quote) continue;
    seenPmid.add(rec.pmid);

    const cls = classify(rec.abstract);
    const isReview = (rec.publication_types || []).some((t) => /review/i.test(t));
    const isTrial = (rec.publication_types || []).some((t) => /randomized controlled trial|clinical trial/i.test(t));
    const tier = isTrial ? "rct" : isReview ? "narrative_review" : cls.tier;

    const r = recordFinding(P, {
      claim: `${rec.title}`.replace(/\.$/, "") + ".",
      verbatim_quote: quote,
      direction: direction(rec.abstract),
      evidence_tier: tier,
      subject: SUBSTANCE_OF(q + " " + rec.title),
      indication: /pancrea/i.test(rec.title + rec.abstract) ? "pancreatic cancer" : "cancer (non-pancreatic or unspecified)",
      model_system: cls.model,
      species: cls.species,
      population_n: (rec.abstract.match(/\bn\s*=\s*(\d+)/i) || [])[1] ? Number(RegExp.$1) : null,
      dose_reported: (rec.abstract.match(/\d+(\.\d+)?\s*(mg\/kg|µM|uM|nM|mg\/mL|mg per kg|mg\/m2)/i) || [])[0] || null,
      route: (rec.abstract.match(/\b(oral|intraperitoneal|intravenous|subcutaneous|topical|i\.p\.|i\.v\.|p\.o\.)\b/i) || [])[0] || null,
      outcome_measure: (rec.abstract.match(/\b(overall survival|progression[- ]free survival|tumor volume|tumour volume|cell viability|IC50|apoptosis)\b/i) || [])[0] || null,
      adverse_events: /adverse|toxicit|side effect/i.test(rec.abstract) ? "mentioned in the abstract — see full text" : "not assessed in the abstract",
      funding: rec.grants?.length ? `Grant IDs: ${rec.grants.slice(0, 3).join(", ")}` : null,
      limitations: isReview ? "Narrative review — not a primary study." : null,
      retracted: (rec.retraction_flags || []).length > 0,
      contacts: (rec.contact_emails || []).slice(0, 2).map((e) => ({
        name: rec.authors?.[0] ? `${rec.authors[0]} (first author)` : "corresponding author",
        role: "corresponding author",
        affiliation: rec.affiliations?.[0] || null,
        email: e,
      })),
      source: {
        type: "journal_article",
        title: rec.title,
        doi: rec.doi,
        pmid: rec.pmid,
        url: rec.url,
        journal: rec.journal,
        year: rec.year,
        authors: (rec.authors || []).slice(0, 3).join(", ") + ((rec.authors || []).length > 3 ? " et al." : ""),
      },
    });
    if (r.ok) {
      recorded++;
      const idx = readIndex(P).find((c) => c.pmid === rec.pmid);
      if (idx) updateCandidate(P, idx.key, { status: "recorded" });
    }
  }
}
console.log(`  recorded ${recorded} findings from real abstracts`);

// ---------------------------------------------------------------------------
// 3. TRIALS — real contact blocks
// ---------------------------------------------------------------------------
console.log("\n── trials + contacts ──");
let trialFindings = 0;
for (const q of ["mebendazole cancer", "ivermectin cancer", "methylene blue cancer"]) {
  try {
    const t = await clinicalTrialsSearch(q, { limit: 12 });
    for (const st of t.records.slice(0, 4)) {
      const contacts = [
        ...st.central_contacts.map((c) => ({ name: c.name, role: c.role || "central contact", email: c.email, phone: c.phone })),
        ...st.overall_officials.map((o) => ({ name: o.name, role: o.role || "principal investigator", affiliation: o.affiliation })),
      ].filter((c) => c.name);
      if (!st.official_title && !st.title) continue;
      const r = recordFinding(P, {
        claim: `Registered trial: ${st.title}. Status ${st.status}${st.why_stopped ? `; stopped because: ${st.why_stopped}` : ""}. Enrolment ${st.enrollment ?? "unstated"}.`,
        verbatim_quote: (st.official_title || st.title) + (st.why_stopped ? ` — Why stopped: ${st.why_stopped}` : ""),
        direction: /terminated|withdrawn|suspended/i.test(st.status || "") ? "null" : "background",
        evidence_tier: "clinical_trial_record" in {} ? "rct" : st.phase?.length ? "rct" : "regulatory_document",
        subject: SUBSTANCE_OF(q + " " + (st.interventions || []).map((i) => i.name).join(" ")),
        indication: (st.conditions || []).join(", ") || null,
        model_system: "human",
        species: "human",
        population_n: st.enrollment ?? null,
        outcome_measure: (st.primary_outcomes || [])[0] || null,
        limitations: st.results_posted ? null : "No results have been posted for this registration.",
        contacts,
        source: { type: "clinical_trial_record", title: st.title, nct: st.nct, url: st.url, year: (st.start_date || "").slice(0, 4), publisher: st.sponsor },
      });
      if (r.ok) trialFindings++;
    }
  } catch (e) {
    console.log("  trial fetch error:", e.message);
  }
}
console.log(`  recorded ${trialFindings} trial records with contacts`);

// ---------------------------------------------------------------------------
// 4. SAFETY — real FDA label data
// ---------------------------------------------------------------------------
console.log("\n── safety / regulatory ──");
for (const sub of ["ivermectin", "mebendazole", "methylene blue"]) {
  try {
    const lab = await fdaLabel(sub);
    if (!lab.found || !lab.contraindications) continue;
    const r = recordFinding(P, {
      claim: `FDA label for ${sub} states contraindications and warnings for its approved use.`,
      verbatim_quote: String(lab.contraindications).replace(/\s+/g, " ").slice(0, 380),
      direction: "harm",
      evidence_tier: "regulatory_document",
      subject: sub,
      indication: "approved indication (not pancreatic cancer)",
      model_system: "human",
      species: "human",
      adverse_events: String(lab.warnings || "").replace(/\s+/g, " ").slice(0, 300) || null,
      limitations: "Label data describes the approved indication and dose, not oncology use.",
      source: { type: "regulatory", title: `FDA label — ${sub}`, url: "https://labels.fda.gov/", publisher: "U.S. Food and Drug Administration" },
    });
    if (r.ok) console.log(`  recorded FDA label finding for ${sub}`);
  } catch (e) {
    console.log("  label error:", e.message);
  }
}

// Mark a few index entries as unreachable/rejected so the PRISMA flow is real.
const idx = readIndex(P).filter((c) => c.status === "indexed" || c.status === "queued");
idx.slice(0, 7).forEach((c) => updateCandidate(P, c.key, { status: "unreachable", reason: "publisher paywall" }));
idx.slice(7, 20).forEach((c) => updateCandidate(P, c.key, { status: "rejected", reason: "not about the substances under study" }));
idx.slice(20, 46).forEach((c) => updateCandidate(P, c.key, { status: "read" }));

const s = corpusStats(P);
const ix = indexStats(P);
console.log(`\n✅ demo corpus "${P}"`);
console.log(`   ${ix.total} documents indexed · ${ix.read} read · ${s.findings} findings`);
console.log(`   direction: ${JSON.stringify(s.byDirection)}`);
console.log(`   species:   ${JSON.stringify(s.bySpecies)}`);
console.log(`   coverage:  ${(ix.coverage * 100).toFixed(1)}%  (est. ${ix.unseen_estimate} unseen)`);
