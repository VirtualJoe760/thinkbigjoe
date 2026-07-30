# research-mcp + thesis-mcp

Two MCP servers for a research client working on alternative-agent literature in
pancreatic cancer (ivermectin, methylene blue, mebendazole, fenbendazole and
similar). They are **not** part of the ThinkBigJoe pipeline — they share nothing
with `tbj-mcp.mjs`, touch no TBJ database, and run standalone.

| Server | Role |
|---|---|
| `research-mcp.mjs` | **Tool 1 — the research instrument.** Finds, reads, verifies and records facts with a citation locked to each one. Emits the research report. |
| `thesis-mcp.mjs` | **Tool 2 — the thesis instrument.** Reads tool 1's corpus (read-only) and builds an investigational protocol thesis where every value traces back to a finding. |

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
- **`safety_profile`** — FDA label + FAERS adverse-event counts, so the harm
  ledger is populated from regulatory data even when the literature is silent.

`read_source` warns loudly when a page is client-rendered or bot-walled instead
of quietly returning 169 characters of navigation chrome — that failure mode is
how an agent ends up "reading" a paper it never saw.

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
deep_search        → pointers, plus the disconfirming mirror
find_trials        → trials + contacts; record terminated ones too
get_full_text      → the actual paper, not the abstract
expand_citations   → backward to the primary source, forward to the rebuttals
check_integrity    → before recording anything
safety_profile     → the harm side of the ledger
record_finding     → one sourced fact at a time
research_status    → check your own balance; fix the gaps it names
compile_report     → the deliverable
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
