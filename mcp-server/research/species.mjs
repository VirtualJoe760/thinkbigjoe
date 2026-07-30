/**
 * species.mjs — the species taxonomy.
 *
 * Animal evidence is not one bucket. For these substances especially it is
 * several distinct literatures that answer different questions, and collapsing
 * them into "animal studies" throws away most of what they are worth:
 *
 *   - Rodent tumour models answer "does it shrink a tumour", usually in an
 *     immunodeficient mouse carrying a human cell line — a model whose
 *     relationship to a person is itself contested.
 *   - The Syrian golden hamster is the classic chemically-induced pancreatic
 *     cancer model and is a different kind of evidence from a xenograft.
 *   - Dog, cattle, horse and sheep carry decades of VETERINARY SAFETY data for
 *     the benzimidazoles, because that is what these drugs were licensed for.
 *     That literature answers "what dose is tolerated, for how long, with what
 *     organ toxicity" better than anything in the oncology literature — and it
 *     is routinely missed by searches that only look for cancer papers.
 *   - Non-human primate data, where it exists, is the closest pharmacokinetic
 *     bridge to humans.
 *   - Zebrafish and chick-embryo (CAM) assays are screening tools, not efficacy
 *     evidence, and should never be reported in the same breath as a mammal.
 *
 * So `species` is a first-class, normalised field, and every animal finding
 * carries it. Free text stays in `model_system` — the normalised value is for
 * grouping and the free text is for truth.
 */

export const SPECIES = [
  "human",
  "mouse",
  "rat",
  "hamster",
  "guinea_pig",
  "rabbit",
  "dog",
  "cat",
  "pig",
  "sheep",
  "goat",
  "cattle",
  "horse",
  "non_human_primate",
  "ferret",
  "zebrafish",
  "chicken_embryo",
  "drosophila",
  "c_elegans",
  "other_animal",
  "cell_line", // in vitro — no organism
  "cell_free", // biochemical assay
  "in_silico",
  "not_applicable",
  "unspecified",
];

/** Which of the above are whole living animals (excluding humans). */
export const ANIMAL_SPECIES = [
  "mouse", "rat", "hamster", "guinea_pig", "rabbit", "dog", "cat", "pig",
  "sheep", "goat", "cattle", "horse", "non_human_primate", "ferret",
  "zebrafish", "chicken_embryo", "drosophila", "c_elegans", "other_animal",
];

/** Mammals whose pharmacology bridges most usefully toward humans. */
export const MAMMAL_SPECIES = [
  "mouse", "rat", "hamster", "guinea_pig", "rabbit", "dog", "cat", "pig",
  "sheep", "goat", "cattle", "horse", "non_human_primate", "ferret",
];

export const SPECIES_LABEL = {
  human: "Human",
  mouse: "Mouse",
  rat: "Rat",
  hamster: "Hamster",
  guinea_pig: "Guinea pig",
  rabbit: "Rabbit",
  dog: "Dog",
  cat: "Cat",
  pig: "Pig",
  sheep: "Sheep",
  goat: "Goat",
  cattle: "Cattle",
  horse: "Horse",
  non_human_primate: "Non-human primate",
  ferret: "Ferret",
  zebrafish: "Zebrafish",
  chicken_embryo: "Chick embryo (CAM)",
  drosophila: "Drosophila",
  c_elegans: "C. elegans",
  other_animal: "Other animal",
  cell_line: "Cell line (in vitro)",
  cell_free: "Cell-free assay",
  in_silico: "Computational",
  not_applicable: "Not applicable",
  unspecified: "Unspecified",
};

/**
 * Patterns → species. Ordered: the first match wins, so specific strain names
 * are listed before the generic terms they contain.
 */
const PATTERNS = [
  [/\b(nsg|nod[- ]?scid|athymic|nude mice|nude mouse|balb\/?c|c57bl|cd-?1 mice|swiss webster|kpc mouse|kpc mice|nu\/nu|scid mice|129s|fvb)\b/i, "mouse"],
  [/\b(mouse|mice|murine|xenograft in mice|orthotopic mouse)\b/i, "mouse"],
  [/\b(sprague[- ]?dawley|wistar|fischer 344|f344|lewis rat)\b/i, "rat"],
  [/\b(rat|rats|rattus)\b/i, "rat"],
  [/\b(syrian golden hamster|golden hamster|hamster|mesocricetus)\b/i, "hamster"],
  [/\b(guinea[- ]?pig|cavia)\b/i, "guinea_pig"],
  [/\b(rabbit|oryctolagus|new zealand white)\b/i, "rabbit"],
  [/\b(dog|dogs|canine|beagle|canis)\b/i, "dog"],
  [/\b(cat|cats|feline|felis)\b/i, "cat"],
  [/\b(pig|pigs|swine|porcine|sus scrofa|minipig)\b/i, "pig"],
  [/\b(sheep|ovine|lamb|ewe|ovis)\b/i, "sheep"],
  [/\b(goat|caprine|capra)\b/i, "goat"],
  [/\b(cattle|bovine|calf|calves|cow|cows|steer|heifer|bos taurus)\b/i, "cattle"],
  [/\b(horse|equine|foal|pony|equus)\b/i, "horse"],
  [/\b(macaque|cynomolgus|rhesus|marmoset|baboon|non[- ]?human primate|primate|macaca)\b/i, "non_human_primate"],
  [/\b(ferret|mustela)\b/i, "ferret"],
  [/\b(zebrafish|danio)\b/i, "zebrafish"],
  [/\b(chick embryo|chicken embryo|cam assay|chorioallantoic)\b/i, "chicken_embryo"],
  [/\b(drosophila|fruit fly)\b/i, "drosophila"],
  [/\b(c\.? ?elegans|caenorhabditis|nematode)\b/i, "c_elegans"],
  [/\b(patient|patients|human subject|volunteer|man|men|women|clinical trial participants|human)\b/i, "human"],
  // Cell lines last — a "PANC-1 xenograft in nude mice" is a MOUSE study, and
  // the mouse patterns above must win over the cell-line name in the string.
  [/\b(panc-?1|miapaca|bxpc-?3|capan|aspc-?1|su\.?86\.?86|hpaf|cfpac|sw1990|hek ?293|hela|cell line|cells in culture|in vitro|monolayer|spheroid|organoid)\b/i, "cell_line"],
  [/\b(cell[- ]free|enzyme assay|biochemical assay|purified tubulin|binding assay)\b/i, "cell_free"],
  [/\b(in silico|molecular docking|computational|simulation|qsar)\b/i, "in_silico"],
];

/**
 * Best-effort normalisation of a free-text model description to a species.
 * Returns { species, confidence, matched } — never guesses silently: an
 * unrecognised string comes back "unspecified" so it shows up as a gap rather
 * than being quietly filed as a mouse.
 */
export function normaliseSpecies(modelSystem, evidenceTier) {
  const txt = String(modelSystem || "").trim();

  if (!txt) {
    // Fall back on the tier only where the tier is unambiguous about organism.
    if (evidenceTier === "in_vitro") return { species: "cell_line", confidence: "inferred", matched: "evidence_tier=in_vitro" };
    if (["rct", "meta_analysis", "cohort", "case_report", "case_series", "case_control", "controlled_trial_nonrandomized"].includes(evidenceTier))
      return { species: "human", confidence: "inferred", matched: `evidence_tier=${evidenceTier}` };
    return { species: "unspecified", confidence: "none", matched: null };
  }

  for (const [re, sp] of PATTERNS) {
    const m = txt.match(re);
    if (m) return { species: sp, confidence: "matched", matched: m[0] };
  }

  if (evidenceTier === "animal_in_vivo") return { species: "other_animal", confidence: "inferred", matched: "evidence_tier=animal_in_vivo" };
  if (evidenceTier === "in_vitro") return { species: "cell_line", confidence: "inferred", matched: "evidence_tier=in_vitro" };
  return { species: "unspecified", confidence: "none", matched: null };
}

export const isAnimal = (sp) => ANIMAL_SPECIES.includes(sp);
export const isMammal = (sp) => MAMMAL_SPECIES.includes(sp);

/**
 * What a species result can and cannot support. Rendered verbatim into reports
 * so that a species is never presented as a bare label — the reader is told what
 * kind of inference it licenses at the point of reading it.
 */
export const SPECIES_CAVEAT = {
  mouse: "Most mouse tumour work uses immunodeficient animals carrying human cell lines. The immune system — a major determinant of response in people — is absent by design.",
  rat: "Rat data is most often toxicology and pharmacokinetics rather than tumour efficacy.",
  hamster: "The Syrian golden hamster is the classic chemically-induced pancreatic model; it develops disease differently from an implanted xenograft.",
  dog: "Canine data for the benzimidazoles is largely licensed veterinary safety and pharmacokinetic data — strong for tolerability, silent on human tumour response.",
  cattle: "Bovine data is veterinary anthelmintic licensing data: long-duration tolerability at defined doses, no oncology relevance.",
  horse: "Equine data is veterinary anthelmintic licensing data.",
  sheep: "Ovine data is veterinary anthelmintic licensing data.",
  pig: "Porcine physiology is a reasonable pharmacokinetic bridge to humans; oncology relevance is usually indirect.",
  non_human_primate: "The closest available pharmacokinetic bridge to humans, and correspondingly rare.",
  zebrafish: "A screening model. Useful for triage and toxicity signals, not for efficacy claims.",
  chicken_embryo: "The CAM assay is a vascularisation/screening model, not a tumour-response model.",
  drosophila: "A genetic screening organism; no pharmacokinetic bearing on mammals.",
  c_elegans: "A screening organism, and the original target organism for anthelmintic activity — relevant to mechanism of the parasite kill, not to tumour biology.",
  cell_line: "Cells in a dish. Concentration in a well is not a dose in a body, and the concentration that acts in vitro is frequently unachievable in human plasma at tolerated doses.",
  cell_free: "A biochemical assay with no cell, no organism, and no pharmacokinetics.",
  in_silico: "A computational prediction. No biological observation was made.",
  human: "Human data. Note the tier — a case report and a randomised trial are both human and are not comparable.",
};

/** Species terms for the query matrix — the axis that finds veterinary data. */
export const SPECIES_QUERY_TERMS = [
  "mouse xenograft",
  "orthotopic mouse model",
  "KPC mouse model",
  "nude mice tumor",
  "rat toxicity study",
  "Syrian golden hamster pancreatic",
  "dog canine pharmacokinetics",
  "canine safety tolerability",
  "cattle bovine anthelmintic residue",
  "sheep ovine anthelmintic",
  "horse equine anthelmintic safety",
  "swine porcine pharmacokinetics",
  "non-human primate pharmacokinetics",
  "zebrafish screen",
  "chick chorioallantoic membrane assay",
  "veterinary maximum tolerated dose",
  "target animal safety study",
];
