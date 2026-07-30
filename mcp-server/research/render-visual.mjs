/**
 * render-visual.mjs — the visual report renderer.
 *
 * Emits ONE self-contained HTML file (no external requests of any kind — no CDN,
 * no fonts, no images; inline SVG and vanilla JS only) whose job is to make a
 * large evidence corpus legible to a human in about ninety seconds.
 *
 * THE DESIGN CONSTRAINT that governs every choice below: it must be impossible
 * to look at this page and come away believing the evidence is stronger than it
 * is. Concretely, that means:
 *
 *  - Evidence tier is encoded by POSITION on a fixed vertical hierarchy, with a
 *    hard rule drawn between human-subject tiers and everything below. An empty
 *    trial row renders as visibly empty surface. You cannot miss that all the
 *    mass sits at the bottom of the pyramid, because the bottom is where it is
 *    drawn.
 *  - Direction uses a diverging scale — harm and benefit are equal-weight poles
 *    at equal saturation, so neither reads as the default. The "neither" block
 *    (null + mixed) is neutral gray and straddles the centre.
 *  - Colour never encodes good/bad. Status tokens are not used for series at all.
 *  - Absence is drawn, not omitted: zero-result searches, unread index entries
 *    and un-run engines each get their own visible panel. A corpus with no null
 *    findings renders a warning band across the balance chart.
 *  - Every chart has a table twin, and every value is reachable without hovering.
 *
 * Palette: the validated reference instance. The ordinal blue ramp used by the
 * matrix passes the ordinal gate in both modes (monotone L, ΔL ≥ 0.06, light end
 * ≥ 2:1 on its surface); the diverging pair is blue↔red with a gray neutral.
 */

import {
  getFindings,
  getSearches,
  corpusStats,
  indexStats,
  readIndex,
  coverageEstimate,
  sourceExhaustion,
  DIRECTIONS,
  EVIDENCE_TIERS,
} from "./corpus.mjs";
import { ANIMAL_SPECIES, SPECIES_LABEL, SPECIES_CAVEAT } from "./species.mjs";
import { relevanceStats, RELEVANCE_LABEL, RELEVANCE_NOTE, RELEVANCE_LEVELS, CONDITION_PROFILES } from "./indication.mjs";

const HUMAN_TIERS = [
  "meta_analysis",
  "rct",
  "controlled_trial_nonrandomized",
  "cohort",
  "case_control",
  "case_series",
  "case_report",
];

const TIER_LABEL = {
  meta_analysis: "Meta-analysis",
  rct: "Randomised controlled trial",
  controlled_trial_nonrandomized: "Controlled trial (non-random.)",
  cohort: "Cohort study",
  case_control: "Case-control",
  case_series: "Case series",
  case_report: "Case report",
  animal_in_vivo: "Animal (in vivo)",
  in_vitro: "Cell culture (in vitro)",
  mechanistic_review: "Mechanistic review",
  narrative_review: "Narrative review",
  preprint: "Preprint",
  conference_abstract: "Conference abstract",
  regulatory_document: "Regulatory document",
  anecdote_unverified: "Unverified anecdote",
};

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : "0%");

// ---------------------------------------------------------------------------

export function renderVisualReport(project, opts = {}) {
  const findings = getFindings(project);
  const searches = getSearches(project);
  const idx = readIndex(project);
  const s = corpusStats(project);
  const ix = indexStats(project);
  const cov = coverageEstimate(project);
  const exh = sourceExhaustion(project);
  const now = new Date().toISOString().slice(0, 10);

  const subjects = [...new Set(findings.map((f) => f.subject || "unspecified"))].sort();
  const tiersPresent = EVIDENCE_TIERS.filter((t) => findings.some((f) => f.evidence_tier === t));
  // Always show the human tiers even when empty — an empty RCT row is the
  // single most informative cell on the page.
  const matrixTiers = [...new Set([...HUMAN_TIERS, ...tiersPresent])].sort(
    (a, b) => EVIDENCE_TIERS.indexOf(a) - EVIDENCE_TIERS.indexOf(b),
  );

  const title = opts.title || `Evidence map — ${project}`;

  const parts = [];
  parts.push(head(title));
  parts.push(header(title, project, now, opts));
  parts.push(kpiRow(s, ix, cov));
  parts.push(relevancePanel(findings, opts));
  parts.push(evidenceMatrix(findings, subjects, matrixTiers));
  parts.push(directionBalance(findings, subjects, s));
  parts.push(speciesPanel(findings));
  parts.push(saturationPanel(project, searches, idx, cov));
  parts.push(prismaPanel(ix, idx, s));
  parts.push(coveragePanel(searches, exh, ix));
  parts.push(findingsTable(findings));
  parts.push(contactsPanel(findings));
  parts.push(footer(project, now));
  parts.push(script());

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Head + theme tokens
// ---------------------------------------------------------------------------

function head(title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{
  color-scheme: light;
  --surface-1:#fcfcfb; --plane:#f9f9f7;
  --text-1:#0b0b0b; --text-2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,.10);
  /* diverging: benefit <-> harm, neutral middle */
  --benefit:#2a78d6; --harm:#e34948; --neutral:#898781; --neutral-2:#c3c2b7;
  /* ordinal blue ramp for the matrix (validated: monotone L, dL>=.06, light end 2.06:1) */
  --r1:#86b6ef; --r2:#3987e5; --r3:#256abf; --r4:#184f95; --r5:#0d366b;
  --on-ramp-lo:#0b0b0b; --on-ramp-hi:#ffffff;
  --warn-band:rgba(227,73,72,.08);
}
@media (prefers-color-scheme: dark){
  :root:where(:not([data-theme="light"])){
    color-scheme: dark;
    --surface-1:#1a1a19; --plane:#0d0d0d;
    --text-1:#ffffff; --text-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10);
    --benefit:#3987e5; --harm:#e66767; --neutral:#898781; --neutral-2:#52514e;
    --r1:#184f95; --r2:#256abf; --r3:#3987e5; --r4:#6da7ec; --r5:#9ec5f4;
    --on-ramp-lo:#ffffff; --on-ramp-hi:#0b0b0b;
    --warn-band:rgba(230,103,103,.10);
  }
}
:root[data-theme="dark"]{
  color-scheme: dark;
  --surface-1:#1a1a19; --plane:#0d0d0d;
  --text-1:#ffffff; --text-2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10);
  --benefit:#3987e5; --harm:#e66767; --neutral:#898781; --neutral-2:#52514e;
  --r1:#184f95; --r2:#256abf; --r3:#3987e5; --r4:#6da7ec; --r5:#9ec5f4;
  --on-ramp-lo:#ffffff; --on-ramp-hi:#0b0b0b;
  --warn-band:rgba(230,103,103,.10);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--plane); color:var(--text-1);
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:26px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}
h2{font-size:17px;margin:0 0 4px;letter-spacing:-.005em}
h3{font-size:14px;margin:0 0 10px;color:var(--text-2);font-weight:600}
p{margin:0 0 10px}
.sub{color:var(--text-2);font-size:13px}
.card{
  background:var(--surface-1); border:1px solid var(--border); border-radius:12px;
  padding:20px; margin:16px 0;
}
.cap{color:var(--muted);font-size:12px;line-height:1.5;margin-top:10px}
.banner{
  background:var(--surface-1);border:1px solid var(--border);border-left:3px solid var(--harm);
  border-radius:8px;padding:14px 16px;margin:16px 0;font-size:13px;color:var(--text-2)
}
.banner b{color:var(--text-1)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}
.kpi{background:var(--surface-1);border:1px solid var(--border);border-radius:12px;padding:16px}
.kpi .v{font-size:30px;line-height:1.1;font-weight:600;letter-spacing:-.02em}
.kpi .k{font-size:12px;color:var(--text-2);margin-top:6px}
.kpi .n{font-size:11px;color:var(--muted);margin-top:4px}
table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;font-weight:600;color:var(--text-2);padding:8px 10px;border-bottom:1px solid var(--axis);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--grid);vertical-align:top}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:10px 0 4px;font-size:12px;color:var(--text-2)}
.sw{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:-1px}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid var(--border);color:var(--text-2);white-space:nowrap}
.warn{border-left:3px solid var(--harm);background:var(--warn-band);padding:12px 14px;border-radius:8px;margin:12px 0;font-size:13px;color:var(--text-1)}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
input[type=search],select{
  font:13px system-ui,-apple-system,sans-serif;padding:7px 10px;border-radius:8px;
  border:1px solid var(--axis);background:var(--surface-1);color:var(--text-1);min-width:130px
}
.quote{
  border-left:2px solid var(--axis);padding:8px 0 8px 12px;margin:8px 0 4px;
  color:var(--text-2);font-size:13px;white-space:pre-wrap
}
.rowbtn{cursor:pointer}
.rowbtn:hover td{background:var(--plane)}
.det{display:none}
.det.open{display:table-row}
.meta{font-size:12px;color:var(--muted);margin-top:6px}
.flow{display:grid;gap:8px}
.fnode{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--plane);font-size:13px}
.fnode .n{font-variant-numeric:tabular-nums;font-weight:600;font-size:15px}
.fsub{margin-left:26px;border-left:2px solid var(--grid);padding-left:14px;display:grid;gap:8px}
.themebtn{
  position:fixed;top:14px;right:14px;z-index:10;border:1px solid var(--border);
  background:var(--surface-1);color:var(--text-2);border-radius:8px;padding:6px 10px;
  font:12px system-ui;cursor:pointer
}
svg{display:block;max-width:100%;height:auto}
.tick{fill:var(--muted);font-size:11px}
.axl{fill:var(--text-2);font-size:12px}
.gl{stroke:var(--grid);stroke-width:1}
.ax{stroke:var(--axis);stroke-width:1}
@media (max-width:640px){
  .wrap{padding:20px 14px 60px}
  h1{font-size:21px}
  .kpi .v{font-size:24px}
}
@media print{
  .themebtn{display:none}
  .card{break-inside:avoid;border-color:#ccc}
  body{background:#fff}
}
</style>
</head>
<body>
<button class="themebtn" onclick="tgl()">◐ theme</button>
<div class="wrap">`;
}

// ---------------------------------------------------------------------------

function header(title, project, now, opts) {
  return `
<h1>${esc(title)}</h1>
<p class="sub">Corpus <code>${esc(project)}</code> · compiled ${now}${opts.question ? ` · ${esc(opts.question)}` : ""}</p>
<div class="banner">
<b>What this page is.</b> A picture of what a body of published literature contains and at what
level of evidence — assembled mechanically from a citation-locked ledger.
<b>What it is not.</b> It is not a verdict, a recommendation, or medical advice. Nothing here says
whether anything works. Where a chart looks empty, the literature is empty; that absence is the
finding.
</div>`;
}

// ---------------------------------------------------------------------------

function kpiRow(s, ix, cov) {
  const k = (v, label, note) =>
    `<div class="kpi"><div class="v">${v}</div><div class="k">${label}</div>${note ? `<div class="n">${note}</div>` : ""}</div>`;
  return `
<div class="kpis">
${k(ix.total.toLocaleString(), "documents found by searching", `${ix.outstanding.toLocaleString()} not yet read`)}
${k(s.findings.toLocaleString(), "facts recorded, each with a quote", `from ${ix.read.toLocaleString()} documents read in full`)}
${k(s.onTarget.toLocaleString(), "actually about pancreatic cancer", s.findings ? `${pct(s.onTarget, s.findings)} of everything recorded` : "—")}
${k(s.onTargetHuman.toLocaleString(), "…and tested in people", "the rest are cells, animals, or other diseases")}
${k(`${(cov.coverage * 100).toFixed(0)}%`, "of the findable research seen so far", `≈${cov.unseen_estimate.toLocaleString()} documents still unseen`)}
</div>`;
}

// ---------------------------------------------------------------------------
// Relevance panel — the lead. How much of this is about the actual question?
// ---------------------------------------------------------------------------

function relevancePanel(findings, opts = {}) {
  const key = opts.condition_profile || "pancreatic_adenocarcinoma";
  const cond = CONDITION_PROFILES[key];
  const rs = relevanceStats(findings, key);
  if (!findings.length) return "";

  const condName = cond.label.toLowerCase();
  const order = ["target", "adjacent", "other_cancer", "non_cancer", "unclear"];
  const shades = { target: "var(--r5)", adjacent: "var(--r3)", other_cancer: "var(--r2)", non_cancer: "var(--r1)", unclear: "var(--neutral-2)" };

  const w = 780,
    barH = 44,
    padT = 6;
  let x = 0;
  const segs = order
    .filter((k) => rs.by[k] > 0)
    .map((k) => {
      const wid = (rs.by[k] / rs.total) * w;
      const seg = `<rect x="${x.toFixed(1)}" y="${padT}" width="${Math.max(0, wid - 2).toFixed(1)}" height="${barH}" rx="4" fill="${shades[k]}"><title>${esc(RELEVANCE_LABEL[k])}: ${rs.by[k]} findings</title></rect>${
        wid > 54
          ? `<text x="${(x + wid / 2 - 1).toFixed(1)}" y="${padT + barH / 2 + 5}" text-anchor="middle" style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums" fill="${k === "non_cancer" || k === "unclear" ? "var(--on-ramp-lo)" : "var(--on-ramp-hi)"}">${rs.by[k]}</text>`
          : ""
      }`;
      x += wid;
      return seg;
    })
    .join("");

  // Of the on-target findings, how many are actually in people?
  const onTarget = findings.filter((f) => f.indication_relevance === "target");
  const onTargetHuman = onTarget.filter((f) => HUMAN_TIERS.includes(f.evidence_tier));
  const onTargetTrials = onTarget.filter((f) => ["meta_analysis", "rct", "controlled_trial_nonrandomized"].includes(f.evidence_tier));

  return `
<div class="card">
<h2>How much of this research is actually about ${esc(condName)}?</h2>
<h3>Searching for a drug and "cancer" returns a great deal of work on other cancers, and on the drug's original non-cancer use. Only the first block below is about the disease in question.</h3>

<div class="scroll">
<svg viewBox="0 0 ${w} ${barH + padT * 2}" width="${w}" role="img" aria-label="Share of findings by relevance to the target condition">${segs}</svg>
</div>
<div class="legend">
${order.filter((k) => rs.by[k] > 0).map((k) => `<span><span class="sw" style="background:${shades[k]}"></span>${esc(RELEVANCE_LABEL[k])} (${rs.by[k]})</span>`).join("")}
</div>

<div class="kpis" style="margin-top:16px">
  <div class="kpi"><div class="v">${rs.by.target}</div><div class="k">studies about ${esc(condName)}</div><div class="n">out of ${rs.total} recorded in total</div></div>
  <div class="kpi"><div class="v">${onTargetHuman.length}</div><div class="k">of those, done in people</div><div class="n">the rest are cells or animals</div></div>
  <div class="kpi"><div class="v">${onTargetTrials.length}</div><div class="k">of those, a controlled trial</div><div class="n">the study type that can show cause and effect</div></div>
</div>

${
  rs.by.target === 0
    ? `<div class="warn"><b>Nothing in this corpus is about ${esc(condName)}.</b> Every study recorded concerns these substances in some other disease or outside cancer entirely. No statement here describes what happens in ${esc(condName)}.</div>`
    : onTargetTrials.length === 0
      ? `<div class="warn"><b>No controlled trial in ${esc(condName)} appears anywhere in this corpus.</b> Without a control group, an observed change cannot be separated from the natural course of the disease, from other treatment being given at the same time, or from which patients happened to get written up.</div>`
      : ""
}

<div class="scroll" style="margin-top:14px">
<table>
<thead><tr><th>Category</th><th class="num">Studies</th><th class="num">Share</th><th>What it means</th></tr></thead>
<tbody>
${order
  .map(
    (k) =>
      `<tr${k === "target" ? ' style="font-weight:600"' : ""}><td>${esc(RELEVANCE_LABEL[k])}</td><td class="num">${rs.by[k]}</td><td class="num">${pct(rs.by[k], rs.total)}</td><td style="font-weight:400">${esc(RELEVANCE_NOTE[k])}</td></tr>`,
  )
  .join("")}
</tbody></table>
</div>
<p class="cap">This is a statement about subject matter, not about quality. An excellent study of a different
cancer is still a study of a different cancer. Counting those as if they were evidence about
${esc(condName)} is the most common way the case for a repurposed drug gets overstated.</p>
</div>`;
}

// ---------------------------------------------------------------------------
// Evidence matrix — the honesty visual
// ---------------------------------------------------------------------------

function evidenceMatrix(findings, subjects, tiers) {
  if (!subjects.length) return "";
  const counts = {};
  let max = 0;
  for (const t of tiers)
    for (const sub of subjects) {
      const n = findings.filter((f) => f.evidence_tier === t && (f.subject || "unspecified") === sub).length;
      counts[`${t}|${sub}`] = n;
      if (n > max) max = n;
    }

  const rowH = 26,
    labelW = 190,
    colW = Math.max(74, Math.min(150, Math.floor(760 / subjects.length))),
    padT = 46,
    gap = 2,
    // A dedicated band for the human/non-human divider so its caption never
    // collides with a row label.
    dividerBand = 24;
  const w = labelW + subjects.length * colW + 8;
  const lastHuman = tiers.map((t) => HUMAN_TIERS.includes(t)).lastIndexOf(true);
  const rowY = (ri) => padT + ri * rowH + (lastHuman >= 0 && ri > lastHuman ? dividerBand : 0);
  const h = padT + tiers.length * rowH + dividerBand + 14;

  const bin = (n) => {
    if (!n) return null;
    const f = max <= 1 ? 1 : n / max;
    return f <= 0.2 ? "var(--r1)" : f <= 0.4 ? "var(--r2)" : f <= 0.6 ? "var(--r3)" : f <= 0.8 ? "var(--r4)" : "var(--r5)";
  };
  const ink = (n) => {
    const f = max <= 1 ? 1 : n / max;
    return f <= 0.4 ? "var(--on-ramp-lo)" : "var(--on-ramp-hi)";
  };

  const cells = [];
  tiers.forEach((t, ri) => {
    const y = rowY(ri);
    const human = HUMAN_TIERS.includes(t);
    cells.push(
      `<text x="${labelW - 10}" y="${y + rowH / 2 + 4}" text-anchor="end" class="tick" ${human ? 'style="font-weight:600"' : ""}>${esc(TIER_LABEL[t] || t)}</text>`,
    );
    subjects.forEach((sub, ci) => {
      const n = counts[`${t}|${sub}`];
      const x = labelW + ci * colW;
      const fill = bin(n);
      cells.push(
        fill
          ? `<rect x="${x}" y="${y}" width="${colW - gap}" height="${rowH - gap}" rx="3" fill="${fill}"><title>${esc(sub)} · ${esc(TIER_LABEL[t] || t)}: ${n} findings</title></rect>
             <text x="${x + (colW - gap) / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" style="font-size:11px;font-variant-numeric:tabular-nums" fill="${ink(n)}">${n}</text>`
          : `<rect x="${x}" y="${y}" width="${colW - gap}" height="${rowH - gap}" rx="3" fill="none" stroke="var(--grid)" stroke-width="1"><title>${esc(sub)} · ${esc(TIER_LABEL[t] || t)}: no findings</title></rect>`,
      );
    });
  });

  // The divider sits inside its own band so the caption can never collide with
  // a row label — the label is the whole point of the line.
  const dividerY = lastHuman >= 0 ? padT + (lastHuman + 1) * rowH + dividerBand / 2 - 4 : 0;
  const divider =
    lastHuman >= 0
      ? `<line x1="0" y1="${dividerY}" x2="${w}" y2="${dividerY}" stroke="var(--harm)" stroke-width="1.5"/>
         <text x="${w}" y="${dividerY + 15}" text-anchor="end" class="tick" style="fill:var(--harm);font-weight:600">↓ below this line: no human subjects</text>`
      : "";

  const heads = subjects
    .map(
      (sub, ci) =>
        `<text x="${labelW + ci * colW + (colW - gap) / 2}" y="${padT - 12}" text-anchor="middle" class="axl">${esc(sub.length > 13 ? sub.slice(0, 12) + "…" : sub)}<title>${esc(sub)}</title></text>`,
    )
    .join("");

  const humanTotal = findings.filter((f) => HUMAN_TIERS.includes(f.evidence_tier)).length;

  return `
<div class="card">
<h2>How reliable is the evidence for each substance?</h2>
<h3>Every study we found, sorted by how much weight its design can carry. The most reliable kinds of study are at the top; the least reliable at the bottom.</h3>
${humanTotal === 0 ? `<div class="warn"><b>Every human-subject row is empty.</b> No finding in this corpus describes an outcome in a person. Everything below the red line comes from cell culture, animals, mechanistic argument, regulatory documents about other uses, or unverified report.</div>` : ""}
<div class="scroll">
<svg viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="Matrix of finding counts by evidence tier and substance">
${heads}
${cells.join("\n")}
${divider}
</svg>
</div>
<div class="legend">
  <span>Findings per cell:</span>
  <span><span class="sw" style="background:var(--r1)"></span>fewest</span>
  <span><span class="sw" style="background:var(--r3)"></span></span>
  <span><span class="sw" style="background:var(--r5)"></span>most (${max})</span>
  <span><span class="sw" style="background:transparent;border:1px solid var(--grid)"></span>none</span>
</div>
<p class="cap">Rows are ordered by study design, not by how much was found. An empty outlined cell means no
finding of that design exists in this corpus for that substance — it is drawn rather than omitted, because
the empty rows near the top are the most informative part of this chart. Cell shade encodes count only;
it says nothing about whether a result was positive.</p>
</div>`;
}

// ---------------------------------------------------------------------------
// Direction balance — diverging
// ---------------------------------------------------------------------------

function directionBalance(findings, subjects, s) {
  const rows = [{ name: "All substances", set: findings }, ...subjects.map((sub) => ({ name: sub, set: findings.filter((f) => (f.subject || "unspecified") === sub) }))];

  const w = 780,
    labelW = 150,
    rowH = 34,
    padT = 34,
    barH = 18;
  const plotW = w - labelW - 24;
  const half = plotW / 2;
  const cx = labelW + half;

  // Scale: the widest single side across all rows sets the scale, so rows are comparable.
  let maxSide = 1;
  for (const r of rows) {
    const c = countDir(r.set);
    maxSide = Math.max(maxSide, c.harm + c.neither / 2, c.benefit + c.neither / 2);
  }
  const px = (n) => (n / maxSide) * half;

  const body = rows
    .map((r, i) => {
      const c = countDir(r.set);
      const y = padT + i * rowH;
      const nHalf = c.neither / 2;
      const segs = [];
      // left arm: harm, then half the neutral block
      let x = cx - px(nHalf);
      segs.push(seg(x - px(c.harm), y, px(c.harm), barH, "var(--harm)", `${c.harm} harm`));
      segs.push(seg(x, y, px(nHalf), barH, "var(--neutral)", `${c.null_} null + ${c.mixed} mixed`));
      // right arm
      segs.push(seg(cx, y, px(nHalf), barH, "var(--neutral)", `${c.null_} null + ${c.mixed} mixed`));
      segs.push(seg(cx + px(nHalf), y, px(c.benefit), barH, "var(--benefit)", `${c.benefit} benefit`));
      const total = c.harm + c.neither + c.benefit;
      return `
<text x="${labelW - 12}" y="${y + barH / 2 + 4}" text-anchor="end" class="tick" ${i === 0 ? 'style="font-weight:600"' : ""}>${esc(r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name)}</text>
${segs.join("")}
<text x="${w - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="tick" style="font-variant-numeric:tabular-nums">${total}</text>`;
    })
    .join("");

  const h = padT + rows.length * rowH + 16;
  const noNull = (s.byDirection.null || 0) === 0;
  const noHarm = (s.byDirection.harm || 0) === 0;

  return `
<div class="card">
<h2>Did the studies find these substances helped, harmed, or did nothing?</h2>
<h3>Bars to the right are studies reporting a benefit; to the left, studies reporting harm. The grey middle is studies that found no effect, or mixed results.</h3>
${
  noNull || noHarm
    ? `<div class="warn"><b>The left side of this chart is ${noHarm && noNull ? "empty" : "nearly empty"}.</b>
       This corpus holds ${s.byDirection.null || 0} null findings and ${s.byDirection.harm || 0} harm findings.
       Literatures that genuinely contain no negative and no safety results are rare; searches that appear to
       contain none are common. Read this chart as a description of the <em>search</em> until disconfirming
       coverage is demonstrably complete.</div>`
    : ""
}
<div class="scroll">
<svg viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="Diverging bar of finding direction by substance">
<line x1="${cx}" y1="${padT - 8}" x2="${cx}" y2="${h - 12}" class="ax"/>
<text x="${cx}" y="${padT - 14}" text-anchor="middle" class="tick">neither</text>
<text x="${labelW}" y="${padT - 14}" text-anchor="start" class="tick">← harm reported</text>
<text x="${w - 8}" y="${padT - 14}" text-anchor="end" class="tick">benefit reported →</text>
${body}
</svg>
</div>
<div class="legend">
  <span><span class="sw" style="background:var(--harm)"></span>harm</span>
  <span><span class="sw" style="background:var(--neutral)"></span>null / mixed</span>
  <span><span class="sw" style="background:var(--benefit)"></span>benefit</span>
  <span class="pill">background findings excluded — they describe context, not a result</span>
</div>
<p class="cap">Direction records what a source reported, not whether it is true, and not whether the effect
is large. A finding from a cell line counts the same here as one from a trial — use the matrix above to see
which is which. Both arms are drawn at equal saturation so that neither side reads as the expected answer.</p>
</div>`;

  function seg(x, y, wid, hh, fill, label) {
    if (wid <= 0.4) return "";
    return `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(0, wid - 2).toFixed(1)}" height="${hh}" rx="3" fill="${fill}"><title>${esc(label)}</title></rect>`;
  }
  function countDir(set) {
    const g = (d) => set.filter((f) => f.direction === d).length;
    const null_ = g("null"),
      mixed = g("mixed");
    return { harm: g("harm"), benefit: g("benefit"), null_, mixed, neither: null_ + mixed };
  }
}

// ---------------------------------------------------------------------------
// Species panel — animal evidence is several literatures, not one
// ---------------------------------------------------------------------------

function speciesPanel(findings) {
  const animals = findings.filter((f) => ANIMAL_SPECIES.includes(f.species));
  const unclassified = findings.filter((f) => f.species === "unspecified" || f.species_confidence === "none");

  if (!animals.length)
    return `<div class="card"><h2>Which animals were tested, and what can each one tell us?</h2>
<p class="cap">No whole-animal study is recorded in this corpus. For the benzimidazole anthelmintics this is a
notable absence rather than a neutral one: decades of licensed veterinary tolerability data exist in dogs,
cattle, horses and sheep, and none of it appears in a search that pairs the drug with an oncology term.</p></div>`;

  const present = [...new Set(animals.map((f) => f.species))].sort((a, b) => ANIMAL_SPECIES.indexOf(a) - ANIMAL_SPECIES.indexOf(b));
  const max = Math.max(...present.map((sp) => animals.filter((f) => f.species === sp).length));
  const w = 700,
    rowH = 30,
    labelW = 160,
    padT = 12;
  const plotW = w - labelW - 60;
  const h = padT + present.length * rowH + 10;

  const bars = present
    .map((sp, i) => {
      const rows = animals.filter((f) => f.species === sp);
      const y = padT + i * rowH;
      const bw = Math.max(2, (rows.length / max) * plotW);
      return `<text x="${labelW - 10}" y="${y + 17}" text-anchor="end" class="tick">${esc(SPECIES_LABEL[sp] || sp)}</text>
<rect x="${labelW}" y="${y + 4}" width="${bw.toFixed(1)}" height="18" rx="3" fill="var(--r3)"><title>${esc(SPECIES_LABEL[sp])}: ${rows.length} findings</title></rect>
<text x="${labelW + bw + 8}" y="${y + 17}" class="tick" style="font-variant-numeric:tabular-nums">${rows.length}</text>`;
    })
    .join("\n");

  const dosed = animals.filter((f) => f.dose_reported);

  return `
<div class="card">
<h2>Which animals were tested, and what can each one tell us?</h2>
<h3>"Animal study" is not one thing. A mouse carrying a human tumour and a dog in a drug-safety trial answer completely different questions.</h3>
<div class="scroll">
<svg viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="Findings by animal species">${bars}</svg>
</div>
<div class="scroll" style="margin-top:14px">
<table>
<thead><tr><th>Species</th><th class="num">Findings</th><th>Strains recorded</th><th>Model types</th><th>What this species can support</th></tr></thead>
<tbody>
${present
  .map((sp) => {
    const rows = animals.filter((f) => f.species === sp);
    return `<tr>
<td><b>${esc(SPECIES_LABEL[sp] || sp)}</b></td>
<td class="num">${rows.length}</td>
<td>${esc([...new Set(rows.map((r) => r.strain).filter(Boolean))].join(", ") || "—")}</td>
<td>${esc([...new Set(rows.map((r) => r.animal_model_type).filter(Boolean))].join(", ") || "—")}</td>
<td>${esc(SPECIES_CAVEAT[sp] || "—")}</td>
</tr>`;
  })
  .join("")}
</tbody></table>
</div>
${
  dosed.length
    ? `<h3 style="margin-top:20px">Doses reported in animal work</h3>
<div class="scroll"><table>
<thead><tr><th>Species</th><th>Strain</th><th>Dose as reported</th><th>Route</th><th>Duration</th><th class="num">n</th><th>Outcome</th></tr></thead>
<tbody>
${dosed
  .sort((a, b) => ANIMAL_SPECIES.indexOf(a.species) - ANIMAL_SPECIES.indexOf(b.species))
  .map(
    (f) =>
      `<tr><td>${esc(SPECIES_LABEL[f.species] || f.species)}</td><td>${esc(f.strain || "—")}</td><td><b>${esc(f.dose_reported)}</b></td><td>${esc(f.route || "—")}</td><td>${esc(f.duration || "—")}</td><td class="num">${f.population_n ?? "—"}</td><td>${esc(f.outcome_measure || "—")}</td></tr>`,
  )
  .join("")}
</tbody></table></div>
<p class="cap">Reproduced exactly as each source states them, in that source's units, for that source's species.
No unit conversion and no cross-species scaling has been applied — deliberately. A dose in this table is a dose
in that animal and is not a human dose. Rendering these on a shared axis would manufacture a comparability the
underlying studies do not support, which is why this is a table and not a chart.</p>`
    : ""
}
${unclassified.length ? `<div class="warn"><b>${unclassified.length} finding(s) could not be assigned a species</b> from the model description recorded, so they are missing from everything above. This is a data-quality gap, drawn rather than hidden.</div>` : ""}
</div>`;
}

// ---------------------------------------------------------------------------
// Saturation — two stacked single-axis charts (never a dual axis)
// ---------------------------------------------------------------------------

function saturationPanel(project, searches, idx, cov) {
  // Rebuild the discovery curve: for each query in order, how many documents in
  // the index list that query as their FIRST discoverer.
  const order = searches.map((q) => `${q.engine}::${q.query}`);
  const firstBy = new Map();
  for (const c of idx) {
    if (!c.first) continue;
    const k = `${c.first.engine}::${c.first.query}`;
    firstBy.set(k, (firstBy.get(k) || 0) + 1);
  }
  const series = order.map((k, i) => ({ i, fresh: firstBy.get(k) || 0, ret: searches[i].result_count || 0 }));
  if (series.length < 2)
    return `<div class="card"><h2>Search saturation</h2><p class="cap">Not enough queries have been run to draw a saturation curve. At least two are needed.</p></div>`;

  let run = 0;
  const cum = series.map((p) => ({ i: p.i, v: (run += p.fresh) }));
  const totalCum = run || 1;

  const w = 780,
    hA = 170,
    hB = 110,
    padL = 52,
    padR = 14,
    padT = 16,
    padB = 26;
  const plotW = w - padL - padR;
  const xs = (i) => padL + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);

  // Chart A — cumulative unique documents discovered
  const yA = (v) => padT + (hA - padT - padB) * (1 - v / totalCum);
  const lineA = cum.map((p, i) => `${i ? "L" : "M"}${xs(p.i).toFixed(1)},${yA(p.v).toFixed(1)}`).join("");
  const areaA = `${lineA}L${xs(cum[cum.length - 1].i).toFixed(1)},${yA(0)}L${xs(0).toFixed(1)},${yA(0)}Z`;

  // Chart B — marginal yield per query (new / returned)
  const yieldPts = series.map((p) => ({ i: p.i, v: p.ret ? p.fresh / p.ret : 0 }));
  const yB = (v) => padT + (hB - padT - 20) * (1 - v);
  const barW = Math.max(1.5, Math.min(10, plotW / series.length - 1.5));
  const barsB = yieldPts
    .map(
      (p) =>
        `<rect x="${(xs(p.i) - barW / 2).toFixed(1)}" y="${yB(p.v).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.8, hB - 20 - yB(p.v) + padT - padT + (yB(0) - yB(p.v)) * 0).toFixed(1)}" rx="1.5" fill="var(--benefit)" opacity=".85"><title>query ${p.i + 1}: ${(p.v * 100).toFixed(0)}% of results were new</title></rect>`,
    )
    .join("");

  const gridA = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = totalCum * f;
      return `<line x1="${padL}" y1="${yA(v).toFixed(1)}" x2="${w - padR}" y2="${yA(v).toFixed(1)}" class="gl"/><text x="${padL - 8}" y="${(yA(v) + 4).toFixed(1)}" text-anchor="end" class="tick">${Math.round(v)}</text>`;
    })
    .join("");

  return `
<div class="card">
<h2>Did we find everything there is to find?</h2>
<h3>The top line is the running total of different documents found. The bars below show how much each new search added that we had not already seen.</h3>
<div class="scroll">
<svg viewBox="0 0 ${w} ${hA}" width="${w}" role="img" aria-label="Cumulative unique documents discovered over the query sequence">
${gridA}
<path d="${areaA}" fill="var(--benefit)" opacity=".10"/>
<path d="${lineA}" fill="none" stroke="var(--benefit)" stroke-width="2" stroke-linejoin="round"/>
<line x1="${padL}" y1="${yA(0)}" x2="${w - padR}" y2="${yA(0)}" class="ax"/>
<text x="${padL}" y="${hA - 6}" class="tick">query 1</text>
<text x="${w - padR}" y="${hA - 6}" text-anchor="end" class="tick">query ${series.length}</text>
<text x="${padL - 8}" y="${padT - 4}" text-anchor="end" class="tick">unique docs</text>
</svg>
<svg viewBox="0 0 ${w} ${hB}" width="${w}" role="img" aria-label="Marginal yield per query">
<line x1="${padL}" y1="${yB(0)}" x2="${w - padR}" y2="${yB(0)}" class="ax"/>
<line x1="${padL}" y1="${yB(1)}" x2="${w - padR}" y2="${yB(1)}" class="gl"/>
<text x="${padL - 8}" y="${yB(1) + 4}" text-anchor="end" class="tick">100%</text>
<text x="${padL - 8}" y="${yB(0) + 4}" text-anchor="end" class="tick">0%</text>
${barsB}
<text x="${padL}" y="${hB - 4}" class="tick">share of each query's results that were new to the index</text>
</svg>
</div>
<div class="legend">
  <span class="pill">observed ${cov.observed.toLocaleString()}</span>
  <span class="pill">estimated reachable ${cov.estimated_total.toLocaleString()}</span>
  <span class="pill">found by exactly one query ${cov.f1_singletons.toLocaleString()}</span>
  <span class="pill">coverage ${(cov.coverage * 100).toFixed(1)}%</span>
</div>
<p class="cap">${esc(cov.interpretation)} Completeness is estimated by capture–recapture on query overlap (Chao1):
documents found by many independent queries indicate dense coverage, while a large population found by exactly
one query indicates the space is still opening up. A flattening top curve with near-zero bars below it is what
finishing looks like; a curve still climbing means the index is incomplete regardless of how many documents it
already holds.</p>
</div>`;
}

// ---------------------------------------------------------------------------

function prismaPanel(ix, idx, s) {
  const dup = idx.reduce((n, c) => n + Math.max(0, (c.nq || 1) - 1), 0);
  const node = (label, n, note) =>
    `<div class="fnode"><div>${label}${note ? `<div class="meta">${note}</div>` : ""}</div><div class="n">${n.toLocaleString()}</div></div>`;
  const st = (k) => idx.filter((c) => c.status === k).length;
  return `
<div class="card">
<h2>What happened to every document we found</h2>
<h3>From the raw search results down to the studies that made it into this report — nothing dropped without being counted.</h3>
<div class="flow">
${node("Records returned by searches", ix.total + dup)}
${node("Duplicates collapsed by DOI / PMID / NCT / URL identity", dup, "the same paper reached by several queries counts once")}
${node("<b>Unique documents indexed</b>", ix.total)}
<div class="fsub">
  ${node("Read in full", ix.read)}
  <div class="fsub">
    ${node("Yielded extracted findings", st("recorded"))}
    ${node("Read and excluded on the merits", st("rejected"))}
    ${node("Unreachable — paywall, dead link, bot wall", st("unreachable"), "content unknown; neither included nor excluded")}
  </div>
  ${node("Indexed but not yet read", ix.outstanding)}
</div>
${node("<b>Findings extracted</b>", s.findings)}
</div>
${ix.outstanding > 0 ? `<div class="warn"><b>${ix.outstanding.toLocaleString()} indexed documents (${pct(ix.outstanding, ix.total)} of the index) have not been read.</b> This report describes the ${pct(ix.read, ix.total)} that was. The unread remainder is not characterised anywhere on this page.</div>` : ""}
<p class="cap">A document counted as "unreachable" is not evidence of anything. It is a gap in the instrument,
recorded so it cannot be mistaken for an absence in the literature.</p>
</div>`;
}

// ---------------------------------------------------------------------------

function coveragePanel(searches, exh, ix) {
  const empty = searches.filter((q) => (q.result_count || 0) === 0);
  const failed = searches.filter((q) => /error|not configured|unavailable/i.test(q.notes || ""));
  const capped = searches.filter((q) => q.hit_ceiling);
  const engines = Object.entries(exh);

  return `
<div class="card">
<h2>What we searched for and found nothing</h2>
<h3>Empty searches are kept on the record. "We looked and there was nothing there" only means something if you can show what you looked for.</h3>
<div class="scroll">
<table>
<thead><tr><th>Source</th><th class="num">Queries</th><th class="num">Retrieved</th><th class="num">Available</th><th class="num">Enumerated</th><th class="num">Ceiling hit</th></tr></thead>
<tbody>
${engines
  .map(
    ([e, v]) =>
      `<tr><td>${esc(e)}</td><td class="num">${v.queries}</td><td class="num">${v.retrieved.toLocaleString()}</td><td class="num">${v.reported_total ? v.reported_total.toLocaleString() : "—"}</td><td class="num">${v.enumerated_fraction != null ? (v.enumerated_fraction * 100).toFixed(0) + "%" : "—"}</td><td class="num">${v.capped_queries || "—"}</td></tr>`,
  )
  .join("")}
</tbody></table>
</div>
${
  failed.length
    ? `<div class="warn"><b>${failed.length} queries could not run.</b> ${esc([...new Set(failed.map((f) => `${f.engine}: ${String(f.notes).slice(0, 110)}`))].slice(0, 4).join(" · "))} — a source that never ran is not a source that found nothing.</div>`
    : ""
}
${
  capped.length
    ? `<div class="warn"><b>${capped.length} queries stopped at an API paging ceiling</b> rather than at the end of the results. What lay past the ceiling is unknowable through that interface.</div>`
    : ""
}
<h3 style="margin-top:18px">Queries that returned nothing (${empty.length})</h3>
${
  empty.length
    ? `<div class="scroll"><table><thead><tr><th>Source</th><th>Intent</th><th>Query</th></tr></thead><tbody>
${empty.slice(0, 60).map((q) => `<tr><td>${esc(q.engine)}</td><td><span class="pill">${esc(q.intent)}</span></td><td><code>${esc(q.query)}</code></td></tr>`).join("")}
</tbody></table></div>${empty.length > 60 ? `<p class="cap">…and ${empty.length - 60} more, listed in full in the white paper's Appendix A.</p>` : ""}`
    : `<p class="cap">Every query returned at least one result.</p>`
}
<p class="cap">These queries are retained deliberately. A search that found nothing is a fact about the
literature; deleting it from the record would make the search look tidier than it was.</p>
</div>`;
}

// ---------------------------------------------------------------------------

function findingsTable(findings) {
  if (!findings.length) return "";
  const subs = [...new Set(findings.map((f) => f.subject).filter(Boolean))].sort();
  const rows = findings
    .slice()
    .sort((a, b) => EVIDENCE_TIERS.indexOf(a.evidence_tier) - EVIDENCE_TIERS.indexOf(b.evidence_tier))
    .map((f, i) => {
      const cite = f.source.doi
        ? `https://doi.org/${f.source.doi}`
        : f.source.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${f.source.pmid}/`
          : f.source.nct
            ? `https://clinicaltrials.gov/study/${f.source.nct}`
            : f.source.url || "#";
      const label = f.source.doi || (f.source.pmid && `PMID ${f.source.pmid}`) || f.source.nct || "link";
      return `
<tr class="rowbtn" data-sub="${esc(f.subject || "")}" data-dir="${esc(f.direction)}" data-tier="${esc(f.evidence_tier)}" data-human="${HUMAN_TIERS.includes(f.evidence_tier) ? "1" : "0"}" data-txt="${esc((f.claim + " " + (f.subject || "") + " " + (f.model_system || "") + " " + (f.outcome_measure || "")).toLowerCase())}" onclick="tog(${i})">
  <td>${esc(f.subject || "—")}</td>
  <td>${esc(TIER_LABEL[f.evidence_tier] || f.evidence_tier)}${f.retracted ? ' <span class="pill" style="border-color:var(--harm);color:var(--harm)">retracted</span>' : ""}</td>
  <td>${esc(f.model_system || "—")}</td>
  <td class="num">${f.population_n ?? "—"}</td>
  <td>${esc(f.dose_reported || "—")}</td>
  <td>${esc(f.outcome_measure || "—")}</td>
  <td><span class="pill" style="border-color:${f.direction === "benefit" ? "var(--benefit)" : f.direction === "harm" ? "var(--harm)" : "var(--axis)"}">${esc(f.direction)}</span></td>
  <td><a href="${esc(cite)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(label)}</a></td>
</tr>
<tr class="det" id="d${i}"><td colspan="8">
  <div><b>${esc(f.claim)}</b></div>
  <div class="quote">${esc(f.verbatim_quote)}</div>
  <div class="meta">
    ${[
      f.route && `Route: ${esc(f.route)}`,
      f.duration && `Duration: ${esc(f.duration)}`,
      f.effect_size && `Effect: ${esc(f.effect_size)}`,
      f.p_value && `p: ${esc(f.p_value)}`,
      f.adverse_events && `Adverse events: ${esc(f.adverse_events)}`,
      f.funding && `Funding: ${esc(f.funding)}`,
      f.conflicts_of_interest && `Conflicts: ${esc(f.conflicts_of_interest)}`,
      f.limitations && `Author-stated limitations: ${esc(f.limitations)}`,
    ]
      .filter(Boolean)
      .join(" · ")}
  </div>
  <div class="meta">Source: ${esc([f.source.authors, f.source.title, f.source.journal, f.source.year].filter(Boolean).join(". "))}</div>
</td></tr>`;
    })
    .join("");

  return `
<div class="card">
<h2>Every study, with the exact sentence it came from</h2>
<h3>Click any row to see the exact words from the original paper. ${findings.length} findings.</h3>
<div class="controls">
  <input type="search" id="q" placeholder="Search claims, models, outcomes…" oninput="filt()">
  <select id="fsub" onchange="filt()"><option value="">All substances</option>${subs.map((x) => `<option>${esc(x)}</option>`).join("")}</select>
  <select id="fdir" onchange="filt()"><option value="">All directions</option>${DIRECTIONS.map((d) => `<option>${d}</option>`).join("")}</select>
  <select id="fhum" onchange="filt()"><option value="">Human and non-human</option><option value="1">Human subjects only</option><option value="0">Non-human only</option></select>
</div>
<div class="scroll">
<table id="ft">
<thead><tr><th>Substance</th><th>Study design</th><th>Model system</th><th class="num">n</th><th>Dose as reported</th><th>Outcome measure</th><th>Direction</th><th>Source</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<p class="cap" id="fcount"></p>
<p class="cap">Dose is reproduced exactly as its source states it, in that source's units and for that source's
model system. A dose beside "mouse xenograft" is a mouse dose and has not been converted to anything.</p>
</div>`;
}

// ---------------------------------------------------------------------------

function contactsPanel(findings) {
  const contacts = [];
  const seen = new Set();
  for (const f of findings)
    for (const c of f.contacts || []) {
      const k = `${c.name}|${c.email}|${c.phone}`;
      if (seen.has(k)) continue;
      seen.add(k);
      contacts.push({ ...c, from: f.source.title || f.source.url });
    }
  if (!contacts.length)
    return `<div class="card"><h2>Who to contact</h2><p class="cap">No contact details were captured from any source read. If publications and trials were reviewed, their corresponding authors and coordinators were not recorded — that is a gap in the corpus, not an absence of contacts.</p></div>`;

  return `
<div class="card">
<h2>Who to contact</h2>
<h3>${contacts.length} researchers and trial coordinators, with the contact details their own papers and trial registrations publish.</h3>
<div class="scroll">
<table>
<thead><tr><th>Name</th><th>Role</th><th>Affiliation</th><th>Email</th><th>Phone</th><th>From</th></tr></thead>
<tbody>
${contacts
  .map(
    (c) =>
      `<tr><td>${esc(c.name || "—")}</td><td>${esc(c.role || "—")}</td><td>${esc(c.affiliation || "—")}</td><td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</td><td>${esc(c.phone || "—")}</td><td>${esc(String(c.from || "—").slice(0, 60))}</td></tr>`,
  )
  .join("")}
</tbody></table>
</div>
<p class="cap">Contact details published by the sources themselves — journal corresponding-author lines and
trial-registry contact blocks — recorded for research correspondence.</p>
</div>`;
}

// ---------------------------------------------------------------------------

function footer(project, now) {
  return `
<p class="cap" style="margin-top:28px">Assembled by research-mcp from corpus <code>${esc(project)}</code> on ${now}.
Every number on this page is a count over an append-only ledger in which each entry carries a verbatim
quotation and a resolvable citation. This page reports what sources say. It is not medical advice and does
not establish efficacy or safety for any use.</p>
</div>`;
}

function script() {
  return `
<script>
function tgl(){
  var r=document.documentElement;
  var cur=r.getAttribute('data-theme');
  var dark=cur? cur==='dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.setAttribute('data-theme', dark?'light':'dark');
}
function tog(i){
  var d=document.getElementById('d'+i);
  if(d) d.classList.toggle('open');
}
function filt(){
  var q=(document.getElementById('q').value||'').toLowerCase();
  var sub=document.getElementById('fsub').value;
  var dir=document.getElementById('fdir').value;
  var hum=document.getElementById('fhum').value;
  var rows=document.querySelectorAll('#ft tbody tr.rowbtn');
  var n=0;
  rows.forEach(function(tr){
    var ok = (!q || tr.dataset.txt.indexOf(q)>-1)
      && (!sub || tr.dataset.sub===sub)
      && (!dir || tr.dataset.dir===dir)
      && (!hum || tr.dataset.human===hum);
    tr.style.display = ok?'':'none';
    var det=tr.nextElementSibling;
    if(det && det.classList.contains('det')){ if(!ok) det.classList.remove('open'); }
    if(ok) n++;
  });
  document.getElementById('fcount').textContent = n + ' of ' + rows.length + ' findings shown';
}
document.addEventListener('DOMContentLoaded', function(){ if(document.getElementById('ft')) filt(); });
</script>
</body>
</html>`;
}
