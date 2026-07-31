const { pubmedSearch } = await import("./fetchers.mjs");
const r = await pubmedSearch("ivermectin pancreatic cancer", { limit: 3 });
const rec = r.records.find(x => x.abstract);
console.log("document:", rec.title.slice(0,70));
const mod = await import("./runner.mjs").catch(()=>null);
// re-implement the two helpers inline so we test the real prompt + parser
const { spawn } = await import("node:child_process");
const SCHEMA = `{"findings":[{"claim":"IN ENGLISH, neutral","verbatim_quote":"word-for-word, >=20 chars","direction":"benefit|harm|null|mixed|background","evidence_tier":"in_vitro|animal_in_vivo|rct|case_report|narrative_review|regulatory_document|...","subject":"substance","indication":"what was ACTUALLY studied","model_system":"exact","species":"human|mouse|cell_line|...","population_n":0,"dose_reported":"exactly as written","outcome_measure":"","adverse_events":"","limitations":""}],"no_findings_reason":""}`;
const prompt = `You are an evidence-extraction function. Return ONLY JSON matching the schema. No prose, no markdown fence.
RULES: every finding needs a verbatim_quote copied word-for-word. claim always English. Never use framing words. Set indication to what was ACTUALLY studied. dose_reported copied exactly. Max 3 findings.
SCHEMA: ${SCHEMA}
DOCUMENT: ${rec.title}\n\n${rec.abstract}`;
const t0=Date.now();
const out = await new Promise((res)=>{
  const p=spawn("/Users/macdaddyjoe/.local/bin/claude",["-p","--output-format","text"],{stdio:["pipe","pipe","pipe"]});
  let o="",e="";
  const to=setTimeout(()=>{p.kill("SIGKILL");res({err:"timeout"})},240000);
  p.stdout.on("data",d=>o+=d); p.stderr.on("data",d=>e+=d);
  p.on("close",c=>{clearTimeout(to);res({o,e,c})});
  p.stdin.write(prompt); p.stdin.end();
});
console.log("claude -p exit:",out.c,"in",((Date.now()-t0)/1000).toFixed(0),"s");
if(out.err){console.log("ERR",out.err);process.exit(1)}
const m=(out.o||"").match(/\{[\s\S]*\}/);
if(!m){console.log("NO JSON. stdout:",(out.o||"").slice(0,300),"stderr:",(out.e||"").slice(0,300));process.exit(1)}
const parsed=JSON.parse(m[0]);
console.log("parsed findings:",parsed.findings?.length ?? 0);
for(const f of (parsed.findings||[]).slice(0,2)){
  console.log("  ---");
  console.log("   claim:  ",(f.claim||"").slice(0,95));
  console.log("   quote:  ",(f.verbatim_quote||"").slice(0,95));
  console.log("   verbatim in source?",rec.abstract.includes((f.verbatim_quote||"").slice(0,40))?"YES":"NO ⚠");
  console.log("   dir/tier/species:",f.direction,"/",f.evidence_tier,"/",f.species,"| indication:",f.indication);
}
