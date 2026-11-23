import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  deleteUniverseFromDraft,
  unlinkCharacterFromUniverse,
} from "../../apps/studio/src/core/integrity.ts";
import {
  abilityTemplateSchema,
  checkRuleLayerConsistency,
  deleteAbilityTemplateFromDraft,
  deleteItemStatTemplateFromDraft,
  deleteRuleSystemFromDraft,
  formatCharacterRuleBindings,
  formatStoryObjectRuleBinding,
  itemStatTemplateSchema,
  reconcileRuleSystemUpdate,
  ruleAttributeTypeLabel,
  ruleEffectLabel,
  ruleLayerPromptSection,
  ruleStatusLabel,
  ruleSystemKindLabel,
  ruleSystemSchema,
  validateAbilityTemplateRecord,
  validateAttributes,
  validateAttributeValues,
  validateCharacterRuleBindings,
  validateItemStatTemplateRecord,
  validateRuleSystemDefinition,
  validateRuleSystemRecord,
  validateStoryObjectRuleBinding,
} from "../../apps/studio/src/core/rule-layer.ts";
import type {
  AbilityTemplate,
  ItemStatTemplate,
  RuleAttribute,
  RuleSystem,
} from "../../apps/studio/src/core/types.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { buildWorkflowBrief } from "../../apps/studio/src/core/workflow.ts";

const NOW = "2026-11-09T00:00:00.000Z";

function powerSystem(overrides: Partial<RuleSystem> = {}): RuleSystem {
  return {
    id: "rules_tide",
    universeId: "uni_mist_harbor",
    title: { zh: "潮汐等级", en: "Tide tiers" },
    kind: "power",
    summary: "钟声强度决定潮汐等级。",
    unit: "级",
    tiers: [
      {
        id: "tier_1",
        name: { zh: "初响", en: "First chime" },
        rank: 1,
        minValue: 0,
        maxValue: 9,
        summary: "",
      },
      {
        id: "tier_2",
        name: { zh: "深钟", en: "Deep bell" },
        rank: 2,
        minValue: 10,
        maxValue: 19,
        summary: "",
      },
    ],
    attributes: [
      {
        key: "resonance",
        label: { zh: "共鸣", en: "Resonance" },
        type: "integer",
        unit: "点",
        min: 0,
        max: 100,
        enumValues: [],
        description: "钟声共鸣强度",
      },
    ],
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function ability(overrides: Partial<AbilityTemplate> = {}): AbilityTemplate {
  return {
    id: "ability_deep_chime",
    universeId: "uni_mist_harbor",
    ruleSystemId: "rules_tide",
    name: { zh: "深钟共鸣", en: "Deep resonance" },
    summary: { zh: "", en: "" },
    tierId: "tier_2",
    effects: [{ attributeKey: "resonance", operation: "add", value: 10 }],
    cost: "一段记忆",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function item(overrides: Partial<ItemStatTemplate> = {}): ItemStatTemplate {
  return {
    id: "item_notched_key",
    universeId: "uni_mist_harbor",
    ruleSystemId: "rules_tide",
    name: { zh: "缺口铜钥匙", en: "Notched brass key" },
    category: { zh: "遗物", en: "Relic" },
    tierId: "tier_1",
    stats: [{ attributeKey: "resonance", operation: "add", value: 5 }],
    summary: { zh: "", en: "" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function attribute(overrides: Partial<RuleAttribute> = {}): RuleAttribute {
  return {
    key: "resonance",
    label: { zh: "共鸣", en: "Resonance" },
    type: "integer",
    unit: "点",
    min: 0,
    max: 100,
    enumValues: [],
    description: "",
    ...overrides,
  };
}

function definition(
  overrides: {
    kind?: RuleSystem["kind"];
    tiers?: {
      id?: string;
      name: { zh: string; en: string };
      rank: number;
      minValue?: number;
      maxValue?: number;
    }[];
    attributes?: RuleAttribute[];
  } = {},
) {
  return {
    kind: overrides.kind ?? ("power" as const),
    tiers: overrides.tiers ?? [
      {
        id: "tier_1",
        name: { zh: "初响", en: "First chime" },
        rank: 1,
        minValue: 0,
        maxValue: 9,
      },
      {
        id: "tier_2",
        name: { zh: "深钟", en: "Deep bell" },
        rank: 2,
        minValue: 10,
        maxValue: 19,
      },
    ],
    attributes: overrides.attributes ?? [],
  };
}

describe("rule-layer validation", () => {
  test("a power ladder with ranges and typed attributes is valid", () => {
    expect(validateRuleSystemRecord(powerSystem())).toEqual([]);
  });

  test("a power system needs an ordered ladder with numeric ranges", () => {
    const oneTier = powerSystem();
    oneTier.tiers = [oneTier.tiers[0]!];
    expect(
      validateRuleSystemRecord(oneTier).map((issue) => issue.message),
    ).toContain("a power system needs at least two tiers");

    const missingRange = powerSystem();
    const second = missingRange.tiers[1]!;
    missingRange.tiers[1] = {
      id: second.id,
      name: second.name,
      rank: second.rank,
      summary: second.summary,
    };
    expect(
      validateRuleSystemRecord(missingRange).map((issue) => issue.message),
    ).toContain("a power tier needs minValue or maxValue");
  });

  test("ranks must be unique and consecutive from 1", () => {
    const duplicated = powerSystem();
    duplicated.tiers[1] = { ...duplicated.tiers[1]!, rank: 1 };
    const messages = validateRuleSystemRecord(duplicated).map(
      (issue) => issue.message,
    );
    expect(messages).toContain("duplicate tier rank: 1");

    const gapped = powerSystem();
    gapped.tiers[1] = { ...gapped.tiers[1]!, rank: 3 };
    expect(
      validateRuleSystemRecord(gapped).map((issue) => issue.message),
    ).toContain("tier ranks must be consecutive starting at 1");
  });

  test("effects must cite an attribute key of a numeric type", () => {
    const system = powerSystem();
    const unknown = ability({
      effects: [{ attributeKey: "luck", operation: "add", value: 1 }],
    });
    expect(validateAbilityTemplateRecord(unknown, system)).toEqual([
      {
        path: ["effects", 0, "attributeKey"],
        message: "unknown attribute: luck",
      },
    ]);

    const enumSystem = powerSystem({
      attributes: [
        {
          key: "school",
          label: { zh: "流派", en: "School" },
          type: "enum",
          unit: "",
          enumValues: ["tide", "bell"],
          description: "",
        },
      ],
    });
    const wrongType = ability({
      effects: [{ attributeKey: "school", operation: "add", value: 1 }],
    });
    expect(validateAbilityTemplateRecord(wrongType, enumSystem)).toEqual([
      {
        path: ["effects", 0, "attributeKey"],
        message: "effects require a numeric attribute",
      },
    ]);

    expect(validateItemStatTemplateRecord(item(), system)).toEqual([]);
    expect(
      validateItemStatTemplateRecord(item({ tierId: "tier_missing" }), system),
    ).toEqual([{ path: ["tierId"], message: "unknown tier" }]);
  });

  test("workspace validation rejects dangling rule references", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.ruleSystems.push(powerSystem());
    workspace.abilityTemplates.push(ability({ ruleSystemId: "rules_missing" }));
    expect(() => validateWorkspace(workspace)).toThrow();
  });

  test("deleting a universe removes its rule systems, abilities and items", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.ruleSystems.push(powerSystem());
    workspace.abilityTemplates.push(ability());
    workspace.itemStatTemplates.push(item());

    deleteUniverseFromDraft(workspace, "uni_mist_harbor");

    expect(workspace.ruleSystems).toEqual([]);
    expect(workspace.abilityTemplates).toEqual([]);
    expect(workspace.itemStatTemplates).toEqual([]);
  });
});

describe("rule-layer schema and definition diagnostics", () => {
  test("stored record schemas surface semantic issues at parse time", () => {
    const broken = powerSystem();
    broken.tiers[1] = { ...broken.tiers[1]!, rank: 1 };
    const parsedSystem = ruleSystemSchema.safeParse(broken);
    expect(parsedSystem.success).toBe(false);
    if (!parsedSystem.success)
      expect(parsedSystem.error.issues.map((issue) => issue.message)).toContain(
        "duplicate tier rank: 1",
      );

    const unnamedAbility = abilityTemplateSchema.safeParse(
      ability({ name: { zh: " ", en: "" } }),
    );
    expect(unnamedAbility.success).toBe(false);
    if (!unnamedAbility.success)
      expect(
        unnamedAbility.error.issues.map((issue) => issue.message),
      ).toContain("ability name is required");

    const unnamedItem = itemStatTemplateSchema.safeParse(
      item({ name: { zh: "", en: " " }, category: { zh: " ", en: "" } }),
    );
    expect(unnamedItem.success).toBe(false);
    if (!unnamedItem.success) {
      const messages = unnamedItem.error.issues.map((issue) => issue.message);
      expect(messages).toContain("item name is required");
      expect(messages).toContain("item category is required");
    }
  });

  test("ladder diagnostics cover ids, names and inverted ranges", () => {
    const duplicateId = validateRuleSystemDefinition(
      definition({
        tiers: [
          {
            id: "tier_1",
            name: { zh: "初响", en: "First chime" },
            rank: 1,
            minValue: 0,
            maxValue: 9,
          },
          {
            id: "tier_1",
            name: { zh: "深钟", en: "Deep bell" },
            rank: 2,
            minValue: 10,
            maxValue: 19,
          },
        ],
      }),
    );
    expect(duplicateId.map((issue) => issue.message)).toContain(
      "duplicate tier id: tier_1",
    );

    const blankName = validateRuleSystemDefinition(
      definition({
        tiers: [
          {
            id: "tier_1",
            name: { zh: "初响", en: "First chime" },
            rank: 1,
            minValue: 0,
            maxValue: 9,
          },
          {
            id: "tier_2",
            name: { zh: " ", en: "" },
            rank: 2,
            minValue: 10,
            maxValue: 19,
          },
        ],
      }),
    );
    expect(blankName.map((issue) => issue.message)).toContain(
      "tier name is required",
    );

    const inverted = validateRuleSystemDefinition(
      definition({
        tiers: [
          {
            id: "tier_1",
            name: { zh: "初响", en: "First chime" },
            rank: 1,
            minValue: 0,
            maxValue: 9,
          },
          {
            id: "tier_2",
            name: { zh: "深钟", en: "Deep bell" },
            rank: 2,
            minValue: 20,
            maxValue: 10,
          },
        ],
      }),
    );
    expect(inverted.map((issue) => issue.message)).toContain(
      "maxValue must be at least minValue",
    );
  });

  test("attribute keys, labels and numeric bounds are checked", () => {
    const messagesFor = (overrides: Partial<RuleAttribute>) =>
      validateAttributes([attribute(overrides)], []).map(
        (issue) => issue.message,
      );

    expect(messagesFor({ key: "1bad" })).toContain(
      "attribute key must be a letter followed by letters, digits, _ or -",
    );
    expect(validateAttributes([attribute(), attribute()], [])).toEqual([
      {
        path: [1, "key"],
        message: "duplicate attribute key: resonance",
      },
    ]);
    expect(messagesFor({ label: { zh: " ", en: "" } })).toContain(
      "attribute label is required",
    );
    expect(messagesFor({ min: 10, max: 5 })).toContain(
      "max must be at least min",
    );
    expect(messagesFor({ min: 0.5 })).toContain(
      "an integer attribute needs an integer min",
    );
    expect(messagesFor({ max: 9.5 })).toContain(
      "an integer attribute needs an integer max",
    );
  });

  test("enum and text attributes enforce their own shape", () => {
    const attributeMessages = (overrides: Partial<RuleAttribute>) =>
      validateAttributes([attribute(overrides)], []).map(
        (issue) => issue.message,
      );

    expect(attributeMessages({ type: "enum" })).toContain(
      "an enum attribute needs at least one value",
    );
    expect(
      attributeMessages({ type: "enum", enumValues: ["tide", "tide"] }),
    ).toContain("enumValues must be unique");
    expect(
      attributeMessages({ type: "enum", enumValues: ["tide"], min: 0 }),
    ).toContain("an enum attribute cannot declare min or max");
    expect(attributeMessages({ enumValues: ["tide"] })).toContain(
      "only an enum attribute may declare enumValues",
    );
    expect(attributeMessages({ type: "text", max: 5 })).toContain(
      "a text attribute cannot declare min or max",
    );
  });

  test("defaults must match the attribute type and bounds", () => {
    const defaultMessages = (overrides: Partial<RuleAttribute>) =>
      validateAttributes([attribute(overrides)], []).map(
        (issue) => issue.message,
      );

    expect(
      defaultMessages({ type: "enum", enumValues: ["tide"], defaultValue: 1 }),
    ).toContain("an enum attribute needs a string default");
    expect(
      defaultMessages({
        type: "enum",
        enumValues: ["tide"],
        defaultValue: "bell",
      }),
    ).toContain("defaultValue must be one of enumValues");
    expect(defaultMessages({ type: "text", defaultValue: 1 })).toContain(
      "a text attribute needs a string default",
    );
    expect(defaultMessages({ defaultValue: "one" })).toContain(
      "a numeric attribute needs a numeric default",
    );
    expect(defaultMessages({ defaultValue: 1.5 })).toContain(
      "an integer attribute needs an integer default",
    );
    expect(defaultMessages({ min: 5, defaultValue: 1 })).toContain(
      "defaultValue is below min",
    );
    expect(defaultMessages({ max: 5, defaultValue: 6 })).toContain(
      "defaultValue is above max",
    );
    expect(validateAttributes([attribute({ defaultValue: 5 })], [])).toEqual(
      [],
    );
  });

  test("each kind requires its own minimum shape", () => {
    expect(
      validateRuleSystemDefinition({
        kind: "attribute",
        tiers: [],
        attributes: [],
      }).map((issue) => issue.message),
    ).toContain("an attribute system needs at least one attribute");

    expect(
      validateRuleSystemDefinition({
        kind: "custom",
        tiers: [],
        attributes: [],
      }).map((issue) => issue.message),
    ).toContain("a rule system needs at least one tier or attribute");
  });

  test("set effects respect the attribute type and bounds", () => {
    const system = powerSystem();
    const setTo = (value: number) => [
      { attributeKey: "resonance", operation: "set" as const, value },
    ];

    expect(
      validateAbilityTemplateRecord(
        ability({ effects: setTo(2.5) }),
        system,
      ).map((issue) => issue.message),
    ).toContain("set needs an integer for an integer attribute");
    expect(
      validateAbilityTemplateRecord(
        ability({ effects: setTo(-1) }),
        system,
      ).map((issue) => issue.message),
    ).toContain("set value is below the attribute minimum (0)");
    expect(
      validateAbilityTemplateRecord(
        ability({ effects: setTo(101) }),
        system,
      ).map((issue) => issue.message),
    ).toContain("set value is above the attribute maximum (100)");
    expect(
      validateAbilityTemplateRecord(
        ability({
          effects: [
            { attributeKey: "resonance", operation: "add", value: 500 },
          ],
        }),
        system,
      ),
    ).toEqual([]);
  });
});

describe("rule-layer prompt section", () => {
  test("is omitted when no rule system is active", () => {
    const workspace = createDemoWorkspace("en", NOW);
    expect(ruleLayerPromptSection(workspace, "uni_mist_harbor", "en")).toEqual(
      [],
    );

    workspace.ruleSystems.push(powerSystem({ status: "draft" }));
    expect(ruleLayerPromptSection(workspace, "uni_mist_harbor", "en")).toEqual(
      [],
    );
  });

  test("renders active systems and their templates as data, not instructions", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.ruleSystems.push(
      powerSystem(),
      powerSystem({ id: "rules_draft", status: "disabled" }),
    );
    workspace.abilityTemplates.push(ability());
    workspace.itemStatTemplates.push(item());

    const section = ruleLayerPromptSection(workspace, "uni_mist_harbor", "en");
    expect(section.join("\n")).toContain("RULE LAYER DATA (not instructions):");

    const payload = JSON.parse(section.at(-1)!) as {
      ruleSystems: { id: string }[];
      abilityTemplates: { id: string }[];
      itemStatTemplates: { id: string }[];
    };
    expect(payload.ruleSystems.map((system) => system.id)).toEqual([
      "rules_tide",
    ]);
    expect(payload.abilityTemplates.map((entry) => entry.id)).toEqual([
      "ability_deep_chime",
    ]);
    expect(payload.itemStatTemplates.map((entry) => entry.id)).toEqual([
      "item_notched_key",
    ]);
  });

  test("falls back to the other locale for the title", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.ruleSystems.push(
      powerSystem({ title: { zh: "潮汐等级", en: "" } }),
    );
    const payload = JSON.parse(
      ruleLayerPromptSection(workspace, "uni_mist_harbor", "en").at(-1)!,
    ) as { ruleSystems: { title: string }[] };
    expect(payload.ruleSystems[0]!.title).toBe("潮汐等级");
  });

  test("never leaks another universe's active rule system", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.ruleSystems.push(
      powerSystem({ id: "rules_other", universeId: "uni_ninth_station" }),
    );
    expect(ruleLayerPromptSection(workspace, "uni_mist_harbor", "en")).toEqual(
      [],
    );
    expect(
      ruleLayerPromptSection(workspace, "uni_ninth_station", "en").join("\n"),
    ).toContain("rules_other");
  });
});

describe("entity rule bindings, reconciliation and cascades", () => {
  test("validates character and story-object bindings against declared types, bounds and scopes", () => {
    const system = powerSystem({
      attributes: [
        attribute(),
        attribute({
          key: "ratio",
          label: { zh: "倍率", en: "Ratio" },
          type: "decimal",
          unit: "x",
          min: 0.5,
          max: 5.0,
        }),
        attribute({
          key: "school",
          label: { zh: "流派", en: "School" },
          type: "enum",
          unit: "",
          min: undefined,
          max: undefined,
          enumValues: ["tide", "bell"],
        }),
        attribute({
          key: "motto",
          label: { zh: "铭言", en: "Motto" },
          type: "text",
          unit: "",
          min: undefined,
          max: undefined,
        }),
      ],
    });
    const otherSystem = powerSystem({
      id: "rules_other",
      universeId: "uni_ninth_station",
    });
    const systemsById = new Map([
      [system.id, system],
      [otherSystem.id, otherSystem],
    ]);
    const ab = ability();
    const otherAb = ability({
      id: "ability_other",
      universeId: "uni_ninth_station",
      ruleSystemId: "rules_other",
    });
    const abilitiesById = new Map([
      [ab.id, ab],
      [otherAb.id, otherAb],
    ]);
    const it = item();
    const otherItem = item({
      id: "item_other",
      universeId: "uni_ninth_station",
      ruleSystemId: "rules_other",
    });
    const itemsById = new Map([
      [it.id, it],
      [otherItem.id, otherItem],
    ]);

    expect(
      validateCharacterRuleBindings(
        {
          universeIds: ["uni_mist_harbor"],
          ruleBindings: [
            {
              ruleSystemId: system.id,
              tierId: "tier_2",
              attributes: {
                resonance: 42,
                ratio: 1.5,
                school: "tide",
                motto: "listen",
              },
              abilityIds: [ab.id],
            },
          ],
        },
        systemsById,
        abilitiesById,
      ),
    ).toEqual([]);

    const badCharIssues = validateCharacterRuleBindings(
      {
        universeIds: ["uni_mist_harbor"],
        ruleBindings: [
          {
            ruleSystemId: system.id,
            tierId: "tier_missing",
            attributes: {
              unknown_key: 1,
              resonance: 105,
              ratio: "bad",
              school: "invalid",
              motto: 123,
            },
            abilityIds: [ab.id, ab.id, "ability_missing", otherAb.id],
          },
          {
            ruleSystemId: system.id,
            attributes: { resonance: 1.5 },
            abilityIds: [],
          },
          {
            ruleSystemId: otherSystem.id,
            attributes: { resonance: -5 },
            abilityIds: [],
          },
          {
            ruleSystemId: "rules_missing",
            attributes: {},
            abilityIds: [],
          },
        ],
      },
      systemsById,
      abilitiesById,
    ).map((issue) => issue.message);
    expect(badCharIssues).toContain("unknown tier");
    expect(badCharIssues).toContain("unknown attribute: unknown_key");
    expect(badCharIssues).toContain(
      "value is above the attribute maximum (100)",
    );
    expect(badCharIssues).toContain("numeric attribute needs a number value");
    expect(badCharIssues).toContain(
      "enum value is not one of the declared values",
    );
    expect(badCharIssues).toContain("text attribute needs a string value");
    expect(badCharIssues).toContain(`duplicate ability: ${ab.id}`);
    expect(badCharIssues).toContain("unknown ability: ability_missing");
    expect(badCharIssues).toContain("ability belongs to another rule system");
    expect(badCharIssues).toContain(`duplicate rule system: ${system.id}`);
    expect(badCharIssues).toContain("integer attribute needs an integer value");
    expect(badCharIssues).toContain("rule system belongs to another universe");
    expect(badCharIssues).toContain("value is below the attribute minimum (0)");
    expect(badCharIssues).toContain("unknown rule system");

    expect(
      validateAttributeValues(
        { resonance: 10 },
        new Map(system.attributes.map((a) => [a.key, a])),
        [],
      ),
    ).toEqual([]);

    expect(
      validateStoryObjectRuleBinding(
        {
          universeId: "uni_mist_harbor",
          ruleBinding: {
            ruleSystemId: system.id,
            itemStatTemplateId: it.id,
            tierId: "tier_1",
            stats: [{ attributeKey: "resonance", operation: "add", value: 4 }],
          },
        },
        systemsById,
        itemsById,
      ),
    ).toEqual([]);

    expect(
      validateStoryObjectRuleBinding(
        {
          universeId: "uni_mist_harbor",
          ruleBinding: {
            ruleSystemId: "rules_missing",
            stats: [],
          },
        },
        systemsById,
        itemsById,
      ).map((i) => i.message),
    ).toContain("unknown rule system");

    const badObjectIssues = validateStoryObjectRuleBinding(
      {
        universeId: "uni_mist_harbor",
        ruleBinding: {
          ruleSystemId: otherSystem.id,
          itemStatTemplateId: "item_missing",
          tierId: "tier_missing",
          stats: [{ attributeKey: "missing", operation: "add", value: 1 }],
        },
      },
      systemsById,
      itemsById,
    ).map((i) => i.message);
    expect(badObjectIssues).toContain(
      "rule system belongs to another universe",
    );
    expect(badObjectIssues).toContain("unknown item stat template");
    expect(badObjectIssues).toContain("unknown tier");
    expect(badObjectIssues).toContain("unknown attribute: missing");

    expect(
      validateStoryObjectRuleBinding(
        {
          universeId: "uni_mist_harbor",
          ruleBinding: {
            ruleSystemId: system.id,
            itemStatTemplateId: otherItem.id,
            stats: [],
          },
        },
        systemsById,
        itemsById,
      ).map((i) => i.message),
    ).toContain("item stat template belongs to another rule system");
  });

  test("workspace validation enforces rule bindings, numeric effects and v14->v15 migration", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.ruleSystems.push(powerSystem());
    workspace.abilityTemplates.push(ability());
    workspace.itemStatTemplates.push(item());
    workspace.characters[0]!.ruleBindings = [
      {
        ruleSystemId: "rules_tide",
        tierId: "tier_2",
        attributes: { resonance: 55 },
        abilityIds: ["ability_deep_chime"],
      },
    ];
    workspace.storyObjects[0]!.ruleBinding = {
      ruleSystemId: "rules_tide",
      itemStatTemplateId: "item_notched_key",
      tierId: "tier_1",
      stats: [{ attributeKey: "resonance", operation: "add", value: 8 }],
    };
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const brokenBinding = structuredClone(workspace);
    brokenBinding.characters[0]!.ruleBindings![0]!.attributes.resonance = 999;
    expect(() => validateWorkspace(brokenBinding)).toThrow(
      /above the attribute maximum/,
    );

    const brokenObject = structuredClone(workspace);
    brokenObject.storyObjects[0]!.ruleBinding!.tierId = "tier_nope";
    expect(() => validateWorkspace(brokenObject)).toThrow(/unknown tier/);

    const legacyV14 = structuredClone(
      createDemoWorkspace("en", NOW),
    ) as unknown as Record<string, unknown>;
    legacyV14.schema_version = 14;
    legacyV14.revision = 10;
    const migrated = validateWorkspace(legacyV14);
    expect(migrated.schema_version).toBe(15);
    expect(migrated.revision).toBe(11);
  });

  test("reconcile and cascade helpers keep the workspace valid after edits and deletes", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.ruleSystems.push(
      powerSystem(),
      powerSystem({ id: "rules_train", universeId: "uni_ninth_station" }),
    );
    workspace.abilityTemplates.push(ability());
    workspace.itemStatTemplates.push(item());
    const gu = workspace.characters.find((item) => item.id === "char_gu")!;
    gu.ruleBindings = [
      {
        ruleSystemId: "rules_tide",
        tierId: "tier_2",
        attributes: { resonance: 90 },
        abilityIds: ["ability_deep_chime"],
      },
      {
        ruleSystemId: "rules_train",
        tierId: "tier_1",
        attributes: { resonance: 10 },
        abilityIds: [],
      },
    ];
    workspace.storyObjects[0]!.ruleBinding = {
      ruleSystemId: "rules_tide",
      itemStatTemplateId: "item_notched_key",
      tierId: "tier_2",
      stats: [{ attributeKey: "resonance", operation: "set", value: 90 }],
    };

    // Narrow resonance max to 50 and drop tier_2 -> reconcile cleans dependents
    const narrowed = powerSystem({
      tiers: [
        {
          id: "tier_1",
          name: { zh: "初响", en: "First chime" },
          rank: 1,
          minValue: 0,
          maxValue: 9,
          summary: "",
        },
        {
          id: "tier_new",
          name: { zh: "潮鸣", en: "Tide toll" },
          rank: 2,
          minValue: 10,
          maxValue: 19,
          summary: "",
        },
      ],
      attributes: [attribute({ max: 50 })],
    });
    workspace.ruleSystems[0] = narrowed;
    reconcileRuleSystemUpdate(workspace, narrowed);
    expect(workspace.abilityTemplates[0]!.tierId).toBeUndefined();
    expect(gu.ruleBindings![0]!.tierId).toBeUndefined();
    expect(gu.ruleBindings![0]!.attributes).toEqual({});
    expect(workspace.storyObjects[0]!.ruleBinding!.tierId).toBeUndefined();
    expect(workspace.storyObjects[0]!.ruleBinding!.stats).toEqual([]);
    expect(() => validateWorkspace(workspace)).not.toThrow();

    // Deleting ability & item templates clears entity links
    deleteAbilityTemplateFromDraft(workspace, "ability_deep_chime");
    expect(gu.ruleBindings![0]!.abilityIds).toEqual([]);
    deleteItemStatTemplateFromDraft(workspace, "item_notched_key");
    expect(
      workspace.storyObjects[0]!.ruleBinding!.itemStatTemplateId,
    ).toBeUndefined();
    expect(() => validateWorkspace(workspace)).not.toThrow();

    // Unlinking a cross-universe character prunes only the removed world's binding
    const unlinked = structuredClone(workspace);
    unlinkCharacterFromUniverse(unlinked, "char_gu", "uni_mist_harbor");
    const guUnlinked = unlinked.characters.find((c) => c.id === "char_gu")!;
    expect(guUnlinked.ruleBindings?.map((b) => b.ruleSystemId)).toEqual([
      "rules_train",
    ]);
    expect(() => validateWorkspace(unlinked)).not.toThrow();

    // Deleting a universe prunes bindings from surviving cross-universe characters
    const worldDeleted = structuredClone(workspace);
    deleteUniverseFromDraft(worldDeleted, "uni_mist_harbor");
    const guSurviving = worldDeleted.characters.find(
      (c) => c.id === "char_gu",
    )!;
    expect(guSurviving.ruleBindings?.map((b) => b.ruleSystemId)).toEqual([
      "rules_train",
    ]);
    expect(() => validateWorkspace(worldDeleted)).not.toThrow();

    // Deleting a rule system cascades templates and entity bindings
    deleteRuleSystemFromDraft(workspace, "rules_tide");
    expect(workspace.ruleSystems.map((s) => s.id)).toEqual(["rules_train"]);
    expect(gu.ruleBindings?.map((b) => b.ruleSystemId)).toEqual([
      "rules_train",
    ]);
    expect(workspace.storyObjects[0]!.ruleBinding).toBeUndefined();
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });
});

describe("rule-layer consistency check, briefs and ArcReel export", () => {
  test("reports out-of-ladder values, ladder gaps, overlaps and attribute bounds violations", () => {
    const workspace = createDemoWorkspace("zh-CN", NOW);
    workspace.ruleSystems.push(
      powerSystem({
        tiers: [
          {
            id: "tier_1",
            name: { zh: "初响", en: "First chime" },
            rank: 1,
            minValue: 1,
            maxValue: 9,
            summary: "",
          },
          {
            id: "tier_2",
            name: { zh: "深钟", en: "Deep bell" },
            rank: 2,
            minValue: 15,
            maxValue: 20,
            summary: "",
          },
        ],
        attributes: [attribute({ min: 5, max: 100 })],
      }),
      powerSystem({
        id: "rules_en_ladder",
        title: { zh: "英文刻度", en: "English ladder" },
        unit: "level",
        tiers: [
          {
            id: "tier_a",
            name: { zh: "低阶", en: "Low" },
            rank: 1,
            minValue: 1,
            maxValue: 10,
            summary: "",
          },
          {
            id: "tier_b",
            name: { zh: "高阶", en: "High" },
            rank: 2,
            minValue: 8,
            maxValue: 20,
            summary: "",
          },
        ],
        attributes: [],
      }),
      powerSystem({ id: "rules_draft", status: "draft" }),
    );
    workspace.works[0]!.chapters[0]!.content =
      "林舟此刻才0级，敌人已经突破到12级甚至25级；他的共鸣：2点，对方共鸣150点。level 30 exceeds 20.";
    workspace.workflowTasks[0]!.result.zh = "战力参考：30级，共鸣 120点。";

    const report = checkRuleLayerConsistency(workspace, "uni_mist_harbor", {
      locale: "zh-CN",
    });
    expect(report.summary.activeRuleSystems).toBe(2);
    expect(report.summary.draftRuleSystems).toBe(1);
    expect(report.summary.checkedRuleSystems).toBe(2);
    expect(report.summary.chaptersScanned).toBeGreaterThan(0);
    expect(report.summary.workflowTasksScanned).toBeGreaterThan(0);
    const kinds = new Set(report.findings.map((finding) => finding.kind));
    expect(kinds.has("tier-range-gap")).toBe(true);
    expect(kinds.has("tier-range-overlap")).toBe(true);
    expect(kinds.has("below-ladder")).toBe(true);
    expect(kinds.has("ladder-gap")).toBe(true);
    expect(kinds.has("above-ladder")).toBe(true);
    expect(kinds.has("attribute-below-min")).toBe(true);
    expect(kinds.has("attribute-above-max")).toBe(true);

    const draftCheck = checkRuleLayerConsistency(workspace, "uni_mist_harbor", {
      locale: "en",
      ruleSystemId: "rules_en_ladder",
      text: "The guardian stands at level 25 while novices begin at 5 level.",
    });
    expect(
      draftCheck.findings.some(
        (f) => f.kind === "above-ladder" && f.value === 25,
      ),
    ).toBe(true);
    expect(draftCheck.findings.some((f) => f.value === 5)).toBe(false);
  });

  test("formats labels and injects bindings into workflow briefs", () => {
    const workspace = createDemoWorkspace("en", NOW);
    const active = powerSystem();
    const draft = powerSystem({ id: "rules_draft_only", status: "draft" });
    workspace.ruleSystems.push(active, draft);
    workspace.abilityTemplates.push(
      ability(),
      ability({ id: "ability_draft", ruleSystemId: "rules_draft_only" }),
    );
    workspace.itemStatTemplates.push(item());
    workspace.characters[0]!.ruleBindings = [
      {
        ruleSystemId: "rules_tide",
        tierId: "tier_2",
        attributes: { resonance: 45 },
        abilityIds: ["ability_deep_chime"],
      },
    ];
    workspace.storyObjects[0]!.ruleBinding = {
      ruleSystemId: "rules_tide",
      itemStatTemplateId: "item_notched_key",
      tierId: "tier_1",
      stats: [
        { attributeKey: "resonance", operation: "add", value: 5 },
        { attributeKey: "resonance", operation: "multiply", value: 1.5 },
        { attributeKey: "resonance", operation: "set", value: 20 },
      ],
    };

    expect(ruleSystemKindLabel("power", "en")).toBe("Power / tier ladder");
    expect(ruleSystemKindLabel("attribute", "zh-CN")).toBe("属性体系");
    expect(ruleStatusLabel("active", "en")).toBe("Active");
    expect(ruleAttributeTypeLabel("enum", "zh-CN")).toBe("枚举");
    expect(
      ruleEffectLabel(
        { attributeKey: "resonance", operation: "multiply", value: 2 },
        active,
        "en",
      ),
    ).toBe("Resonance ×2");
    expect(
      ruleEffectLabel(
        { attributeKey: "resonance", operation: "set", value: 10 },
        active,
        "en",
      ),
    ).toBe("Resonance = 10 点");

    const charLines = formatCharacterRuleBindings(
      workspace,
      workspace.characters[0]!,
      "uni_mist_harbor",
      "en",
    );
    expect(charLines[0]).toContain("Deep bell");
    expect(charLines[0]).toContain("45");
    expect(charLines[0]).toContain("Deep resonance");

    const objLine = formatStoryObjectRuleBinding(
      workspace,
      workspace.storyObjects[0]!,
      "en",
    );
    expect(objLine).toContain("Notched brass key");
    expect(objLine).toContain("First chime");

    const brief = buildWorkflowBrief(workspace, "task_chapter_three", "en");
    expect(brief).toContain("Rule standing");
    expect(brief).toContain("Deep bell");
    expect(brief).toContain("Structured stats");
  });
});
