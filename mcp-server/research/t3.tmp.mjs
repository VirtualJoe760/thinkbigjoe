process.env.RESEARCH_CORPUS_DIR="/tmp/rt7";
const il=await import("./index-layer.mjs");
const q="ivermectin pancreatic cancer";
for (const src of ["pubmed","europepmc","clinicaltrials","openalex","web"]) {
  const t=Date.now();
  const race = await Promise.race([
    il.ENUMERATORS[src](q,{max:400}).then(r=>`${r.retrieved} records`).catch(e=>`ERROR ${e.message}`),
    new Promise(r=>setTimeout(()=>r("*** TIMED OUT >90s ***"),90000)),
  ]);
  console.log(`  ${src.padEnd(15)} ${((Date.now()-t)/1000).toFixed(1)}s  ${race}`);
}
