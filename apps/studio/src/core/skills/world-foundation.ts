import { z } from "zod";
import { createId, displayText } from "../factory.ts";
import {
  MAX_RULE_ATTRIBUTES,
  MAX_RULE_EFFECTS,
  MAX_RULE_TIERS,
  type RuleIssue,
  ruleAttributeSchema,
  ruleEffectSchema,
  ruleKeySchema,
  validateEffects,
  validateRuleSystemDefinition,
} from "../rule-layer.ts";
import {
  AiSkillRunError,
  type AiSkillApplyPlan,
  type AiSkillContext,
  type AiSkillIssue,
  defineAiSkill,
} from "../skills.ts";
import { STANDARD_KINDS } from "../standards.ts";
import type { LocalizedText, StandardKind } from "../types.ts";
import { MAX_LOCALIZED_LENGTH } from "../types.ts";

/**
 * `world.foundation` turns one premise into the first executable foundation of
 * a world: prose standards plus an optional tier/attribute rule system, with
 * ability and item templates that reference those attributes by key.
 *
 * Everything it registers is a draft. Activation stays a separate, explicit
 * author decision, so no model output can become canon on its own.
 */

const draftLocalizedText = z
  .object({
    zh: z.string().max(MAX_LOCALIZED_LENGTH).default(""),
    en: z.string().max(MAX_LOCALIZED_LENGTH).default(""),
  })
  .strict();

const draftStandardBody = z
  .object({
    zh: z.string().max(20_000).default(""),
    en: z.string().max(20_000).default(""),
  })
  .strict();

const draftStandardSchema = z
  .object({
    key: ruleKeySchema,
    title: draftLocalizedText,
    kind: z.enum(STANDARD_KINDS as [StandardKind, ...StandardKind[]]),
    body: draftStandardBody,
  })
  .strict();

const draftTierSchema = z
  .object({
    key: ruleKeySchema,
    name: draftLocalizedText,
    rank: z.number().int().positive(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    summary: z.string().trim().max(4_000).default(""),
  })
  .strict();

const draftRuleSystemSchema = z
  .object({
    key: ruleKeySchema,
    title: draftLocalizedText,
    kind: z.enum(["power", "attribute", "custom"]),
    summary: z.string().trim().max(10_000).default(""),
    unit: z.string().trim().max(40).default(""),
    tiers: z.array(draftTierSchema).max(MAX_RULE_TIERS).default([]),
    attributes: z
      .array(ruleAttributeSchema)
      .max(MAX_RULE_ATTRIBUTES)
      .default([]),
  })
  .strict();

const draftAbilitySchema = z
  .object({
    key: ruleKeySchema,
    name: draftLocalizedText,
    summary: draftLocalizedText.default({ zh: "", en: "" }),
    tierKey: ruleKeySchema.optional(),
    effects: z.array(ruleEffectSchema).max(MAX_RULE_EFFECTS).default([]),
    cost: z.string().trim().max(2_000).default(""),
  })
  .strict();

const draftItemSchema = z
  .object({
    key: ruleKeySchema,
    name: draftLocalizedText,
    category: draftLocalizedText,
    tierKey: ruleKeySchema.optional(),
    stats: z.array(ruleEffectSchema).max(MAX_RULE_EFFECTS).default([]),
    summary: draftLocalizedText.default({ zh: "", en: "" }),
  })
  .strict();

export const worldFoundationOutputSchema = z
  .object({
    standards: z.array(draftStandardSchema).min(1).max(12),
    ruleSystem: draftRuleSystemSchema.nullable().default(null),
    abilities: z.array(draftAbilitySchema).max(30).default([]),
    items: z.array(draftItemSchema).max(30).default([]),
    notes: z.string().trim().max(4_000).default(""),
  })
  .strict();

export type WorldFoundationOutput = z.infer<typeof worldFoundationOutputSchema>;

export interface WorldFoundationSelection {
  acceptedStandardKeys: string[];
  includeRuleSystem: boolean;
  acceptedAbilityKeys: string[];
  acceptedItemKeys: string[];
}

const POWER_SYSTEM_VALUES = ["numeric", "qualitative", "none"] as const;
type PowerSystemMode = (typeof POWER_SYSTEM_VALUES)[number];

function tierIdFor(key: string): string {
  return `tier_${key}`;
}

function isBlank(text: LocalizedText): boolean {
  return !text.zh.trim() && !text.en.trim();
}

function toSkillIssues(issues: RuleIssue[]): AiSkillIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function checkUniqueKeys(
  entries: readonly { key: string }[],
  path: string,
  issues: AiSkillIssue[],
): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.key))
      issues.push({
        path: `${path}.${index}.key`,
        message: `duplicate key: ${entry.key}`,
      });
    seen.add(entry.key);
  }
}

function validateWorldFoundationOutput(
  output: WorldFoundationOutput,
  context: AiSkillContext,
): AiSkillIssue[] {
  const issues: AiSkillIssue[] = [];
  checkUniqueKeys(output.standards, "standards", issues);
  for (const [index, standard] of output.standards.entries()) {
    if (isBlank(standard.title))
      issues.push({
        path: `standards.${index}.title`,
        message: "standard title is required",
      });
    if (isBlank(standard.body))
      issues.push({
        path: `standards.${index}.body`,
        message: "standard body is required",
      });
  }

  const system = output.ruleSystem;
  if (system) {
    issues.push(
      ...toSkillIssues(
        validateRuleSystemDefinition(
          {
            kind: system.kind,
            tiers: system.tiers.map((tier) => ({
              id: tierIdFor(tier.key),
              name: tier.name,
              rank: tier.rank,
              ...(tier.minValue === undefined
                ? {}
                : { minValue: tier.minValue }),
              ...(tier.maxValue === undefined
                ? {}
                : { maxValue: tier.maxValue }),
            })),
            attributes: system.attributes,
          },
          ["ruleSystem"],
        ),
      ),
    );
  }

  const mode = context.input.powerSystem as PowerSystemMode | undefined;
  if (mode === "none") {
    if (system)
      issues.push({
        path: "ruleSystem",
        message: "powerSystem=none requires ruleSystem=null",
      });
  } else if (mode === "numeric") {
    if (!system)
      issues.push({
        path: "ruleSystem",
        message: "powerSystem=numeric requires a rule system",
      });
    else if (system.kind !== "power")
      issues.push({
        path: "ruleSystem.kind",
        message: "powerSystem=numeric requires kind=power",
      });
  } else if (mode === "qualitative") {
    if (!system)
      issues.push({
        path: "ruleSystem",
        message: "powerSystem=qualitative requires a rule system",
      });
    else if (system.kind !== "custom")
      issues.push({
        path: "ruleSystem.kind",
        message:
          "powerSystem=qualitative requires kind=custom; text ranks carry no numeric range",
      });
  }

  if (!system && (output.abilities.length || output.items.length))
    issues.push({
      path: "abilities",
      message: "abilities and items require a rule system",
    });

  if (system) {
    const attributes = new Map(
      system.attributes.map((attribute) => [attribute.key, attribute]),
    );
    const tierKeys = new Set(system.tiers.map((tier) => tier.key));
    checkUniqueKeys(output.abilities, "abilities", issues);
    checkUniqueKeys(output.items, "items", issues);
    for (const [index, ability] of output.abilities.entries()) {
      if (isBlank(ability.name))
        issues.push({
          path: `abilities.${index}.name`,
          message: "ability name is required",
        });
      if (ability.tierKey && !tierKeys.has(ability.tierKey))
        issues.push({
          path: `abilities.${index}.tierKey`,
          message: `unknown tier: ${ability.tierKey}`,
        });
      issues.push(
        ...toSkillIssues(
          validateEffects(ability.effects, attributes, [
            "abilities",
            index,
            "effects",
          ]),
        ),
      );
    }
    for (const [index, item] of output.items.entries()) {
      if (isBlank(item.name))
        issues.push({
          path: `items.${index}.name`,
          message: "item name is required",
        });
      if (isBlank(item.category))
        issues.push({
          path: `items.${index}.category`,
          message: "item category is required",
        });
      if (item.tierKey && !tierKeys.has(item.tierKey))
        issues.push({
          path: `items.${index}.tierKey`,
          message: `unknown tier: ${item.tierKey}`,
        });
      issues.push(
        ...toSkillIssues(
          validateEffects(item.stats, attributes, ["items", index, "stats"]),
        ),
      );
    }
  }

  return issues;
}

function readKeyList(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  issues: AiSkillIssue[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array of keys" });
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !allowed.has(entry)) {
      issues.push({ path, message: `unknown key: ${String(entry)}` });
      continue;
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function normalizeWorldFoundationSelection(
  output: WorldFoundationOutput,
  selection: unknown,
): WorldFoundationSelection {
  if (!selection || typeof selection !== "object" || Array.isArray(selection))
    throw new AiSkillRunError([
      { path: "selection", message: "review selection is required" },
    ]);
  const raw = selection as Record<string, unknown>;
  const issues: AiSkillIssue[] = [];
  const acceptedStandardKeys = readKeyList(
    raw.acceptedStandardKeys ?? [],
    new Set(output.standards.map((standard) => standard.key)),
    "acceptedStandardKeys",
    issues,
  );
  const acceptedAbilityKeys = readKeyList(
    raw.acceptedAbilityKeys ?? [],
    new Set(output.abilities.map((ability) => ability.key)),
    "acceptedAbilityKeys",
    issues,
  );
  const acceptedItemKeys = readKeyList(
    raw.acceptedItemKeys ?? [],
    new Set(output.items.map((item) => item.key)),
    "acceptedItemKeys",
    issues,
  );
  if (typeof raw.includeRuleSystem !== "boolean")
    issues.push({
      path: "includeRuleSystem",
      message: "must be true or false",
    });
  const includeRuleSystem = raw.includeRuleSystem === true;
  if (includeRuleSystem && !output.ruleSystem)
    issues.push({
      path: "includeRuleSystem",
      message: "the output has no rule system",
    });
  if (
    !includeRuleSystem &&
    acceptedAbilityKeys.length + acceptedItemKeys.length > 0
  )
    issues.push({
      path: "includeRuleSystem",
      message: "abilities and items require the rule system",
    });
  if (!acceptedStandardKeys.length && !includeRuleSystem)
    issues.push({
      path: "selection",
      message: "select at least one standard or the rule system",
    });
  if (issues.length) throw new AiSkillRunError(issues);
  return {
    acceptedStandardKeys,
    includeRuleSystem,
    acceptedAbilityKeys,
    acceptedItemKeys,
  };
}

function applyWorldFoundation(
  context: AiSkillContext,
  output: WorldFoundationOutput,
  selection: unknown,
  now: string,
): AiSkillApplyPlan {
  const chosen = selection as WorldFoundationSelection;
  const standardKeys = new Set(chosen.acceptedStandardKeys);
  const abilityKeys = new Set(chosen.acceptedAbilityKeys);
  const itemKeys = new Set(chosen.acceptedItemKeys);
  const standards = output.standards
    .filter((standard) => standardKeys.has(standard.key))
    .map((standard) => ({
      id: createId("std"),
      title: standard.title,
      kind: standard.kind,
      universeId: context.universeId,
      body: standard.body,
      status: "draft" as const,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }));
  const system = output.ruleSystem;
  if (!chosen.includeRuleSystem || !system) return { standards };

  const ruleSystemId = createId("rules");
  const tierIds = new Map(
    system.tiers.map((tier) => [tier.key, tierIdFor(tier.key)]),
  );
  return {
    standards,
    ruleSystems: [
      {
        id: ruleSystemId,
        universeId: context.universeId,
        title: system.title,
        kind: system.kind,
        summary: system.summary,
        unit: system.unit,
        tiers: system.tiers.map((tier) => ({
          id: tierIds.get(tier.key)!,
          name: tier.name,
          rank: tier.rank,
          ...(tier.minValue === undefined ? {} : { minValue: tier.minValue }),
          ...(tier.maxValue === undefined ? {} : { maxValue: tier.maxValue }),
          summary: tier.summary,
        })),
        attributes: system.attributes,
        status: "draft",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    abilityTemplates: output.abilities
      .filter((ability) => abilityKeys.has(ability.key))
      .map((ability) => ({
        id: createId("ability"),
        universeId: context.universeId,
        ruleSystemId,
        name: ability.name,
        summary: ability.summary,
        ...(ability.tierKey ? { tierId: tierIds.get(ability.tierKey)! } : {}),
        effects: ability.effects,
        cost: ability.cost,
        createdAt: now,
        updatedAt: now,
      })),
    itemStatTemplates: output.items
      .filter((item) => itemKeys.has(item.key))
      .map((item) => ({
        id: createId("item"),
        universeId: context.universeId,
        ruleSystemId,
        name: item.name,
        category: item.category,
        ...(item.tierKey ? { tierId: tierIds.get(item.tierKey)! } : {}),
        stats: item.stats,
        summary: item.summary,
        createdAt: now,
        updatedAt: now,
      })),
  };
}

function existingRulesSection(context: AiSkillContext): string {
  const { workspace, universeId, locale } = context;
  const standards = workspace.standards.filter(
    (standard) =>
      standard.status !== "disabled" &&
      (!standard.universeId || standard.universeId === universeId),
  );
  const systems = workspace.ruleSystems.filter(
    (system) => system.universeId === universeId,
  );
  if (!standards.length && !systems.length)
    return locale === "en"
      ? "No standards or rule systems exist for this world yet."
      : "这个世界还没有任何规则或规则系统。";
  const lines: string[] = [];
  for (const standard of standards)
    lines.push(
      `- standard [${standard.kind}, ${standard.status}] ${displayText(
        standard.title,
        locale,
      )}`,
    );
  for (const system of systems)
    lines.push(
      `- rule system [${system.kind}, ${system.status}] ${displayText(
        system.title,
        locale,
      )} (${system.tiers.length} tiers, ${system.attributes.length} attributes)`,
    );
  return lines.join("\n");
}

function powerSystemLabel(mode: string, locale: "zh-CN" | "en"): string {
  const labels: Record<PowerSystemMode, LocalizedText> = {
    numeric: {
      zh: "数字等级（需要数值区间与单位）",
      en: "Numeric tiers (needs ranges and a unit)",
    },
    qualitative: {
      zh: "定性等级（只排等级，不写数值区间）",
      en: "Qualitative ranks (order only, no numeric ranges)",
    },
    none: { zh: "不设等级", en: "No tier ladder" },
  };
  const label = labels[mode as PowerSystemMode];
  return label ? displayText(label, locale) : mode;
}

function buildWorldFoundationPrompt(context: AiSkillContext): string {
  const { workspace, universeId, locale, input } = context;
  const universe = workspace.universes.find((entry) => entry.id === universeId);
  const worldName = universe ? displayText(universe.name, locale) : "";
  const worldSummary = universe ? displayText(universe.summary, locale) : "";
  const genres = universe?.genres.join(", ") ?? "";
  const mode = input.powerSystem ?? "";

  if (locale === "en") {
    return [
      "You are the worldbuilding editor for a long-form fiction project.",
      "Design the first executable foundation for the world below and return exactly one JSON object — no markdown fence, no commentary before or after.",
      "",
      "## World",
      `- Name: ${worldName}`,
      `- Summary: ${worldSummary}`,
      `- Genres: ${genres || input.genre || "(unspecified)"}`,
      "",
      "## Author input",
      `- Premise: ${input.premise}`,
      ...(input.genre ? [`- Genre: ${input.genre}`] : []),
      ...(input.tone ? [`- Tone: ${input.tone}`] : []),
      `- Power system: ${powerSystemLabel(mode, locale)}`,
      "",
      "## Existing rules (do not restate or contradict them)",
      existingRulesSection(context),
      "",
      "## Output shape",
      JSON.stringify(
        {
          standards: [
            {
              key: "world-tone",
              title: { zh: "…", en: "…" },
              kind: "style",
              body: { zh: "…", en: "…" },
            },
          ],
          ruleSystem: {
            key: "power-ladder",
            title: { zh: "…", en: "…" },
            kind: "power",
            summary: "…",
            unit: "level",
            tiers: [
              {
                key: "tier-1",
                name: { zh: "…", en: "…" },
                rank: 1,
                minValue: 0,
                maxValue: 9,
                summary: "…",
              },
            ],
            attributes: [
              {
                key: "attack",
                label: { zh: "攻击", en: "Attack" },
                type: "integer",
                unit: "points",
                min: 0,
                max: 100,
                enumValues: [],
                description: "…",
              },
            ],
          },
          abilities: [
            {
              key: "flame-slash",
              name: { zh: "…", en: "…" },
              summary: { zh: "…", en: "…" },
              tierKey: "tier-1",
              effects: [
                { attributeKey: "attack", operation: "add", value: 10 },
              ],
              cost: "…",
            },
          ],
          items: [
            {
              key: "iron-sword",
              name: { zh: "…", en: "…" },
              category: { zh: "武器", en: "Weapon" },
              tierKey: "tier-1",
              stats: [{ attributeKey: "attack", operation: "add", value: 5 }],
              summary: { zh: "…", en: "…" },
            },
          ],
          notes: "…",
        },
        null,
        2,
      ),
      "",
      "## Constraints",
      "- keys match ^[A-Za-z][A-Za-z0-9_-]{0,39}$ and are unique within their array.",
      "- standards: 1–12 entries; every title and body must carry both zh and en text.",
      "- Every localized field is an object {zh, en}; both sides must be filled.",
      "- kind is one of: style, format, naming, numeric, entity-prompt, continuity.",
      '- Numeric tiers: ruleSystem.kind="power" with at least two tiers; every tier needs minValue or maxValue; ranks are consecutive from 1 and never repeat; unit names the scale.',
      '- Qualitative ranks: ruleSystem.kind="custom" with at least one tier and no numeric ranges.',
      "- No tier ladder: ruleSystem=null and both abilities and items are empty arrays.",
      "- ability.tierKey and item.tierKey must reference ruleSystem.tiers[].key.",
      "- effects and stats may only target integer or decimal attributes, and attributeKey must reference ruleSystem.attributes[].key.",
      "- type is one of integer, decimal, enum, text; an enum needs enumValues and must not declare min/max; text must not declare min/max.",
      '- State every number with its unit or scale. Avoid vague "very strong" / "weak" placeholders.',
      "- This is a draft. Do not present assumptions as canon; when the premise leaves something open, propose a conservative, extensible choice and list the assumption in notes.",
    ].join("\n");
  }

  return [
    "你是长篇小说项目的世界设定编辑。",
    "请为下面的世界设计第一套可执行的基础设定，只输出一个 JSON 对象——不要 markdown 代码围栏，不要前后解释。",
    "",
    "## 世界",
    `- 名称：${worldName}`,
    `- 简介：${worldSummary}`,
    `- 类型：${genres || input.genre || "（未指定）"}`,
    "",
    "## 作者输入",
    `- 世界前提：${input.premise}`,
    ...(input.genre ? [`- 类型：${input.genre}`] : []),
    ...(input.tone ? [`- 基调：${input.tone}`] : []),
    `- 战力体系：${powerSystemLabel(mode, locale)}`,
    "",
    "## 已有规则（不要重复或矛盾）",
    existingRulesSection(context),
    "",
    "## 输出结构",
    JSON.stringify(
      {
        standards: [
          {
            key: "world-tone",
            title: { zh: "……", en: "…" },
            kind: "style",
            body: { zh: "……", en: "…" },
          },
        ],
        ruleSystem: {
          key: "power-ladder",
          title: { zh: "……", en: "…" },
          kind: "power",
          summary: "……",
          unit: "级",
          tiers: [
            {
              key: "tier-1",
              name: { zh: "……", en: "…" },
              rank: 1,
              minValue: 0,
              maxValue: 9,
              summary: "……",
            },
          ],
          attributes: [
            {
              key: "attack",
              label: { zh: "攻击", en: "Attack" },
              type: "integer",
              unit: "点",
              min: 0,
              max: 100,
              enumValues: [],
              description: "……",
            },
          ],
        },
        abilities: [
          {
            key: "flame-slash",
            name: { zh: "……", en: "…" },
            summary: { zh: "……", en: "…" },
            tierKey: "tier-1",
            effects: [{ attributeKey: "attack", operation: "add", value: 10 }],
            cost: "……",
          },
        ],
        items: [
          {
            key: "iron-sword",
            name: { zh: "……", en: "…" },
            category: { zh: "武器", en: "Weapon" },
            tierKey: "tier-1",
            stats: [{ attributeKey: "attack", operation: "add", value: 5 }],
            summary: { zh: "……", en: "…" },
          },
        ],
        notes: "……",
      },
      null,
      2,
    ),
    "",
    "## 约束",
    "- key 必须匹配 ^[A-Za-z][A-Za-z0-9_-]{0,39}$，同一数组内唯一。",
    "- standards 1–12 条；title 与 body 都必须同时给出 zh 和 en 内容。",
    "- 所有本地化字段都是 {zh, en} 对象，两侧都要有内容。",
    "- kind 只能是：style、format、naming、numeric、entity-prompt、continuity。",
    '- 数字等级：ruleSystem.kind="power"，至少两个等级；每个等级必须有 minValue 或 maxValue；rank 从 1 连续递增且不重复；unit 写明刻度单位。',
    '- 定性等级：ruleSystem.kind="custom"，至少一个等级，不写数值区间。',
    "- 不设等级：ruleSystem=null，abilities 与 items 都为空数组。",
    "- ability.tierKey 与 item.tierKey 必须引用 ruleSystem.tiers[].key。",
    "- effects 与 stats 只能指向 integer/decimal 属性，attributeKey 必须引用 ruleSystem.attributes[].key。",
    "- type 只能是 integer、decimal、enum、text；enum 必须给出 enumValues 且不能声明 min/max；text 不能声明 min/max。",
    "- 每个数值都要带单位或量纲，不要用“很强/较弱”这类空泛占位。",
    "- 这是草稿。不要把假设当作既定事实；前提没有写明的部分，给出保守、可扩展的设定，并把假设写进 notes。",
  ].join("\n");
}

export const worldFoundationSkill = defineAiSkill<WorldFoundationOutput>({
  id: "world.foundation",
  version: 1,
  title: { zh: "世界基础规则", en: "World foundation" },
  summary: {
    zh: "从一句世界前提生成基础标准、等级体系、属性与技能/物品模板，全部以草稿登记。",
    en: "Draft prose standards, a tier ladder, attributes and ability/item templates from one premise.",
  },
  scope: "universe",
  inputFields: [
    {
      key: "premise",
      kind: "text",
      required: true,
      maxLength: 6_000,
      label: { zh: "世界前提", en: "World premise" },
      placeholder: {
        zh: "例如：潮汐锁定的大陆上，记忆可以被提炼成燃料。",
        en: "For example: on a tidally locked continent, memory can be refined into fuel.",
      },
    },
    {
      key: "genre",
      kind: "text",
      required: false,
      maxLength: 300,
      label: { zh: "类型", en: "Genre" },
      placeholder: {
        zh: "例如：科幻 / 悬疑",
        en: "For example: science fiction / mystery",
      },
    },
    {
      key: "tone",
      kind: "text",
      required: false,
      maxLength: 300,
      label: { zh: "基调", en: "Tone" },
      placeholder: {
        zh: "例如：冷峻、克制",
        en: "For example: stark and restrained",
      },
    },
    {
      key: "powerSystem",
      kind: "select",
      required: true,
      maxLength: 20,
      label: { zh: "战力体系", en: "Power system" },
      options: [
        {
          value: "numeric",
          label: { zh: "数字等级", en: "Numeric tiers" },
        },
        {
          value: "qualitative",
          label: { zh: "定性等级", en: "Qualitative ranks" },
        },
        { value: "none", label: { zh: "不设等级", en: "No tiers" } },
      ],
    },
  ],
  outputSchema: worldFoundationOutputSchema,
  buildPrompt: buildWorldFoundationPrompt,
  validateOutput: validateWorldFoundationOutput,
  normalizeSelection: (output, selection) =>
    normalizeWorldFoundationSelection(output, selection),
  apply: applyWorldFoundation,
});
