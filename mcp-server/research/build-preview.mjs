#!/usr/bin/env node
/**
 * build-preview.mjs — builds the reviewable preview site.
 *
 *   preview/index.html          the tool console: pipeline, tools, gates
 *   preview/visual-report.html  the real rendered visual report
 *   preview/white-paper.html    the real rendered white paper
 *
 * Run:  RESEARCH_CORPUS_DIR=/tmp/demo node build-preview.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { renderWhitePaper } from "./render-whitepaper.mjs";
import { renderVisualReport } from "./render-visual.mjs";
import { corpusStats, indexStats } from "./corpus.mjs";
import { expandQueryMatrix } from "./index-layer.mjs";
import { exportDataset } from "./export.mjs";

const P = process.env.DEMO_PROJECT || "demo-preview";
if (!existsSync("preview")) mkdirSync("preview");

const s = corpusStats(P);
const ix = indexStats(P);
const matrix = expandQueryMatrix({ depth: "standard" });
const matrixEx = expandQueryMatrix({ depth: "exhaustive" });
const ds = exportDataset(P, { out_dir: "preview/dataset" });

const esc = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// --- minimal markdown → html, enough for the white paper's constructs --------
function md2html(md) {
  const lines = md.split("\n");
  const out = [];
  let inTable = false,
    inCode = false,
    inQuote = false;
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const closeTable = () => { if (inTable) { out.push("</tbody></table></div>"); inTable = false; } };
  const closeQuote = () => { if (inQuote) { out.push("</blockquote>"); inQuote = false; } };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      closeTable(); closeQuote();
      if (!inCode) { out.push('<pre class="code">'); inCode = true; } else { out.push("</pre>"); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(l)); continue; }

    if (/^\|/.test(l)) {
      const cells = l.split("|").slice(1, -1).map((c) => c.trim());
      if (/^\|[\s:|-]+\|$/.test(l)) continue;
      if (!inTable) {
        closeQuote();
        out.push('<div class="scroll"><table><thead><tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
        inTable = true;
      } else {
        out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      }
      continue;
    }
    closeTable();

    if (/^>/.test(l)) {
      if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
      out.push(inline(l.replace(/^>\s?/, "")) + "<br>");
      continue;
    }
    closeQuote();

    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length} id="s${i}">${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^---+$/.test(l)) { out.push("<hr>"); continue; }
    if (/^[-*]\s+/.test(l)) { out.push(`<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`); continue; }
    if (/^\d+\.\s+/.test(l)) { out.push(`<li>${inline(l.replace(/^\d+\.\s+/, ""))}</li>`); continue; }
    if (l.trim() === "") { out.push(""); continue; }
    out.push(`<p>${inline(l)}</p>`);
  }
  closeTable(); closeQuote();
  return out.join("\n").replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
}

const SHELL = (title, body, extra = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light;--surface:#fcfcfb;--plane:#f9f9f7;--t1:#0b0b0b;--t2:#52514e;--muted:#898781;
--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--accent:#2a78d6;--harm:#e34948;--ok:#0ca30c}
@media(prefers-color-scheme:dark){:root:where(:not([data-theme=light])){color-scheme:dark;--surface:#1a1a19;--plane:#0d0d0d;
--t1:#fff;--t2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--accent:#3987e5;--harm:#e66767}}
:root[data-theme=dark]{color-scheme:dark;--surface:#1a1a19;--plane:#0d0d0d;--t1:#fff;--t2:#c3c2b7;--muted:#898781;
--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--accent:#3987e5;--harm:#e66767}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--t1);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:26px 20px 90px}
h1{font-size:27px;margin:0 0 8px;letter-spacing:-.01em;line-height:1.2}
h2{font-size:19px;margin:34px 0 10px;letter-spacing:-.005em}
h3{font-size:15px;margin:22px 0 8px}
h4{font-size:14px;margin:16px 0 6px;color:var(--t2)}
p{margin:0 0 11px}
a{color:var(--accent)}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--plane);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
pre.code{background:var(--plane);border:1px solid var(--border);border-radius:8px;padding:14px;overflow-x:auto;font:12.5px ui-monospace,Menlo,monospace;line-height:1.5}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin:14px 0}
.sub{color:var(--t2);font-size:13.5px}
.cap{color:var(--muted);font-size:12.5px;line-height:1.55}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}
th{text-align:left;font-weight:600;color:var(--t2);padding:8px 10px;border-bottom:1px solid var(--axis);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--grid);vertical-align:top}
.scroll{overflow-x:auto}
blockquote{margin:10px 0;padding:10px 14px;border-left:3px solid var(--axis);background:var(--plane);border-radius:0 8px 8px 0;color:var(--t2);font-size:13.5px}
hr{border:none;border-top:1px solid var(--grid);margin:26px 0}
ul{margin:0 0 12px;padding-left:22px}
li{margin:3px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px;margin:16px 0}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:15px}
.kpi .v{font-size:27px;font-weight:600;letter-spacing:-.02em;line-height:1.1}
.kpi .k{font-size:12px;color:var(--t2);margin-top:5px}
.nav{position:sticky;top:0;background:var(--plane);border-bottom:1px solid var(--border);padding:11px 20px;margin:-26px -20px 20px;z-index:9;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.nav a{display:inline-block;padding:6px 12px;border-radius:8px;border:1px solid var(--border);text-decoration:none;color:var(--t2);font-size:13px;background:var(--surface)}
.nav a.on{border-color:var(--accent);color:var(--accent)}
.nav .sp{flex:1}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;border:1px solid var(--border);color:var(--t2)}
.pill.gate{border-color:var(--harm);color:var(--harm)}
.pill.new{border-color:var(--accent);color:var(--accent)}
.tool{border:1px solid var(--border);border-radius:10px;padding:13px 15px;margin:9px 0;background:var(--surface)}
.tool h4{margin:0 0 5px;font-size:14px;color:var(--t1);font-family:ui-monospace,Menlo,monospace}
.tool p{margin:0;font-size:13px;color:var(--t2)}
.phase{display:flex;align-items:center;gap:10px;margin:26px 0 8px}
.phase .n{width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600;flex:none}
.phase h3{margin:0}
.flowline{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--t2);margin:14px 0 20px}
.flowline span.s{padding:5px 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.flowline span.a{color:var(--muted)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:760px){.two{grid-template-columns:1fr}}
.tbtn{position:fixed;top:12px;right:12px;z-index:20;border:1px solid var(--border);background:var(--surface);color:var(--t2);border-radius:8px;padding:6px 10px;font:12px system-ui;cursor:pointer}
</style></head><body>
<button class="tbtn" onclick="var r=document.documentElement,c=r.getAttribute('data-theme'),d=c?c==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.setAttribute('data-theme',d?'light':'dark')">◐ theme</button>
<div class="wrap">
<div class="nav">
<a href="index.html"${title.includes("console") ? ' class="on"' : ""}>Console</a>
<a href="visual-report.html"${title.includes("Visual") ? ' class="on"' : ""}>Visual report</a>
<a href="white-paper.html"${title.includes("White") ? ' class="on"' : ""}>White paper</a>
<a href="dataset/manifest.json">Dataset</a>
<span class="sp"></span><span class="pill">demo corpus · real sources</span>
</div>
${body}
</div>${extra}</body></html>`;

// ---------------------------------------------------------------------------
const tool = (n, d, tag) => `<div class="tool"><h4>${esc(n)} ${tag ? `<span class="pill ${tag === "NEW" ? "new" : "gate"}">${tag}</span>` : ""}</h4><p>${d}</p></div>`;

const console_ = SHELL(
  "research-mcp — tool console",
  `
<h1>research-mcp + thesis-mcp</h1>
<p class="sub">Two MCP servers for deep literature research. Indexing layer → stratified reading → white paper + visual report → publishable JSON dataset.
Built for Cowork; the loop is designed to run unattended on Sonnet 5.</p>

<div class="kpis">
<div class="kpi"><div class="v">${ix.total.toLocaleString()}</div><div class="k">documents indexed in the demo run</div></div>
<div class="kpi"><div class="v">${matrix.query_count}</div><div class="k">queries at <code>standard</code> depth</div></div>
<div class="kpi"><div class="v">${matrixEx.query_count}</div><div class="k">at <code>exhaustive</code></div></div>
<div class="kpi"><div class="v">${s.findings}</div><div class="k">findings, each with a verbatim quote</div></div>
<div class="kpi"><div class="v">${(ix.coverage * 100).toFixed(0)}%</div><div class="k">estimated coverage (Chao1)</div></div>
</div>

<div class="card">
<h3 style="margin-top:0">The loop</h3>
<div class="flowline">
<span class="s">start_run</span><span class="a">→</span>
<span class="s">INDEXING</span><span class="a">→</span>
<span class="s">TRIAGE</span><span class="a">→</span>
<span class="s">READING</span><span class="a">→</span>
<span class="s">GAP_FILL</span><span class="a">→</span>
<span class="s">SAFETY</span><span class="a">→</span>
<span class="s">WHITE PAPER</span><span class="a">→</span>
<span class="s">VISUAL</span><span class="a">→</span>
<span class="s">DONE</span>
</div>
<p>The agent calls <code>next_action</code>, does exactly what it returns, and calls it again. <strong>It cannot return <code>done:true</code> until both reports exist on disk.</strong>
Every state's exit condition is a computable predicate over ledger counts — not a judgement the model makes about whether it has done enough.</p>
<p class="cap">State is recomputed from the ledgers on every call, so there is no checkpoint file. A crashed run, a new session, a different model a week later — all resume exactly where the corpus actually is.</p>
</div>

<h2>What stops it stopping early — and what stops it churning</h2>
<div class="two">
<div class="card">
<h4 style="margin-top:0">Premature stop</h4>
<p class="cap">The failure where an agent declares victory at 40% coverage because searches started looking repetitive.</p>
<ul class="cap">
<li><strong>Chao1 capture–recapture</strong> on query overlap estimates how much has <em>not</em> been seen. Coverage must clear the target before INDEXING can exit.</li>
<li><strong>Rolling marginal yield</strong> — the share of each query's results that were new. Repetition is the signal being measured, and it is counted for the agent.</li>
<li><strong>Stratified read quotas</strong> — READING cannot exit while any stratum is short, which is what stops it reading the 50 most-cited papers and calling the literature surveyed.</li>
</ul>
</div>
<div class="card">
<h4 style="margin-top:0">Infinite churn</h4>
<p class="cap">The failure where an agent re-searches an exhausted space forever.</p>
<ul class="cap">
<li><strong>Per-gap attempt budget.</strong> After the maximum attempts the driver writes the gap to the ledger and advances.</li>
<li><strong>A logged gap appears in the report's limitations.</strong> Giving up is allowed; giving up quietly is not.</li>
<li><strong>Exhaustion vs ceiling are distinct facts.</strong> "There is no more" and "we cannot see any more" are recorded separately and reported separately.</li>
</ul>
</div>
</div>

<h2>The pipeline</h2>

<div class="phase"><div class="n">1</div><h3>Indexing — enumeration, before anything is read</h3></div>
<p>One question expands into a deliberate query matrix, and every query is paged <em>to the bottom of its source</em> rather than the bottom of page one.
In the demo run Europe PMC enumerated all 1,960 records for one query via cursorMark; PubMed walked 454 via WebEnv; ClinicalTrials.gov and OpenAlex paged by token and cursor.</p>
<h4>The query matrix axes</h4>
<div class="scroll"><table><thead><tr><th>Axis</th><th>Queries (standard)</th><th>What it exists to catch</th></tr></thead><tbody>
${Object.entries(matrix.by_axis)
  .map(
    ([k, v]) =>
      `<tr><td><code>${k}</code></td><td>${v}</td><td>${
        {
          core: "substance × indication — the spine, including the misspellings people actually type (“methane blue”, “mebendazol”)",
          mechanism: "biology papers that never mention the indication and so never appear in the core axis",
          design: "each evidence tier separately, so one ranking cannot bury every case report under the reviews",
          outcome: "papers indexed by what they measured rather than what they studied",
          combination: "repurposing literature is mostly combination literature — gemcitabine, FOLFIRINOX, radiation",
          disconfirming: "the vocabulary negative results are <em>actually</em> published under — “no significant difference”, “failed to inhibit”, terminated, retracted",
          grey: "reported experience and testimonial, including the named Joe Tippens protocol — recorded at anecdote tier, never promoted",
          species: "the veterinary record — dog, cattle, horse, sheep. Decades of licensed tolerability data invisible to any query pairing the drug with “cancer”",
          safety: "maximum tolerated dose, interactions, pharmacokinetics, overdose case reports",
          class: "cross-substance and drug-class framing",
        }[k] || ""
      }</td></tr>`,
  )
  .join("")}
</tbody></table></div>
<p class="cap">${matrix.by_intent.disconfirming} of ${matrix.query_count} queries at standard depth are disconfirming — roughly ${((matrix.by_intent.disconfirming / matrix.query_count) * 100).toFixed(0)}%. That ratio is the point: the disconfirming axis is sized comparably to the confirming axes, not tacked on.</p>

<div class="phase"><div class="n">2</div><h3>Triage — the read order is computed, not chosen</h3></div>
<p>Priority is deliberately <strong>not</strong> citation rank. Sorting by citations reads the famous positive papers first, which on any real time budget means null results and safety literature are the ones that never get read.
Disconfirming, safety and trial records are boosted to counteract exactly that. The driver performs triage itself rather than asking the model to — a model scoring its own read queue is precisely where a preference for confirming literature would re-enter.</p>

<div class="phase"><div class="n">3</div><h3>Reading — and the gate everything passes through</h3></div>
<p><code>record_finding</code> is the only route to a report. It rejects:</p>
<div class="scroll"><table><thead><tr><th>Rejected when…</th><th>Why</th></tr></thead><tbody>
<tr><td>no resolvable source (url / doi / pmid / nct)</td><td>there is no “general knowledge” path into the corpus</td></tr>
<tr><td>no verbatim quote ≥ 20 chars, copied word-for-word</td><td>the quote is what makes the claim checkable by a third party</td></tr>
<tr><td>direction not one of benefit / harm / null / mixed / background</td><td>the single field that makes the corpus's balance visible</td></tr>
<tr><td>evidence tier missing or invalid</td><td>an in-vitro result must never be able to look like a trial</td></tr>
</tbody></table></div>

<div class="phase"><div class="n">4</div><h3>Species — animal evidence is several literatures, not one</h3></div>
<p>Every finding carries a normalised species alongside the verbatim model description. A mouse xenograft and a licensed canine tolerability study answer different questions.
For the benzimidazoles specifically, the veterinary record <em>is</em> the best-characterised safety data that exists — and every species carries its own interpretive caveat, rendered at the point of reading rather than buried in a methods note.</p>
<div class="scroll"><table><thead><tr><th>Species in the demo corpus</th><th>Findings</th></tr></thead><tbody>
${Object.entries(s.bySpecies).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td><code>${k}</code></td><td>${v}</td></tr>`).join("")}
</tbody></table></div>

<div class="phase"><div class="n">5</div><h3>Deliverables</h3></div>
<div class="two">
<div class="card"><h4 style="margin-top:0"><a href="white-paper.html">White paper →</a></h4>
<p class="cap">PRISMA 2020 structure with the flow diagram and its four stages of counts, GRADE framing, a full search-strategy appendix, species tables, a risk-of-bias panel, and — in place of a Conclusions section — <strong>“What this body of evidence does not establish”</strong>, derived from the corpus rather than written.</p></div>
<div class="card"><h4 style="margin-top:0"><a href="visual-report.html">Visual report →</a></h4>
<p class="cap">One self-contained HTML page, no external requests, light and dark, mobile and print. Built so it is impossible to look at it and come away thinking the evidence is stronger than it is.</p></div>
</div>

<div class="phase"><div class="n">6</div><h3>Retention — the dataset a website reads</h3></div>
<p><code>export_dataset</code> projects the ledgers into stable, versioned, denormalised JSON. Output is deterministic, so an unchanged corpus re-exports byte-identical and the dataset can live in git with meaningful diffs.</p>
<div class="scroll"><table><thead><tr><th>File</th><th>Contents</th></tr></thead><tbody>
${[
  ["manifest.json", "schema version, content hash, counts, and the consumer contract"],
  ["findings.json", "every finding with its verbatim quote, tier, species and permalink"],
  ["substances.json", "per-substance rollup with <strong>pre-computed honesty flags</strong> so a page cannot render a substance without its caveat"],
  ["sources.json", "bibliography with stable ids"],
  ["trials.json", "trial records with contact blocks"],
  ["contacts.json", "the published-contacts directory"],
  ["coverage.json", "the corpus's own limitations, for the site to display"],
  ["searches.json", "the full search log including queries that found nothing"],
  ["search-index.json", "tokenised text for client-side filtering, no library needed"],
  ["schema.json", "field meanings for consumers"],
]
  .map(([f, d]) => `<tr><td><code>${f}</code></td><td>${d}</td></tr>`)
  .join("")}
</tbody></table></div>
<p class="cap">Live from this demo run: <a href="dataset/manifest.json">manifest.json</a> · <a href="dataset/substances.json">substances.json</a> · <a href="dataset/coverage.json">coverage.json</a> · <a href="dataset/contacts.json">contacts.json</a></p>

<h2>Tools</h2>
<h3>Driver</h3>
${tool("next_action", "★ The main loop. Returns the single next thing to do with exact tool and arguments, plus progress and why the run is not finished. Returns done:true only when both reports exist.", "NEW")}
${tool("start_run", "Records the question, substances and depth; sets the saturation targets and read quotas the driver enforces.", "NEW")}
<h3>Indexing layer</h3>
${tool("build_index", "★ Expands the query matrix and pages every source to exhaustion. Records whether each query reached the end of the source or hit its paging ceiling. Deduplicates to stable identity and returns marginal-yield statistics.", "NEW")}
${tool("index_status", "Index composition plus the Chao1 estimate of what has not been seen. Coverage — not raw document count — is what says whether searching is done.", "NEW")}
${tool("read_queue", "Next documents in computed priority order, stratified so null results and safety literature cannot be crowded out.", "NEW")}
${tool("mark_read", "Advance a document to recorded / rejected / unreachable. A reason is required for the last two.", "NEW")}
<h3>Retrieval</h3>
${tool("deep_search", "One question across Google, DuckDuckGo, PubMed, Europe PMC, ClinicalTrials.gov and OpenAlex, with a mirrored disconfirming set fired automatically.")}
${tool("get_full_text", "Europe PMC full text (~50k chars) plus the complete reference list. Methods, dosing, species and adverse events live here, not in the abstract.")}
${tool("expand_citations", "The depth engine — walks the citation graph backward to the primary source and forward to replications, failures and rebuttals.")}
${tool("find_trials", "ClinicalTrials.gov v2 with full contact blocks: coordinators with phone and email, PIs with affiliations, per-site contacts, and why_stopped on halted trials.")}
${tool("read_source", "Reads a page in full; warns loudly when a page is client-rendered or bot-walled instead of returning navigation chrome.")}
${tool("check_integrity", "Retraction / correction / expression-of-concern check before anything is recorded.")}
${tool("safety_profile", "FDA label plus FAERS adverse-event counts — the harm side of the ledger.")}
<h3>Ledger</h3>
${tool("record_finding", "★ The only way anything reaches a report. Four rejection gates.", "GATE")}
${tool("species_breakdown", "Animal evidence by species, each with its interpretive caveat, plus findings whose species could not be classified.", "NEW")}
${tool("list_findings", "Read the corpus back, filtered by substance, direction, tier or species.")}
${tool("research_status", "Balance, coverage, and the explicit gap list that would block a report.")}
${tool("retract_finding", "Supersede a finding; the original stays in the append-only ledger.")}
<h3>Deliverables and retention</h3>
${tool("compile_whitepaper", "PRISMA/GRADE white paper. Refuses if no disconfirming searches were run.", "GATE")}
${tool("compile_visual_report", "The self-contained visual page.", "NEW")}
${tool("export_dataset", "★ The retention layer — versioned deterministic JSON for the website.", "NEW")}
${tool("match_patient_context", "Matches the corpus to one person's clinical context: applicable evidence, interaction and contraindication flags against their own medication list, and recruiting trials with coordinator phone numbers. Stateless — the context is never stored. Returns evidence and phone numbers, not a protocol.", "NEW")}

<h2>Register in Cowork</h2>
<pre class="code">{
  "mcpServers": {
    "research": {
      "command": "node",
      "args": ["/Users/macdaddyjoe/code/thinkbigjoe/mcp-server/research/research-mcp.mjs"],
      "env": {
        "RESEARCH_CORPUS_DIR": "/Users/macdaddyjoe/research-corpus",
        "RESEARCH_CONTACT_EMAIL": "you@example.org"
      }
    },
    "thesis": {
      "command": "node",
      "args": ["/Users/macdaddyjoe/code/thinkbigjoe/mcp-server/research/thesis-mcp.mjs"],
      "env": { "RESEARCH_CORPUS_DIR": "/Users/macdaddyjoe/research-corpus" }
    }
  }
}</pre>
<p class="cap">Everything works with no API keys — PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex, Crossref, openFDA and DuckDuckGo are all open.
Google needs <code>GOOGLE_CSE_ID</code> + <code>GOOGLE_API_KEY</code> (100/day free) or <code>SERPAPI_KEY</code>; without one the Google layer reports itself
<em>unavailable</em> rather than returning nothing, and that gap prints in the report — “Google found nothing” and “Google never ran” are not the same claim.</p>
<p class="cap" style="margin-top:22px">This preview was built from corpus <code>${esc(P)}</code>: a real run against live APIs. The findings' direction and tier were assigned by keyword heuristic for demonstration, which is exactly the job a real research agent does properly through <code>record_finding</code>.</p>
`,
);

writeFileSync("preview/index.html", console_);

const md = renderWhitePaper(P, {
  title: "Repurposed and alternative agents in pancreatic cancer: an evidence map",
  objective:
    "To identify, index and characterise the published evidence relating ivermectin, methylene blue, mebendazole and fenbendazole to pancreatic adenocarcinoma, without appraising whether that evidence supports use.",
});
writeFileSync("preview/white-paper.html", SHELL("White paper", md2html(md)));
writeFileSync("preview/white-paper.md", md);

writeFileSync(
  "preview/visual-report.html",
  renderVisualReport(P, {
    title: "Repurposed agents in pancreatic cancer — evidence map",
    question: "What does the published literature contain, and at what level of evidence?",
  }),
);

console.log(`✅ preview built`);
console.log(`   preview/index.html          tool console`);
console.log(`   preview/visual-report.html  ${(renderVisualReport(P, {}).length / 1024).toFixed(0)} KB, self-contained`);
console.log(`   preview/white-paper.html    ${(md.length / 1024).toFixed(0)} KB of markdown rendered`);
console.log(`   preview/dataset/            ${ds.files.length} JSON files`);
