import { z } from "zod";
import type {
  AbilityTemplate,
  ItemStatTemplate,
  LocalizedText,
  RuleAttribute,
  RuleAttributeType,
  RuleEffect,
  RuleSystem,
  RuleSystemKind,
  RuleTier,
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
    for (const issue of validateRuleSystemRecord(system))
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
  });

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
