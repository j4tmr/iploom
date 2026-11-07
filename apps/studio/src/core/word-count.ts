/**
 * The token pattern is created once and reused with `exec` instead of
 * `matchAll`, which allocates one match object per token. A 1.5M-character
 * manuscript has hundreds of thousands of tokens, so those allocations showed
 * up on every keystroke once the whole workspace was recounted.
 *
 * The ranges are U+3400–U+4DBF, U+4E00–U+9FFF and U+20000–U+2FA1F (CJK).
 */
const TOKEN =
  /[㐀-䶿一-鿿𠀀-𯨟]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu;

export function wordCount(text: string): number {
  TOKEN.lastIndex = 0;
  let count = 0;
  while (TOKEN.exec(text)) count += 1;
  return count;
}
