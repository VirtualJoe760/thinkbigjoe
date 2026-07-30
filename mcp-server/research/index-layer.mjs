/**
 * index-layer.mjs — the indexing layer. This runs FIRST, before anything is read.
 *
 * Its job is ENUMERATION, not judgement: turn one research question into the
 * full set of queries needed to reach saturation, run each one to the bottom of
 * its source rather than to the bottom of page one, and park every unique
 * document in the index ledger with a stable identity.
 *
 * Two things make this different from "run a search":
 *
 * 1. PAGING TO EXHAUSTION. Every source here reports how many records it holds
 *    for a query, and every source has a different mechanism for walking them —
 *    retstart/WebEnv, cursorMark, nextPageToken, cursor=*. This module walks
 *    each one until the source is empty or the source's own paging ceiling is
 *    hit, and records WHICH of those two happened. That distinction is the
 *    difference between "there is no more" and "we cannot see any more", and
 *    conflating them is how a search silently under-reports.
 *
 * 2. THE QUERY MATRIX. One question expands into hundreds of queries along
 *    deliberate axes — substance synonyms (including the misspellings people
 *    actually use), indication synonyms, mechanism terms, study-design terms,
 *    outcome terms, combination partners, and a mandatory disconfirming axis
 *    plus a grey-literature axis. Searching "fenbendazole pancreatic cancer"
 *    once and calling it research is how you find the twelve papers everyone
 *    already knows about and none of the others.
 *
 * Saturation, not effort, decides when to stop — see coverageEstimate() in
 * corpus.mjs. A search stops when queries stop finding anything new, which is a
 * measurable property, not a feeling.
 */

import {
  pubmedSearch,
  europepmcSearch,
  clinicalTrialsSearch,
  openalexSearch,
  duckduckgoSearch,
  googleSearch,
  yandexSearch,
  baiduSearch,
} from "./fetchers.mjs";
import { SPECIES_QUERY_TERMS } from "./species.mjs";
import { limited } from "./ratelimit.mjs";

const CONTACT = process.env.RESEARCH_CONTACT_EMAIL || "research@example.org";
const UA = process.env.RESEARCH_USER_AGENT || `research-mcp/1.0 (+mailto:${CONTACT})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every outbound call goes through the rate limiter: it paces to each service's
 * published guidance, tracks daily quotas across process restarts, honours
 * Retry-After on a 429, and backs off exponentially on 5xx. A source that runs
 * out of quota returns a structured error the caller logs as a coverage gap —
 * it never looks like "no results".
 */
async function getJson(url, source = "default") {
  const r = await limited(source, async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      const ra = res.headers.get("retry-after");
      if (ra) err.retryAfter = Number(ra);
      throw err;
    }
    return res.json();
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

// ===========================================================================
// PART 1 — THE QUERY MATRIX
// ===========================================================================

/**
 * Term tables. These are data, not prose — the expansion below is a cartesian
 * walk over them. Misspellings are included on purpose: they are what people
 * actually type, and grey literature is indexed under them.
 */
export const TERMS = {
  substances: {
    ivermectin: [
      "ivermectin",
      "Stromectol",
      "Soolantra",
      "Sklice",
      "Mectizan",
      "22,23-dihydroavermectin B1",
      "MK-933",
      "avermectin",
      "CAS 70288-86-7",
    ],
    "methylene blue": [
      "methylene blue",
      "methylthioninium chloride",
      "Provayblue",
      "ProvayBlue",
      "tetramethylthionine chloride",
      "basic blue 9",
      "methane blue", // common misnaming — indexed in grey literature under it
      "MTC",
      "CAS 61-73-4",
    ],
    mebendazole: [
      "mebendazole",
      "Vermox",
      "Ovex",
      "Emverm",
      "mebendazol", // no trailing e — Spanish/Portuguese and common misspelling
      "methyl 5-benzoylbenzimidazole-2-carbamate",
      "R-17635",
      "CAS 31431-39-7",
    ],
    fenbendazole: [
      "fenbendazole",
      "Panacur",
      "Safe-Guard",
      "fenbendazol",
      "methyl N-(6-phenylsulfanyl-1H-benzimidazol-2-yl)carbamate",
      "HOE 881",
      "CAS 43210-67-9",
      "Joe Tippens", // the named protocol this substance is discussed under
    ],
    "benzimidazole class": [
      "benzimidazole anthelmintic",
      "albendazole",
      "flubendazole",
      "oxibendazole",
      "parbendazole",
      "ricobendazole",
      "triclabendazole",
    ],
  },

  indication: [
    "pancreatic cancer",
    "pancreatic ductal adenocarcinoma",
    "PDAC",
    "pancreatic adenocarcinoma",
    "pancreatic carcinoma",
    "pancreatic neoplasm",
    "exocrine pancreatic cancer",
    "cancer of the pancreas",
    "Pancreatic Neoplasms[MeSH Terms]",
    "Carcinoma, Pancreatic Ductal[MeSH Terms]",
  ],

  // Tagged separately — a different disease with different biology. Included so
  // it can be found and then correctly excluded, rather than silently merged.
  adjacent_indication: ["pancreatic neuroendocrine tumor", "pNET", "insulinoma", "islet cell carcinoma"],

  mechanism: [
    "apoptosis",
    "autophagy",
    "tubulin polymerization",
    "microtubule",
    "mitochondrial",
    "oxidative phosphorylation",
    "glycolysis",
    "Warburg effect",
    "P-glycoprotein",
    "multidrug resistance",
    "WNT signaling",
    "YAP TAZ",
    "STAT3",
    "NF-kB",
    "hedgehog signaling",
    "hypoxia HIF-1",
    "ferroptosis",
    "cell cycle arrest",
    "glucose uptake GLUT",
    "reactive oxygen species",
    "cancer stem cells",
    "tumor microenvironment stroma",
  ],

  design: [
    "in vitro",
    "cell line",
    "xenograft",
    "orthotopic model",
    "patient derived xenograft PDX",
    "organoid",
    "case report",
    "case series",
    "phase I",
    "phase II",
    "clinical trial",
    "cohort study",
    "retrospective",
    "pharmacokinetics",
    "maximum tolerated dose",
    "bioavailability",
    "dose escalation",
  ],

  outcome: [
    "overall survival",
    "progression free survival",
    "tumor volume",
    "tumor growth inhibition",
    "IC50",
    "cell viability",
    "apoptosis index",
    "CA 19-9",
    "objective response rate",
    "quality of life",
  ],

  combination: [
    "gemcitabine",
    "nab-paclitaxel",
    "Abraxane",
    "FOLFIRINOX",
    "5-fluorouracil",
    "oxaliplatin",
    "irinotecan",
    "radiotherapy",
    "vitamin C ascorbate",
    "curcumin",
    "statin simvastatin",
    "metformin",
    "berberine",
    "vitamin D",
    "vitamin E succinate",
    "CBD cannabidiol",
    "hyperthermia",
    "photodynamic therapy", // relevant specifically to methylene blue
  ],

  // The mandatory disconfirming axis. These are the forms negative results are
  // ACTUALLY published under — "no benefit" is rarely the phrase used.
  disconfirming: [
    "no significant difference",
    "did not improve survival",
    "no antitumor activity",
    "failed to inhibit",
    "lack of efficacy",
    "negative results",
    "null result",
    "terminated trial",
    "withdrawn study",
    "trial stopped futility",
    "retracted",
    "expression of concern",
    "hepatotoxicity",
    "neurotoxicity",
    "adverse events toxicity",
    "serotonin syndrome", // methylene blue specifically
    "G6PD deficiency hemolysis", // methylene blue specifically
    "bone marrow suppression",
    "case report toxicity",
    "criticism rebuttal methodological flaws",
    "pseudoscience debunked misinformation",
    "pharmacokinetic barrier plasma concentration achievable",
  ],

  // Where reported experience actually lives. The client explicitly asked for
  // "success stories ever found" — these are recorded at anecdote tier, never
  // promoted, but a corpus that pretends they do not exist is incomplete.
  grey: [
    "Joe Tippens protocol",
    "fenbendazole protocol cancer testimonial",
    "survivor story anecdote",
    "self-administered off-label",
    "patient forum experience",
    "site:reddit.com",
    "site:cancerforums.net",
    "site:inspire.com",
    "site:healthunlocked.com",
    "substack cancer protocol",
    "case report self-treatment",
  ],

  // Non-English literature. This axis exists because a meaningful share of
  // repurposed-drug oncology work is published in Chinese and Russian venues
  // that English-only queries never surface — and because Yandex and Baidu are
  // the practical way into those webs. The terms are paired with the indication
  // in-language so the query is genuinely native, not an English query with one
  // translated word in it.
  multilingual: {
    zh: {
      label: "Chinese",
      engines: ["baidu", "openalex", "europepmc"],
      indication: ["胰腺癌", "胰腺导管腺癌"],
      substances: {
        ivermectin: ["伊维菌素"],
        "methylene blue": ["亚甲蓝", "亚甲基蓝"],
        mebendazole: ["甲苯咪唑"],
        fenbendazole: ["芬苯达唑"],
        "benzimidazole class": ["苯并咪唑", "阿苯达唑"],
      },
      axis: ["抗肿瘤", "细胞凋亡", "临床试验", "毒性", "无效"],
    },
    ru: {
      label: "Russian",
      engines: ["yandex", "openalex", "europepmc"],
      indication: ["рак поджелудочной железы", "аденокарцинома поджелудочной железы"],
      substances: {
        ivermectin: ["ивермектин"],
        "methylene blue": ["метиленовый синий"],
        mebendazole: ["мебендазол"],
        fenbendazole: ["фенбендазол"],
        "benzimidazole class": ["бензимидазол", "альбендазол"],
      },
      axis: ["противоопухолевый", "апоптоз", "клиническое исследование", "токсичность"],
    },
    es: {
      label: "Spanish",
      engines: ["google", "duckduckgo", "europepmc"],
      indication: ["cáncer de páncreas", "adenocarcinoma de páncreas"],
      substances: {
        ivermectin: ["ivermectina"],
        "methylene blue": ["azul de metileno"],
        mebendazole: ["mebendazol"],
        fenbendazole: ["fenbendazol"],
        "benzimidazole class": ["bencimidazol", "albendazol"],
      },
      axis: ["antitumoral", "apoptosis", "ensayo clínico", "toxicidad"],
    },
    ja: {
      label: "Japanese",
      engines: ["google", "openalex"],
      indication: ["膵癌", "膵臓がん"],
      substances: {
        ivermectin: ["イベルメクチン"],
        "methylene blue": ["メチレンブルー"],
        mebendazole: ["メベンダゾール"],
        fenbendazole: ["フェンベンダゾール"],
        "benzimidazole class": ["ベンズイミダゾール"],
      },
      axis: ["抗腫瘍", "アポトーシス", "臨床試験"],
    },
  },
};

/**
 * Expand one question into the full query matrix.
 *
 * The expansion is deliberately layered rather than a full cartesian product —
 * a full product of every table would be ~250,000 queries and mostly noise. The
 * layers below are the ones that actually surface distinct literature.
 */
export function expandQueryMatrix(opts = {}) {
  const subs = opts.substances?.length
    ? opts.substances
    : Object.keys(TERMS.substances);
  const indications = opts.indications?.length ? opts.indications : TERMS.indication;
  const depth = opts.depth || "standard"; // quick | standard | exhaustive

  const cfg = {
    quick: { syn: 2, ind: 2, mech: 4, design: 3, outcome: 2, combo: 3, disc: 6, grey: 3, species: 4 },
    standard: { syn: 4, ind: 4, mech: 10, design: 8, outcome: 5, combo: 8, disc: 14, grey: 6, species: 10 },
    exhaustive: { syn: 99, ind: 99, mech: 99, design: 99, outcome: 99, combo: 99, disc: 99, grey: 99, species: 99 },
  }[depth];

  const out = [];
  const seen = new Set();
  const add = (q, intent, axis, substance) => {
    const key = q.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key) || key.length < 4) return;
    seen.add(key);
    out.push({ query: q, intent, axis, substance });
  };

  for (const sub of subs) {
    const syns = (TERMS.substances[sub] || [sub]).slice(0, cfg.syn);
    const inds = indications.slice(0, cfg.ind);

    // Layer 1 — substance × indication. The spine.
    for (const s of syns) for (const ind of inds) add(`${s} ${ind}`, "confirming", "core", sub);

    // Layer 2 — substance × mechanism. Finds the biology papers that never
    // mention the indication and so never appear in layer 1.
    for (const m of TERMS.mechanism.slice(0, cfg.mech)) add(`${syns[0]} ${m} cancer`, "confirming", "mechanism", sub);

    // Layer 3 — substance × indication × design. Surfaces the tiers separately
    // so a single ranking cannot bury every case report under the reviews.
    for (const d of TERMS.design.slice(0, cfg.design)) add(`${syns[0]} ${inds[0]} ${d}`, "confirming", "design", sub);

    // Layer 4 — outcome terms.
    for (const o of TERMS.outcome.slice(0, cfg.outcome)) add(`${syns[0]} ${inds[0]} ${o}`, "confirming", "outcome", sub);

    // Layer 5 — combination partners. Repurposing literature is mostly combination literature.
    for (const c of TERMS.combination.slice(0, cfg.combo)) add(`${syns[0]} ${c} pancreatic`, "confirming", "combination", sub);

    // Layer 6 — DISCONFIRMING. Not optional, and not a token gesture: this axis
    // is sized comparably to the confirming axes above.
    for (const d of TERMS.disconfirming.slice(0, cfg.disc)) add(`${syns[0]} ${d}`, "disconfirming", "disconfirming", sub);
    for (const d of TERMS.disconfirming.slice(0, Math.ceil(cfg.disc / 2)))
      add(`${syns[0]} ${inds[0]} ${d}`, "disconfirming", "disconfirming", sub);

    // Layer 7 — grey literature and reported experience.
    for (const g of TERMS.grey.slice(0, cfg.grey)) add(`${syns[0]} ${g}`, "grey", "grey", sub);

    // Layer 8 — SPECIES / ANIMAL MODEL. This axis exists because the veterinary
    // literature for these drugs is large, old, and invisible to any search that
    // pairs the substance with "cancer". Decades of dog, cattle, horse and sheep
    // tolerability and pharmacokinetic data sit under licensing terms, not
    // oncology terms, and it is the best-characterised safety data that exists
    // for the benzimidazoles.
    for (const sp of SPECIES_QUERY_TERMS.slice(0, cfg.species))
      add(`${syns[0]} ${sp}`, "confirming", "species", sub);

    // Layer 9 — safety/regulatory baseline, independent of the indication.
    add(`${syns[0]} maximum tolerated dose human`, "confirming", "safety", sub);
    add(`${syns[0]} drug interactions contraindications`, "disconfirming", "safety", sub);
    add(`${syns[0]} pharmacokinetics plasma concentration human`, "confirming", "safety", sub);
    add(`${syns[0]} overdose toxicity case report`, "disconfirming", "safety", sub);
  }

  // Layer 10 — NON-ENGLISH. Native-language queries pairing the substance with
  // the indication in the SAME language, routed to the engines that actually
  // index that web. An English query with one translated word in it does not
  // reach this literature; a native query does.
  if (depth !== "quick") {
    const perLang = depth === "exhaustive" ? 99 : 1;
    for (const [code, L] of Object.entries(TERMS.multilingual)) {
      for (const sub of subs) {
        const names = L.substances[sub];
        if (!names) continue;
        for (const nm of names.slice(0, perLang)) {
          for (const ind of L.indication.slice(0, perLang)) add(`${nm} ${ind}`, "confirming", `lang:${code}`, sub);
          for (const ax of L.axis.slice(0, depth === "exhaustive" ? 99 : 2))
            add(
              `${nm} ${L.indication[0]} ${ax}`,
              /毒性|токсичность|toxicidad|无效/.test(ax) ? "disconfirming" : "confirming",
              `lang:${code}`,
              sub,
            );
        }
      }
    }
  }

  // Layer 11 — class-level and cross-substance queries.
  add(`repurposed drugs pancreatic cancer`, "confirming", "class", null);
  add(`drug repurposing oncology failed clinical translation`, "disconfirming", "class", null);
  add(`anthelmintic antitumor pancreatic`, "confirming", "class", null);

  return {
    depth,
    query_count: out.length,
    by_intent: out.reduce((a, q) => ((a[q.intent] = (a[q.intent] || 0) + 1), a), {}),
    by_axis: out.reduce((a, q) => ((a[q.axis] = (a[q.axis] || 0) + 1), a), {}),
    queries: out,
  };
}

// ===========================================================================
// PART 2 — ENUMERATION: page each source to the bottom
// ===========================================================================

/**
 * Every enumerator returns the same envelope:
 *   { records, reported_total, retrieved, exhausted, hit_ceiling, ceiling_reason, pages }
 *
 * `exhausted`  — we reached the end of what the source holds. Trustworthy zero.
 * `hit_ceiling`— the source refused to page further. The remainder is unknown,
 *                and the caller must partition the query (by year, by filter) to
 *                see past it. This flag propagates all the way to the report.
 */

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ncbiKey = () => (process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "");

/**
 * PubMed. esearch caps offset-based paging; past that the History server
 * (usehistory=y → WebEnv + query_key) is the documented route, and this uses it
 * for anything beyond the first page.
 */
export async function enumeratePubmed(query, { max = 5000, pageSize = 500 } = {}) {
  const first = await getJson(
    `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${pageSize}&usehistory=y&email=${encodeURIComponent(CONTACT)}${ncbiKey()}`,
    "pubmed",
  );
  const r = first.esearchresult || {};
  const total = Number(r.count || 0);
  const webenv = r.webenv;
  const qk = r.querykey;
  const ids = [...(r.idlist || [])];
  let hitCeiling = false;
  let ceilingReason = null;

  const target = Math.min(total, max);
  while (ids.length < target && webenv) {
    // The History server's own practical ceiling. Past it, partition by date.
    if (ids.length >= 9999) {
      hitCeiling = true;
      ceilingReason = "PubMed offset ceiling (~10,000) reached; partition the query by publication year to see further.";
      break;
    }
    const page = await getJson(
      `${EUTILS}/esearch.fcgi?db=pubmed&query_key=${qk}&WebEnv=${webenv}&retmode=json&retstart=${ids.length}&retmax=${pageSize}&email=${encodeURIComponent(CONTACT)}${ncbiKey()}`,
      "pubmed",
    );
    const batch = page.esearchresult?.idlist || [];
    if (!batch.length) break;
    ids.push(...batch);
  }
  if (total > max && ids.length >= max) {
    hitCeiling = true;
    ceilingReason = ceilingReason || `Stopped at the caller's max of ${max}; the source reports ${total}.`;
  }

  return {
    engine: "pubmed",
    records: ids.map((pmid) => ({ source_type: "pubmed", pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` })),
    reported_total: total,
    retrieved: ids.length,
    exhausted: ids.length >= total,
    hit_ceiling: hitCeiling,
    ceiling_reason: ceilingReason,
  };
}

/**
 * Europe PMC. Offset paging is capped; cursorMark walks the whole result set.
 */
export async function enumerateEuropePMC(query, { max = 5000, pageSize = 1000 } = {}) {
  let cursor = "*";
  const records = [];
  let total = 0;
  let guard = 0;

  while (records.length < max && guard++ < 60) {
    const url =
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}` +
      `&format=json&resultType=core&pageSize=${Math.min(pageSize, 1000)}&cursorMark=${encodeURIComponent(cursor)}&email=${encodeURIComponent(CONTACT)}`;
    const data = await getJson(url, "europepmc");
    total = data.hitCount ?? total;
    const batch = data.resultList?.result || [];
    if (!batch.length) break;
    for (const x of batch)
      records.push({
        source_type: "europepmc",
        pmid: x.pmid || null,
        pmcid: x.pmcid || null,
        doi: x.doi || null,
        title: x.title,
        year: x.pubYear,
        journal: x.journalInfo?.journal?.title || null,
        cited_by: x.citedByCount ?? null,
        open_access: x.isOpenAccess === "Y",
        full_text_available: !!x.pmcid,
        url: x.doi ? `https://doi.org/${x.doi}` : `https://europepmc.org/article/${x.source}/${x.id}`,
      });
    const next = data.nextCursorMark;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return {
    engine: "europepmc",
    records,
    reported_total: total,
    retrieved: records.length,
    exhausted: records.length >= total,
    hit_ceiling: records.length >= max && total > max,
    ceiling_reason: records.length >= max && total > max ? `Stopped at the caller's max of ${max}; source reports ${total}.` : null,
  };
}

/** ClinicalTrials.gov v2 — nextPageToken walks the full set. */
export async function enumerateClinicalTrials(query, { max = 2000, pageSize = 200, status } = {}) {
  let token = null;
  const records = [];
  let total = 0;
  let guard = 0;

  while (records.length < max && guard++ < 60) {
    const p = new URLSearchParams({
      "query.term": query,
      pageSize: String(Math.min(pageSize, 1000)),
      format: "json",
      countTotal: "true",
    });
    if (status) p.set("filter.overallStatus", status);
    if (token) p.set("pageToken", token);
    const data = await getJson(`https://clinicaltrials.gov/api/v2/studies?${p}`, "clinicaltrials");
    total = data.totalCount ?? total;
    const batch = data.studies || [];
    if (!batch.length) break;
    for (const st of batch) {
      const pr = st.protocolSection || {};
      const cl = pr.contactsLocationsModule || {};
      records.push({
        source_type: "clinicaltrials",
        nct: pr.identificationModule?.nctId,
        title: pr.identificationModule?.briefTitle,
        url: `https://clinicaltrials.gov/study/${pr.identificationModule?.nctId}`,
        trial_status: pr.statusModule?.overallStatus,
        why_stopped: pr.statusModule?.whyStopped || null,
        phase: pr.designModule?.phases || [],
        enrollment: pr.designModule?.enrollmentInfo?.count ?? null,
        conditions: pr.conditionsModule?.conditions || [],
        interventions: (pr.armsInterventionsModule?.interventions || []).map((i) => i.name),
        sponsor: pr.sponsorCollaboratorsModule?.leadSponsor?.name || null,
        trial_contacts: [
          ...(cl.centralContacts || []).map((c) => ({ name: c.name, role: c.role, phone: c.phone || null, email: c.email || null })),
          ...(cl.overallOfficials || []).map((o) => ({ name: o.name, role: o.role, affiliation: o.affiliation })),
        ],
        locations: (cl.locations || []).slice(0, 40).map((l) => ({
          facility: l.facility,
          city: l.city,
          state: l.state,
          country: l.country,
          status: l.status,
          contacts: (l.contacts || []).map((c) => ({ name: c.name, role: c.role, phone: c.phone || null, email: c.email || null })),
        })),
      });
    }
    token = data.nextPageToken;
    if (!token) break;
  }
  return {
    engine: "clinicaltrials",
    records,
    reported_total: total,
    retrieved: records.length,
    exhausted: !token || records.length >= total,
    hit_ceiling: !!token && records.length >= max,
    ceiling_reason: token && records.length >= max ? `Stopped at the caller's max of ${max}; source reports ${total}.` : null,
  };
}

/** OpenAlex — cursor paging enumerates the whole set; page paging does not. */
export async function enumerateOpenAlex(query, { max = 5000, perPage = 200, filter } = {}) {
  let cursor = "*";
  const records = [];
  let total = 0;
  let guard = 0;

  while (records.length < max && guard++ < 60) {
    const p = new URLSearchParams({
      search: query,
      per_page: String(Math.min(perPage, 200)),
      cursor,
      mailto: CONTACT,
    });
    if (filter) p.set("filter", filter);
    const data = await getJson(`https://api.openalex.org/works?${p}`, "openalex");
    total = data.meta?.count ?? total;
    const batch = data.results || [];
    if (!batch.length) break;
    for (const w of batch)
      records.push({
        source_type: "openalex",
        doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : null,
        pmid: w.ids?.pmid?.split("/").pop() || null,
        title: w.display_name,
        year: w.publication_year,
        journal: w.primary_location?.source?.display_name || null,
        cited_by: w.cited_by_count,
        is_retracted: w.is_retracted === true,
        open_access: !!w.best_oa_location,
        url: w.doi || w.id,
      });
    const next = data.meta?.next_cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return {
    engine: "openalex",
    records,
    reported_total: total,
    retrieved: records.length,
    exhausted: records.length >= total,
    hit_ceiling: records.length >= max && total > max,
    ceiling_reason: records.length >= max && total > max ? `Stopped at the caller's max of ${max}; source reports ${total}.` : null,
  };
}

/**
 * Web search. Honest note: no web engine lets you enumerate everything it holds
 * for a query — every one of them caps result depth in the low hundreds. Depth
 * on the open web comes from query decomposition, not from paging, which is why
 * the query matrix above matters more here than anywhere else.
 */
export async function enumerateWeb(query, { max = 100 } = {}) {
  const out = [];
  let ceilingReason = null;
  try {
    const dd = await duckduckgoSearch(query, { limit: Math.min(max, 100) });
    out.push(...dd.map((r) => ({ source_type: "web", url: r.url, title: r.title, snippet: r.snippet })));
  } catch (e) {
    ceilingReason = `DuckDuckGo: ${e.message}`;
  }
  let googleNote = null;
  try {
    const g = await googleSearch(query, { limit: Math.min(max, 100) });
    if (g.unavailable) googleNote = g.unavailable;
    else out.push(...g.results.map((r) => ({ source_type: "web", url: r.url, title: r.title, snippet: r.snippet })));
  } catch (e) {
    googleNote = `Google: ${e.message}`;
  }
  const seen = new Set();
  const records = out.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
  return {
    engine: "web",
    records,
    reported_total: null, // web engines do not report a trustworthy total
    retrieved: records.length,
    exhausted: false, // never true for web search — say so rather than imply completeness
    hit_ceiling: true,
    ceiling_reason:
      ceilingReason ||
      googleNote ||
      "Web search engines cap result depth (roughly 100–300 per query) and report no reliable total. Coverage on the open web comes from running more, narrower queries — never from paging deeper.",
  };
}

/**
 * Yandex — the practical route into the Russian-language web. Same honest
 * ceiling caveat as every web engine: depth comes from more queries, not from
 * paging deeper.
 */
export async function enumerateYandex(query, { max = 50 } = {}) {
  const r = await yandexSearch(query, { limit: Math.min(max, 100) });
  return {
    engine: "yandex",
    records: (r.results || []).map((x) => ({ source_type: "web", url: x.url, title: x.title, snippet: x.snippet })),
    reported_total: null,
    retrieved: (r.results || []).length,
    exhausted: false,
    hit_ceiling: true,
    ceiling_reason: r.unavailable || "Yandex caps result depth and reports no reliable total; coverage comes from running more, narrower queries.",
  };
}

/** Baidu — the practical route into the Chinese-language web. */
export async function enumerateBaidu(query, { max = 50 } = {}) {
  const r = await baiduSearch(query, { limit: Math.min(max, 50) });
  return {
    engine: "baidu",
    records: (r.results || []).map((x) => ({ source_type: "web", url: x.url, title: x.title, snippet: x.snippet })),
    reported_total: null,
    retrieved: (r.results || []).length,
    exhausted: false,
    hit_ceiling: true,
    ceiling_reason: r.unavailable || "Baidu caps result depth and reports no reliable total; coverage comes from running more, narrower queries.",
  };
}

export const ENUMERATORS = {
  pubmed: enumeratePubmed,
  europepmc: enumerateEuropePMC,
  clinicaltrials: enumerateClinicalTrials,
  openalex: enumerateOpenAlex,
  web: enumerateWeb,
  yandex: enumerateYandex,
  baidu: enumerateBaidu,
};
