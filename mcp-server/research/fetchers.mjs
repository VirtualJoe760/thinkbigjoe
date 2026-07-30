/**
 * fetchers.mjs — the retrieval layer.
 *
 * Two classes of source, deliberately kept separate:
 *
 *   SURFACE  — Google + DuckDuckGo. Fast, broad, indexes news/forums/blogs.
 *              Good for finding that something exists. Bad as an endpoint.
 *
 *   DEEP     — PubMed, Europe PMC (full text), ClinicalTrials.gov, OpenAlex
 *              (citation graph), Crossref, bioRxiv/medRxiv, openFDA, and the
 *              WHO/EU trial registries. These are the layer under the search
 *              results: primary records, full text, reference lists, retraction
 *              notices, and — the part surface search never gives you —
 *              investigator names, affiliations, emails and phone numbers.
 *
 * The "go deeper than surface" mechanism is citation traversal: openalexExpand()
 * walks BOTH directions off a paper (what it cited, and who later cited it),
 * which is how you reach the 1970s primary source a 2024 blog post is
 * paraphrasing, and how you find the rebuttal that was published after it.
 *
 * No API key is required for anything here except Google (see googleSearch).
 * All calls set a contact mailto/UA per each service's polite-use policy.
 */

const UA =
  process.env.RESEARCH_USER_AGENT ||
  "research-mcp/1.0 (deep-research agent; +mailto:" +
    (process.env.RESEARCH_CONTACT_EMAIL || "research@example.org") +
    ")";

const CONTACT = process.env.RESEARCH_CONTACT_EMAIL || "research@example.org";

async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function getText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 30000),
    redirect: "follow",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return { body, finalUrl: res.url, contentType: res.headers.get("content-type") || "" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HTML → text, plus link/contact extraction (no dependencies)
// ---------------------------------------------------------------------------

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1];
    if (/^(javascript|mailto|tel|#)/i.test(href)) continue;
    try {
      href = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    out.push({ url: href, text: htmlToText(m[2]).slice(0, 200) });
  }
  return out;
}

/**
 * Pull contact details out of a page. Publication and trial pages routinely
 * carry a corresponding-author email or a coordinator phone number in the
 * footer or a "Contacts" block; this is the cheapest way to get them.
 */
export function extractContacts(text, html = "") {
  const emails = [
    ...new Set(
      (text + " " + html.replace(/<[^>]+>/g, " "))
        .match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)
        ?.map((e) => e.replace(/[.,;]$/, ""))
        .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e))
        .filter((e) => !/^(example|noreply|no-reply|donotreply)@/i.test(e)) || [],
    ),
  ].slice(0, 25);

  const phones = [
    ...new Set(
      text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}/g)
        ?.map((p) => p.trim())
        .filter((p) => p.replace(/\D/g, "").length >= 9 && p.replace(/\D/g, "").length <= 15) || [],
    ),
  ].slice(0, 15);

  // "Correspondence to: Dr X" / "Corresponding author: X"
  const corr = [
    ...new Set(
      text.match(/(?:correspond(?:ence|ing author)s?\s*(?:to)?\s*[:\-–]\s*)([^\n]{3,120})/gi) || [],
    ),
  ].slice(0, 5);

  return { emails, phones, correspondence: corr.map((c) => c.trim()) };
}

// ---------------------------------------------------------------------------
// SURFACE LAYER — DuckDuckGo
// ---------------------------------------------------------------------------

/**
 * DuckDuckGo HTML endpoint. No key, no quota. Returns organic results only.
 * We deliberately use the no-JS endpoint so results are parseable and stable.
 */
export async function duckduckgoSearch(query, { limit = 25, region = "wt-wt", timeRange } = {}) {
  const results = [];
  const seen = new Set();
  let body = new URLSearchParams({ q: query, kl: region });
  if (timeRange) body.set("df", timeRange); // d | w | m | y

  for (let page = 0; page < Math.ceil(limit / 25) && results.length < limit; page++) {
    if (page > 0) body.set("s", String(page * 25));
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
    const html = await res.text();

    const re =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
    let m;
    while ((m = re.exec(html)) && results.length < limit) {
      let url = m[1];
      // DDG wraps externals in /l/?uddg=<encoded>
      const wrapped = url.match(/[?&]uddg=([^&]+)/);
      if (wrapped) url = decodeURIComponent(wrapped[1]);
      if (!/^https?:/.test(url) || seen.has(url)) continue;
      seen.add(url);
      results.push({
        engine: "duckduckgo",
        url,
        title: htmlToText(m[2]),
        snippet: htmlToText(m[3] || ""),
      });
    }
    if (!/class="result__a"/.test(html)) break;
    await sleep(700); // be a good citizen
  }
  return results;
}

// ---------------------------------------------------------------------------
// SURFACE LAYER — Google
// ---------------------------------------------------------------------------

/**
 * Google. Google has no free scrape-safe endpoint, so this uses whichever
 * key is configured, in order of preference:
 *
 *   GOOGLE_CSE_ID + GOOGLE_API_KEY   → Programmable Search JSON API (100/day free)
 *   SERPAPI_KEY                      → SerpAPI (also unlocks Google Scholar)
 *
 * With neither, this returns a structured "unavailable" marker rather than
 * silently returning nothing — a research agent must be able to tell the
 * difference between "Google found nothing" and "Google never ran".
 */
export async function googleSearch(query, { limit = 20, scholar = false } = {}) {
  const cseId = process.env.GOOGLE_CSE_ID;
  const cseKey = process.env.GOOGLE_API_KEY;
  const serp = process.env.SERPAPI_KEY;

  if (scholar) {
    if (!serp) return { unavailable: "google_scholar requires SERPAPI_KEY", results: [] };
    const data = await getJson(
      `https://serpapi.com/search.json?engine=google_scholar&q=${encodeURIComponent(query)}&num=${Math.min(limit, 20)}&api_key=${serp}`,
    );
    return {
      results: (data.organic_results || []).map((r) => ({
        engine: "google_scholar",
        url: r.link,
        title: r.title,
        snippet: r.snippet,
        cited_by: r.inline_links?.cited_by?.total ?? null,
        publication: r.publication_info?.summary ?? null,
      })),
    };
  }

  if (cseId && cseKey) {
    const results = [];
    for (let start = 1; start <= Math.min(limit, 100) && results.length < limit; start += 10) {
      const data = await getJson(
        `https://www.googleapis.com/customsearch/v1?key=${cseKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=10&start=${start}`,
      );
      for (const it of data.items || [])
        results.push({ engine: "google", url: it.link, title: it.title, snippet: it.snippet });
      if (!data.items?.length) break;
    }
    return { results };
  }

  if (serp) {
    const data = await getJson(
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${Math.min(limit, 100)}&api_key=${serp}`,
    );
    return {
      results: (data.organic_results || []).map((r) => ({
        engine: "google",
        url: r.link,
        title: r.title,
        snippet: r.snippet,
      })),
    };
  }

  return {
    unavailable:
      "Google is not configured. Set GOOGLE_CSE_ID + GOOGLE_API_KEY (Programmable Search, 100 queries/day free) or SERPAPI_KEY. DuckDuckGo results below are NOT a substitute — report this gap in the coverage section of any report.",
    results: [],
  };
}

// ---------------------------------------------------------------------------
// DEEP LAYER — PubMed / NCBI E-utilities (no key needed; key raises rate limit)
// ---------------------------------------------------------------------------

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ncbiKey = () => (process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "");

export async function pubmedSearch(query, { limit = 50, db = "pubmed", sort = "relevance" } = {}) {
  const s = await getJson(
    `${EUTILS}/esearch.fcgi?db=${db}&term=${encodeURIComponent(query)}&retmode=json&retmax=${limit}&sort=${sort}&email=${encodeURIComponent(CONTACT)}${ncbiKey()}`,
  );
  const ids = s.esearchresult?.idlist || [];
  const total = Number(s.esearchresult?.count || 0);
  if (!ids.length) return { total, records: [] };

  // efetch gives abstracts + MeSH + publication types + author affiliations,
  // which esummary does not. XML is the only format that carries all of it.
  const { body: xml } = await getText(
    `${EUTILS}/efetch.fcgi?db=${db}&id=${ids.join(",")}&retmode=xml&email=${encodeURIComponent(CONTACT)}${ncbiKey()}`,
  );

  const records = [];
  for (const art of xml.split(/<PubmedArticle>/).slice(1)) {
    const pick = (tag) => {
      const m = art.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? htmlToText(m[1]) : null;
    };
    const pickAll = (tag) => {
      const out = [];
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
      let m;
      while ((m = re.exec(art))) out.push(htmlToText(m[1]));
      return out;
    };
    const pmid = pick("PMID");
    const abstractParts = pickAll("AbstractText");
    records.push({
      source_type: "pubmed",
      pmid,
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
      doi: (art.match(/<ArticleId IdType="doi">([^<]+)</) || [])[1] || null,
      pmc: (art.match(/<ArticleId IdType="pmc">([^<]+)</) || [])[1] || null,
      title: pick("ArticleTitle"),
      journal: pick("Title"),
      year: (art.match(/<PubDate>[\s\S]*?<Year>(\d{4})</) || [])[1] || null,
      abstract: abstractParts.join("\n\n") || null,
      publication_types: pickAll("PublicationType"),
      mesh: pickAll("DescriptorName"),
      authors: pickAll("LastName").slice(0, 30),
      affiliations: [...new Set(pickAll("Affiliation"))].slice(0, 10),
      // Retraction / correction signals — checked so a retracted paper never
      // gets cited as live evidence.
      retraction_flags: pickAll("PublicationType").filter((t) => /retract|withdraw|expression of concern/i.test(t)),
      // Affiliation strings are where corresponding-author emails live in PubMed.
      contact_emails: [
        ...new Set(pickAll("Affiliation").join(" ").match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g) || []),
      ],
      grants: pickAll("GrantID").slice(0, 20),
    });
  }
  return { total, records };
}

// ---------------------------------------------------------------------------
// DEEP LAYER — Europe PMC (full text + references + preprints)
// ---------------------------------------------------------------------------

export async function europepmcSearch(query, { limit = 50, includePreprints = true } = {}) {
  const src = includePreprints ? "" : "%20AND%20SRC:MED";
  const data = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}${src}&format=json&resultType=core&pageSize=${Math.min(limit, 100)}&email=${encodeURIComponent(CONTACT)}`,
  );
  return {
    total: data.hitCount ?? 0,
    records: (data.resultList?.result || []).map((r) => ({
      source_type: "europepmc",
      id: r.id,
      source: r.source,
      pmid: r.pmid || null,
      pmcid: r.pmcid || null,
      doi: r.doi || null,
      title: r.title,
      journal: r.journalInfo?.journal?.title || r.bookOrReportDetails?.publisher || null,
      year: r.pubYear || null,
      abstract: r.abstractText ? htmlToText(r.abstractText) : null,
      is_preprint: r.source === "PPR",
      is_open_access: r.isOpenAccess === "Y",
      cited_by: r.citedByCount ?? null,
      pub_types: r.pubTypeList?.pubType || [],
      grants: (r.grantsList?.grant || []).map((g) => ({
        agency: g.agency,
        id: g.grantId,
      })),
      authors: (r.authorList?.author || []).map((a) => ({
        name: a.fullName,
        affiliation: a.authorAffiliationDetailsList?.authorAffiliation?.[0]?.affiliation || null,
      })),
      full_text_urls: (r.fullTextUrlList?.fullTextUrl || []).map((u) => u.url),
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
    })),
  };
}

/** Full text of an open-access article (PMC id), plus its reference list. */
export async function europepmcFullText(pmcid) {
  const id = pmcid.startsWith("PMC") ? pmcid : "PMC" + pmcid;
  const { body: xml } = await getText(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/${id}/fullTextXML`,
  );
  const refs = [];
  const re = /<ref\b[\s\S]*?<\/ref>/g;
  let m;
  while ((m = re.exec(xml))) {
    const chunk = m[0];
    refs.push({
      title: (chunk.match(/<article-title>([\s\S]*?)<\/article-title>/) || [])[1]?.replace(/<[^>]+>/g, "") || null,
      doi: (chunk.match(/<pub-id pub-id-type="doi">([^<]+)</) || [])[1] || null,
      pmid: (chunk.match(/<pub-id pub-id-type="pmid">([^<]+)</) || [])[1] || null,
      year: (chunk.match(/<year[^>]*>(\d{4})</) || [])[1] || null,
    });
  }
  return { pmcid: id, text: htmlToText(xml), references: refs, reference_count: refs.length };
}

// ---------------------------------------------------------------------------
// DEEP LAYER — ClinicalTrials.gov v2 (this is the contact-information goldmine)
// ---------------------------------------------------------------------------

export async function clinicalTrialsSearch(query, { limit = 50, status } = {}) {
  const params = new URLSearchParams({
    "query.term": query,
    pageSize: String(Math.min(limit, 100)),
    format: "json",
    countTotal: "true",
  });
  if (status) params.set("filter.overallStatus", status);
  const data = await getJson(`https://clinicaltrials.gov/api/v2/studies?${params}`);

  return {
    total: data.totalCount ?? 0,
    records: (data.studies || []).map((s) => {
      const p = s.protocolSection || {};
      const contacts = p.contactsLocationsModule || {};
      return {
        source_type: "clinicaltrials",
        nct: p.identificationModule?.nctId,
        url: `https://clinicaltrials.gov/study/${p.identificationModule?.nctId}`,
        title: p.identificationModule?.briefTitle,
        official_title: p.identificationModule?.officialTitle,
        status: p.statusModule?.overallStatus,
        why_stopped: p.statusModule?.whyStopped || null,
        phase: p.designModule?.phases || [],
        study_type: p.designModule?.studyType,
        enrollment: p.designModule?.enrollmentInfo?.count ?? null,
        conditions: p.conditionsModule?.conditions || [],
        interventions: (p.armsInterventionsModule?.interventions || []).map((i) => ({
          type: i.type,
          name: i.name,
          description: i.description,
        })),
        primary_outcomes: (p.outcomesModule?.primaryOutcomes || []).map((o) => o.measure),
        results_posted: !!s.resultsSection,
        sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || null,
        collaborators: (p.sponsorCollaboratorsModule?.collaborators || []).map((c) => c.name),
        start_date: p.statusModule?.startDateStruct?.date || null,
        completion_date: p.statusModule?.completionDateStruct?.date || null,
        // ---- contacts: exactly what the client asked to capture ----
        central_contacts: (contacts.centralContacts || []).map((c) => ({
          name: c.name,
          role: c.role,
          phone: c.phone || null,
          phone_ext: c.phoneExt || null,
          email: c.email || null,
        })),
        overall_officials: (contacts.overallOfficials || []).map((o) => ({
          name: o.name,
          role: o.role,
          affiliation: o.affiliation,
        })),
        locations: (contacts.locations || []).slice(0, 40).map((l) => ({
          facility: l.facility,
          city: l.city,
          state: l.state,
          country: l.country,
          status: l.status,
          contacts: (l.contacts || []).map((c) => ({
            name: c.name,
            role: c.role,
            phone: c.phone || null,
            email: c.email || null,
          })),
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// DEEP LAYER — OpenAlex citation graph (the "go deeper" engine)
// ---------------------------------------------------------------------------

const OA = "https://api.openalex.org";

function oaWork(w) {
  return {
    source_type: "openalex",
    id: w.id,
    doi: w.doi || null,
    pmid: w.ids?.pmid?.split("/").pop() || null,
    title: w.display_name,
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name || null,
    type: w.type,
    cited_by_count: w.cited_by_count,
    is_retracted: w.is_retracted === true,
    open_access_url: w.best_oa_location?.pdf_url || w.best_oa_location?.landing_page_url || null,
    url: w.doi ? w.doi.replace("https://doi.org/", "https://doi.org/") : w.id,
    referenced_works: w.referenced_works || [],
    authors: (w.authorships || []).map((a) => ({
      name: a.author?.display_name,
      institutions: (a.institutions || []).map((i) => i.display_name),
      corresponding: a.is_corresponding === true,
    })),
    funders: (w.grants || []).map((g) => ({ funder: g.funder_display_name, award: g.award_id })),
    concepts: (w.topics || []).map((t) => t.display_name).slice(0, 6),
  };
}

export async function openalexSearch(query, { limit = 50, filter } = {}) {
  const params = new URLSearchParams({
    search: query,
    per_page: String(Math.min(limit, 200)),
    mailto: CONTACT,
  });
  if (filter) params.set("filter", filter);
  const data = await getJson(`${OA}/works?${params}`);
  return { total: data.meta?.count ?? 0, records: (data.results || []).map(oaWork) };
}

/**
 * The depth primitive. Given a paper, walk the citation graph in both
 * directions:
 *   backward → what this paper is built on (finds the primary source under a
 *              secondary claim; this is how you get past a blog paraphrase)
 *   forward  → who cited it since (finds replications, failures, retractions,
 *              and the rebuttal that never shows up in a search result)
 */
export async function openalexExpand(idOrDoi, { direction = "both", limit = 50 } = {}) {
  let id = idOrDoi;
  if (/^10\./.test(id)) id = `https://doi.org/${id}`;
  if (/^\d+$/.test(id)) id = `pmid:${id}`;
  const work = await getJson(`${OA}/works/${encodeURIComponent(id)}?mailto=${CONTACT}`);
  const out = { work: oaWork(work), backward: [], forward: [] };

  if (direction === "backward" || direction === "both") {
    const refs = (work.referenced_works || []).slice(0, limit);
    for (let i = 0; i < refs.length; i += 50) {
      const batch = refs.slice(i, i + 50).map((u) => u.split("/").pop());
      const d = await getJson(
        `${OA}/works?filter=openalex_id:${batch.join("|")}&per_page=50&mailto=${CONTACT}`,
      );
      out.backward.push(...(d.results || []).map(oaWork));
    }
  }
  if (direction === "forward" || direction === "both") {
    const d = await getJson(
      `${OA}/works?filter=cites:${work.id.split("/").pop()}&per_page=${Math.min(limit, 200)}&sort=cited_by_count:desc&mailto=${CONTACT}`,
    );
    out.forward = (d.results || []).map(oaWork);
  }
  return out;
}

// ---------------------------------------------------------------------------
// DEEP LAYER — integrity checks
// ---------------------------------------------------------------------------

/**
 * Is this paper retracted, corrected, or under an expression of concern?
 * Checks OpenAlex's retraction flag, PubMed publication types, and Crossref
 * update-to records. Called automatically before any finding is recorded.
 */
export async function integrityCheck({ doi, pmid }) {
  const flags = [];
  try {
    if (doi) {
      const cr = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${CONTACT}`);
      const msg = cr.message || {};
      for (const u of msg["update-to"] || [])
        flags.push({ source: "crossref", type: u.type, doi: u.DOI, label: u.label });
      if (msg.type === "retraction") flags.push({ source: "crossref", type: "is_retraction_notice" });
    }
  } catch { /* crossref miss is not fatal */ }
  try {
    const id = doi ? `https://doi.org/${doi}` : `pmid:${pmid}`;
    const w = await getJson(`${OA}/works/${encodeURIComponent(id)}?mailto=${CONTACT}`);
    if (w.is_retracted) flags.push({ source: "openalex", type: "retracted" });
  } catch { /* openalex miss is not fatal */ }
  return { clean: flags.length === 0, flags };
}

// ---------------------------------------------------------------------------
// DEEP LAYER — regulatory / safety
// ---------------------------------------------------------------------------

/** openFDA adverse-event reports. The harm side of the ledger. */
export async function fdaAdverseEvents(drugName, { limit = 20 } = {}) {
  const q = `patient.drug.medicinalproduct:"${drugName}"`;
  try {
    const data = await getJson(
      `https://api.fda.gov/drug/event.json?search=${encodeURIComponent(q)}&count=patient.reaction.reactionmeddrapt.exact&limit=${limit}`,
    );
    const total = await getJson(
      `https://api.fda.gov/drug/event.json?search=${encodeURIComponent(q)}&limit=1`,
    ).then((d) => d.meta?.results?.total ?? null).catch(() => null);
    return {
      drug: drugName,
      total_reports: total,
      top_reactions: (data.results || []).map((r) => ({ reaction: r.term, count: r.count })),
      url: `https://open.fda.gov/data/faers/`,
    };
  } catch (e) {
    return { drug: drugName, error: String(e.message || e), top_reactions: [] };
  }
}

/** FDA drug labels — approved indications, contraindications, interactions. */
export async function fdaLabel(drugName) {
  try {
    const data = await getJson(
      `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=1`,
    );
    const r = (data.results || [])[0];
    if (!r) return { drug: drugName, found: false };
    const first = (a) => (Array.isArray(a) ? a[0] : a) || null;
    return {
      drug: drugName,
      found: true,
      brand: r.openfda?.brand_name || [],
      indications: first(r.indications_and_usage),
      dosage: first(r.dosage_and_administration),
      contraindications: first(r.contraindications),
      warnings: first(r.warnings_and_cautions) || first(r.warnings),
      interactions: first(r.drug_interactions),
      pharmacology: first(r.clinical_pharmacology),
      url: "https://labels.fda.gov/",
    };
  } catch (e) {
    return { drug: drugName, found: false, error: String(e.message || e) };
  }
}

// ---------------------------------------------------------------------------
// Generic deep fetch — read any page to the bottom, with links + contacts
// ---------------------------------------------------------------------------

export async function fetchPage(url, { maxChars = 60000 } = {}) {
  const { body, finalUrl, contentType } = await getText(url, { timeout: 45000 });
  if (/pdf/i.test(contentType)) {
    return {
      url: finalUrl,
      contentType,
      text: null,
      note: "PDF — text extraction not available in-process. Record the URL as the source and use the abstract/landing page for quotable text, or fetch the PMC full-text XML if one exists.",
      links: [],
      contacts: { emails: [], phones: [], correspondence: [] },
    };
  }
  const text = htmlToText(body);
  // A JS-rendered page (SPA) returns a shell with almost no prose. Say so
  // loudly — silently returning 300 characters of nav chrome is how an agent
  // ends up "reading" a paper it never saw.
  const thin =
    text.length < 1200 && /<div id=(?:"|')(?:root|app|__next)/i.test(body)
      ? "CLIENT-RENDERED PAGE — this site builds its content in the browser, so almost no text is present in the HTML. Do NOT treat the text below as the document. Use the structured API instead (ClinicalTrials.gov → find_trials, PubMed/Europe PMC → get_full_text), or find the publisher's static/print view."
      : text.length < 1200
        ? "VERY LITTLE TEXT EXTRACTED — likely a paywall, a redirect interstitial, or a bot wall (NCBI/PMC block direct scraping). Do NOT record a finding from this. Use the API path instead: get_full_text with the PMC id returns the complete text and reference list, and find_trials returns full trial records including contacts."
        : null;
  return {
    url: finalUrl,
    contentType,
    truncated: text.length > maxChars,
    warning: thin,
    text: text.slice(0, maxChars),
    links: extractLinks(body, finalUrl).slice(0, 200),
    contacts: extractContacts(text, body),
    // Reference-ish outbound links: DOIs, PubMed, trial registries. These are
    // the trail to follow when the page is a secondary source.
    citation_links: [
      ...new Set(
        extractLinks(body, finalUrl)
          .map((l) => l.url)
          .filter((u) => /doi\.org|pubmed|ncbi\.nlm|clinicaltrials\.gov|europepmc|biorxiv|medrxiv|arxiv/i.test(u)),
      ),
    ].slice(0, 100),
  };
}

// ---------------------------------------------------------------------------
// SURFACE LAYER — Yandex and Baidu
// ---------------------------------------------------------------------------
//
// These are here for a specific reason, not for completeness. A large amount of
// benzimidazole and repurposed-drug oncology work is published in Russian and
// Chinese venues that Google and DuckDuckGo index thinly or not at all. Yandex
// is the practical route into the Russian-language web; Baidu into the Chinese.
//
// Neither offers a free, scrape-stable endpoint, so both follow the same honest
// pattern as Google: use a configured key if one exists, and otherwise return a
// structured `unavailable` marker rather than silently returning nothing. A
// source that never ran must never look like a source that found nothing.

/**
 * Yandex. Two supported routes:
 *   YANDEX_API_KEY + YANDEX_FOLDER_ID → Yandex Cloud Search API v2 (current)
 *   SERPAPI_KEY                       → SerpAPI's yandex engine
 */
export async function yandexSearch(query, { limit = 20, lang = "ru" } = {}) {
  const key = process.env.YANDEX_API_KEY;
  const folder = process.env.YANDEX_FOLDER_ID;
  const serp = process.env.SERPAPI_KEY;

  if (key && folder) {
    try {
      const res = await fetch("https://searchapi.api.cloud.yandex.net/v2/web/search", {
        method: "POST",
        headers: { Authorization: `Api-Key ${key}`, "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({
          query: { searchType: lang === "ru" ? "SEARCH_TYPE_RU" : "SEARCH_TYPE_COM", queryText: query },
          folderId: folder,
          responseFormat: "FORMAT_XML",
          groupSpec: { groupsOnPage: Math.min(limit, 100), docsInGroup: 1 },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // The API returns base64 XML in rawData.
      const xml = data.rawData ? Buffer.from(data.rawData, "base64").toString("utf8") : "";
      const results = [];
      const re = /<doc>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<title>([\s\S]*?)<\/title>([\s\S]*?)<\/doc>/g;
      let m;
      while ((m = re.exec(xml)) && results.length < limit)
        results.push({ engine: "yandex", url: m[1], title: htmlToText(m[2]), snippet: htmlToText(m[3]).slice(0, 300) });
      return { results };
    } catch (e) {
      return { unavailable: `Yandex Cloud Search API error: ${e.message}`, results: [] };
    }
  }

  if (serp) {
    try {
      const data = await getJson(
        `https://serpapi.com/search.json?engine=yandex&text=${encodeURIComponent(query)}&api_key=${serp}`,
      );
      return {
        results: (data.organic_results || []).slice(0, limit).map((r) => ({
          engine: "yandex",
          url: r.link,
          title: r.title,
          snippet: r.snippet,
        })),
      };
    } catch (e) {
      return { unavailable: `SerpAPI yandex error: ${e.message}`, results: [] };
    }
  }

  return {
    unavailable:
      "Yandex is not configured. Set YANDEX_API_KEY + YANDEX_FOLDER_ID (Yandex Cloud Search API) or SERPAPI_KEY. Without it, Russian-language sources are reachable only through whatever OpenAlex and Europe PMC happen to index — report this as a coverage gap.",
    results: [],
  };
}

/**
 * Baidu. Baidu publishes no general web-search API and blocks direct scraping
 * aggressively, so SerpAPI's baidu engine is the only reliable route.
 */
export async function baiduSearch(query, { limit = 20 } = {}) {
  const serp = process.env.SERPAPI_KEY;
  if (serp) {
    try {
      const data = await getJson(
        `https://serpapi.com/search.json?engine=baidu&q=${encodeURIComponent(query)}&rn=${Math.min(limit, 50)}&api_key=${serp}`,
      );
      return {
        results: (data.organic_results || []).slice(0, limit).map((r) => ({
          engine: "baidu",
          url: r.link,
          title: r.title,
          snippet: r.snippet,
        })),
      };
    } catch (e) {
      return { unavailable: `SerpAPI baidu error: ${e.message}`, results: [] };
    }
  }
  return {
    unavailable:
      "Baidu is not configured. Baidu publishes no general web-search API and blocks direct scraping, so SERPAPI_KEY (engine=baidu) is the only reliable route. Without it, Chinese-language sources are reachable only through OpenAlex and Europe PMC's Chinese-journal coverage — report this as a coverage gap.",
    results: [],
  };
}

// ---------------------------------------------------------------------------
// SURFACE LAYER — keyless fallbacks
// ---------------------------------------------------------------------------
//
// DuckDuckGo is the only mainstream engine with a keyless endpoint, and it
// blocks aggressively — on some networks it is simply unreachable. When it is,
// the web surface layer would otherwise be empty for anyone without a Google or
// SerpAPI key. These two fill that hole without a key.
//
// Neither is a substitute for Google, and the reports say so. Marginalia in
// particular indexes the small, non-commercial, independent web — which makes it
// weak for mainstream coverage and unusually strong for exactly the grey
// literature (protocol write-ups, patient accounts, independent researchers'
// sites) that the grey axis is trying to reach and that commercial engines
// demote.

/**
 * Marginalia — a small independent-web index with a free, keyless public API.
 * Strong on the long tail, weak on mainstream results. Use as a complement.
 */
export async function marginaliaSearch(query, { limit = 20, index = 0 } = {}) {
  try {
    const data = await getJson(
      `https://api.marginalia.nu/public/search/${encodeURIComponent(query)}?index=${index}`,
      { timeout: 25000 },
    );
    return {
      results: (data.results || []).slice(0, limit).map((r) => ({
        engine: "marginalia",
        url: r.url,
        title: r.title,
        snippet: r.description || "",
      })),
      pages: data.pages ?? null,
      license: data.license || null,
    };
  } catch (e) {
    return { unavailable: `Marginalia: ${e.message}`, results: [] };
  }
}

/**
 * SearXNG — a metasearch front end that aggregates Google, Bing, Brave and
 * others. Public instances rate-limit or block JSON output, so this requires a
 * SEARXNG_URL pointing at an instance you control (self-hosting is a container
 * and about five minutes). With one configured it is the best keyless route to
 * mainstream results that exists.
 */
export async function searxngSearch(query, { limit = 25, categories = "general", language = "all" } = {}) {
  const base = process.env.SEARXNG_URL;
  if (!base)
    return {
      unavailable:
        "SearXNG is not configured. Set SEARXNG_URL to an instance you control (public instances block JSON output). It aggregates Google, Bing and Brave without per-engine API keys and is the best keyless route to mainstream web results.",
      results: [],
    };
  try {
    const url = `${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=${categories}&language=${language}`;
    const data = await getJson(url, { timeout: 30000 });
    return {
      results: (data.results || []).slice(0, limit).map((r) => ({
        engine: "searxng",
        url: r.url,
        title: r.title,
        snippet: r.content || "",
        via: r.engine || null,
      })),
    };
  } catch (e) {
    return { unavailable: `SearXNG at ${base}: ${e.message}`, results: [] };
  }
}
