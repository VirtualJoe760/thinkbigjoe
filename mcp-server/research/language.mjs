/**
 * language.mjs — everything the report says is in English; every quote stays in
 * the language it was written in.
 *
 * These two requirements pull against each other, and the resolution matters.
 *
 * A verbatim quotation is the mechanism that makes a claim checkable: a reader
 * can go to the source and find those exact words. Translate it and it stops
 * being verbatim — it becomes the agent's paraphrase wearing quotation marks,
 * which is precisely the thing this corpus exists to prevent. So the original
 * quote is preserved exactly as published.
 *
 * But a report nobody can read is not a report. So:
 *
 *   claim                  → ALWAYS English. Rejected if it is not.
 *   verbatim_quote         → ALWAYS the source's own words, untranslated.
 *   verbatim_quote_english → REQUIRED when the quote is not in English.
 *
 * The reports render the English translation as the body text and keep the
 * original beneath it, marked with its language. A reader gets an English
 * document; an auditor can still check the quote against the source.
 *
 * Detection is script-based, which is reliable for the languages this project
 * actually reaches (Chinese, Japanese, Russian, Korean, Arabic, Greek) and
 * deliberately conservative for Latin-script languages — Spanish and German
 * share an alphabet with English, so those are caught by a stopword check
 * rather than guessed at from characters.
 */

/**
 * Symbols that are ordinary English scientific writing, not evidence of another
 * language. Biomedical text is saturated with them — "IC50 of 5 μM", "TNF-α",
 * "β-catenin" — and treating a single Greek letter as a language signal rejects
 * a large fraction of perfectly good English claims. They are stripped before
 * any language test runs.
 */
const SCIENTIFIC_SYMBOLS = /[μµαβγδεζθκλνπρστφχψωΩΔΣΦΨ°±×÷≤≥≈≠∼‰′″]/g;

const stripScientific = (t) => String(t || "").replace(SCIENTIFIC_SYMBOLS, " ");

const SCRIPTS = [
  { code: "zh", name: "Chinese", re: /[一-鿿]/, min: 1 },
  { code: "ja", name: "Japanese", re: /[぀-ヿ]/, min: 1 },
  { code: "ko", name: "Korean", re: /[가-힯]/, min: 1 },
  { code: "ru", name: "Cyrillic (Russian/Ukrainian/etc.)", re: /[Ѐ-ӿ]/, min: 1 },
  { code: "ar", name: "Arabic", re: /[؀-ۿ]/, min: 1 },
  { code: "he", name: "Hebrew", re: /[֐-׿]/, min: 1 },
  { code: "el", name: "Greek", re: /[Ͱ-Ͽ]/, min: 4 }, // only after SCIENTIFIC_SYMBOLS are stripped
  { code: "th", name: "Thai", re: /[฀-๿]/, min: 1 },
  { code: "hi", name: "Devanagari", re: /[ऀ-ॿ]/, min: 1 },
];

/** Distinctive stopwords for Latin-script languages a script test cannot separate. */
/**
 * Distinctive stopwords for Latin-script languages a script test cannot separate.
 *
 * Every token here had to survive one question: could this appear in ordinary
 * English biomedical prose? Tokens that could — "a", "as", "o", "per", "il"
 * (as in IL-6), "la", "le", "en", "es", "patients" — are REMOVED, because they
 * were matching English sentences and rejecting them as Portuguese or Italian.
 * What is left is diacritic-bearing or genuinely language-specific.
 *
 * Scoring is a RATIO of marker hits to total tokens, not a raw count, so a long
 * English paragraph cannot accumulate enough incidental hits to trip the test.
 */
const LATIN_MARKERS = [
  { code: "es", name: "Spanish", words: /\b(los|las|del|que|para|con|una|por|estudio|pacientes|células|cáncer|tratamiento|resultados|fueron|este|esta|también)\b/gi },
  { code: "pt", name: "Portuguese", words: /\b(dos|das|não|que|para|com|uma|foram|estudo|células|câncer|tratamento|resultados|este|esta|também)\b/gi },
  { code: "fr", name: "French", words: /\b(les|des|une|pour|avec|dans|étude|cellules|traitement|résultats|cette|nous|été|sont)\b/gi },
  { code: "de", name: "German", words: /\b(der|die|das|und|von|mit|für|eine|nicht|Studie|Patienten|Zellen|Behandlung|Ergebnisse|wurde|wurden)\b/g },
  { code: "it", name: "Italian", words: /\b(dei|del|che|con|una|nel|studio|pazienti|cellule|trattamento|risultati|questo|sono|stato)\b/gi },
  { code: "tr", name: "Turkish", words: /\b(bir|için|ile|olarak|çalışma|hastalar|hücre|tedavi|sonuç|ve|bu)\b/gi },
];

/** Minimum share of tokens that must be language markers before we call it. */
const LATIN_RATIO = 0.18;
const LATIN_MIN_HITS = 4;

/**
 * Detect the language of a string.
 * @returns { code, name, english, confidence }
 */
export function detectLanguage(text) {
  const s = String(text || "");
  if (!s.trim()) return { code: "und", name: "undetermined", english: true, confidence: "none" };

  const clean = stripScientific(s);

  for (const sc of SCRIPTS) {
    const hits = (clean.match(new RegExp(sc.re.source, "g")) || []).length;
    if (hits >= sc.min) return { code: sc.code, name: sc.name, english: false, confidence: "script" };
  }

  const tokens = (clean.match(/\b[\p{L}]{1,}\b/gu) || []).length || 1;
  for (const m of LATIN_MARKERS) {
    const hits = (clean.match(m.words) || []).length;
    if (hits >= LATIN_MIN_HITS && hits / tokens >= LATIN_RATIO)
      return { code: m.code, name: m.name, english: false, confidence: "stopwords" };
  }

  return { code: "en", name: "English", english: true, confidence: "default" };
}

/**
 * True when the string is genuinely written in a non-Latin script.
 *
 * Deliberately counts occurrences against each script's own threshold rather
 * than tripping on a single character — and strips scientific symbols first.
 * The naive version rejected "IC50 of 5 μM" and "TNF-α" as non-English, which
 * would have silently excluded a large share of biomedical findings and left a
 * corpus biased toward whatever prose happens to avoid Greek letters.
 */
export function hasNonLatinScript(text) {
  const clean = stripScientific(text);
  return SCRIPTS.some((sc) => (clean.match(new RegExp(sc.re.source, "g")) || []).length >= sc.min);
}

/**
 * Enforce the language contract on a finding before it enters the corpus.
 * @returns { ok } or { ok:false, error } — the error text is written to be read
 *          by the agent, so it says what to do, not just what is wrong.
 */
export function validateLanguage(input) {
  const claim = String(input.claim || "");
  const quote = String(input.verbatim_quote || "");

  // 1. The claim must be English. This is the field that becomes the report.
  if (hasNonLatinScript(claim)) {
    const d = detectLanguage(claim);
    return {
      ok: false,
      error: `REJECTED: the claim is written in ${d.name}, and every claim in this corpus must be in English — the report is an English document. Translate the claim into English. Keep the original wording in verbatim_quote (untranslated, that is the point of it) and put your English rendering of the quote in verbatim_quote_english.`,
    };
  }
  const claimLang = detectLanguage(claim);
  if (!claimLang.english && claimLang.confidence === "stopwords") {
    return {
      ok: false,
      error: `REJECTED: the claim appears to be written in ${claimLang.name}. Every claim must be in English. Translate it, leave verbatim_quote in the original language, and supply verbatim_quote_english.`,
    };
  }

  // 2. A non-English quote is fine — required, even — but it needs a translation
  //    travelling with it, or the report has an untranslated hole in it.
  const quoteLang = detectLanguage(quote);
  if (!quoteLang.english) {
    const t = String(input.verbatim_quote_english || "").trim();
    if (t.length < 15) {
      return {
        ok: false,
        error: `REJECTED: verbatim_quote is in ${quoteLang.name}. Do NOT translate it — a translated quote is no longer verbatim and cannot be checked against the source. Instead, keep it exactly as published and add verbatim_quote_english with your English translation of it. Both are stored; the report shows the English and keeps the original beneath it.`,
      };
    }
    if (hasNonLatinScript(t))
      return { ok: false, error: `REJECTED: verbatim_quote_english still contains ${detectLanguage(t).name} text. It must be an English translation.` };
  }

  return {
    ok: true,
    source_language: quoteLang.code,
    source_language_name: quoteLang.name,
    needs_translation: !quoteLang.english,
  };
}
