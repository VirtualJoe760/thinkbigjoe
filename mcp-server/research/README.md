# research-mcp + thesis-mcp

Two MCP servers for a research client working on alternative-agent literature in
pancreatic cancer (ivermectin, methylene blue, mebendazole, fenbendazole and
similar). They are **not** part of the ThinkBigJoe pipeline — they share nothing
with `tbj-mcp.mjs`, touch no TBJ database, and run standalone.

| Server | Role |
|---|---|
| `research-mcp.mjs` | **Tool 1 — the research instrument.** Indexes the search space, reads it in a stratified order, records facts with a citation locked to each one, and emits the white paper, the visual report, and the publishable dataset. |
| `thesis-mcp.mjs` | **Tool 2 — the thesis instrument.** Reads tool 1's corpus (read-only) and builds an investigational protocol thesis where every value traces back to a finding. |

Built to run **unattended in Cowork for days**. See *Surviving a multi-day run* below.

## The loop

```
start_run → INDEXING → TRIAGE → READING → GAP_FILL → SAFETY → WHITE PAPER → VISUAL → DONE
```

The agent calls `next_action`, does exactly what it returns, and calls it again. **It cannot
return `done:true` until both reports exist on disk.** Every state's exit condition is a
computable predicate over ledger counts — not a judgement the model makes about whether it has
done enough.

State is recomputed from the ledgers on every call, so there is no checkpoint file to corrupt.
A crashed run, a new session, or a different model a week later all resume exactly where the
corpus actually is.

| Failure mode | The guard |
|---|---|
| **Stops early** at 40% coverage because searches look repetitive | Chao1 capture–recapture on query overlap must clear the coverage target; rolling marginal yield must fall below the saturation floor; per-stratum read quotas must all be met |
| **Churns forever** re-searching an exhausted space | Per-gap attempt budget; on give-up the gap is written to the ledger and appears in the report's limitations. Giving up is allowed, giving up *quietly* is not |

Both write to an append-only file corpus at `RESEARCH_CORPUS_DIR`
(default `~/research-corpus/<project>/`): `findings.jsonl`, `searches.jsonl`,
`sources.jsonl`, `thesis-*.jsonl`, `reports/*.md`. Plain JSONL — greppable,
diffable, auditable, no database.

---

## The design problem, and how these solve it

An LLM asked to research a contested topic will do two things badly. It will
search only for what it expects to find, and it will slide from *reporting* what
a source said into *agreeing* with it. Neither is fixed by telling it to be
neutral in a prompt. Both are fixed structurally:

**Bias controls in `research-mcp` (in the order they bite):**

1. `record_finding` rejects any claim with no resolvable source — url, DOI,
   PMID or NCT. There is no "general knowledge" path into the corpus.
2. It rejects any claim with no **verbatim quote** of ≥20 characters copied from
   the source. The quote is what makes the claim checkable by a third party.
3. Every finding must be classified **benefit / harm / null / mixed / background**.
   That single field is what makes the balance of the corpus visible.
4. `check_integrity` checks Crossref update-to records and OpenAlex retraction
   flags before a source can back a finding.
5. `deep_search` **automatically fires a mirrored disconfirming query set**
   alongside every search — *no benefit*, *negative results*, *failed trial OR
   terminated*, *toxicity adverse events*, *retracted OR expression of concern*,
   *criticism OR rebuttal*. This cannot be switched off. You cannot only-search-for-yes.
6. `compile_report` **refuses to render** if no disconfirming searches were logged.
7. The report renderer is **deterministic template code, not a model prompt**.
   The agent cannot editorialise into the report; it can only put findings into
   the corpus, and the corpus renders itself. The report leads with coverage
   gaps, the direction balance, and an asymmetry notice when the corpus holds no
   null or no harm findings.

**Bias controls in `thesis-mcp`:**

1. `propose_parameter` **verifies every cited finding id against the corpus** and
   rejects any value with no basis. A dose that is not in the literature cannot
   be written down — it renders as an OPEN QUESTION with a note on what study
   would settle it.
2. Species provenance is **computed from the cited findings, not asserted**. A
   value backed only by mouse work is labelled preclinical everywhere it appears.
3. Cross-species conversions must set `derived=true` and supply the arithmetic
   plus a citation for the conversion method; they render as *derived*, never
   as *observed*.
4. `assess_mechanism` requires either contradicting findings or a record of the
   search that established there were none.
5. `define_falsification` is **mandatory** — `compile_thesis` refuses without at
   least one criterion. A thesis nothing could refute is an advertisement.
6. `assess_safety` is **mandatory per substance** — compile refuses until every
   substance appearing in a parameter has interactions, contraindications,
   documented human exposure limits and monitoring recorded.
7. The thesis inherits the corpus's caveats verbatim at the top: if there is no
   human evidence, §2 says so before anything else is read.

---

## Surviving a multi-day run

A long unattended run breaks in ways a short one never shows. Each of these was measured, not
assumed:

**The index would have died.** A 14-query seed produced 7,193 index rows. An exhaustive run is
~1,120 queries × 7 sources, and most of what a query returns is a document some earlier query
already found — projecting to ~2.8M rows and >1 GB, re-parsed several times per `next_action`.
The fix is three things: a **snapshot + tail** store (`store.mjs`) where reads load compacted
state and replay only what has happened since; **bounded per-candidate state** (a distinct-query
count and three boolean hints, replacing an unbounded provenance array); and **writes that update
the in-process cache** instead of invalidating it, so the writing process never re-parses its own
snapshot. Compaction thresholds scale with corpus size — a fixed trigger means rewriting a 100 MB
snapshot every ten queries.

Measured on a simulated full run — 5,500 source-queries, 2.2M records, 176,917 unique documents:

| | Before | After |
|---|---|---|
| Write 2.2M records | (did not complete) | **50 s** |
| `readIndex`, cold | ~28 s projected | **1.36 s** (once per process) |
| `readIndex`, warm | — | **2 ms** |
| `next_action` | minutes projected | **71 ms** |

**Every outbound request is rate-limited.** This was not true in the first pass and the omission
was the real hazard: `build_index` was paced, but `deep_search`, `read_source`, `find_trials`,
`expand_citations`, `check_integrity` and `safety_profile` all called `fetchers.mjs` directly — 28
network call sites with no pacing at all. Over a multi-day run those paths make far more requests
than indexing does. All of them now route through the limiter.

**A circuit breaker stops a bad minute becoming a block.** Retries alone are not enough: when a
source starts refusing, retrying it on every subsequent call turns one throttle into thousands of
hostile requests. Four consecutive failures open the circuit for that source; the cooldown grows
(1 → 5 → 15 → 60 min) and one success closes it. Breaker state persists, so a crash-looping
process cannot reset it and resume hammering. DuckDuckGo gets special handling — it answers a
challenge page rather than a 429, so a challenge page is counted as a refusal rather than parsed
as zero results.

**Rate limits and daily quotas persist to disk** (`ratelimit.mjs`). An in-memory counter resets on
restart, so a crash-looping agent would blow through a 100/day Google quota several times over and
never know. Counters are keyed by UTC date in the corpus directory. Backoff is exponential with
jitter and honours `Retry-After` on a 429. A source whose quota is spent returns a structured
error the caller logs as a coverage gap — it never looks like "no results".

**A heartbeat makes the run observable.** Every `next_action` writes `run-status.json` with state,
progress counters, movement since the last beat, store size and quota use — so "still working" can
be told apart from "wedged four hours ago" with a single file read from outside the process.

## Depth: how these get past page-one

Surface search (Google, DuckDuckGo) is treated as a **pointer layer only**. The
depth comes from four things:

- **`get_full_text`** — Europe PMC full-text XML. Methods, dosing, adverse
  events and stated limitations live in the full text and almost never in the
  abstract. Returns ~50k characters and the complete reference list.
- **`expand_citations`** — the depth engine. Walks the OpenAlex citation graph
  **backward** (what the paper rests on → reaches the primary source under a
  claim a blog post or review is paraphrasing) and **forward** (who cited it
  since → surfaces replications, failures to replicate, and published rebuttals
  that no search engine ranks).
- **`find_trials`** — ClinicalTrials.gov v2, including `why_stopped` on
  terminated trials, which is frequently the most informative field on the page.
- **The indexing layer itself** — `build_index` pages every source *to exhaustion* rather than to
  the end of page one, and records which of "there is no more" and "we cannot see any more"
  actually happened. Verified live: Europe PMC enumerated all 1,960 records for one query via
  cursorMark; PubMed walked 454 via WebEnv; ClinicalTrials.gov and OpenAlex paged by token and
  cursor.
- **`safety_profile`** — FDA label + FAERS adverse-event counts, so the harm
  ledger is populated from regulatory data even when the literature is silent.

`read_source` warns loudly when a page is client-rendered or bot-walled instead
of quietly returning 169 characters of navigation chrome — that failure mode is
how an agent ends up "reading" a paper it never saw.

### The query matrix

One question expands into hundreds of deliberate queries. At `standard` depth ≈ 500; at
`exhaustive` ≈ 1,260.

| Axis | What it exists to catch |
|---|---|
| core | substance × indication, including the misspellings people actually type ("methane blue", "mebendazol") |
| mechanism | biology papers that never name the indication and so never appear in the core axis |
| design | each evidence tier separately, so one ranking cannot bury every case report under the reviews |
| outcome | papers indexed by what they measured rather than what they studied |
| combination | repurposing literature is mostly combination literature — gemcitabine, FOLFIRINOX, radiation |
| **disconfirming** | the vocabulary negative results are *actually* published under — "no significant difference", "failed to inhibit", terminated, retracted. ~30% of all queries |
| **species** | the veterinary record — dog, cattle, horse, sheep. Decades of licensed tolerability data invisible to any query pairing the drug with "cancer" |
| grey | reported experience and testimonial, including the named Joe Tippens protocol — recorded at anecdote tier, never promoted |
| **lang:zh / ru / es / ja** | native-language queries pairing substance and indication *in the same language*, routed to Baidu, Yandex, OpenAlex and Europe PMC. An English query with one translated word does not reach this literature |
| safety | maximum tolerated dose, interactions, pharmacokinetics, overdose case reports |

### Species

Animal evidence is not one category, and `species` is a first-class normalised field alongside the
verbatim model description. A mouse xenograft and a licensed canine tolerability study answer
different questions; for the benzimidazoles the veterinary record *is* the best-characterised
safety data that exists. Every species carries its own interpretive caveat, rendered at the point
of reading rather than buried in a methods note.

### Relevance to the actual question

Searching a drug with "cancer" returns a great deal of work on other cancers and on the drug's
original non-cancer use. `indication.mjs` classifies every finding as **target / adjacent /
other_cancer / non_cancer / unclear**, and both reports lead with the breakdown. The distance
between "there is a substantial literature on this drug and cancer" and "there are 11 findings on
this drug and pancreatic adenocarcinoma, 4 of them in people" is where a repurposing case is
usually overstated, so it is the first thing either report says.

## Contacts

Captured wherever a source publishes them, and rendered as an appendix table in
the report:

- ClinicalTrials.gov central contacts (name, role, **phone**, **email**),
  overall officials / PIs with affiliations, and per-site facility contacts.
- PubMed affiliation strings (where corresponding-author emails live) and
  Europe PMC per-author affiliations.
- Corresponding-author lines, emails and phone numbers extracted from any page
  read with `read_source`.

These are professional contact details the sources published themselves, for
research correspondence.

---

## Language

The report is an English document, and the gate enforces it:

| Field | Rule |
|---|---|
| `claim` | **Always English.** Rejected if written in another language — script detection for CJK/Cyrillic/Arabic/Greek, stopword detection for Spanish/French/German/Portuguese/Italian/Turkish. |
| `verbatim_quote` | **Always the source's own words, untranslated.** Translating it would make it no longer verbatim, and a verbatim quotation is the whole mechanism that lets a reader check a claim against its source. |
| `verbatim_quote_english` | **Required when the quote is not English.** Both are stored; the reports print the translation as body text and keep the original beneath it, tagged with its language. |

## Elapsed time and ETA

`run_progress` (and the `timing` block on every `next_action`) reports **two clocks that mean
different things**:

- `elapsed_wall` — time since the run started, including overnight pauses
- `elapsed_active` — how much of that was actually spent working

Throughput is the **median over active intervals**, with gaps longer than five minutes classified
as idle rather than slow. This matters: a naive wall-clock rate on a run that pauses overnight
reports four days remaining when the real figure is forty minutes of work. The estimate is a
**range** with its basis stated, and says `not yet measurable` rather than guessing when too little
has been done.

## Setup

```bash
cd /Users/macdaddyjoe/code/thinkbigjoe/mcp-server/research && npm install
```

Everything works with **no API keys**: PubMed, Europe PMC, ClinicalTrials.gov,
OpenAlex, Crossref, openFDA and DuckDuckGo are all open.

Optional environment:

| Var | Effect |
|---|---|
| `RESEARCH_CORPUS_DIR` | Where corpora live. Default `~/research-corpus`. |
| `YANDEX_API_KEY` + `YANDEX_FOLDER_ID` | Yandex Cloud Search — the practical route into the Russian-language web. |
| `SERPAPI_KEY` | Unlocks Google, **Baidu** (the only reliable route into the Chinese-language web), and Google Scholar. |
| `SEARXNG_URL` | A SearXNG instance you control. Aggregates Google/Bing/Brave without per-engine keys — the best keyless route to mainstream web results. Public instances block JSON output, so self-host. |
| `RESEARCH_CONTACT_EMAIL` | Sent as the polite-pool contact to NCBI / OpenAlex / Crossref. Set this — it raises your rate limits and it is the courteous thing to do. |
| `GOOGLE_CSE_ID` + `GOOGLE_API_KEY` | Enables the Google layer via Programmable Search (100 queries/day free). |
| `SERPAPI_KEY` | Alternative Google layer, and the only way to reach Google Scholar. |
| `NCBI_API_KEY` | Raises the PubMed rate limit from 3/sec to 10/sec. |

**Without a Google key the Google layer reports itself as unavailable rather
than returning nothing**, and the gap is printed in the report's coverage
section. That distinction matters: "Google found nothing" and "Google never ran"
are not the same claim.

## Register with an MCP client

```json
{
  "mcpServers": {
    "research": {
      "command": "node",
      "args": ["/Users/macdaddyjoe/code/thinkbigjoe/mcp-server/research/research-mcp.mjs"],
      "env": { "RESEARCH_CORPUS_DIR": "/Users/macdaddyjoe/research-corpus", "RESEARCH_CONTACT_EMAIL": "you@example.org" }
    },
    "thesis": {
      "command": "node",
      "args": ["/Users/macdaddyjoe/code/thinkbigjoe/mcp-server/research/thesis-mcp.mjs"],
      "env": { "RESEARCH_CORPUS_DIR": "/Users/macdaddyjoe/research-corpus" }
    }
  }
}
```

Give them to **separate agents**. The research agent should not know the thesis
exists — its job is to find out what is true, not to supply ammunition. Run the
research phase to completion, then hand the corpus name to the thesis agent.

## Verify

```bash
cd /Users/macdaddyjoe/code/thinkbigjoe/mcp-server/research && RESEARCH_CORPUS_DIR=/tmp/smoke-corpus node smoke-test.mjs
```

Hits every live API and asserts each corpus gate actually rejects what it claims
to. 20 checks.

---

## Working sequence

**Phase 1 — research** (one project per research question):

```
start_run            → question, substances, depth
next_action          → ★ the loop. Do what it says; call it again. Repeat until done:true.
  build_index        →   enumeration, to exhaustion, before anything is read
  read_queue         →   stratified priority order — not citation rank
  get_full_text      →   the actual paper, not the abstract
  expand_citations   →   backward to the primary source, forward to the rebuttals
  check_integrity    →   before recording anything
  record_finding     →   one sourced fact at a time
  mark_read          →   advance the queue
  safety_profile     →   the harm side of the ledger
compile_whitepaper   → PRISMA/GRADE white paper
compile_visual_report→ the self-contained HTML page
export_dataset       → versioned JSON for the website
```

**Phase 2 — thesis** (different agent, same project name):

```
load_evidence        → the corpus plus its inherited caveats
assess_mechanism     → pathway + what contradicts it + what is NOT demonstrated
propose_parameter    → each value traced to finding ids, or marked OPEN
assess_safety        → mandatory, per substance
define_falsification → mandatory
grade_thesis         → GRADE, bluntly
compile_thesis       → the deliverable
```

## Scope

The thesis document is framed by its renderer as an **investigational hypothesis
for evaluation by qualified investigators** — a structured argument with its
joints visible, so a reviewer can see exactly where it is strong and exactly
where it is held together by a single mouse study. It is not a treatment plan
for any individual, and the renderer will not render it as one. Everything it
contains is traceable to a line in `findings.jsonl`.
