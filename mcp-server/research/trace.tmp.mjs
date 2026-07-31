process.env.RESEARCH_CORPUS_DIR="/tmp/rt5"; process.env.RESEARCH_PROJECT="rt5"; process.env.RESEARCH_DEPTH="quick";
const t=(m)=>console.log(`[${Date.now()%100000}] ${m}`);
t("importing driver");
const d=await import("./driver.mjs");
t("importing index-layer");
const il=await import("./index-layer.mjs");
t("initRun");
d.initRun("rt5",{question:"q",depth:"quick"});
t("nextAction");
const a=d.nextAction("rt5");
t(`state=${a.state}`);
t("expandQueryMatrix");
const cfg=d.getRunConfig("rt5");
const matrix=il.expandQueryMatrix({depth:cfg.depth,substances:cfg.substances});
t(`matrix=${matrix.query_count}`);
const c=await import("./corpus.mjs");
t("getSearches");
const searches=c.getSearches("rt5");
t(`searches=${searches.length}`);
const okPairs=new Set(searches.filter(q=>!/^ERROR/.test(q.notes||"")).map(q=>`${q.engine}::${q.query}`));
const SOURCES=["pubmed","europepmc","clinicaltrials","openalex","web"];
const pending=matrix.queries.filter(q=>SOURCES.some(s=>!okPairs.has(`${s}::${q.query}`)));
t(`pending=${pending.length}`);
t(`first query: ${pending[0].query}`);
for (const src of SOURCES){
  t(`  calling ${src}…`);
  try{ const r=await il.ENUMERATORS[src](pending[0].query,{max:400}); t(`  ${src} → ${r.retrieved}`);}
  catch(e){ t(`  ${src} ERROR ${e.message}`);}
}
t("DONE");
