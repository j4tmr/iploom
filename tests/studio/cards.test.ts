import { describe, expect, test } from "bun:test";
import {
  appliedConstructs,
  applyConstruct,
  BUILT_IN_CONSTRUCTS,
  cardExportRecord,
  cardUniverseId,
  createCard,
  createCardBatch,
  defaultCardValues,
  deleteCardTypeFromDraft,
  duplicateCardType,
  isKnownCardBehavior,
  parseCardFieldInput,
  previewFieldsForType,
  reconcileCardValues,
  reorderCardFields,
  resolveCardBehavior,
  resolveCardIcon,
  setLocalizedTitle,
} from "../../apps/studio/src/core/cards.ts";
import {
  createDemoWorkspace,
  createEmptyWorkspace,
  localized,
} from "../../apps/studio/src/core/factory.ts";
import type {
  CardType,
  StudioWorkspace,
} from "../../apps/studio/src/core/types.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";

const NOW = "2026-11-19T00:00:00.000Z";

function demo(): { workspace: StudioWorkspace; universeId: string } {
  const workspace = createDemoWorkspace("en", NOW);
  return { workspace, universeId: workspace.universes[0]!.id };
}

function applyLooter(workspace: StudioWorkspace, universeId: string): void {
  const result = applyConstruct(workspace, "looter", universeId, NOW);
  if (result.status !== "applied") throw new Error(result.status);
}

function typeIn(
  workspace: StudioWorkspace,
  universeId: string,
  name: string,
): CardType {
  const type = workspace.cardTypes.find(
    (item) => item.universeId === universeId && item.name.en === name,
  );
  if (!type) throw new Error(`missing type ${name} in ${universeId}`);
  return type;
}

function cardTypeId(
  workspace: StudioWorkspace,
  universeId: string,
  name: string,
): string {
  return typeIn(workspace, universeId, name).id;
}

describe("built-in constructs", () => {
  test("applying the looter construct adds editable types, cards and edges", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    expect(workspace.cardTypes.map((type) => type.name.en)).toEqual([
      "Scene",
      "Monster",
      "Equipment",
    ]);
    expect(new Set(workspace.cardTypes.map((type) => type.id)).size).toBe(3);
    expect(
      workspace.cardTypes.every((type) => type.universeId === universeId),
    ).toBe(true);
    expect(workspace.cards.length).toBe(8);
    expect(workspace.cardEdges.length).toBe(6);
    expect(workspace.constructs).toEqual([
      {
        id: "looter",
        universeId,
        name: { zh: "刷子游戏", en: "Looter game" },
        appliedAt: NOW,
      },
    ]);
    // The whole result must still pass the strict workspace schema.
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("a construct cannot be applied twice in the same universe", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const again = applyConstruct(workspace, "looter", universeId, NOW);
    expect(again.status).toBe("already-applied");
    expect(workspace.cards.length).toBe(8);
    expect(workspace.constructs.length).toBe(1);
  });

  test("the same construct can be applied in another universe", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const otherUniverse = workspace.universes[1]!.id;
    applyLooter(workspace, otherUniverse);
    expect(workspace.cardTypes.length).toBe(6);
    expect(workspace.cards.length).toBe(16);
    expect(workspace.cardEdges.length).toBe(12);
    expect(workspace.constructs.length).toBe(2);
    expect(
      workspace.cardTypes.filter((type) => type.universeId === otherUniverse),
    ).toHaveLength(3);
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("an unknown construct id or universe changes nothing", () => {
    const { workspace, universeId } = demo();
    expect(applyConstruct(workspace, "nope", universeId, NOW).status).toBe(
      "unknown",
    );
    expect(applyConstruct(workspace, "looter", "uni_missing", NOW).status).toBe(
      "unknown",
    );
    expect(workspace.cardTypes).toEqual([]);
    expect(workspace.constructs).toEqual([]);
  });

  test("applied constructs are listed per universe, newest first", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    workspace.constructs.push({
      id: "other",
      universeId,
      name: { zh: "其他", en: "Other" },
      appliedAt: "2026-11-20T00:00:00.000Z",
    });
    workspace.constructs.push({
      id: "other",
      universeId: workspace.universes[1]!.id,
      name: { zh: "其他", en: "Other" },
      appliedAt: "2026-11-21T00:00:00.000Z",
    });
    expect(
      appliedConstructs(workspace, universeId).map((item) => item.id),
    ).toEqual(["other", "looter"]);
    expect(BUILT_IN_CONSTRUCTS[0]?.id).toBe("looter");
  });

  test("sample values survive their own type definitions", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    for (const card of workspace.cards) {
      const type = workspace.cardTypes.find((item) => item.id === card.typeId);
      expect(type).toBeDefined();
      for (const key of Object.keys(card.values))
        expect(type!.fields.some((field) => field.key === key)).toBe(true);
    }
  });

  test("every generated card resolves to the universe of its type", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    for (const card of workspace.cards)
      expect(cardUniverseId(workspace, card)).toBe(universeId);
  });
});

describe("type templates", () => {
  test("duplicating a type copies its fields under a new identity", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const original = typeIn(workspace, universeId, "Monster");
    const copy = duplicateCardType(original, NOW);
    expect(copy.id).not.toBe(original.id);
    expect(copy.universeId).toBe(universeId);
    expect(copy.name).toEqual({ zh: "怪物 副本", en: "Monster copy" });
    expect(copy.fields).toEqual(original.fields);
    copy.fields[0]!.key = "renamed";
    expect(original.fields[0]!.key).toBe("level");
    workspace.cardTypes.push(copy);
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("deleting a type removes its cards and the relations that touched them", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const monsterTypeId = cardTypeId(workspace, universeId, "Monster");
    expect(deleteCardTypeFromDraft(workspace, monsterTypeId)).toBe(true);
    expect(workspace.cardTypes.map((type) => type.name.en)).toEqual([
      "Scene",
      "Equipment",
    ]);
    expect(workspace.cards.map((card) => card.typeId)).toEqual([
      cardTypeId(workspace, universeId, "Scene"),
      cardTypeId(workspace, universeId, "Scene"),
      cardTypeId(workspace, universeId, "Equipment"),
      cardTypeId(workspace, universeId, "Equipment"),
    ]);
    expect(workspace.cardEdges).toEqual([]);
    expect(() => validateWorkspace(workspace)).not.toThrow();
    expect(deleteCardTypeFromDraft(workspace, monsterTypeId)).toBe(false);
  });
});

describe("card batches", () => {
  test("createCardBatch numbers titles and fills defaults", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const type = typeIn(workspace, universeId, "Monster");
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
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const type = typeIn(workspace, universeId, "Monster");
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
    id: "ctype_test",
    universeId: "uni_mist_harbor",
    name: { zh: "测试", en: "Test" },
    summary: { zh: "", en: "" },
    icon: "layers",
    color: "#336655",
    behavior: "generic",
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
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    workspace.cards[0]!.values.ghost = 1;
    expect(() => validateWorkspace(workspace)).toThrow();
  });

  test("rejects numeric fields holding text and non-integer integers", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const monster = workspace.cards.find(
      (card) => card.typeId === cardTypeId(workspace, universeId, "Monster"),
    )!;
    monster.values.hp = "lots";
    expect(() => validateWorkspace(workspace)).toThrow();
    monster.values.hp = 10.5;
    expect(() => validateWorkspace(workspace)).toThrow();
  });

  test("rejects edges that point at a missing card", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
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

  test("rejects a relation between cards of different universes", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    const otherUniverse = workspace.universes[1]!.id;
    applyLooter(workspace, otherUniverse);
    const mine = workspace.cards.find(
      (card) => card.typeId === cardTypeId(workspace, universeId, "Monster"),
    )!;
    const foreign = workspace.cards.find(
      (card) => card.typeId === cardTypeId(workspace, otherUniverse, "Scene"),
    )!;
    workspace.cardEdges.push({
      id: "cardedge_cross",
      sourceId: mine.id,
      targetId: foreign.id,
      label: localized("跨越", "Crosses"),
      notes: "",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(() => validateWorkspace(workspace)).toThrow(/crosses universe/);
  });

  test("rejects duplicate field keys and construct records within a universe", () => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    workspace.cardTypes[0]!.fields.push({
      ...workspace.cardTypes[0]!.fields[0]!,
    });
    expect(() => validateWorkspace(workspace)).toThrow();
    workspace.cardTypes[0]!.fields.pop();
    workspace.constructs.push({ ...workspace.constructs[0]! });
    expect(() => validateWorkspace(workspace)).toThrow();
    workspace.constructs.pop();
    workspace.constructs.push({
      ...workspace.constructs[0]!,
      universeId: workspace.universes[1]!.id,
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("scopes work-owned packs to their work and its universe", () => {
    const { workspace, universeId } = demo();
    const work = workspace.works.find(
      (item) => item.universeId === universeId,
    )!;
    applyConstruct(workspace, "looter", universeId, NOW, work.id);
    expect(() => validateWorkspace(workspace)).not.toThrow();
    // The same construct may also exist at world level, and in two works.
    applyConstruct(workspace, "looter", universeId, NOW);
    const second = structuredClone(work);
    second.id = "work_scope_second";
    workspace.works.push(second);
    applyConstruct(workspace, "looter", universeId, NOW, second.id);
    expect(() => validateWorkspace(workspace)).not.toThrow();

    // A pack cannot point at a work that does not exist.
    workspace.cardTypes[0]!.workId = "work_missing";
    expect(() => validateWorkspace(workspace)).toThrow(/unknown work/);
    workspace.cardTypes[0]!.workId = work.id;

    // Nor at a work that belongs to another universe.
    const other = workspace.universes[1]!.id;
    const foreignWork = workspace.works.find(
      (item) => item.universeId === other,
    );
    expect(foreignWork).toBeDefined();
    workspace.constructs[0]!.workId = foreignWork!.id;
    expect(() => validateWorkspace(workspace)).toThrow(
      /work belongs to another universe/,
    );

    // The applied-construct record carries the same rule.
    workspace.constructs[0]!.workId = "work_missing";
    expect(() => validateWorkspace(workspace)).toThrow(/unknown work/);
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
      (workspace: StudioWorkspace) => {
        const target = workspace.cardTypes[0]!.fields[0]!;
        target.min = 50;
        target.max = 10;
      },
    ],
    [
      "enum without values",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(field({ type: "enum" }));
      },
    ],
    [
      "enum default outside its values",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "enum", enumValues: ["a"], defaultValue: "b" }),
        );
      },
    ],
    [
      "numeric enum default",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "enum", enumValues: ["a"], defaultValue: 1 }),
        );
      },
    ],
    [
      "enum values on a text field",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "text", enumValues: ["a"] }),
        );
      },
    ],
    [
      "text default on a numeric field",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", defaultValue: "5" }),
        );
      },
    ],
    [
      "decimal default on an integer field",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", defaultValue: 1.5 }),
        );
      },
    ],
    [
      "numeric default on a text field",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "text", defaultValue: 3 }),
        );
      },
    ],
    [
      "default below the minimum",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", min: 10, defaultValue: 5 }),
        );
      },
    ],
    [
      "default above the maximum",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes[0]!.fields.push(
          field({ type: "integer", max: 10, defaultValue: 50 }),
        );
      },
    ],
    [
      "unknown card type",
      (workspace: StudioWorkspace) => {
        workspace.cards[0]!.typeId = "cardtype_missing";
      },
    ],
    [
      "text field holding a number",
      (workspace: StudioWorkspace) => {
        const card = workspace.cards.find(
          (item) => item.typeId === workspace.cardTypes[0]!.id,
        )!;
        card.values.mood = 3;
      },
    ],
    [
      "enum value outside the declared values",
      (workspace: StudioWorkspace) => {
        const card = workspace.cards.find(
          (item) => item.typeId === workspace.cardTypes[1]!.id,
        )!;
        card.values.tier = "传说";
      },
    ],
    [
      "value below the field minimum",
      (workspace: StudioWorkspace) => {
        const card = workspace.cards.find(
          (item) => item.typeId === workspace.cardTypes[1]!.id,
        )!;
        card.values.level = 0;
      },
    ],
    [
      "value above the field maximum",
      (workspace: StudioWorkspace) => {
        const card = workspace.cards.find(
          (item) => item.typeId === workspace.cardTypes[1]!.id,
        )!;
        card.values.level = 101;
      },
    ],
    [
      "duplicate card id",
      (workspace: StudioWorkspace) => {
        workspace.cards.push({ ...workspace.cards[0]!, values: {} });
      },
    ],
    [
      "duplicate card edge id",
      (workspace: StudioWorkspace) => {
        workspace.cardEdges.push({ ...workspace.cardEdges[0]! });
      },
    ],
    [
      "duplicate card type id",
      (workspace: StudioWorkspace) => {
        workspace.cardTypes.push({ ...workspace.cardTypes[0]!, fields: [] });
      },
    ],
  ])("rejects an invalid field or value: %s", (_name, mutate) => {
    const { workspace, universeId } = demo();
    applyLooter(workspace, universeId);
    mutate(workspace);
    expect(() => validateWorkspace(workspace)).toThrow();
  });
});

describe("universe scoping migrations", () => {
  test("migrates v8 workspaces by adding empty card collections", () => {
    const legacy = structuredClone(
      createEmptyWorkspace("Test", "en", NOW),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 8;
    delete legacy.cardTypes;
    delete legacy.cards;
    delete legacy.cardEdges;
    delete legacy.constructs;
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(12);
    expect(migrated.cardTypes).toEqual([]);
    expect(migrated.cards).toEqual([]);
    expect(migrated.cardEdges).toEqual([]);
    expect(migrated.constructs).toEqual([]);
  });

  test("assigns v9 node data to the first universe", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", NOW),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 9;
    legacy.revision = 20;
    legacy.cardTypes = [
      {
        id: "ctype_legacy",
        name: { zh: "旧类型", en: "Legacy type" },
        summary: { zh: "", en: "" },
        color: "#336655",
        fields: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    legacy.constructs = [
      {
        id: "looter",
        name: { zh: "刷子游戏", en: "Looter game" },
        appliedAt: NOW,
      },
    ];
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(12);
    expect(migrated.revision).toBe(23);
    expect(migrated.cardTypes[0]!.universeId).toBe("uni_mist_harbor");
    expect(migrated.cardTypes[0]!.icon).toBe("layers");
    expect(migrated.cardTypes[0]!.behavior).toBe("generic");
    expect(migrated.constructs[0]!.universeId).toBe("uni_mist_harbor");
    expect(migrated.universes.map((universe) => universe.id)).toEqual([
      "uni_mist_harbor",
      "uni_ninth_station",
    ]);
  });

  test("creates a node workshop universe for v9 node data without universes", () => {
    const legacy = structuredClone(
      createEmptyWorkspace("Test", "en", NOW),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 9;
    legacy.cardTypes = [
      {
        id: "ctype_legacy",
        name: { zh: "旧类型", en: "Legacy type" },
        summary: { zh: "", en: "" },
        color: "#336655",
        fields: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(12);
    expect(migrated.universes).toHaveLength(1);
    expect(migrated.universes[0]!.id).toBe("universe_node_workshop");
    expect(migrated.cardTypes[0]!.universeId).toBe("universe_node_workshop");
    expect(migrated.cardTypes[0]!.icon).toBe("layers");
    expect(migrated.cardTypes[0]!.behavior).toBe("generic");
  });

  test("does not create a universe when v9 has no node data", () => {
    const legacy = structuredClone(
      createEmptyWorkspace("Test", "en", NOW),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 9;
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(12);
    expect(migrated.universes).toEqual([]);
  });

  test("migrates v11 card types by backfilling default icon and behavior without clobbering custom keys", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", NOW),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 11;
    legacy.revision = 5;
    legacy.cardTypes = [
      {
        id: "ctype_v11",
        universeId: "uni_mist_harbor",
        name: { zh: "旧节点", en: "Old node" },
        summary: { zh: "", en: "" },
        color: "#336655",
        fields: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "ctype_custom_behavior",
        universeId: "uni_mist_harbor",
        name: { zh: "任务节点", en: "Quest node" },
        summary: { zh: "", en: "" },
        icon: "timeline",
        color: "#336655",
        behavior: "quest_node",
        fields: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(12);
    expect(migrated.revision).toBe(6);
    expect(migrated.cardTypes[0]!.icon).toBe("layers");
    expect(migrated.cardTypes[0]!.behavior).toBe("generic");
    expect(migrated.cardTypes[1]!.icon).toBe("timeline");
    expect(migrated.cardTypes[1]!.behavior).toBe("quest_node");
  });
});

describe("card behaviors, icon fallback, field ordering and novel starter pack", () => {
  test("resolves known behaviors and falls back cleanly to generic for unknown keys", () => {
    expect(isKnownCardBehavior("character")).toBe(true);
    expect(isKnownCardBehavior("future_plugin")).toBe(false);
    expect(isKnownCardBehavior(undefined)).toBe(false);
    expect(resolveCardBehavior("character").exportKind).toBe("character");
    expect(resolveCardBehavior("future_plugin").key).toBe("generic");
    expect(resolveCardBehavior("future_plugin").exportKind).toBe("card");
    expect(resolveCardIcon("book", "generic")).toBe("book");
    expect(resolveCardIcon("unknown_icon", "monster")).toBe("sparkles");
    expect(resolveCardIcon(undefined, "future_plugin")).toBe("layers");
  });

  test("previewFieldsForType prioritizes behavior fields and falls back to declared order", () => {
    const { workspace, universeId } = demo();
    applyConstruct(workspace, "novel-bible", universeId, NOW);
    const charType = typeIn(workspace, universeId, "Character");
    expect(
      previewFieldsForType(charType)
        .map((f) => f.key)
        .slice(0, 3),
    ).toEqual(["role", "faction", "status"]);
    const unknownType: CardType = {
      ...charType,
      id: "ctype_unknown_behavior",
      behavior: "custom_plugin",
    };
    expect(previewFieldsForType(unknownType).map((f) => f.key)).toEqual(
      unknownType.fields.map((f) => f.key),
    );
    const sampleCard = createCard(unknownType, {
      title: localized("插件卡", "Plugin card"),
      now: NOW,
    });
    const mapped = cardExportRecord(unknownType, sampleCard);
    expect(mapped.behavior).toBe("custom_plugin");
    expect(mapped.resolvedBehavior).toBe("generic");
    expect(mapped.exportKind).toBe("card");
  });

  test("novel-bible construct seeds 5 editable base types, sample cards and edges", () => {
    const { workspace, universeId } = demo();
    const applied = applyConstruct(workspace, "novel-bible", universeId, NOW);
    expect(applied.status).toBe("applied");
    expect(workspace.cardTypes.map((type) => type.behavior)).toEqual([
      "character",
      "location",
      "faction",
      "object",
      "lore",
    ]);
    expect(workspace.cards).toHaveLength(5);
    expect(workspace.cardEdges).toHaveLength(4);
    expect(() => validateWorkspace(workspace)).not.toThrow();
    expect(
      applyConstruct(workspace, "novel-bible", universeId, NOW).status,
    ).toBe("already-applied");
  });

  test("reorderCardFields, parseCardFieldInput and setLocalizedTitle handle valid and invalid inputs", () => {
    expect(reorderCardFields(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderCardFields(["a", "b"], 0, 0)).toEqual(["a", "b"]);
    expect(reorderCardFields(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(reorderCardFields(["a", "b"], 0, 5)).toEqual(["a", "b"]);

    expect(
      parseCardFieldInput(
        {
          key: "hp",
          label: localized("生命", "HP"),
          type: "integer",
          unit: "",
          min: 1,
          max: 100,
          enumValues: [],
        },
        "",
      ),
    ).toEqual({ ok: true });
    expect(
      parseCardFieldInput(
        {
          key: "hp",
          label: localized("生命", "HP"),
          type: "integer",
          unit: "",
          min: 1,
          max: 100,
          enumValues: [],
        },
        "abc",
      ),
    ).toEqual({ ok: false, reason: "number" });
    expect(
      parseCardFieldInput(
        {
          key: "hp",
          label: localized("生命", "HP"),
          type: "integer",
          unit: "",
          min: 1,
          max: 100,
          enumValues: [],
        },
        "12.5",
      ),
    ).toEqual({ ok: false, reason: "integer" });
    expect(
      parseCardFieldInput(
        {
          key: "hp",
          label: localized("生命", "HP"),
          type: "integer",
          unit: "",
          min: 1,
          max: 100,
          enumValues: [],
        },
        "0",
      ),
    ).toEqual({ ok: false, reason: "min" });
    expect(
      parseCardFieldInput(
        {
          key: "hp",
          label: localized("生命", "HP"),
          type: "integer",
          unit: "",
          min: 1,
          max: 100,
          enumValues: [],
        },
        "101",
      ),
    ).toEqual({ ok: false, reason: "max" });
    expect(
      parseCardFieldInput(
        {
          key: "hp",
          label: localized("生命", "HP"),
          type: "integer",
          unit: "",
          min: 1,
          max: 100,
          enumValues: [],
        },
        "50",
      ),
    ).toEqual({ ok: true, value: 50 });
    expect(
      parseCardFieldInput(
        {
          key: "tier",
          label: localized("级别", "Tier"),
          type: "enum",
          unit: "",
          enumValues: ["普通", "精英"],
        },
        "传说",
      ),
    ).toEqual({ ok: false, reason: "enum" });
    expect(
      parseCardFieldInput(
        {
          key: "tier",
          label: localized("级别", "Tier"),
          type: "enum",
          unit: "",
          enumValues: ["普通", "精英"],
        },
        "",
      ),
    ).toEqual({ ok: true });
    expect(
      parseCardFieldInput(
        {
          key: "tier",
          label: localized("级别", "Tier"),
          type: "enum",
          unit: "",
          enumValues: ["普通", "精英"],
        },
        "精英",
      ),
    ).toEqual({ ok: true, value: "精英" });
    expect(
      parseCardFieldInput(
        {
          key: "note",
          label: localized("注", "Note"),
          type: "text",
          unit: "",
          enumValues: [],
        },
        "",
      ),
    ).toEqual({ ok: true });
    expect(
      parseCardFieldInput(
        {
          key: "note",
          label: localized("注", "Note"),
          type: "text",
          unit: "",
          enumValues: [],
        },
        "hello",
      ),
    ).toEqual({ ok: true, value: "hello" });

    expect(setLocalizedTitle({ zh: "旧", en: "Old" }, "en", "  New  ")).toEqual(
      { zh: "旧", en: "New" },
    );
    expect(
      setLocalizedTitle({ zh: "旧", en: "Old" }, "zh-CN", "  新  "),
    ).toEqual({ zh: "新", en: "Old" });
  });

  test("rejects malformed card behavior or icon keys while accepting valid unknown behavior keys", () => {
    const { workspace, universeId } = demo();
    workspace.cardTypes.push({
      id: "ctype_custom",
      universeId,
      name: localized("自定义", "Custom"),
      summary: localized("", ""),
      icon: "layers",
      color: "#336655",
      behavior: "custom_quest",
      fields: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const badBehavior = structuredClone(workspace);
    badBehavior.cardTypes[0]!.behavior = "BAD KEY!";
    expect(() => validateWorkspace(badBehavior)).toThrow();

    const badIcon = structuredClone(workspace);
    badIcon.cardTypes[0]!.icon = "../evil";
    expect(() => validateWorkspace(badIcon)).toThrow();
  });
});
