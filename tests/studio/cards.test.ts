import { describe, expect, test } from "bun:test";
import {
  appliedConstructs,
  applyConstruct,
  BUILT_IN_CONSTRUCTS,
  createCardBatch,
  defaultCardValues,
  deleteCardTypeFromDraft,
  duplicateCardType,
  reconcileCardValues,
} from "../../apps/studio/src/core/cards.ts";
import { createEmptyWorkspace } from "../../apps/studio/src/core/factory.ts";
import type { CardType } from "../../apps/studio/src/core/types.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";

const NOW = "2026-11-19T00:00:00.000Z";

function looterType(typeId: string, workspace = createEmptyWorkspace("en")) {
  applyConstruct(workspace, "looter", NOW);
  const type = workspace.cardTypes.find((item) => item.id === typeId);
  if (!type) throw new Error(`missing type ${typeId}`);
  return type;
}

describe("built-in constructs", () => {
  test("applying the looter construct adds editable types, cards and edges", () => {
    const workspace = createEmptyWorkspace("en");
    const result = applyConstruct(workspace, "looter", NOW);
    expect(result.status).toBe("applied");
    expect(workspace.cardTypes.map((type) => type.id)).toEqual([
      "cardtype_looter_scene",
      "cardtype_looter_monster",
      "cardtype_looter_equipment",
    ]);
    expect(workspace.cards.length).toBe(8);
    expect(workspace.cardEdges.length).toBe(6);
    expect(workspace.constructs).toEqual([
      {
        id: "looter",
        name: { zh: "刷子游戏", en: "Looter game" },
        appliedAt: NOW,
      },
    ]);
    // The whole result must still pass the strict workspace schema.
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("a construct cannot be applied twice", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    const again = applyConstruct(workspace, "looter", NOW);
    expect(again.status).toBe("already-applied");
    expect(workspace.cards.length).toBe(8);
    expect(workspace.constructs.length).toBe(1);
  });

  test("an unknown construct id changes nothing", () => {
    const workspace = createEmptyWorkspace("en");
    expect(applyConstruct(workspace, "nope", NOW).status).toBe("unknown");
    expect(workspace.cardTypes).toEqual([]);
    expect(workspace.constructs).toEqual([]);
  });

  test("applied constructs are listed newest first", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    workspace.constructs.push({
      id: "other",
      name: { zh: "其他", en: "Other" },
      appliedAt: "2026-11-20T00:00:00.000Z",
    });
    expect(appliedConstructs(workspace).map((item) => item.id)).toEqual([
      "other",
      "looter",
    ]);
    expect(BUILT_IN_CONSTRUCTS[0]?.id).toBe("looter");
  });

  test("sample values survive their own type definitions", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    for (const card of workspace.cards) {
      const type = workspace.cardTypes.find((item) => item.id === card.typeId);
      expect(type).toBeDefined();
      for (const key of Object.keys(card.values))
        expect(type!.fields.some((field) => field.key === key)).toBe(true);
    }
  });
});

describe("type templates", () => {
  test("duplicating a type copies its fields under a new identity", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    const original = workspace.cardTypes[1]!;
    const copy = duplicateCardType(original, NOW);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toEqual({ zh: "怪物 副本", en: "Monster copy" });
    expect(copy.fields).toEqual(original.fields);
    copy.fields[0]!.key = "renamed";
    expect(original.fields[0]!.key).toBe("level");
    workspace.cardTypes.push(copy);
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("deleting a type removes its cards and the relations that touched them", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    expect(deleteCardTypeFromDraft(workspace, "cardtype_looter_monster")).toBe(
      true,
    );
    expect(workspace.cardTypes.map((type) => type.id)).toEqual([
      "cardtype_looter_scene",
      "cardtype_looter_equipment",
    ]);
    expect(workspace.cards.map((card) => card.typeId)).toEqual([
      "cardtype_looter_scene",
      "cardtype_looter_scene",
      "cardtype_looter_equipment",
      "cardtype_looter_equipment",
    ]);
    expect(workspace.cardEdges).toEqual([]);
    expect(() => validateWorkspace(workspace)).not.toThrow();
    expect(deleteCardTypeFromDraft(workspace, "cardtype_looter_monster")).toBe(
      false,
    );
  });
});

describe("card batches", () => {
  test("createCardBatch numbers titles and fills defaults", () => {
    const type = looterType("cardtype_looter_monster");
    const batch = createCardBatch(type, {
      count: 3,
      titlePrefix: "骷髅",
      now: NOW,
    });
    expect(batch.map((card) => card.title.en)).toEqual([
      "骷髅 1",
      "骷髅 2",
      "骷髅 3",
    ]);
    expect(batch[0]!.values).toEqual(defaultCardValues(type));
    expect(batch[0]!.values.hp).toBe(
      type.fields.find((f) => f.key === "hp")?.defaultValue,
    );
  });

  test("batch size is clamped and a start index is honoured", () => {
    const type = looterType("cardtype_looter_monster");
    const batch = createCardBatch(type, {
      count: 900,
      titlePrefix: "狼",
      startIndex: 7,
      now: NOW,
    });
    expect(batch.length).toBe(500);
    expect(batch[0]!.title.en).toBe("狼 7");
    expect(createCardBatch(type, { count: -2, titlePrefix: "x" })).toEqual([]);
  });
});

describe("reconciling values after a type edit", () => {
  const type: CardType = {
    id: "cardtype_test",
    name: { zh: "测试", en: "Test" },
    summary: { zh: "", en: "" },
    color: "#336655",
    fields: [
      {
        key: "hp",
        label: { zh: "生命", en: "HP" },
        type: "integer",
        unit: "",
        min: 10,
        max: 100,
        enumValues: [],
      },
      {
        key: "tier",
        label: { zh: "级别", en: "Tier" },
        type: "enum",
        unit: "",
        enumValues: ["普通", "精英"],
      },
      {
        key: "tag",
        label: { zh: "标签", en: "Tag" },
        type: "text",
        unit: "",
        enumValues: [],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };

  test("clamps numbers, drops removed fields and stale enum values", () => {
    expect(
      reconcileCardValues(type, {
        hp: 999,
        tier: "传说",
        tag: 42,
        ghost: "旧字段",
      }),
    ).toEqual({ hp: 100, tag: "42" });
  });

  test("rounds integer fields and keeps valid values", () => {
    expect(
      reconcileCardValues(type, { hp: 55.6, tier: "精英", tag: "a" }),
    ).toEqual({ hp: 56, tier: "精英", tag: "a" });
  });
});

describe("card schema checks", () => {
  test("rejects values whose key is not a field of the type", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    workspace.cards[0]!.values.ghost = 1;
    expect(() => validateWorkspace(workspace)).toThrow();
  });

  test("rejects numeric fields holding text and non-integer integers", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    const monster = workspace.cards.find(
      (card) => card.typeId === "cardtype_looter_monster",
    )!;
    monster.values.hp = "lots";
    expect(() => validateWorkspace(workspace)).toThrow();
    monster.values.hp = 10.5;
    expect(() => validateWorkspace(workspace)).toThrow();
  });

  test("rejects edges that point at a missing card", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    workspace.cardEdges.push({
      id: "cardedge_missing",
      sourceId: "card_missing",
      targetId: workspace.cards[0]!.id,
      label: { zh: "指向", en: "Points at" },
      notes: "",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(() => validateWorkspace(workspace)).toThrow(/unknown card/);
  });

  test("rejects duplicate field keys and duplicate construct records", () => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    workspace.cardTypes[0]!.fields.push({
      ...workspace.cardTypes[0]!.fields[0]!,
    });
    expect(() => validateWorkspace(workspace)).toThrow();
    workspace.cardTypes[0]!.fields.pop();
    workspace.constructs.push({ ...workspace.constructs[0]! });
    expect(() => validateWorkspace(workspace)).toThrow();
  });

  const field = (
    overrides: Partial<CardType["fields"][number]> = {},
  ): CardType["fields"][number] => ({
    key: `extra${Math.random().toString(36).slice(2, 7)}`,
    label: { zh: "额外", en: "Extra" },
    type: "text",
    unit: "",
    enumValues: [],
    ...overrides,
  });

  test.each([
    [
      "min greater than max",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        const target = workspace.cardTypes[0]!.fields[0]!;
        target.min = 50;
        target.max = 10;
      },
    ],
    [
      "enum without values",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(field({ type: "enum" }));
      },
    ],
    [
      "enum default outside its values",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "enum", enumValues: ["a"], defaultValue: "b" }),
        );
      },
    ],
    [
      "numeric enum default",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "enum", enumValues: ["a"], defaultValue: 1 }),
        );
      },
    ],
    [
      "enum values on a text field",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "text", enumValues: ["a"] }),
        );
      },
    ],
    [
      "text default on a numeric field",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", defaultValue: "5" }),
        );
      },
    ],
    [
      "decimal default on an integer field",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", defaultValue: 1.5 }),
        );
      },
    ],
    [
      "numeric default on a text field",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "text", defaultValue: 3 }),
        );
      },
    ],
    [
      "default below the minimum",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", min: 10, defaultValue: 5 }),
        );
      },
    ],
    [
      "default above the maximum",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", max: 10, defaultValue: 50 }),
        );
      },
    ],
    [
      "unknown card type",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cards[0]!.typeId = "cardtype_missing";
      },
    ],
    [
      "text field holding a number",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        const card = workspace.cards.find(
          (item) => item.typeId === "cardtype_looter_scene",
        )!;
        card.values.mood = 3;
      },
    ],
    [
      "enum value outside the declared values",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        const card = workspace.cards.find(
          (item) => item.typeId === "cardtype_looter_monster",
        )!;
        card.values.tier = "传说";
      },
    ],
    [
      "value below the field minimum",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        const card = workspace.cards.find(
          (item) => item.typeId === "cardtype_looter_monster",
        )!;
        card.values.level = 0;
      },
    ],
    [
      "value above the field maximum",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        const card = workspace.cards.find(
          (item) => item.typeId === "cardtype_looter_monster",
        )!;
        card.values.level = 101;
      },
    ],
    [
      "duplicate card id",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cards.push({ ...workspace.cards[0]!, values: {} });
      },
    ],
    [
      "duplicate card edge id",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardEdges.push({ ...workspace.cardEdges[0]! });
      },
    ],
    [
      "duplicate card type id",
      (workspace: ReturnType<typeof createEmptyWorkspace>) => {
        workspace.cardTypes.push({ ...workspace.cardTypes[0]!, fields: [] });
      },
    ],
  ])("rejects an invalid field or value: %s", (_name, mutate) => {
    const workspace = createEmptyWorkspace("en");
    applyConstruct(workspace, "looter", NOW);
    mutate(workspace);
    expect(() => validateWorkspace(workspace)).toThrow();
  });

  test("migrates v8 workspaces by adding empty card collections", () => {
    const legacy = structuredClone(
      createEmptyWorkspace("en"),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 8;
    delete legacy.cardTypes;
    delete legacy.cards;
    delete legacy.cardEdges;
    delete legacy.constructs;
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(9);
    expect(migrated.cardTypes).toEqual([]);
    expect(migrated.cards).toEqual([]);
    expect(migrated.cardEdges).toEqual([]);
    expect(migrated.constructs).toEqual([]);
  });
});
