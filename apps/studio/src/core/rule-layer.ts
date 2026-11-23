import { z } from "zod";
import type {
  AbilityTemplate,
  Character,
  CharacterRuleBinding,
  ItemStatTemplate,
  LocalizedText,
  RuleAttribute,
  RuleAttributeType,
  RuleEffect,
  RuleEffectOperation,
  RuleStatus,
  RuleSystem,
  RuleSystemKind,
  RuleTier,
  StoryObject,
  StoryObjectRuleBinding,
  StudioWorkspace,
  UiLocale,
} from "./types.ts";

/**
 * Structured world rules: an ordered tier ladder plus typed attributes that
 * abilities and items reference by key.
 *
 * The rule layer is deliberately separate from `WorkspaceStandard`. Prose
 * standards say what the author wants; this layer is the machine-readable part
 * a prompt, a save-time check or a downstream tool can actually parse. Both are
 * drafts until the author activates them, and neither replaces the other.
 */

export const MAX_RULE_SYSTEMS = 200;
export const MAX_RULE_TIERS = 50;
export const MAX_RULE_ATTRIBUTES = 50;
export const MAX_RULE_ENUM_VALUES = 50;
export const MAX_RULE_EFFECTS = 30;
export const MAX_ABILITY_TEMPLATES = 2_000;
export const MAX_ITEM_STAT_TEMPLATES = 2_000;
export const MAX_CHARACTER_RULE_BINDINGS = 50;
export const MAX_CHARACTER_ABILITIES = 100;

export const RULE_SYSTEM_KINDS: readonly RuleSystemKind[] = [
  "power",
  "attribute",
  "custom",
];
export const RULE_ATTRIBUTE_TYPES: readonly RuleAttributeType[] = [
  "integer",
  "decimal",
  "enum",
  "text",
];
export const RULE_EFFECT_OPERATIONS: readonly RuleEffectOperation[] = [
  "add",
  "set",
  "multiply",
];

/** Keys are local to one rule system; they are not workspace identifiers. */
const ruleKeyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
/** Shared by stored records and AI drafts, which carry keys instead of ids. */
export const ruleKeySchema = z
  .string()
  .trim()
  .regex(ruleKeyPattern, "invalid rule key");
const identifier = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/, "invalid identifier");
const isoDate = z.string().datetime({ offset: true });
const finiteNumber = z.number();
const positiveInt = z.number().int().positive();

const localizedTextSchema = z
  .object({
    zh: z.string().max(500).default(""),
    en: z.string().max(500).default(""),
  })
  .strict();

const ruleSystemKindSchema: z.ZodType<RuleSystemKind> = z.enum([
  "power",
  "attribute",
  "custom",
]);
const ruleAttributeTypeSchema: z.ZodType<RuleAttributeType> = z.enum([
  "integer",
  "decimal",
  "enum",
  "text",
]);
const ruleStatusSchema = z.enum(["draft", "active", "disabled"]);

export const ruleEffectSchema = z
  .object({
    attributeKey: ruleKeySchema,
    operation: z.enum(["add", "set", "multiply"]),
    value: finiteNumber,
  })
  .strict();

export const ruleAttributeSchema = z
  .object({
    key: ruleKeySchema,
    label: localizedTextSchema,
    type: ruleAttributeTypeSchema,
    unit: z.string().trim().max(40).default(""),
    min: finiteNumber.optional(),
    max: finiteNumber.optional(),
    enumValues: z
      .array(z.string().trim().min(1).max(100))
      .max(MAX_RULE_ENUM_VALUES)
      .default([]),
    defaultValue: z
      .union([finiteNumber, z.string().trim().max(100)])
      .optional(),
    description: z.string().trim().max(4_000).default(""),
  })
  .strict();

export const ruleTierSchema = z
  .object({
    id: identifier,
    name: localizedTextSchema,
    rank: positiveInt,
    minValue: finiteNumber.optional(),
    maxValue: finiteNumber.optional(),
    summary: z.string().trim().max(4_000).default(""),
  })
  .strict();

export const ruleSystemSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    title: localizedTextSchema,
    kind: ruleSystemKindSchema,
    summary: z.string().trim().max(10_000).default(""),
    unit: z.string().trim().max(40).default(""),
    tiers: z.array(ruleTierSchema).max(MAX_RULE_TIERS).default([]),
    attributes: z
      .array(ruleAttributeSchema)
      .max(MAX_RULE_ATTRIBUTES)
      .default([]),
    status: ruleStatusSchema,
    version: positiveInt,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()
  .superRefine((system, ctx) => {
    if (!system.title.zh.trim() && !system.title.en.trim())
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "rule system title is required",
      });
    for (const issue of validateRuleSystemRecord(system))
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
  });

export const ruleAttributeValueSchema = z.union([
  finiteNumber,
  z.string().max(10_000),
]);

export const characterRuleBindingSchema: z.ZodType<CharacterRuleBinding> = z
  .object({
    ruleSystemId: identifier,
    tierId: identifier.optional(),
    attributes: z.record(ruleKeySchema, ruleAttributeValueSchema).default({}),
    abilityIds: z.array(identifier).max(MAX_CHARACTER_ABILITIES).default([]),
  })
  .strict();

export const storyObjectRuleBindingSchema: z.ZodType<StoryObjectRuleBinding> = z
  .object({
    ruleSystemId: identifier,
    itemStatTemplateId: identifier.optional(),
    tierId: identifier.optional(),
    stats: z.array(ruleEffectSchema).max(MAX_RULE_EFFECTS).default([]),
  })
  .strict();

export const abilityTemplateSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    ruleSystemId: identifier,
    name: localizedTextSchema,
    summary: localizedTextSchema,
    tierId: identifier.optional(),
    effects: z.array(ruleEffectSchema).max(MAX_RULE_EFFECTS).default([]),
    cost: z.string().trim().max(2_000).default(""),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()
  .superRefine((ability, ctx) => {
    if (!ability.name.zh.trim() && !ability.name.en.trim())
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "ability name is required",
      });
  });

export const itemStatTemplateSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    ruleSystemId: identifier,
    name: localizedTextSchema,
    category: localizedTextSchema,
    tierId: identifier.optional(),
    stats: z.array(ruleEffectSchema).max(MAX_RULE_EFFECTS).default([]),
    summary: localizedTextSchema,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (!item.name.zh.trim() && !item.name.en.trim())
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "item name is required",
      });
    if (!item.category.zh.trim() && !item.category.en.trim())
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "item category is required",
      });
  });

/** A validation finding whose path is relative to the record being checked. */
export interface RuleIssue {
  path: (string | number)[];
  message: string;
}

interface TierDefinition {
  id?: string;
  name: LocalizedText;
  rank: number;
  minValue?: number;
  maxValue?: number;
}

interface AttributeDefinition {
  key: string;
  label: LocalizedText;
  type: RuleAttributeType;
  unit: string;
  min?: number;
  max?: number;
  enumValues: string[];
  defaultValue?: number | string;
}

const isBlank = (text: LocalizedText) => !text.zh.trim() && !text.en.trim();

function numericBoundsIssue(
  attribute: AttributeDefinition,
  path: (string | number)[],
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (
    attribute.min !== undefined &&
    attribute.max !== undefined &&
    attribute.min > attribute.max
  )
    issues.push({
      path: [...path, "max"],
      message: "max must be at least min",
    });
  if (
    attribute.type === "integer" &&
    attribute.min !== undefined &&
    !Number.isInteger(attribute.min)
  )
    issues.push({
      path: [...path, "min"],
      message: "an integer attribute needs an integer min",
    });
  if (
    attribute.type === "integer" &&
    attribute.max !== undefined &&
    !Number.isInteger(attribute.max)
  )
    issues.push({
      path: [...path, "max"],
      message: "an integer attribute needs an integer max",
    });
  return issues;
}

function defaultValueIssue(
  attribute: AttributeDefinition,
  path: (string | number)[],
): RuleIssue[] {
  if (attribute.defaultValue === undefined) return [];
  if (attribute.type === "enum") {
    if (typeof attribute.defaultValue !== "string")
      return [
        {
          path: [...path, "defaultValue"],
          message: "an enum attribute needs a string default",
        },
      ];
    if (!attribute.enumValues.includes(attribute.defaultValue))
      return [
        {
          path: [...path, "defaultValue"],
          message: "defaultValue must be one of enumValues",
        },
      ];
    return [];
  }
  if (attribute.type === "text") {
    return typeof attribute.defaultValue === "string"
      ? []
      : [
          {
            path: [...path, "defaultValue"],
            message: "a text attribute needs a string default",
          },
        ];
  }
  if (typeof attribute.defaultValue !== "number")
    return [
      {
        path: [...path, "defaultValue"],
        message: "a numeric attribute needs a numeric default",
      },
    ];
  const issues: RuleIssue[] = [];
  if (attribute.type === "integer" && !Number.isInteger(attribute.defaultValue))
    issues.push({
      path: [...path, "defaultValue"],
      message: "an integer attribute needs an integer default",
    });
  if (attribute.min !== undefined && attribute.defaultValue < attribute.min)
    issues.push({
      path: [...path, "defaultValue"],
      message: "defaultValue is below min",
    });
  if (attribute.max !== undefined && attribute.defaultValue > attribute.max)
    issues.push({
      path: [...path, "defaultValue"],
      message: "defaultValue is above max",
    });
  return issues;
}

/** Validate the ordered ladder and its numeric ranges. */
export function validateTiers(
  tiers: readonly TierDefinition[],
  path: (string | number)[],
  options: { requireRange: boolean },
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const ranks = new Set<number>();
  const ids = new Set<string>();
  for (const [index, tier] of tiers.entries()) {
    if (tier.id !== undefined) {
      if (ids.has(tier.id))
        issues.push({
          path: [...path, index, "id"],
          message: `duplicate tier id: ${tier.id}`,
        });
      ids.add(tier.id);
    }
    if (isBlank(tier.name))
      issues.push({
        path: [...path, index, "name"],
        message: "tier name is required",
      });
    if (ranks.has(tier.rank))
      issues.push({
        path: [...path, index, "rank"],
        message: `duplicate tier rank: ${tier.rank}`,
      });
    ranks.add(tier.rank);
    if (
      tier.minValue !== undefined &&
      tier.maxValue !== undefined &&
      tier.minValue > tier.maxValue
    )
      issues.push({
        path: [...path, index, "maxValue"],
        message: "maxValue must be at least minValue",
      });
    if (
      options.requireRange &&
      tier.minValue === undefined &&
      tier.maxValue === undefined
    )
      issues.push({
        path: [...path, index],
        message: "a power tier needs minValue or maxValue",
      });
  }
  if (ranks.size) {
    const sorted = [...ranks].sort((left, right) => left - right);
    if (sorted.some((rank, index) => rank !== index + 1))
      issues.push({
        path,
        message: "tier ranks must be consecutive starting at 1",
      });
  }
  return issues;
}

/** Validate typed attribute definitions and their defaults. */
export function validateAttributes(
  attributes: readonly AttributeDefinition[],
  path: (string | number)[],
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const keys = new Set<string>();
  for (const [index, attribute] of attributes.entries()) {
    const attributePath = [...path, index];
    if (!ruleKeyPattern.test(attribute.key))
      issues.push({
        path: [...attributePath, "key"],
        message:
          "attribute key must be a letter followed by letters, digits, _ or -",
      });
    if (keys.has(attribute.key))
      issues.push({
        path: [...attributePath, "key"],
        message: `duplicate attribute key: ${attribute.key}`,
      });
    keys.add(attribute.key);
    if (isBlank(attribute.label))
      issues.push({
        path: [...attributePath, "label"],
        message: "attribute label is required",
      });
    if (attribute.type === "enum") {
      if (!attribute.enumValues.length)
        issues.push({
          path: [...attributePath, "enumValues"],
          message: "an enum attribute needs at least one value",
        });
      if (new Set(attribute.enumValues).size !== attribute.enumValues.length)
        issues.push({
          path: [...attributePath, "enumValues"],
          message: "enumValues must be unique",
        });
      if (attribute.min !== undefined || attribute.max !== undefined)
        issues.push({
          path: attributePath,
          message: "an enum attribute cannot declare min or max",
        });
    } else if (attribute.enumValues.length) {
      issues.push({
        path: [...attributePath, "enumValues"],
        message: "only an enum attribute may declare enumValues",
      });
    }
    if (attribute.type === "text") {
      if (attribute.min !== undefined || attribute.max !== undefined)
        issues.push({
          path: attributePath,
          message: "a text attribute cannot declare min or max",
        });
    }
    issues.push(...numericBoundsIssue(attribute, attributePath));
    issues.push(...defaultValueIssue(attribute, attributePath));
  }
  return issues;
}

/** Validate numeric effects against the attributes they cite. */
export function validateEffects(
  effects: readonly RuleEffect[],
  attributes: ReadonlyMap<string, AttributeDefinition>,
  path: (string | number)[],
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  for (const [index, effect] of effects.entries()) {
    const attribute = attributes.get(effect.attributeKey);
    if (!attribute) {
      issues.push({
        path: [...path, index, "attributeKey"],
        message: `unknown attribute: ${effect.attributeKey}`,
      });
      continue;
    }
    if (attribute.type !== "integer" && attribute.type !== "decimal") {
      issues.push({
        path: [...path, index, "attributeKey"],
        message: "effects require a numeric attribute",
      });
      continue;
    }
    if (effect.operation !== "set") continue;
    if (attribute.type === "integer" && !Number.isInteger(effect.value))
      issues.push({
        path: [...path, index, "value"],
        message: "set needs an integer for an integer attribute",
      });
    if (attribute.min !== undefined && effect.value < attribute.min)
      issues.push({
        path: [...path, index, "value"],
        message: `set value is below the attribute minimum (${attribute.min})`,
      });
    if (attribute.max !== undefined && effect.value > attribute.max)
      issues.push({
        path: [...path, index, "value"],
        message: `set value is above the attribute maximum (${attribute.max})`,
      });
  }
  return issues;
}

function validateKindShape(
  kind: RuleSystemKind,
  tierCount: number,
  attributeCount: number,
  path: (string | number)[],
): RuleIssue[] {
  if (kind === "power" && tierCount < 2)
    return [
      {
        path: [...path, "tiers"],
        message: "a power system needs at least two tiers",
      },
    ];
  if (kind === "attribute" && attributeCount < 1)
    return [
      {
        path: [...path, "attributes"],
        message: "an attribute system needs at least one attribute",
      },
    ];
  if (kind === "custom" && tierCount + attributeCount < 1)
    return [
      { path, message: "a rule system needs at least one tier or attribute" },
    ];
  return [];
}

/** Semantic checks shared by the stored record and the AI draft. */
export function validateRuleSystemDefinition(
  system: {
    kind: RuleSystemKind;
    tiers: readonly TierDefinition[];
    attributes: readonly AttributeDefinition[];
  },
  path: (string | number)[] = [],
): RuleIssue[] {
  const issues = validateKindShape(
    system.kind,
    system.tiers.length,
    system.attributes.length,
    path,
  );
  issues.push(
    ...validateTiers(system.tiers, [...path, "tiers"], {
      requireRange: system.kind === "power",
    }),
  );
  issues.push(
    ...validateAttributes(system.attributes, [...path, "attributes"]),
  );
  return issues;
}

export function validateRuleSystemRecord(system: RuleSystem): RuleIssue[] {
  return validateRuleSystemDefinition(system);
}

function attributesByKey(
  attributes: readonly AttributeDefinition[],
): Map<string, AttributeDefinition> {
  return new Map(attributes.map((attribute) => [attribute.key, attribute]));
}

export function validateAbilityTemplateRecord(
  ability: AbilityTemplate,
  system: RuleSystem,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (
    ability.tierId &&
    !system.tiers.some((tier) => tier.id === ability.tierId)
  )
    issues.push({ path: ["tierId"], message: "unknown tier" });
  issues.push(
    ...validateEffects(ability.effects, attributesByKey(system.attributes), [
      "effects",
    ]),
  );
  return issues;
}

export function validateItemStatTemplateRecord(
  item: ItemStatTemplate,
  system: RuleSystem,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (item.tierId && !system.tiers.some((tier) => tier.id === item.tierId))
    issues.push({ path: ["tierId"], message: "unknown tier" });
  issues.push(
    ...validateEffects(item.stats, attributesByKey(system.attributes), [
      "stats",
    ]),
  );
  return issues;
}

/** Validate concrete attribute values assigned to an entity against a system. */
export function validateAttributeValues(
  values: Readonly<Record<string, number | string>>,
  attributes: ReadonlyMap<string, AttributeDefinition>,
  path: (string | number)[],
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  for (const [key, value] of Object.entries(values)) {
    const fieldPath = [...path, key];
    const attribute = attributes.get(key);
    if (!attribute) {
      issues.push({ path: fieldPath, message: `unknown attribute: ${key}` });
      continue;
    }
    if (attribute.type === "text") {
      if (typeof value !== "string")
        issues.push({
          path: fieldPath,
          message: "text attribute needs a string value",
        });
      continue;
    }
    if (attribute.type === "enum") {
      if (typeof value !== "string" || !attribute.enumValues.includes(value))
        issues.push({
          path: fieldPath,
          message: "enum value is not one of the declared values",
        });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({
        path: fieldPath,
        message: "numeric attribute needs a number value",
      });
      continue;
    }
    if (attribute.type === "integer" && !Number.isInteger(value))
      issues.push({
        path: fieldPath,
        message: "integer attribute needs an integer value",
      });
    if (attribute.min !== undefined && value < attribute.min)
      issues.push({
        path: fieldPath,
        message: `value is below the attribute minimum (${attribute.min})`,
      });
    if (attribute.max !== undefined && value > attribute.max)
      issues.push({
        path: fieldPath,
        message: `value is above the attribute maximum (${attribute.max})`,
      });
  }
  return issues;
}

export function validateCharacterRuleBindings(
  character: Pick<Character, "universeIds" | "ruleBindings">,
  ruleSystemsById: ReadonlyMap<string, RuleSystem>,
  abilityTemplatesById: ReadonlyMap<string, AbilityTemplate>,
  path: (string | number)[] = ["ruleBindings"],
): RuleIssue[] {
  const bindings = character.ruleBindings ?? [];
  const issues: RuleIssue[] = [];
  const seenSystems = new Set<string>();
  for (const [index, binding] of bindings.entries()) {
    const bindingPath = [...path, index];
    if (seenSystems.has(binding.ruleSystemId))
      issues.push({
        path: [...bindingPath, "ruleSystemId"],
        message: `duplicate rule system: ${binding.ruleSystemId}`,
      });
    seenSystems.add(binding.ruleSystemId);
    const system = ruleSystemsById.get(binding.ruleSystemId);
    if (!system) {
      issues.push({
        path: [...bindingPath, "ruleSystemId"],
        message: "unknown rule system",
      });
      continue;
    }
    if (!character.universeIds.includes(system.universeId))
      issues.push({
        path: [...bindingPath, "ruleSystemId"],
        message: "rule system belongs to another universe",
      });
    if (
      binding.tierId &&
      !system.tiers.some((tier) => tier.id === binding.tierId)
    )
      issues.push({
        path: [...bindingPath, "tierId"],
        message: "unknown tier",
      });
    issues.push(
      ...validateAttributeValues(
        binding.attributes,
        attributesByKey(system.attributes),
        [...bindingPath, "attributes"],
      ),
    );
    const seenAbilities = new Set<string>();
    for (const [abilityIndex, abilityId] of binding.abilityIds.entries()) {
      const abilityPath = [...bindingPath, "abilityIds", abilityIndex];
      if (seenAbilities.has(abilityId))
        issues.push({
          path: abilityPath,
          message: `duplicate ability: ${abilityId}`,
        });
      seenAbilities.add(abilityId);
      const ability = abilityTemplatesById.get(abilityId);
      if (!ability)
        issues.push({
          path: abilityPath,
          message: `unknown ability: ${abilityId}`,
        });
      else if (ability.ruleSystemId !== binding.ruleSystemId)
        issues.push({
          path: abilityPath,
          message: "ability belongs to another rule system",
        });
    }
  }
  return issues;
}

export function validateStoryObjectRuleBinding(
  storyObject: Pick<StoryObject, "universeId" | "ruleBinding">,
  ruleSystemsById: ReadonlyMap<string, RuleSystem>,
  itemStatTemplatesById: ReadonlyMap<string, ItemStatTemplate>,
  path: (string | number)[] = ["ruleBinding"],
): RuleIssue[] {
  const binding = storyObject.ruleBinding;
  if (!binding) return [];
  const issues: RuleIssue[] = [];
  const system = ruleSystemsById.get(binding.ruleSystemId);
  if (!system) {
    issues.push({
      path: [...path, "ruleSystemId"],
      message: "unknown rule system",
    });
    return issues;
  }
  if (system.universeId !== storyObject.universeId)
    issues.push({
      path: [...path, "ruleSystemId"],
      message: "rule system belongs to another universe",
    });
  if (binding.itemStatTemplateId) {
    const template = itemStatTemplatesById.get(binding.itemStatTemplateId);
    if (!template)
      issues.push({
        path: [...path, "itemStatTemplateId"],
        message: "unknown item stat template",
      });
    else if (template.ruleSystemId !== binding.ruleSystemId)
      issues.push({
        path: [...path, "itemStatTemplateId"],
        message: "item stat template belongs to another rule system",
      });
  }
  if (
    binding.tierId &&
    !system.tiers.some((tier) => tier.id === binding.tierId)
  )
    issues.push({ path: [...path, "tierId"], message: "unknown tier" });
  issues.push(
    ...validateEffects(binding.stats, attributesByKey(system.attributes), [
      ...path,
      "stats",
    ]),
  );
  return issues;
}

/** Workspace-wide cross-entity checks for rule systems, templates and bindings. */
export function validateRuleLayerWorkspace(
  workspace: Pick<
    StudioWorkspace,
    | "universes"
    | "ruleSystems"
    | "abilityTemplates"
    | "itemStatTemplates"
    | "characters"
    | "storyObjects"
  >,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const universes = new Set(workspace.universes.map((item) => item.id));
  const ruleSystemsById = new Map(
    workspace.ruleSystems.map((item) => [item.id, item]),
  );
  const abilitiesById = new Map(
    workspace.abilityTemplates.map((item) => [item.id, item]),
  );
  const itemsById = new Map(
    workspace.itemStatTemplates.map((item) => [item.id, item]),
  );

  for (const [index, system] of workspace.ruleSystems.entries()) {
    if (!universes.has(system.universeId))
      issues.push({
        path: ["ruleSystems", index, "universeId"],
        message: "unknown universe",
      });
  }
  for (const [index, ability] of workspace.abilityTemplates.entries()) {
    const system = ruleSystemsById.get(ability.ruleSystemId);
    if (!universes.has(ability.universeId))
      issues.push({
        path: ["abilityTemplates", index, "universeId"],
        message: "unknown universe",
      });
    if (!system) {
      issues.push({
        path: ["abilityTemplates", index, "ruleSystemId"],
        message: "unknown rule system",
      });
      continue;
    }
    if (system.universeId !== ability.universeId)
      issues.push({
        path: ["abilityTemplates", index, "ruleSystemId"],
        message: "rule system belongs to another universe",
      });
    for (const found of validateAbilityTemplateRecord(ability, system))
      issues.push({
        path: ["abilityTemplates", index, ...found.path],
        message: found.message,
      });
  }
  for (const [index, item] of workspace.itemStatTemplates.entries()) {
    const system = ruleSystemsById.get(item.ruleSystemId);
    if (!universes.has(item.universeId))
      issues.push({
        path: ["itemStatTemplates", index, "universeId"],
        message: "unknown universe",
      });
    if (!system) {
      issues.push({
        path: ["itemStatTemplates", index, "ruleSystemId"],
        message: "unknown rule system",
      });
      continue;
    }
    if (system.universeId !== item.universeId)
      issues.push({
        path: ["itemStatTemplates", index, "ruleSystemId"],
        message: "rule system belongs to another universe",
      });
    for (const found of validateItemStatTemplateRecord(item, system))
      issues.push({
        path: ["itemStatTemplates", index, ...found.path],
        message: found.message,
      });
  }
  for (const [index, character] of workspace.characters.entries()) {
    if (!character.ruleBindings?.length) continue;
    issues.push(
      ...validateCharacterRuleBindings(
        character,
        ruleSystemsById,
        abilitiesById,
        ["characters", index, "ruleBindings"],
      ),
    );
  }
  for (const [index, object] of workspace.storyObjects.entries()) {
    if (!object.ruleBinding) continue;
    issues.push(
      ...validateStoryObjectRuleBinding(object, ruleSystemsById, itemsById, [
        "storyObjects",
        index,
        "ruleBinding",
      ]),
    );
  }
  return issues;
}

/** Keep only attribute values that still satisfy a revised rule system. */
export function reconcileRuleAttributeValues(
  system: RuleSystem,
  values: Readonly<Record<string, number | string>>,
): Record<string, number | string> {
  const attributes = attributesByKey(system.attributes);
  const kept: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (validateAttributeValues({ [key]: value }, attributes, []).length === 0)
      kept[key] = value;
  }
  return kept;
}

function keepValidEffects(
  effects: readonly RuleEffect[],
  attributes: ReadonlyMap<string, AttributeDefinition>,
): RuleEffect[] {
  return effects.filter(
    (effect) => validateEffects([effect], attributes, []).length === 0,
  );
}

/**
 * Reconcile linked templates and entity bindings after a rule system is edited
 * in the UI (for example removing a tier or narrowing an attribute bound).
 */
export function reconcileRuleSystemUpdate(
  draft: StudioWorkspace,
  nextSystem: RuleSystem,
): void {
  const tierIds = new Set(nextSystem.tiers.map((tier) => tier.id));
  const attributes = attributesByKey(nextSystem.attributes);
  for (const ability of draft.abilityTemplates) {
    if (ability.ruleSystemId !== nextSystem.id) continue;
    if (ability.tierId && !tierIds.has(ability.tierId)) delete ability.tierId;
    ability.effects = keepValidEffects(ability.effects, attributes);
  }
  for (const item of draft.itemStatTemplates) {
    if (item.ruleSystemId !== nextSystem.id) continue;
    if (item.tierId && !tierIds.has(item.tierId)) delete item.tierId;
    item.stats = keepValidEffects(item.stats, attributes);
  }
  for (const character of draft.characters) {
    if (!character.ruleBindings?.length) continue;
    for (const binding of character.ruleBindings) {
      if (binding.ruleSystemId !== nextSystem.id) continue;
      if (binding.tierId && !tierIds.has(binding.tierId)) delete binding.tierId;
      binding.attributes = reconcileRuleAttributeValues(
        nextSystem,
        binding.attributes,
      );
    }
  }
  for (const object of draft.storyObjects) {
    const binding = object.ruleBinding;
    if (!binding || binding.ruleSystemId !== nextSystem.id) continue;
    if (binding.tierId && !tierIds.has(binding.tierId)) delete binding.tierId;
    binding.stats = keepValidEffects(binding.stats, attributes);
  }
}

/** Delete a rule system together with its templates and entity bindings. */
export function deleteRuleSystemFromDraft(
  draft: StudioWorkspace,
  ruleSystemId: string,
): void {
  draft.ruleSystems = draft.ruleSystems.filter(
    (system) => system.id !== ruleSystemId,
  );
  draft.abilityTemplates = draft.abilityTemplates.filter(
    (ability) => ability.ruleSystemId !== ruleSystemId,
  );
  draft.itemStatTemplates = draft.itemStatTemplates.filter(
    (item) => item.ruleSystemId !== ruleSystemId,
  );
  for (const character of draft.characters) {
    if (!character.ruleBindings?.length) continue;
    const kept = character.ruleBindings.filter(
      (binding) => binding.ruleSystemId !== ruleSystemId,
    );
    if (kept.length) character.ruleBindings = kept;
    else delete character.ruleBindings;
  }
  for (const object of draft.storyObjects) {
    if (object.ruleBinding?.ruleSystemId === ruleSystemId)
      delete object.ruleBinding;
  }
}

/** Delete an ability template and drop it from every character's bindings. */
export function deleteAbilityTemplateFromDraft(
  draft: StudioWorkspace,
  abilityId: string,
): void {
  draft.abilityTemplates = draft.abilityTemplates.filter(
    (ability) => ability.id !== abilityId,
  );
  for (const character of draft.characters) {
    if (!character.ruleBindings?.length) continue;
    for (const binding of character.ruleBindings) {
      binding.abilityIds = binding.abilityIds.filter((id) => id !== abilityId);
    }
  }
}

/** Delete an item stat template and clear references on story objects. */
export function deleteItemStatTemplateFromDraft(
  draft: StudioWorkspace,
  itemTemplateId: string,
): void {
  draft.itemStatTemplates = draft.itemStatTemplates.filter(
    (item) => item.id !== itemTemplateId,
  );
  for (const object of draft.storyObjects) {
    if (object.ruleBinding?.itemStatTemplateId === itemTemplateId)
      delete object.ruleBinding.itemStatTemplateId;
  }
}

/** Remove a character's bindings to rule systems belonging to a removed world. */
export function pruneCharacterRuleBindingsForUniverse(
  character: Character,
  universeId: string,
  ruleSystems: readonly RuleSystem[],
): void {
  if (!character.ruleBindings?.length) return;
  const removed = new Set(
    ruleSystems
      .filter((system) => system.universeId === universeId)
      .map((system) => system.id),
  );
  if (!removed.size) return;
  const kept = character.ruleBindings.filter(
    (binding) => !removed.has(binding.ruleSystemId),
  );
  if (kept.length) character.ruleBindings = kept;
  else delete character.ruleBindings;
}

export type RuleConsistencyFindingKind =
  | "below-ladder"
  | "above-ladder"
  | "ladder-gap"
  | "attribute-below-min"
  | "attribute-above-max"
  | "tier-range-gap"
  | "tier-range-overlap";

export type RuleConsistencySourceKind =
  | "ruleSystem"
  | "chapter"
  | "workflowTask"
  | "text";

export interface RuleConsistencyFinding {
  kind: RuleConsistencyFindingKind;
  severity: "warning" | "info";
  ruleSystemId: string;
  sourceKind: RuleConsistencySourceKind;
  sourceId: string;
  sourceLabel: string;
  excerpt: string;
  value?: number;
  unit?: string;
  attributeKey?: string;
  message: string;
}

export interface RuleConsistencySummary {
  activeRuleSystems: number;
  draftRuleSystems: number;
  checkedRuleSystems: number;
  chaptersScanned: number;
  workflowTasksScanned: number;
  boundCharacters: number;
  totalCharacters: number;
  boundObjects: number;
  totalObjects: number;
  totalFindings: number;
}

export interface RuleConsistencyReport {
  universeId: string;
  summary: RuleConsistencySummary;
  findings: RuleConsistencyFinding[];
}

export interface RuleConsistencyOptions {
  ruleSystemId?: string;
  includeDraftSystems?: boolean;
  text?: string;
  textLabel?: string;
  locale?: UiLocale;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAsciiWord(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function excerptAround(text: string, start: number, length: number): string {
  const from = Math.max(0, start - 24);
  const to = Math.min(text.length, start + length + 24);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to).replace(/\s+/g, " ").trim()}${suffix}`;
}

function collectUnitNumberMatches(
  text: string,
  unit: string,
): Array<{ value: number; index: number; length: number }> {
  const trimmed = unit.trim();
  if (!trimmed) return [];
  const escaped = escapeRegExp(trimmed);
  const patterns: RegExp[] = isAsciiWord(trimmed)
    ? [
        new RegExp(
          `(?<![A-Za-z0-9_.])(-?\\d+(?:\\.\\d+)?)\\s*${escaped}(?![A-Za-z0-9_])`,
          "gi",
        ),
        new RegExp(
          `(?<![A-Za-z0-9_])${escaped}[\\s:：#]*(-?\\d+(?:\\.\\d+)?)(?![A-Za-z0-9_.])`,
          "gi",
        ),
      ]
    : [new RegExp(`(?<![0-9.])(-?\\d+(?:\\.\\d+)?)\\s*${escaped}`, "g")];
  const matches: Array<{ value: number; index: number; length: number }> = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const hit of text.matchAll(pattern)) {
      const rawNumber = hit[1];
      const index = hit.index ?? 0;
      if (!rawNumber) continue;
      const value = Number(rawNumber);
      if (!Number.isFinite(value)) continue;
      const dedupeKey = `${index}:${hit[0].length}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      matches.push({ value, index, length: hit[0].length });
    }
  }
  return matches;
}

function collectAttributeNumberMatches(
  text: string,
  label: string,
  unit: string,
): Array<{ value: number; index: number; length: number }> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return [];
  const escapedLabel = escapeRegExp(trimmedLabel);
  const escapedUnit = unit.trim()
    ? `(?:\\s*${escapeRegExp(unit.trim())})?`
    : "";
  const pattern = isAsciiWord(trimmedLabel)
    ? new RegExp(
        `(?<![A-Za-z0-9_])${escapedLabel}(?:\\s+(?:is|are|at|of|reaches?|reached|hits?|exceeds?|exceeded|drops?\\s+to|falls?\\s+to|fell\\s+to))?[\\s:：=+]*(-?\\d+(?:\\.\\d+)?)${escapedUnit}(?![A-Za-z0-9_.])`,
        "gi",
      )
    : new RegExp(
        `${escapedLabel}[\\s:：=+]*(?:(?:为|是|高达|达到|突破|超过|低至|降至|降到|跌至|仅为|只有|仅剩|仍有|提升至|提升到)[\\s:：=+]*)?(-?\\d+(?:\\.\\d+)?)${escapedUnit}`,
        "g",
      );
  const matches: Array<{ value: number; index: number; length: number }> = [];
  for (const hit of text.matchAll(pattern)) {
    const rawNumber = hit[1];
    if (!rawNumber) continue;
    const value = Number(rawNumber);
    if (!Number.isFinite(value)) continue;
    matches.push({ value, index: hit.index ?? 0, length: hit[0].length });
  }
  return matches;
}

/**
 * Audit prose chapters, generated workflow designs (or an explicit draft text)
 * against a universe's registered structured rule systems.
 *
 * Reports:
 * - ladder range gaps or overlaps between consecutive numeric tiers (info);
 * - cited numeric values paired with a ladder's unit that fall outside or
 *   between registered tier ranges (warning);
 * - cited numeric values paired with a declared numeric attribute label that
 *   fall below `min` or above `max` (warning).
 */
export function checkRuleLayerConsistency(
  workspace: StudioWorkspace,
  universeId: string,
  options: RuleConsistencyOptions = {},
): RuleConsistencyReport {
  const locale = options.locale ?? workspace.settings.locale;
  const worldSystems = workspace.ruleSystems.filter(
    (system) => system.universeId === universeId,
  );
  const activeRuleSystems = worldSystems.filter(
    (system) => system.status === "active",
  ).length;
  const draftRuleSystems = worldSystems.filter(
    (system) => system.status === "draft",
  ).length;
  const checkedSystems = worldSystems.filter(
    (system) =>
      (!options.ruleSystemId || system.id === options.ruleSystemId) &&
      (options.includeDraftSystems
        ? system.status !== "disabled"
        : system.status === "active"),
  );

  const findings: RuleConsistencyFinding[] = [];
  const emitted = new Set<string>();
  const pushFinding = (finding: RuleConsistencyFinding) => {
    const key = [
      finding.sourceKind,
      finding.sourceId,
      finding.ruleSystemId,
      finding.kind,
      finding.attributeKey ?? "",
      finding.value ?? "",
      finding.excerpt,
    ].join("|");
    if (emitted.has(key)) return;
    emitted.add(key);
    findings.push(finding);
  };

  for (const system of checkedSystems) {
    const sorted = [...system.tiers].sort((a, b) => a.rank - b.rank);
    const title = ruleTitle(system.title, locale);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index]!;
      const next = sorted[index + 1]!;
      if (current.maxValue === undefined || next.minValue === undefined)
        continue;
      if (next.minValue < current.maxValue) {
        pushFinding({
          kind: "tier-range-overlap",
          severity: "info",
          ruleSystemId: system.id,
          sourceKind: "ruleSystem",
          sourceId: system.id,
          sourceLabel: title,
          excerpt: `${ruleTitle(current.name, locale)} (..${current.maxValue}) / ${ruleTitle(next.name, locale)} (${next.minValue}..)`,
          unit: system.unit || undefined,
          message:
            locale === "en"
              ? `Tier ${current.rank} max (${current.maxValue}) overlaps tier ${next.rank} min (${next.minValue}).`
              : `第 ${current.rank} 阶上限（${current.maxValue}）与第 ${next.rank} 阶下限（${next.minValue}）重叠。`,
        });
      } else {
        const bothIntegers =
          Number.isInteger(current.maxValue) && Number.isInteger(next.minValue);
        const hasGap = bothIntegers
          ? next.minValue - current.maxValue > 1
          : next.minValue > current.maxValue;
        if (hasGap) {
          pushFinding({
            kind: "tier-range-gap",
            severity: "info",
            ruleSystemId: system.id,
            sourceKind: "ruleSystem",
            sourceId: system.id,
            sourceLabel: title,
            excerpt: `${current.maxValue} .. ${next.minValue}`,
            unit: system.unit || undefined,
            message:
              locale === "en"
                ? `Gap between tier ${current.rank} max (${current.maxValue}) and tier ${next.rank} min (${next.minValue}).`
                : `第 ${current.rank} 阶上限（${current.maxValue}）与第 ${next.rank} 阶下限（${next.minValue}）之间存在数值断层。`,
          });
        }
      }
    }
  }

  const sources: Array<{
    sourceKind: RuleConsistencySourceKind;
    sourceId: string;
    sourceLabel: string;
    text: string;
  }> = [];
  let chaptersScanned = 0;
  let workflowTasksScanned = 0;

  if (options.text !== undefined) {
    sources.push({
      sourceKind: "text",
      sourceId: "input",
      sourceLabel:
        options.textLabel ?? (locale === "en" ? "Draft text" : "待审文本"),
      text: options.text,
    });
  } else {
    for (const work of workspace.works) {
      if (work.universeId !== universeId) continue;
      for (const chapter of work.chapters) {
        const body = [chapter.summary, chapter.outline, chapter.content]
          .filter((part) => part.trim())
          .join("\n");
        if (!body) continue;
        chaptersScanned += 1;
        sources.push({
          sourceKind: "chapter",
          sourceId: chapter.id,
          sourceLabel: `${ruleTitle(work.title, locale)} · #${chapter.number} ${chapter.title}`,
          text: body,
        });
      }
    }
    for (const task of workspace.workflowTasks) {
      if (task.universeId !== universeId) continue;
      const body = [task.result.zh, task.result.en]
        .filter((part) => part.trim())
        .join("\n");
      if (!body) continue;
      workflowTasksScanned += 1;
      sources.push({
        sourceKind: "workflowTask",
        sourceId: task.id,
        sourceLabel: ruleTitle(task.title, locale),
        text: body,
      });
    }
  }

  for (const system of checkedSystems) {
    const rangedTiers = system.tiers.filter(
      (tier) => tier.minValue !== undefined || tier.maxValue !== undefined,
    );
    const ladderIntervals = rangedTiers.map((tier) => ({
      min: tier.minValue ?? Number.NEGATIVE_INFINITY,
      max: tier.maxValue ?? Number.POSITIVE_INFINITY,
    }));
    const ladderMin =
      ladderIntervals.length > 0
        ? Math.min(...ladderIntervals.map((interval) => interval.min))
        : Number.POSITIVE_INFINITY;
    const ladderMax =
      ladderIntervals.length > 0
        ? Math.max(...ladderIntervals.map((interval) => interval.max))
        : Number.NEGATIVE_INFINITY;
    const systemTitle = ruleTitle(system.title, locale);

    for (const source of sources) {
      if (ladderIntervals.length > 0 && system.unit.trim()) {
        for (const hit of collectUnitNumberMatches(source.text, system.unit)) {
          const inTier = ladderIntervals.some(
            (interval) =>
              hit.value >= interval.min && hit.value <= interval.max,
          );
          if (inTier) continue;
          const kind: RuleConsistencyFindingKind =
            hit.value < ladderMin
              ? "below-ladder"
              : hit.value > ladderMax
                ? "above-ladder"
                : "ladder-gap";
          const rangeText = `${Number.isFinite(ladderMin) ? ladderMin : "-∞"}–${Number.isFinite(ladderMax) ? ladderMax : "+∞"}${system.unit}`;
          pushFinding({
            kind,
            severity: "warning",
            ruleSystemId: system.id,
            sourceKind: source.sourceKind,
            sourceId: source.sourceId,
            sourceLabel: source.sourceLabel,
            excerpt: excerptAround(source.text, hit.index, hit.length),
            value: hit.value,
            unit: system.unit,
            message:
              kind === "ladder-gap"
                ? locale === "en"
                  ? `${hit.value} ${system.unit} falls in a gap between registered tiers of "${systemTitle}".`
                  : `${hit.value}${system.unit} 落在「${systemTitle}」已登记等级之间的空白区间。`
                : locale === "en"
                  ? `${hit.value} ${system.unit} is outside the registered ladder range (${rangeText}) of "${systemTitle}".`
                  : `${hit.value}${system.unit} 超出「${systemTitle}」已登记等级范围（${rangeText}）。`,
          });
        }
      }

      for (const attribute of system.attributes) {
        if (attribute.type !== "integer" && attribute.type !== "decimal")
          continue;
        if (attribute.min === undefined && attribute.max === undefined)
          continue;
        const labels = [attribute.label.zh, attribute.label.en].filter((item) =>
          item.trim(),
        );
        const attrLabel = ruleTitle(attribute.label, locale);
        for (const label of labels) {
          for (const hit of collectAttributeNumberMatches(
            source.text,
            label,
            attribute.unit,
          )) {
            if (attribute.min !== undefined && hit.value < attribute.min) {
              pushFinding({
                kind: "attribute-below-min",
                severity: "warning",
                ruleSystemId: system.id,
                sourceKind: source.sourceKind,
                sourceId: source.sourceId,
                sourceLabel: source.sourceLabel,
                excerpt: excerptAround(source.text, hit.index, hit.length),
                value: hit.value,
                unit: attribute.unit || undefined,
                attributeKey: attribute.key,
                message:
                  locale === "en"
                    ? `${attrLabel} (${hit.value}${attribute.unit ? ` ${attribute.unit}` : ""}) is below minimum ${attribute.min}.`
                    : `属性「${attrLabel}」数值 ${hit.value}${attribute.unit} 低于下限 ${attribute.min}。`,
              });
            } else if (
              attribute.max !== undefined &&
              hit.value > attribute.max
            ) {
              pushFinding({
                kind: "attribute-above-max",
                severity: "warning",
                ruleSystemId: system.id,
                sourceKind: source.sourceKind,
                sourceId: source.sourceId,
                sourceLabel: source.sourceLabel,
                excerpt: excerptAround(source.text, hit.index, hit.length),
                value: hit.value,
                unit: attribute.unit || undefined,
                attributeKey: attribute.key,
                message:
                  locale === "en"
                    ? `${attrLabel} (${hit.value}${attribute.unit ? ` ${attribute.unit}` : ""}) exceeds maximum ${attribute.max}.`
                    : `属性「${attrLabel}」数值 ${hit.value}${attribute.unit} 超过上限 ${attribute.max}。`,
              });
            }
          }
        }
      }
    }
  }

  const worldSystemIds = new Set(worldSystems.map((system) => system.id));
  const worldCharacters = workspace.characters.filter((character) =>
    character.universeIds.includes(universeId),
  );
  const boundCharacters = worldCharacters.filter((character) =>
    (character.ruleBindings ?? []).some((binding) =>
      worldSystemIds.has(binding.ruleSystemId),
    ),
  ).length;
  const worldObjects = workspace.storyObjects.filter(
    (object) => object.universeId === universeId,
  );
  const boundObjects = worldObjects.filter(
    (object) =>
      object.ruleBinding !== undefined &&
      worldSystemIds.has(object.ruleBinding.ruleSystemId),
  ).length;

  return {
    universeId,
    summary: {
      activeRuleSystems,
      draftRuleSystems,
      checkedRuleSystems: checkedSystems.length,
      chaptersScanned,
      workflowTasksScanned,
      boundCharacters,
      totalCharacters: worldCharacters.length,
      boundObjects,
      totalObjects: worldObjects.length,
      totalFindings: findings.length,
    },
    findings,
  };
}

export function ruleSystemKindLabel(
  kind: RuleSystemKind,
  locale: UiLocale,
): string {
  const labels: Record<RuleSystemKind, LocalizedText> = {
    power: { zh: "力量 / 等级体系", en: "Power / tier ladder" },
    attribute: { zh: "属性体系", en: "Attribute system" },
    custom: { zh: "自定义规则体系", en: "Custom rule system" },
  };
  return ruleTitle(labels[kind], locale);
}

export function ruleStatusLabel(status: RuleStatus, locale: UiLocale): string {
  const labels: Record<RuleStatus, LocalizedText> = {
    draft: { zh: "草稿", en: "Draft" },
    active: { zh: "生效", en: "Active" },
    disabled: { zh: "停用", en: "Disabled" },
  };
  return ruleTitle(labels[status], locale);
}

export function ruleAttributeTypeLabel(
  type: RuleAttributeType,
  locale: UiLocale,
): string {
  const labels: Record<RuleAttributeType, LocalizedText> = {
    integer: { zh: "整数", en: "Integer" },
    decimal: { zh: "小数", en: "Decimal" },
    enum: { zh: "枚举", en: "Enum" },
    text: { zh: "文本", en: "Text" },
  };
  return ruleTitle(labels[type], locale);
}

export function ruleEffectLabel(
  effect: RuleEffect,
  system: Pick<RuleSystem, "attributes"> | undefined,
  locale: UiLocale,
): string {
  const attribute = system?.attributes.find(
    (item) => item.key === effect.attributeKey,
  );
  const label = attribute
    ? ruleTitle(attribute.label, locale)
    : effect.attributeKey;
  const unit = attribute?.unit ? ` ${attribute.unit}` : "";
  if (effect.operation === "add") {
    const sign = effect.value >= 0 ? "+" : "";
    return `${label} ${sign}${effect.value}${unit}`;
  }
  if (effect.operation === "multiply") return `${label} ×${effect.value}`;
  return `${label} = ${effect.value}${unit}`;
}

/**
 * Format a character's rule bindings scoped to a universe as concise readable
 * lines for workflow briefs and summary displays.
 */
export function formatCharacterRuleBindings(
  workspace: Pick<StudioWorkspace, "ruleSystems" | "abilityTemplates">,
  character: Pick<Character, "ruleBindings">,
  universeId: string | undefined,
  locale: UiLocale,
): string[] {
  const bindings = character.ruleBindings ?? [];
  if (!bindings.length) return [];
  const lines: string[] = [];
  for (const binding of bindings) {
    const system = workspace.ruleSystems.find(
      (item) =>
        item.id === binding.ruleSystemId &&
        (!universeId || item.universeId === universeId),
    );
    if (!system) continue;
    const parts: string[] = [];
    if (binding.tierId) {
      const tier = system.tiers.find((item) => item.id === binding.tierId);
      if (tier) {
        const range =
          tier.minValue !== undefined || tier.maxValue !== undefined
            ? ` (${tier.minValue ?? "−∞"}–${tier.maxValue ?? "+∞"}${system.unit ? ` ${system.unit}` : ""})`
            : "";
        parts.push(`#${tier.rank} ${ruleTitle(tier.name, locale)}${range}`);
      }
    }
    const attrParts = Object.entries(binding.attributes).map(([key, value]) => {
      const attr = system.attributes.find((item) => item.key === key);
      const label = attr ? ruleTitle(attr.label, locale) : key;
      const unit = attr?.unit ? ` ${attr.unit}` : "";
      return `${label}: ${value}${unit}`;
    });
    if (attrParts.length) parts.push(attrParts.join(", "));
    const abilityNames = binding.abilityIds
      .map((id) => workspace.abilityTemplates.find((item) => item.id === id))
      .filter((item): item is AbilityTemplate => Boolean(item))
      .map((item) => ruleTitle(item.name, locale));
    if (abilityNames.length) {
      parts.push(
        `${locale === "en" ? "Abilities" : "技能"}: ${abilityNames.join(", ")}`,
      );
    }
    if (parts.length)
      lines.push(`${ruleTitle(system.title, locale)} — ${parts.join(" · ")}`);
  }
  return lines;
}

/** Format a story object's structured stat binding for briefs and UI previews. */
export function formatStoryObjectRuleBinding(
  workspace: Pick<StudioWorkspace, "ruleSystems" | "itemStatTemplates">,
  storyObject: Pick<StoryObject, "ruleBinding">,
  locale: UiLocale,
): string | null {
  const binding = storyObject.ruleBinding;
  if (!binding) return null;
  const system = workspace.ruleSystems.find(
    (item) => item.id === binding.ruleSystemId,
  );
  if (!system) return null;
  const parts: string[] = [];
  if (binding.itemStatTemplateId) {
    const template = workspace.itemStatTemplates.find(
      (item) => item.id === binding.itemStatTemplateId,
    );
    if (template) parts.push(ruleTitle(template.name, locale));
  }
  const effectiveTierId =
    binding.tierId ??
    workspace.itemStatTemplates.find(
      (item) => item.id === binding.itemStatTemplateId,
    )?.tierId;
  if (effectiveTierId) {
    const tier = system.tiers.find((item) => item.id === effectiveTierId);
    if (tier) parts.push(`#${tier.rank} ${ruleTitle(tier.name, locale)}`);
  }
  const statEffects = binding.stats.length
    ? binding.stats
    : (workspace.itemStatTemplates.find(
        (item) => item.id === binding.itemStatTemplateId,
      )?.stats ?? []);
  if (statEffects.length) {
    parts.push(
      statEffects
        .map((effect) => ruleEffectLabel(effect, system, locale))
        .join(", "),
    );
  }
  return parts.length
    ? `${ruleTitle(system.title, locale)} — ${parts.join(" · ")}`
    : ruleTitle(system.title, locale);
}

function ruleTitle(title: LocalizedText, locale: UiLocale): string {
  return locale === "en"
    ? title.en.trim() || title.zh.trim()
    : title.zh.trim() || title.en.trim();
}

function promptTier(tier: RuleTier) {
  return {
    id: tier.id,
    name: tier.name,
    rank: tier.rank,
    ...(tier.minValue === undefined ? {} : { minValue: tier.minValue }),
    ...(tier.maxValue === undefined ? {} : { maxValue: tier.maxValue }),
    ...(tier.summary ? { summary: tier.summary } : {}),
  };
}

function promptAttribute(attribute: RuleAttribute) {
  return {
    key: attribute.key,
    label: attribute.label,
    type: attribute.type,
    ...(attribute.unit ? { unit: attribute.unit } : {}),
    ...(attribute.min === undefined ? {} : { min: attribute.min }),
    ...(attribute.max === undefined ? {} : { max: attribute.max }),
    ...(attribute.enumValues.length
      ? { enumValues: attribute.enumValues }
      : {}),
    ...(attribute.defaultValue === undefined
      ? {}
      : { defaultValue: attribute.defaultValue }),
    ...(attribute.description ? { description: attribute.description } : {}),
  };
}

/**
 * Render every active rule system in scope as structured prompt data.
 * Draft and disabled systems stay out of production prompts, exactly like
 * draft prose standards, so an unreviewed AI proposal cannot silently become
 * canon.
 */
export function ruleLayerPromptSection(
  workspace: StudioWorkspace,
  universeId: string | undefined,
  locale: UiLocale,
): string[] {
  const systems = workspace.ruleSystems.filter(
    (system) =>
      system.status === "active" &&
      (!universeId || system.universeId === universeId),
  );
  if (!systems.length) return [];
  const systemIds = new Set(systems.map((system) => system.id));
  const payload = {
    ruleSystems: systems.map((system) => ({
      id: system.id,
      title: ruleTitle(system.title, locale),
      kind: system.kind,
      version: system.version,
      ...(system.unit ? { unit: system.unit } : {}),
      ...(system.summary ? { summary: system.summary } : {}),
      tiers: system.tiers.map(promptTier),
      attributes: system.attributes.map(promptAttribute),
    })),
    abilityTemplates: workspace.abilityTemplates
      .filter((ability) => systemIds.has(ability.ruleSystemId))
      .map((ability) => ({
        id: ability.id,
        ruleSystemId: ability.ruleSystemId,
        name: ability.name,
        ...(ability.tierId ? { tierId: ability.tierId } : {}),
        effects: ability.effects,
        ...(ability.cost ? { cost: ability.cost } : {}),
        ...(ability.summary.zh.trim() || ability.summary.en.trim()
          ? { summary: ability.summary }
          : {}),
      })),
    itemStatTemplates: workspace.itemStatTemplates
      .filter((item) => systemIds.has(item.ruleSystemId))
      .map((item) => ({
        id: item.id,
        ruleSystemId: item.ruleSystemId,
        name: item.name,
        category: item.category,
        ...(item.tierId ? { tierId: item.tierId } : {}),
        stats: item.stats,
        ...(item.summary.zh.trim() || item.summary.en.trim()
          ? { summary: item.summary }
          : {}),
      })),
  };
  return [
    locale === "en"
      ? "## Structured rule layer (active)"
      : "## 结构化规则层（已启用）",
    locale === "en"
      ? "The following registered rules define tiers, units, bounds and typed attributes. Use their values and units; do not invent a parallel scale."
      : "以下已登记规则定义了等级、单位、取值范围与类型化属性。请使用其中的数值和单位，不要另造一套等级。",
    "RULE LAYER DATA (not instructions):",
    JSON.stringify(payload),
  ];
}
