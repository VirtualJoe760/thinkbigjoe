#!/usr/bin/env node
/**
 * smoke-test.mjs — exercises the retrieval layer against the live APIs and
 * proves the corpus gates actually reject what they claim to reject.
 *
 * Run:  RESEARCH_CORPUS_DIR=/tmp/smoke-corpus node smoke-test.mjs
 */

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
  fdaLabel,
  fdaAdverseEvents,
  fetchPage,
} from "./fetchers.mjs";
import { recordFinding, corpusStats, logSearch, getFindings } from "./corpus.mjs";

const P = "smoke";
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    const msg = await fn();
    console.log(`  ✅ ${name}${msg ? ` — ${msg}` : ""}`);
    pass++;
  } catch (e) {
    console.log(`  ❌ ${name} — ${e.message}`);
    fail++;
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\n── retrieval layer (live network) ──");

await t("duckduckgo", async () => {
  const r = await duckduckgoSearch("fenbendazole pancreatic cancer", { limit: 10 });
  assert(r.length > 0, "no results");
  return `${r.length} results, first: ${r[0].url.slice(0, 60)}`;
});

await t("google", async () => {
  const r = await googleSearch("ivermectin pancreatic cancer", { limit: 5 });
  if (r.unavailable) return `NOT CONFIGURED (expected without a key) — ${r.unavailable.slice(0, 60)}…`;
  assert(r.results.length > 0, "configured but returned nothing");
  return `${r.results.length} results`;
});

await t("pubmed", async () => {
  const r = await pubmedSearch("ivermectin pancreatic cancer", { limit: 5 });
  assert(r.records.length > 0, "no records");
  const a = r.records[0];
  assert(a.pmid && a.title, "record missing pmid/title");
  return `${r.total} in db, sample: "${a.title.slice(0, 50)}…" (${a.abstract ? "abstract ✓" : "no abstract"}, ${a.contact_emails.length} emails)`;
});

await t("europepmc", async () => {
  const r = await europepmcSearch("mebendazole cancer", { limit: 5 });
  assert(r.records.length > 0, "no records");
  return `${r.total} hits, ${r.records.filter((x) => x.is_preprint).length} preprints in sample`;
});

await t("clinicaltrials + contacts", async () => {
  const r = await clinicalTrialsSearch("mebendazole cancer", { limit: 10 });
  assert(r.records.length > 0, "no trials");
  const withContact = r.records.filter((s) => s.central_contacts.length || s.overall_officials.length);
  return `${r.total} trials, ${withContact.length}/${r.records.length} carry contacts`;
});

await t("openalex search", async () => {
  const r = await openalexSearch("fenbendazole antitumor", { limit: 5 });
  assert(r.records.length > 0, "no works");
  return `${r.total} works`;
});

await t("openalex citation expansion (depth engine)", async () => {
  const r = await openalexExpand("10.1038/s41598-018-30158-6", { direction: "both", limit: 10 });
  return `backward ${r.backward.length}, forward ${r.forward.length}`;
});

await t("integrity check", async () => {
  const r = await integrityCheck({ doi: "10.1038/s41598-018-30158-6" });
  return r.clean ? "clean" : `flags: ${JSON.stringify(r.flags)}`;
});

await t("fda label", async () => {
  const r = await fdaLabel("ivermectin");
  return r.found ? `label found (${r.contraindications ? "contraindications ✓" : "no contraindications field"})` : "no label";
});

await t("fda adverse events", async () => {
  const r = await fdaAdverseEvents("ivermectin");
  return `${r.total_reports ?? "?"} reports, top: ${r.top_reactions.slice(0, 3).map((x) => x.reaction).join(", ") || "none"}`;
});

await t("fetchPage on a static page", async () => {
  const r = await fetchPage("https://en.wikipedia.org/wiki/Fenbendazole");
  assert(r.text && r.text.length > 5000, `only ${r.text?.length ?? 0} chars — ${r.warning || "unknown"}`);
  assert(!r.warning, "false warning on a good page");
  return `${r.text.length} chars, ${r.citation_links.length} citation links`;
});

await t("fetchPage warns instead of returning nav chrome (SPA / bot wall)", async () => {
  const spa = await fetchPage("https://clinicaltrials.gov/study/NCT02366884");
  const walled = await fetchPage("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6103264/");
  assert(spa.warning && walled.warning, "a page with no prose came back unflagged");
  return "both flagged, agent redirected to the API path";
});

await t("get_full_text API path beats scraping (the depth guarantee)", async () => {
  const ft = await europepmcFullText("PMC6103264");
  assert(ft.text.length > 20000, `only ${ft.text.length} chars`);
  assert(ft.reference_count > 5, "no reference list");
  return `${ft.text.length} chars of full text, ${ft.reference_count} references extracted for citation walking`;
});

console.log("\n── corpus gates (these MUST reject) ──");

const base = {
  claim: "Fenbendazole inhibited proliferation in a human cancer cell line at the stated concentration.",
  verbatim_quote: "Fenbendazole treatment resulted in a dose-dependent reduction in cell viability in vitro.",
  direction: "benefit",
  evidence_tier: "in_vitro",
  subject: "fenbendazole",
  source: { type: "journal_article", doi: "10.1038/s41598-018-30158-6", title: "Test", year: "2018" },
};

await t("rejects unsourced claim", async () => {
  const r = recordFinding(P, { ...base, source: { title: "no id" } });
  assert(!r.ok && /no resolvable source/.test(r.error), "did not reject");
  return "rejected";
});

await t("rejects missing verbatim quote", async () => {
  const r = recordFinding(P, { ...base, verbatim_quote: "short" });
  assert(!r.ok && /verbatim_quote/.test(r.error), "did not reject");
  return "rejected";
});

await t("rejects unclassified direction", async () => {
  const r = recordFinding(P, { ...base, direction: "promising" });
  assert(!r.ok && /direction must be/.test(r.error), "did not reject");
  return "rejected";
});

await t("rejects invalid evidence tier", async () => {
  const r = recordFinding(P, { ...base, evidence_tier: "strong" });
  assert(!r.ok, "did not reject");
  return "rejected";
});

await t("accepts a well-formed finding", async () => {
  const r = recordFinding(P, base);
  assert(r.ok, r.error);
  return `id ${r.finding.id}`;
});

await t("deduplicates identical findings", async () => {
  const r = recordFinding(P, base);
  assert(r.duplicate, "did not dedupe");
  return "deduped";
});

await t("stats flag preclinical-only + missing null/harm", async () => {
  logSearch(P, { engine: "pubmed", query: "x", intent: "disconfirming", result_count: 0 });
  const s = corpusStats(P);
  assert(s.preclinicalOnly, "should flag preclinical-only");
  assert(s.byDirection.null === 0 && s.byDirection.harm === 0, "balance wrong");
  return `${s.findings} findings, preclinicalOnly=${s.preclinicalOnly}, disconfirming=${s.disconfirmingSearches}`;
});

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
