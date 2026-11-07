import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { searchWorkspace } from "../../apps/studio/src/core/search.ts";
import { wordCount } from "../../apps/studio/src/core/word-count.ts";

const NOW = "2026-11-07T00:00:00.000Z";

describe("word count scripts", () => {
  test("keeps existing Chinese and English counts unchanged", () => {
    expect(wordCount("林舟走进钟楼")).toBe(6);
    expect(wordCount("Hello world")).toBe(2);
    expect(wordCount("don't stop")).toBe(2);
  });

  test("counts accented Latin, Cyrillic and Hangul by word", () => {
    expect(wordCount("café naïve résumé")).toBe(3);
    expect(wordCount("Привет мир")).toBe(2);
    expect(wordCount("안녕하세요 세계")).toBe(2);
  });

  test("counts kana per character and full-width digits by number", () => {
    expect(wordCount("こんにちは")).toBe(5);
    expect(wordCount("カタカナ")).toBe(4);
    expect(wordCount("第１２３章")).toBe(3);
  });

  test("does not merge a word into an adjacent Han character", () => {
    expect(wordCount("林舟abc")).toBe(3);
    expect(wordCount("abc林")).toBe(2);
    expect(wordCount("café")).toBe(1);
  });
});

describe("workspace search normalization", () => {
  test("matches multi-word queries across entities", () => {
    const workspace = createDemoWorkspace("zh-CN", NOW);
    const hits = searchWorkspace(workspace, "林舟 钟楼", "zh-CN");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.id === "char_lin")).toBe(true);
    expect(hits.some((hit) => hit.id === "loc_old_tower")).toBe(true);
  });

  test("scores the English name at the exact tier", () => {
    const workspace = createDemoWorkspace("zh-CN", NOW);
    const lin = workspace.characters.find(
      (character) => character.id === "char_lin",
    )!;
    const english = searchWorkspace(workspace, lin.name.en, "zh-CN").find(
      (hit) => hit.id === "char_lin",
    );
    const chinese = searchWorkspace(workspace, lin.name.zh, "zh-CN").find(
      (hit) => hit.id === "char_lin",
    );
    expect(english).toBeDefined();
    expect(chinese).toBeDefined();
    // 6 (name weight) x 8 (exact): the English name is a field of its own now,
    // instead of being buried inside a combined `zh en` string.
    expect(english!.score).toBe(48);
    expect(english!.score).toBeGreaterThanOrEqual(chinese!.score);
  });

  test("folds full-width letters and collapses whitespace", () => {
    const workspace = createDemoWorkspace("en", NOW);
    const halfWidth = searchWorkspace(workspace, "lin", "en");
    const fullWidth = searchWorkspace(workspace, "Ｌｉｎ", "en");
    expect(fullWidth.length).toBeGreaterThan(0);
    expect(fullWidth.map((hit) => [hit.id, hit.score])).toEqual(
      halfWidth.map((hit) => [hit.id, hit.score]),
    );

    const doubled = searchWorkspace(workspace, "lin  zhou", "en");
    const ideographic = searchWorkspace(workspace, "lin　zhou", "en");
    expect(doubled.length).toBeGreaterThan(0);
    expect(doubled.map((hit) => hit.id)).toEqual(
      ideographic.map((hit) => hit.id),
    );
  });
});
