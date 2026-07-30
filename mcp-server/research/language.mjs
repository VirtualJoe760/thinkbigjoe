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

const SCRIPTS = [
  { code: "zh", name: "Chinese", re: /[一-鿿]/, min: 1 },
  { code: "ja", name: "Japanese", re: /[぀-ヿ]/, min: 1 },
  { code: "ko", name: "Korean", re: /[가-힯]/, min: 1 },
  { code: "ru", name: "Cyrillic (Russian/Ukrainian/etc.)", re: /[Ѐ-ӿ]/, min: 1 },
  { code: "ar", name: "Arabic", re: /[؀-ۿ]/, min: 1 },
  { code: "he", name: "Hebrew", re: /[֐-׿]/, min: 1 },
  { code: "el", name: "Greek", re: /[Ͱ-Ͽ]/, min: 2 },
  { code: "th", name: "Thai", re: /[฀-๿]/, min: 1 },
  { code: "hi", name: "Devanagari", re: /[ऀ-ॿ]/, min: 1 },
];

/** Distinctive stopwords for Latin-script languages a script test cannot separate. */
const LATIN_MARKERS = [
  { code: "es", name: "Spanish", words: /\b(el|la|los|las|de|del|que|para|con|una|por|se|es|en|estudio|pacientes|células|cáncer|tratamiento|resultados)\b/gi, threshold: 4 },
  { code: "pt", name: "Portuguese", words: /\b(o|a|os|as|de|do|da|que|para|com|uma|por|se|é|em|estudo|pacientes|células|câncer|tratamento|resultados)\b/gi, threshold: 4 },
  { code: "fr", name: "French", words: /\b(le|la|les|des|du|que|pour|avec|une|par|est|dans|étude|patients|cellules|traitement|résultats)\b/gi, threshold: 4 },
  { code: "de", name: "German", words: /\b(der|die|das|und|von|mit|für|eine|ist|im|nicht|Studie|Patienten|Zellen|Behandlung|Ergebnisse)\b/g, threshold: 4 },
  { code: "it", name: "Italian", words: /\b(il|la|le|dei|del|che|per|con|una|per|è|nel|studio|pazienti|cellule|trattamento|risultati)\b/gi, threshold: 4 },
  { code: "tr", name: "Turkish", words: /\b(ve|bir|bu|için|ile|olarak|çalışma|hastalar|hücre|tedavi|sonuç)\b/gi, threshold: 3 },
];

/**
 * Detect the language of a string.
 * @returns { code, name, english, confidence }
 */
export function detectLanguage(text) {
  const s = String(text || "");
  if (!s.trim()) return { code: "und", name: "undetermined", english: true, confidence: "none" };

  for (const sc of SCRIPTS) {
    const hits = (s.match(new RegExp(sc.re.source, "g")) || []).length;
    if (hits >= sc.min) return { code: sc.code, name: sc.name, english: false, confidence: "script" };
  }

  for (const m of LATIN_MARKERS) {
    const hits = (s.match(m.words) || []).length;
    if (hits >= m.threshold) return { code: m.code, name: m.name, english: false, confidence: "stopwords" };
  }

  return { code: "en", name: "English", english: true, confidence: "default" };
}

/** True when the string contains any non-Latin script — the hard signal. */
export function hasNonLatinScript(text) {
  return SCRIPTS.some((sc) => sc.re.test(String(text || "")));
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
