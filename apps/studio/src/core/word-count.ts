/**
 * Han characters and Japanese kana count one per character, matching how those
 * manuscripts are measured. Everything else that is a letter, number or
 * combining mark counts per word: accented Latin (`café`), Cyrillic
 * (`Привет`), Hangul (`안녕하세요`) and full-width digits (`１２３`). The
 * lookahead stops a word from swallowing an adjacent Han or kana character, so
 * `林舟abc` is three tokens rather than two.
 */
const PER_CHARACTER = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー`;
const WORD_START = String.raw`(?:(?![${PER_CHARACTER}])[\p{L}\p{N}])`;
const WORD_REST = String.raw`(?:(?![${PER_CHARACTER}])[\p{L}\p{N}\p{M}])*`;
const TOKEN = new RegExp(
  String.raw`[${PER_CHARACTER}]|${WORD_START}${WORD_REST}(?:['’-]${WORD_START}${WORD_REST})*`,
  "gu",
);

export function wordCount(text: string): number {
  return [...text.matchAll(TOKEN)].length;
}
