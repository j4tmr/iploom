import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAIN_SOURCE = readFileSync(
  join(import.meta.dir, "../../apps/studio/electron/main.ts"),
  "utf8",
);

/**
 * `electron/main.ts` imports Electron at module scope, so the Bun test process
 * can never load it. The catalog wiring is therefore guarded at the source
 * level: every place that adopts a workspace must re-derive `mainMessages`
 * (issue #103), or a runtime language switch leaves dialogs and IPC errors in
 * the previous language with the rest of the suite still green.
 */
export const LOCALE_ADOPTION_SITES: Array<[site: string, pattern: RegExp]> = [
  [
    "loadWorkspace success",
    /const loaded = await store\.load\(\);[\s\S]{0,200}?applyMainLocale\(/,
  ],
  [
    "demo fallback",
    /createDemoWorkspace\(defaultLocale\(\)\);[\s\S]{0,160}?applyMainLocale\(workspace\.settings\.locale\)/,
  ],
  ["iploom:save", /"iploom:save",[\s\S]{0,2000}?applyMainLocale\(/],
  [
    "iploom:restore-snapshot",
    /"iploom:restore-snapshot",[\s\S]{0,800}?applyMainLocale\(/,
  ],
  [
    "iploom:reset-demo",
    /"iploom:reset-demo",[\s\S]{0,800}?applyMainLocale\(locale\)/,
  ],
  [
    "bootstrap",
    /async function bootstrap\(\): Promise<void> \{[\s\S]{0,600}?applyMainLocale\(defaultLocale\(\)\);/,
  ],
];

export function missingLocaleAdoptionSites(source: string): string[] {
  return LOCALE_ADOPTION_SITES.filter(
    ([, pattern]) => !pattern.test(source),
  ).map(([site]) => site);
}

describe("main-process locale wiring", () => {
  test("every catalog adoption site re-derives the locale copy", () => {
    expect(missingLocaleAdoptionSites(MAIN_SOURCE)).toEqual([]);
  });

  test("the catalog is only reassigned inside applyMainLocale", () => {
    // One assignment in one helper keeps the module variable and the store's
    // captured copy in lockstep; any other assignment would skip the store.
    expect(
      MAIN_SOURCE.match(/mainMessages = mainMessagesFor\(/g) ?? [],
    ).toHaveLength(1);
    expect(MAIN_SOURCE).toMatch(
      /function applyMainLocale\(locale: UiLocale\): void \{[\s\S]{0,200}?mainMessages = mainMessagesFor\(locale\);[\s\S]{0,160}?workspaceStore\?\.setLocale\(locale\);/,
    );
    // Before the first workspace load, every early failure stays English.
    expect(MAIN_SOURCE).toContain(
      "let mainMessages: MainMessages = englishMainMessages;",
    );
  });

  test("the guard detects a removed adoption call", () => {
    const withoutReset = MAIN_SOURCE.replace(
      "applyMainLocale(locale);\n    rememberFolders();",
      "rememberFolders();",
    );
    expect(withoutReset).not.toBe(MAIN_SOURCE);
    expect(missingLocaleAdoptionSites(withoutReset)).toEqual([
      "iploom:reset-demo",
    ]);
  });
});
