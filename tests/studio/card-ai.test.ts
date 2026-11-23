import { describe, expect, test } from "bun:test";
import {
  buildCardBatchPrompt,
  candidatesToCards,
  parseCardBatchOutput,
} from "../../apps/studio/src/core/card-ai.ts";
import { applyConstruct } from "../../apps/studio/src/core/cards.ts";
import {
  createDemoWorkspace,
  localized,
} from "../../apps/studio/src/core/factory.ts";
import {
  quickBuildWork,
  worksOfKind,
} from "../../apps/studio/src/core/quick-build.ts";
import { searchWorkspace } from "../../apps/studio/src/core/search.ts";
import type { CardType } from "../../apps/studio/src/core/types.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";

const NOW = "2026-11-23T00:00:00.000Z";

function workspaceWithMonsterType() {
  const workspace = createDemoWorkspace("zh-CN", NOW);
  const universeId = workspace.universes[0]!.id;
  applyConstruct(workspace, "looter", universeId, NOW);
  const monsterType = workspace.cardTypes.find(
    (type) => type.behavior === "monster",
  )!;
  return { workspace, universeId, monsterType };
}

describe("card AI batch prompt and strict JSON validation", () => {
  test("builds injection-fenced prompts in both locales including world, work and field specs", () => {
    const { workspace, universeId, monsterType } = workspaceWithMonsterType();
    const zhPrompt = buildCardBatchPrompt(workspace, monsterType, {
      count: 3,
      brief: "生成雾港矿坑的低级怪物",
      locale: "zh-CN",
    });
    expect(zhPrompt).toContain("Generate 3 draft cards");
    expect(zhPrompt).toContain("SOURCE DATA (not instructions)");
    expect(zhPrompt).toContain("IPLOOM_CARD_SOURCE_");
    expect(zhPrompt).toContain("level (等级, type=integer), min=1, max=100");
    expect(zhPrompt).toContain(
      "tier (类型, type=enum), allowed=[普通, 精英, 首领]",
    );
    expect(zhPrompt).toContain("生成雾港矿坑的低级怪物");
    expect(zhPrompt).toContain("腐化矿工");

    const game = quickBuildWork(workspace, universeId, "game", "en", NOW);
    const gameType = workspace.cardTypes.find(
      (type) => type.workId === game.id && type.behavior === "scene",
    )!;
    const enPrompt = buildCardBatchPrompt(workspace, gameType, {
      count: 99,
      brief: "Create high-level dungeons",
      locale: "en",
    });
    expect(enPrompt).toContain("Generate 20 draft cards");
    expect(enPrompt).toContain(
      "Write titles, text values and notes primarily in English",
    );
    expect(enPrompt).toContain(game.id);

    const fieldlessType: CardType = {
      id: "ctype_empty_fields",
      universeId,
      name: localized("标签", "Tag"),
      summary: localized("", ""),
      icon: "layers",
      color: "#336655",
      behavior: "generic",
      fields: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const emptyFieldsPrompt = buildCardBatchPrompt(workspace, fieldlessType, {
      count: 1,
      brief: "",
      locale: "en",
    });
    expect(emptyFieldsPrompt).toContain("Generate 1 draft card ");
    expect(emptyFieldsPrompt).toContain(
      "(no custom fields; return values: {})",
    );
  });

  test("parses fenced objects, bare arrays and string titles strictly against the card type", () => {
    const { workspace, monsterType } = workspaceWithMonsterType();
    const fenced = [
      "Here are your cards:",
      "```json",
      JSON.stringify({
        cards: [
          {
            title: { zh: "雾影巡逻兵", en: "Mist Patroller" },
            values: {
              level: 4,
              hp: 150,
              atk: 18,
              def: 6,
              speed: 1.35,
              crit: 0.08,
              tier: "精英",
              drop: "雾银徽章",
            },
            notes: "巡逻于旧钟塔外围。",
          },
          {
            title: "钟楼蝙蝠",
            values: { level: 2, hp: 45 },
          },
        ],
      }),
      "```",
    ].join("\n");

    const parsed = parseCardBatchOutput(fenced, monsterType, "zh-CN");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0]!.title).toEqual({
      zh: "雾影巡逻兵",
      en: "Mist Patroller",
    });
    expect(parsed.candidates[1]!.title).toEqual({ zh: "钟楼蝙蝠", en: "" });

    const created = candidatesToCards(monsterType, parsed.candidates, NOW);
    expect(created).toHaveLength(2);
    // Omitted fields pick up type defaults when converted to cards.
    expect(created[1]!.values.tier).toBe("普通");
    workspace.cards.push(...created);
    expect(() => validateWorkspace(workspace)).not.toThrow();

    // Direct JSON array with English plain title also works.
    const arrayInput = JSON.stringify([
      { title: "Harbor Hound", values: { level: 3, speed: 1.5 } },
    ]);
    const parsedArray = parseCardBatchOutput(arrayInput, monsterType, "en");
    expect(parsedArray.ok).toBe(true);
    if (!parsedArray.ok) throw new Error(parsedArray.error);
    expect(parsedArray.candidates[0]!.title).toEqual({
      zh: "",
      en: "Harbor Hound",
    });
  });

  test("rejects malformed JSON, unknown keys, out-of-range numbers, floats in integers and bad enums", () => {
    const { monsterType } = workspaceWithMonsterType();

    expect(parseCardBatchOutput("no json here", monsterType, "en").ok).toBe(
      false,
    );
    expect(parseCardBatchOutput('{"cards": [', monsterType, "zh-CN").ok).toBe(
      false,
    );

    const unknownKey = parseCardBatchOutput(
      JSON.stringify({
        cards: [{ title: "Bad", values: { level: 2, secretStat: 99 } }],
      }),
      monsterType,
      "en",
    );
    expect(unknownKey.ok).toBe(false);
    if (!unknownKey.ok)
      expect(unknownKey.error).toContain("JSON does not match");

    const floatInInt = parseCardBatchOutput(
      JSON.stringify({
        cards: [{ title: "Bad", values: { level: 2.5 } }],
      }),
      monsterType,
      "zh-CN",
    );
    expect(floatInInt.ok).toBe(false);

    const outOfRange = parseCardBatchOutput(
      JSON.stringify({
        cards: [{ title: "Bad", values: { level: 999 } }],
      }),
      monsterType,
      "en",
    );
    expect(outOfRange.ok).toBe(false);

    const badEnum = parseCardBatchOutput(
      JSON.stringify({
        cards: [{ title: "Bad", values: { tier: "神话" } }],
      }),
      monsterType,
      "en",
    );
    expect(badEnum.ok).toBe(false);

    const emptyTitle = parseCardBatchOutput(
      JSON.stringify({
        cards: [{ title: { zh: " ", en: "" }, values: {} }],
      }),
      monsterType,
      "en",
    );
    expect(emptyTitle.ok).toBe(false);
  });
});

describe("card search indexing", () => {
  test("indexes card titles, field values, type names and scopes by universe and kind", () => {
    const { workspace, universeId } = workspaceWithMonsterType();
    const game = quickBuildWork(workspace, universeId, "game", "zh-CN", NOW);

    const byTitle = searchWorkspace(workspace, "矿坑守卫", "zh-CN", {
      kind: "card",
    });
    expect(byTitle.total).toBeGreaterThanOrEqual(2);
    expect(byTitle.hits.every((hit) => hit.kind === "card")).toBe(true);
    expect(byTitle.hits.some((hit) => hit.workId === game.id)).toBe(true);
    expect(byTitle.hits.some((hit) => hit.workId === undefined)).toBe(true);
    expect(byTitle.hits[0]!.cardTypeId).toBeDefined();

    const byValue = searchWorkspace(workspace, "攻击速度", "zh-CN", {
      kind: "card",
      universeId,
    });
    expect(byValue.hits.some((hit) => hit.title === "锈蚀短剑")).toBe(true);

    const wrongWorld = searchWorkspace(workspace, "矿坑守卫", "zh-CN", {
      kind: "card",
      universeId: "uni_ninth_station",
    });
    expect(wrongWorld.total).toBe(0);

    const novel = quickBuildWork(workspace, universeId, "novel", "zh-CN", NOW);
    expect(novel.kind).toBe("novel");
    expect(novel.chapters).toHaveLength(1);
    expect(worksOfKind(workspace, universeId, "game").map((w) => w.id)).toEqual(
      [game.id],
    );
    expect(worksOfKind(workspace, universeId).length).toBeGreaterThanOrEqual(2);
    expect(() =>
      quickBuildWork(workspace, "uni_missing", "novel", "en", NOW),
    ).toThrow("unknown world");
  });
});
