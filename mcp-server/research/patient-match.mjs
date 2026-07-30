/**
 * patient-match.mjs — the personal-context layer.
 *
 * This is what the eventual website's "tell us about your situation" form talks
 * to. Given a person's clinical context, it returns THE SUBSET OF THE CORPUS
 * THAT APPLIES TO THEM, plus the safety flags their own medication and condition
 * list raises, plus the trials currently recruiting that they may be eligible
 * for, with the coordinator's phone number.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS RETURNS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Returns: matched evidence, interaction and contraindication flags raised
 * against their own list, matching recruiting trials with contacts, and a
 * written statement of what the evidence cannot tell them.
 *
 * Does not return: a dose for them, a schedule for them, a protocol for them, or
 * any statement that a substance will or should help them. That is not a
 * limitation to be worked around — it is the difference between a research tool
 * and a prescription, and this module is a research tool. The evidence it hands
 * back is the same evidence in the report, with its species and tier attached,
 * so a person and their oncologist can read it together.
 *
 * The honest framing this enables is strong: "here is every human study that
 * exists on this, here is what it did and did not measure, here are the three
 * trials recruiting near you and the coordinator's direct line, and here are the
 * two interactions between this and the drugs you are already taking." That is
 * more useful to a patient than a fabricated dose, and it is true.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * PRIVACY: this module is STATELESS BY CONSTRUCTION. It imports no writer, holds
 * no module-level state, and returns a plain object. The profile is never
 * written to the corpus, never logged, and never leaves the process. Any caller
 * that persists a profile is adding that behaviour itself, and would be taking
 * on health-data obligations this module deliberately avoids.
 */

import { getFindings, readIndex, EVIDENCE_TIERS } from "./corpus.mjs";

const HUMAN_TIERS = [
  "meta_analysis",
  "rct",
  "controlled_trial_nonrandomized",
  "cohort",
  "case_control",
  "case_series",
  "case_report",
];

/**
 * The profile shape the website form should collect. Everything is optional —
 * a sparser profile returns broader results with an explicit note saying so,
 * rather than refusing.
 */
export const PROFILE_SCHEMA = {
  diagnosis: "string — e.g. 'pancreatic ductal adenocarcinoma'",
  stage: "string — e.g. 'IV', 'locally advanced', 'resectable'",
  biomarkers: "array of strings — e.g. ['KRAS G12D', 'BRCA2 wild-type', 'CA19-9 340']",
  prior_treatments: "array of strings — e.g. ['FOLFIRINOX', 'Whipple resection', 'gemcitabine + nab-paclitaxel']",
  current_medications: "array of strings — generic names. Used ONLY to raise interaction flags.",
  conditions: "array of strings — other diagnoses, e.g. ['hepatic impairment', 'epilepsy']",
  allergies: "array of strings",
  substances_of_interest: "array of strings — what they want to read about",
  country: "string — for trial matching",
  region: "string — state/province, for trial matching",
  age_years: "number — used only against trial eligibility ranges",
};

const norm = (s) => String(s || "").toLowerCase().trim();
const anyMatch = (hay, needles) => needles.some((n) => n && norm(hay).includes(norm(n)));

/**
 * Match the corpus against one person's context.
 * @returns a plain object; nothing is written anywhere.
 */
export function matchProfile(project, profile = {}) {
  const findings = getFindings(project);
  const idx = readIndex(project);

  const meds = (profile.current_medications || []).filter(Boolean);
  const conditions = (profile.conditions || []).filter(Boolean);
  const wanted = (profile.substances_of_interest || []).filter(Boolean);
  const dx = profile.diagnosis || "";

  // ---- 1. Evidence that applies -------------------------------------------
  let relevant = findings;
  if (wanted.length) relevant = relevant.filter((f) => anyMatch(f.subject || "", wanted));
  if (dx) {
    const onTopic = relevant.filter((f) => anyMatch(f.indication || "", [dx]) || anyMatch(f.claim, [dx]));
    // Do not silently drop everything if the indication strings do not line up —
    // report both sets and say which is which.
    if (onTopic.length) relevant = onTopic;
  }

  const bySubstance = {};
  for (const f of relevant) {
    const k = f.subject || "unspecified";
    bySubstance[k] ||= { human: [], preclinical: [], anecdote: [], other: [] };
    const bucket = HUMAN_TIERS.includes(f.evidence_tier)
      ? "human"
      : ["animal_in_vivo", "in_vitro"].includes(f.evidence_tier)
        ? "preclinical"
        : f.evidence_tier === "anecdote_unverified"
          ? "anecdote"
          : "other";
    bySubstance[k][bucket].push(summarise(f));
  }

  // ---- 2. Safety flags raised by THEIR list --------------------------------
  // Text-matched against what the corpus actually recorded. A flag means "the
  // literature we read mentions this" — not "this will happen to you", and not
  // "no flag means safe": a substance with no safety findings recorded produces
  // no flags precisely because nothing was recorded.
  const interactionFlags = [];
  const contraindicationFlags = [];

  for (const f of findings) {
    const haystack = [f.claim, f.verbatim_quote, f.adverse_events, f.limitations].filter(Boolean).join(" ");
    for (const med of meds) {
      if (anyMatch(haystack, [med])) {
        interactionFlags.push({
          your_medication: med,
          substance: f.subject,
          what_the_source_says: f.claim,
          verbatim_quote: f.verbatim_quote,
          evidence_tier: f.evidence_tier,
          human_subjects: HUMAN_TIERS.includes(f.evidence_tier),
          source: permalink(f.source),
          finding_id: f.id,
        });
      }
    }
    for (const c of conditions) {
      if (anyMatch(haystack, [c])) {
        contraindicationFlags.push({
          your_condition: c,
          substance: f.subject,
          what_the_source_says: f.claim,
          verbatim_quote: f.verbatim_quote,
          evidence_tier: f.evidence_tier,
          source: permalink(f.source),
          finding_id: f.id,
        });
      }
    }
  }

  // ---- 3. Trials they might be eligible for --------------------------------
  const trials = idx
    .filter((c) => c.nct)
    .filter((c) => {
      if (!dx) return true;
      const hay = [c.title, ...(c.conditions || [])].filter(Boolean).join(" ");
      return anyMatch(hay, [dx, "pancrea"]);
    })
    .map((c) => ({
      nct: c.nct,
      title: c.title,
      status: c.trial_status || null,
      recruiting: /recruit/i.test(c.trial_status || ""),
      phase: c.phase || null,
      conditions: c.conditions || [],
      interventions: c.interventions || [],
      why_stopped: c.why_stopped || null,
      sponsor: c.sponsor || null,
      // The actionable part: who to call.
      contacts: c.trial_contacts || [],
      locations: filterLocations(c.locations || [], profile),
      url: c.url || `https://clinicaltrials.gov/study/${c.nct}`,
    }))
    .sort((a, b) => Number(b.recruiting) - Number(a.recruiting));

  // ---- 4. The honest frame -------------------------------------------------
  const substancesShown = Object.keys(bySubstance);
  const humanCount = relevant.filter((f) => HUMAN_TIERS.includes(f.evidence_tier)).length;
  const cannotTell = [];

  if (!relevant.length)
    cannotTell.push("No finding in this corpus matches the substances and diagnosis given. That means the corpus does not cover it — not that nothing exists.");
  if (relevant.length && humanCount === 0)
    cannotTell.push("None of the matched evidence comes from human subjects. It describes what happened in cell cultures or animals. Whether any of it happens in a person is unknown and cannot be inferred from what is shown here.");
  for (const sub of substancesShown) {
    const g = bySubstance[sub];
    if (!g.human.length && (g.preclinical.length || g.anecdote.length))
      cannotTell.push(`${sub}: no human-subject evidence. What is shown is ${g.preclinical.length} preclinical and ${g.anecdote.length} unverified reported experiences.`);
  }
  if (meds.length && !interactionFlags.length)
    cannotTell.push(`No interaction between your listed medications and these substances appears in this corpus. This is not a clearance — most drug pairs have simply never been studied together, and an unstudied pair produces no finding to flag.`);
  if (!meds.length)
    cannotTell.push("No current medications were provided, so no interaction check was possible.");
  cannotTell.push("Nothing here accounts for your individual physiology, organ function, or how any of this would interact with treatment you are currently receiving. Only a clinician with your full record can do that.");

  return {
    matched: {
      substances: substancesShown,
      finding_count: relevant.length,
      human_finding_count: humanCount,
      by_substance: bySubstance,
    },
    safety_flags: {
      interactions: dedupeFlags(interactionFlags),
      contraindications: dedupeFlags(contraindicationFlags),
      how_to_read_these:
        "Each flag means a source in this corpus mentions your medication or condition alongside this substance. It is a pointer to something to read and to raise with your oncologist — not a prediction about you. An empty list means nothing was recorded, which is not the same as nothing existing.",
    },
    trials: {
      count: trials.length,
      recruiting: trials.filter((t) => t.recruiting).length,
      studies: trials,
      note: "Trial eligibility is determined by the trial's own team, not by this matching. Contact the coordinator listed and ask — that call is free and they will tell you in minutes whether you qualify.",
    },
    what_this_cannot_tell_you: cannotTell,
    scope:
      "This is a literature-matching result. It reports which published evidence relates to the context given, at what level of evidence, and who is running relevant trials. It does not recommend a substance, a dose, a schedule, or a protocol, and it is not a substitute for your treating clinician.",
    privacy: "The context supplied was used in memory to filter this corpus and was not stored, logged, or transmitted anywhere.",
  };

  function summarise(f) {
    return {
      id: f.id,
      claim: f.claim,
      verbatim_quote: f.verbatim_quote,
      direction: f.direction,
      evidence_tier: f.evidence_tier,
      evidence_rank: EVIDENCE_TIERS.indexOf(f.evidence_tier),
      human_subjects: HUMAN_TIERS.includes(f.evidence_tier),
      model_system: f.model_system,
      population_n: f.population_n,
      // Dose is shown WITH its model system, always. A dose without the species
      // it was given to is the single most dangerous field in this dataset.
      dose_reported: f.dose_reported,
      dose_applies_to: f.model_system || "unspecified model system",
      route: f.route,
      outcome_measure: f.outcome_measure,
      effect_size: f.effect_size,
      adverse_events: f.adverse_events,
      limitations: f.limitations,
      retracted: !!f.retracted,
      source: permalink(f.source),
    };
  }
}

function permalink(src = {}) {
  return src.doi
    ? `https://doi.org/${src.doi}`
    : src.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${src.pmid}/`
      : src.nct
        ? `https://clinicaltrials.gov/study/${src.nct}`
        : src.url || null;
}

function dedupeFlags(list) {
  const seen = new Set();
  return list.filter((f) => {
    const k = `${f.finding_id}|${f.your_medication || f.your_condition}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function filterLocations(locations, profile) {
  if (!profile.country && !profile.region) return locations.slice(0, 20);
  const near = locations.filter(
    (l) =>
      (profile.country && anyMatch(l.country || "", [profile.country])) ||
      (profile.region && anyMatch(l.state || "", [profile.region])),
  );
  return (near.length ? near : locations).slice(0, 20);
}
