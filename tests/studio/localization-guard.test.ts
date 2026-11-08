import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../../apps/studio/src");
const ELECTRON_DIRECTORY = join(import.meta.dir, "../../apps/studio/electron");
const SCANNED_DIRECTORIES = ["components", "views"];

/**
 * Inline locale branching duplicates copy at the call site, so one language
 * silently falls back to the other and the zh dictionary no longer types the
 * en dictionary. Every user-visible string belongs in `i18n.ts` (renderer) or
 * the injected main-process catalog `src/node/messages.ts` instead.
 *
 * The detector deliberately matches only branching on the `locale` argument
 * itself (and the `local(locale, zh, en)` helper that hides the same branch),
 * so passing a locale to `displayText`, `formatNumber` or `Intl` stays legal —
 * those localize data, not UI copy.
 */
const PATTERNS: Array<[pattern: string, regex: RegExp]> = [
  // `locale === "en" ? ... : ...` and every comparison variant.
  ["locale comparison", /(?<!\.)\blocale\s*(?:===|!==|==|!=)\s*["']/],
  // `local(locale, "关闭", "Close")` and its `function local(locale…)` form.
  ["locale helper", /\blocal\s*\(\s*locale\b/],
];

export interface InlineLocaleHit {
  line: number;
  pattern: string;
  text: string;
}

export function findInlineLocaleCopy(source: string): InlineLocaleHit[] {
  const hits: InlineLocaleHit[] = [];
  source.split("\n").forEach((text, index) => {
    for (const [pattern, regex] of PATTERNS) {
      if (regex.test(text)) {
        hits.push({ line: index + 1, pattern, text: text.trim() });
      }
    }
  });
  return hits;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("localization guard", () => {
  test("detects the inline patterns the UI trees must not contain", () => {
    expect(findInlineLocaleCopy('const en = locale === "en";')).toHaveLength(1);
    expect(
      findInlineLocaleCopy('t(locale === "zh-CN" ? "关闭" : "Close")'),
    ).toHaveLength(1);
    expect(
      findInlineLocaleCopy("function local(locale: UiLocale, zh: string) {}"),
    ).toHaveLength(1);
    expect(
      findInlineLocaleCopy('{local(locale, "关闭", "Close")}'),
    ).toHaveLength(1);
    // Localizing data and reading a stored preference are not copy branches.
    expect(findInlineLocaleCopy("displayText(item.name, locale)")).toEqual([]);
    expect(findInlineLocaleCopy('nameEn === ".en" || nameEn === "en"')).toEqual(
      [],
    );
    expect(
      findInlineLocaleCopy('workspace.settings.locale === "zh-CN"'),
    ).toEqual([]);
  });

  test("renderer trees and the Electron main process avoid inline locale copy", () => {
    // The Electron entry point now owns native dialogs and IPC errors too, so
    // a locale branch there has the same failure mode as one in the renderer.
    const roots = [
      ...SCANNED_DIRECTORIES.map((directory) => join(SRC, directory)),
      ELECTRON_DIRECTORY,
    ];
    const violations = roots.flatMap((root) =>
      sourceFiles(root).flatMap((file) =>
        findInlineLocaleCopy(readFileSync(file, "utf8")).map(
          (hit) =>
            `${relative(SRC, file)}:${hit.line} [${hit.pattern}] ${hit.text}`,
        ),
      ),
    );
    expect(violations).toEqual([]);
  });
});
