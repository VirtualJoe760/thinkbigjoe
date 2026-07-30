/**
 * indication.mjs — how on-topic is this finding, really?
 *
 * THE PROBLEM. Searching "fenbendazole cancer" returns a great deal of work
 * about colorectal, lung and breast cancer, plus a lot of parasitology. All of
 * it is genuinely about the substance, none of it is about pancreatic cancer,
 * and a report that mixes them silently overstates how much is known about the
 * actual question. The distance between "there are 300 papers on this drug and
 * cancer" and "there are four on this drug and pancreatic cancer" is the whole
 * ballgame, and it has to be visible on the front page, not derivable by a
 * careful reader.
 *
 * So relevance to the target condition is a first-class field with four levels,
 * classified from the indication string and the claim text, and every report
 * leads with the breakdown.
 *
 * The levels are about SUBJECT MATTER, not quality. An excellent colorectal
 * trial is `other_cancer`; that is not a criticism of the trial, it is a
 * statement about what question it answers.
 */

export const RELEVANCE_LEVELS = [
  "target", // the target condition itself — e.g. pancreatic adenocarcinoma
  "adjacent", // a near neighbour that is NOT the same disease (pancreatic NET)
  "other_cancer", // a different cancer entirely
  "non_cancer", // parasitology, toxicology, veterinary licensing, other indications
  "unclear",
];

export const RELEVANCE_LABEL = {
  target: "The target condition",
  adjacent: "Adjacent but a different disease",
  other_cancer: "A different cancer",
  non_cancer: "Not cancer (parasitology, toxicology, veterinary, other use)",
  unclear: "Could not be determined",
};

export const RELEVANCE_NOTE = {
  target: "Directly about the condition under study.",
  adjacent:
    "A different disease with different biology that is easily conflated with the target. Pancreatic neuroendocrine tumours are not pancreatic adenocarcinoma; results do not transfer between them.",
  other_cancer:
    "About the substance in a different cancer. It may inform mechanism, but it is not evidence about the target condition, and counting it as if it were is the most common way a repurposing case is overstated.",
  non_cancer:
    "About the substance outside oncology — parasitology, toxicology, or licensed veterinary use. This is often where the best dose-tolerability data lives, and it is never efficacy evidence.",
  unclear: "The recorded indication and claim did not contain enough to classify. Treated as a data-quality gap, not as relevant.",
};

/**
 * Condition profiles. `target` is the disease under study; `adjacent` are the
 * near-misses that must be separated from it rather than absorbed into it.
 */
export const CONDITION_PROFILES = {
  pancreatic_adenocarcinoma: {
    label: "Pancreatic ductal adenocarcinoma",
    target: [
      /pancrea\w*\s+(ductal\s+)?adenocarcinoma/i,
      /\bPDAC\b/,
      /pancrea\w*\s+cancer/i,
      /pancrea\w*\s+carcinoma/i,
      /pancrea\w*\s+(tumou?r|neoplas|malignan)/i,
      /cancer of the pancreas/i,
      /exocrine pancrea/i,
      /рак поджелудочной железы/i, // Russian
      /胰腺癌|胰腺导管腺癌/, // Chinese
      /cáncer de páncreas|adenocarcinoma de páncreas/i, // Spanish
      /膵臓がん|膵癌/, // Japanese
    ],
    adjacent: [
      /pancrea\w*\s+neuroendocrine/i,
      /\bpNET\b/,
      /insulinoma/i,
      /islet cell (carcinoma|tumou?r)/i,
      /pancreatitis/i,
      /intraductal papillary mucinous/i,
      /\bIPMN\b/,
    ],
  },
};

const CANCER_RE =
  /\b(cancer|carcinoma|adenocarcinoma|tumou?r|neoplas\w*|malignan\w*|oncolog\w*|metasta\w*|leukaemi\w*|leukemi\w*|lymphoma|sarcoma|melanoma|glioma|glioblastoma|myeloma|mesothelioma|chemotherap\w*)\b/i;

/**
 * Classify a finding's relevance to the target condition.
 *
 * Order matters: target beats adjacent beats other-cancer beats non-cancer. A
 * paper about a pancreatic model that also mentions colon lines is a target
 * paper; the reverse is not true, which is why the target patterns are tested
 * against the indication field first and the free text second.
 */
export function classifyRelevance(finding, conditionKey = "pancreatic_adenocarcinoma") {
  const profile = CONDITION_PROFILES[conditionKey];
  if (!profile) return { relevance: "unclear", matched: null, reason: `no profile for '${conditionKey}'` };

  const indication = String(finding.indication || "");
  const body = [finding.claim, finding.verbatim_quote, finding.model_system, finding.source?.title]
    .filter(Boolean)
    .join(" ");

  for (const re of profile.target) {
    const m = indication.match(re) || body.match(re);
    if (m) return { relevance: "target", matched: m[0], reason: "matched a target-condition term" };
  }
  for (const re of profile.adjacent) {
    const m = indication.match(re) || body.match(re);
    if (m)
      return {
        relevance: "adjacent",
        matched: m[0],
        reason: "matched an adjacent condition — a different disease that is commonly conflated with the target",
      };
  }
  const cm = indication.match(CANCER_RE) || body.match(CANCER_RE);
  if (cm) return { relevance: "other_cancer", matched: cm[0], reason: "about cancer, but not the target condition" };

  if (indication || body) return { relevance: "non_cancer", matched: null, reason: "no oncology terms found" };
  return { relevance: "unclear", matched: null, reason: "nothing recorded to classify from" };
}

/** Relevance counts plus the honest headline number. */
export function relevanceStats(findings, conditionKey = "pancreatic_adenocarcinoma") {
  const by = {};
  for (const r of RELEVANCE_LEVELS) by[r] = 0;
  for (const f of findings) by[f.indication_relevance || classifyRelevance(f, conditionKey).relevance]++;
  const total = findings.length;
  return {
    by,
    total,
    on_target: by.target,
    on_target_share: total ? +(by.target / total).toFixed(3) : 0,
    off_target: total - by.target,
    headline:
      total === 0
        ? "No findings recorded."
        : by.target === 0
          ? `None of the ${total} findings recorded are about ${CONDITION_PROFILES[conditionKey].label.toLowerCase()}. Everything in this corpus is about the substances in some other setting.`
          : `${by.target} of ${total} findings (${((by.target / total) * 100).toFixed(0)}%) are about ${CONDITION_PROFILES[conditionKey].label.toLowerCase()}. The remaining ${total - by.target} concern these substances in other diseases or outside oncology entirely.`,
  };
}
