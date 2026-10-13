// -----------------------------------------------------------------------------
// The languages of the texts the user reads.
//
// Gladys renders a `{ en, fr, de, es }` object in the reader's language and
// falls back on English: every user-facing message carries all four. The
// helpers build the messages that wrap a value (an installation name, a mode,
// an error) without repeating the template once per language.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * A multi-language text built by the same function for every language.
 * @param {(language: string) => string} build
 * @returns {Record<string, string>}
 */
export function textsOf(build) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, build(language)]));
}

/**
 * A text of a multi-language object in one language, English as the fallback.
 * @param {Record<string, string>} texts
 * @param {string} [language]
 */
export function localize(texts, language = 'en') {
  return texts?.[language] ?? texts?.en;
}

/** The language to format with: one the integration speaks, English otherwise. */
export function supportedLanguage(language) {
  return LANGUAGES.includes(language) ? language : 'en';
}
