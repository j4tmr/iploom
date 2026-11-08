/**
 * Han characters and Japanese kana count one per character, matching how those
 * manuscripts are measured. Everything else that is a letter, number or
 * combining mark counts per word: accented Latin (`café`), Cyrillic
 * (`Привет`), Hangul (`안녕하세요`) and full-width digits (`１２３`). The
 * lookahead stops a word from swallowing an adjacent Han or kana character, so
 * `林舟abc` is three tokens rather than two.
 *
 * The token pattern is created once and reused with `exec` instead of
 * `matchAll`, which allocates one match object per token. A 1.5M-character
 * manuscript has hundreds of thousands of tokens, so those allocations showed
 * up on every keystroke once the whole workspace was recounted.
 */
const PER_CHARACTER = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー`;
const WORD_START = String.raw`(?:(?![${PER_CHARACTER}])[\p{L}\p{N}])`;
const WORD_REST = String.raw`(?:(?![${PER_CHARACTER}])[\p{L}\p{N}\p{M}])*`;
const TOKEN = new RegExp(
  `[${PER_CHARACTER}]|${WORD_START}${WORD_REST}(?:['’-]${WORD_START}${WORD_REST})*`,
  "gu",
);

export function wordCount(text: string): number {
  TOKEN.lastIndex = 0;
  let count = 0;
  while (TOKEN.exec(text)) count += 1;
  return count;
}
