export function wordCount(text: string): number {
  return [
    ...text.matchAll(
      /[\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{2fa1f}]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu,
    ),
  ].length;
}
