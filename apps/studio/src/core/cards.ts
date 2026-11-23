import { createId, localized } from "./factory.ts";
import {
  BUILT_IN_CARD_BEHAVIORS,
  CARD_TYPE_ICONS,
  type AppliedConstruct,
  type BuiltInCardBehavior,
  type Card,
  type CardEdge,
  type CardField,
  type CardType,
  type CardTypeIcon,
  type LocalizedText,
  type StudioWorkspace,
  type UiLocale,
} from "./types.ts";

/** Field keys are local to one card type, not workspace identifiers. */
export const CARD_FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

/** Behavior keys allow custom/future identifiers that safely fall back to generic. */
export const CARD_BEHAVIOR_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

export interface CardBehaviorDescriptor {
  key: BuiltInCardBehavior;
  label: LocalizedText;
  description: LocalizedText;
  defaultIcon: CardTypeIcon;
  defaultColor: string;
  /** Downstream export category; unknown keys map to `"card"`. */
  exportKind: string;
  /** Field keys surfaced first in compact previews when present on the type. */
  previewFields: readonly string[];
}

export const CARD_BEHAVIOR_REGISTRY: Record<
  BuiltInCardBehavior,
  CardBehaviorDescriptor
> = {
  generic: {
    key: "generic",
    label: localized("通用卡片", "Generic card"),
    description: localized(
      "通用数据结构，按声明顺序展示与校验字段。",
      "Generic card shape rendered and validated strictly by declared fields.",
    ),
    defaultIcon: "layers",
    defaultColor: "#3f6f8f",
    exportKind: "card",
    previewFields: [],
  },
  character: {
    key: "character",
    label: localized("人物卡片", "Character"),
    description: localized(
      "角色设定：身份、阵营、状态与动机。",
      "Character sheet: role, faction, status and motivation.",
    ),
    defaultIcon: "users",
    defaultColor: "#367c75",
    exportKind: "character",
    previewFields: ["role", "faction", "status"],
  },
  location: {
    key: "location",
    label: localized("地点卡片", "Location"),
    description: localized(
      "世界场所：区域、风险等级与通行条件。",
      "World location: region, risk level and access.",
    ),
    defaultIcon: "world",
    defaultColor: "#2f7567",
    exportKind: "location",
    previewFields: ["region", "access", "riskLevel"],
  },
  faction: {
    key: "faction",
    label: localized("势力卡片", "Faction"),
    description: localized(
      "组织或阵营：立场、影响力与目标。",
      "Organization or faction: alignment, influence and goal.",
    ),
    defaultIcon: "grid",
    defaultColor: "#5d4037",
    exportKind: "faction",
    previewFields: ["alignment", "influence", "goal"],
  },
  object: {
    key: "object",
    label: localized("物件卡片", "Story object"),
    description: localized(
      "道具与神器：分类、稀有度与状态。",
      "Prop or artifact: category, rarity and status.",
    ),
    defaultIcon: "package",
    defaultColor: "#8b6f47",
    exportKind: "object",
    previewFields: ["category", "rarity", "status"],
  },
  lore: {
    key: "lore",
    label: localized("设定卡片", "Lore"),
    description: localized(
      "世界规则、历史与文化条目。",
      "World rules, history and cultural lore entries.",
    ),
    defaultIcon: "book",
    defaultColor: "#4a5d73",
    exportKind: "lore",
    previewFields: ["category", "scope"],
  },
  scene: {
    key: "scene",
    label: localized("场景关卡", "Scene / level"),
    description: localized(
      "关卡或副本：等级区间、波次与首领。",
      "Level or dungeon: level band, waves and boss.",
    ),
    defaultIcon: "world",
    defaultColor: "#3f6f8f",
    exportKind: "scene",
    previewFields: ["levelMin", "levelMax", "boss"],
  },
  monster: {
    key: "monster",
    label: localized("怪物单位", "Monster"),
    description: localized(
      "可战斗单位：等级、基础属性与类型。",
      "Combat unit: level, stats and tier.",
    ),
    defaultIcon: "sparkles",
    defaultColor: "#8f4b3f",
    exportKind: "monster",
    previewFields: ["level", "hp", "tier"],
  },
  equipment: {
    key: "equipment",
    label: localized("装备道具", "Equipment"),
    description: localized(
      "可掉落装备：稀有度、部位与数值。",
      "Droppable gear: rarity, slot and stats.",
    ),
    defaultIcon: "package",
    defaultColor: "#6f5a2f",
    exportKind: "equipment",
    previewFields: ["rarity", "slot", "atk"],
  },
};

export function isKnownCardBehavior(
  key: string | undefined,
): key is BuiltInCardBehavior {
  return (
    typeof key === "string" &&
    (BUILT_IN_CARD_BEHAVIORS as readonly string[]).includes(key)
  );
}

/**
 * Look up the built-in behavior descriptor for a card type. Unknown keys
 * never fail: they fall back cleanly to `"generic"`.
 */
export function resolveCardBehavior(
  key: string | undefined,
): CardBehaviorDescriptor {
  return isKnownCardBehavior(key)
    ? CARD_BEHAVIOR_REGISTRY[key]
    : CARD_BEHAVIOR_REGISTRY.generic;
}

/** Resolve a stored icon string to a valid Studio icon, falling back to behavior. */
export function resolveCardIcon(
  icon: string | undefined,
  behavior?: string,
): CardTypeIcon {
  if (
    typeof icon === "string" &&
    (CARD_TYPE_ICONS as readonly string[]).includes(icon)
  ) {
    return icon as CardTypeIcon;
  }
  return resolveCardBehavior(behavior).defaultIcon;
}

/**
 * Order a type's fields for compact previews: behavior-priority keys first,
 * followed by remaining fields in their declared order.
 */
export function previewFieldsForType(type: CardType): CardField[] {
  const priority = resolveCardBehavior(type.behavior).previewFields;
  if (!priority.length) return [...type.fields];
  const prioritized: CardField[] = [];
  const seen = new Set<string>();
  for (const key of priority) {
    const match = type.fields.find((item) => item.key === key);
    if (match) {
      prioritized.push(match);
      seen.add(match.key);
    }
  }
  for (const item of type.fields) {
    if (!seen.has(item.key)) prioritized.push(item);
  }
  return prioritized;
}

/** Reorder an immutable field list without mutating the source array. */
export function reorderCardFields<T>(
  fields: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= fields.length ||
    toIndex >= fields.length
  ) {
    return [...fields];
  }
  const next = [...fields];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}

export type CardFieldParseResult =
  | { ok: true; value?: number | string }
  | { ok: false; reason: "number" | "integer" | "min" | "max" | "enum" };

/**
 * Parse and validate a raw text input against one field definition.
 * Shared by CardModal and the inline Table Editor so both reject the same bad
 * edits before writing to the workspace.
 */
export function parseCardFieldInput(
  field: CardField,
  raw: string,
): CardFieldParseResult {
  if (field.type === "text") {
    return raw === ""
      ? { ok: true }
      : { ok: true, value: raw.slice(0, 10_000) };
  }
  if (field.type === "enum") {
    if (raw === "") return { ok: true };
    if (!field.enumValues.includes(raw)) return { ok: false, reason: "enum" };
    return { ok: true, value: raw };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return { ok: false, reason: "number" };
  if (field.type === "integer" && !Number.isInteger(numeric))
    return { ok: false, reason: "integer" };
  if (field.min !== undefined && numeric < field.min)
    return { ok: false, reason: "min" };
  if (field.max !== undefined && numeric > field.max)
    return { ok: false, reason: "max" };
  return { ok: true, value: numeric };
}

export interface CardExportMapping {
  id: string;
  typeId: string;
  behavior: string;
  resolvedBehavior: BuiltInCardBehavior;
  exportKind: string;
  title: LocalizedText;
  values: Record<string, number | string>;
  notes: string;
}

/** Update only the active UI language of a localized title while preserving the other. */
export function setLocalizedTitle(
  current: LocalizedText,
  locale: UiLocale,
  value: string,
): LocalizedText {
  const trimmed = value.trim();
  return locale === "en"
    ? { zh: current.zh, en: trimmed }
    : { zh: trimmed, en: current.en };
}

/** Deterministic export mapping driven by the type's behavior key. */
export function cardExportRecord(
  type: CardType,
  card: Card,
): CardExportMapping {
  const resolved = resolveCardBehavior(type.behavior);
  return {
    id: card.id,
    typeId: type.id,
    behavior: type.behavior,
    resolvedBehavior: resolved.key,
    exportKind: resolved.exportKind,
    title: card.title,
    values: card.values,
    notes: card.notes,
  };
}

/** Fill every declared default so a new card always has a complete shape. */
export function defaultCardValues(
  type: CardType,
): Record<string, number | string> {
  const values: Record<string, number | string> = {};
  for (const field of type.fields) {
    if (field.defaultValue !== undefined)
      values[field.key] = field.defaultValue;
  }
  return values;
}

/**
 * Fit stored values to the type's current field list. Editing a type can
 * remove fields, change their type, narrow a range or drop an enum value;
 * cards created earlier must still validate afterwards.
 */
export function reconcileCardValues(
  type: CardType,
  values: Record<string, number | string>,
): Record<string, number | string> {
  const next: Record<string, number | string> = {};
  for (const field of type.fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.type === "text") {
      next[field.key] = String(value).slice(0, 10_000);
      continue;
    }
    if (field.type === "enum") {
      if (field.enumValues.includes(String(value)))
        next[field.key] = String(value);
      continue;
    }
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) continue;
    let adjusted = field.type === "integer" ? Math.round(numeric) : numeric;
    if (field.min !== undefined && adjusted < field.min) adjusted = field.min;
    if (field.max !== undefined && adjusted > field.max) adjusted = field.max;
    next[field.key] = adjusted;
  }
  return next;
}

/**
 * Copy a type as a starting template: same fields and look, fresh identity and
 * no cards. The copy's values are independent, so editing it never touches the
 * original type or its cards.
 */
export function duplicateCardType(
  type: CardType,
  now = new Date().toISOString(),
): CardType {
  return {
    ...structuredClone(type),
    id: createId("ctype"),
    universeId: type.universeId,
    name: {
      zh: `${type.name.zh.trim()} 副本`.trim(),
      en: `${type.name.en.trim()} copy`.trim(),
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createCard(
  type: CardType,
  input: {
    title: LocalizedText;
    values?: Record<string, number | string>;
    notes?: string;
    now?: string;
    id?: string;
  },
): Card {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? createId("card"),
    typeId: type.id,
    title: input.title,
    values: { ...defaultCardValues(type), ...input.values },
    notes: input.notes ?? "",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create N cards of one type with default values. The numbered titles make the
 * batch visible in the table, and every card stays a normal editable record.
 */
export function createCardBatch(
  type: CardType,
  options: {
    count: number;
    titlePrefix: string;
    startIndex?: number;
    now?: string;
  },
): Card[] {
  const now = options.now ?? new Date().toISOString();
  const start = options.startIndex ?? 1;
  const count = Math.max(0, Math.min(500, Math.floor(options.count)));
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return createCard(type, {
      title: localized(
        `${options.titlePrefix} ${index}`,
        `${options.titlePrefix} ${index}`,
      ),
      now,
    });
  });
}

export interface ConstructBuild {
  types: CardType[];
  cards: Card[];
  edges: CardEdge[];
}

export interface BuiltInConstruct {
  id: string;
  name: LocalizedText;
  summary: LocalizedText;
  /**
   * `workId` is set when the pack is created inside one work (a game quick
   * build), so every type it stamps is scoped to that work.
   */
  build: (now: string, universeId: string, workId?: string) => ConstructBuild;
}

function field(
  key: string,
  zh: string,
  en: string,
  type: CardType["fields"][number]["type"],
  extra: Partial<CardType["fields"][number]> = {},
): CardType["fields"][number] {
  return {
    key,
    label: localized(zh, en),
    type,
    unit: "",
    enumValues: [],
    ...extra,
  };
}

function looterConstruct(
  now: string,
  universeId: string,
  workId?: string,
): ConstructBuild {
  const sceneType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("场景", "Scene"),
    summary: localized(
      "关卡或副本：等级区间、波次、首领与掉落倾向。",
      "A level or dungeon: level band, waves, boss and loot bias.",
    ),
    icon: "world",
    color: "#3f6f8f",
    behavior: "scene",
    fields: [
      field("levelMin", "最低等级", "Min level", "integer", {
        min: 1,
        max: 100,
        defaultValue: 1,
      }),
      field("levelMax", "最高等级", "Max level", "integer", {
        min: 1,
        max: 100,
        defaultValue: 10,
      }),
      field("waves", "波次", "Waves", "integer", {
        min: 1,
        max: 50,
        defaultValue: 3,
      }),
      field("boss", "首领", "Boss", "text", { defaultValue: "" }),
      field("lootBias", "掉落倾向", "Loot bias", "enum", {
        enumValues: ["武器", "防具", "饰品", "材料"],
        defaultValue: "武器",
      }),
      field("mood", "氛围", "Mood", "text", { defaultValue: "" }),
    ],
    createdAt: now,
    updatedAt: now,
  };
  const monsterType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("怪物", "Monster"),
    summary: localized(
      "可战斗单位：等级、基础属性、类型与掉落。",
      "A combat unit: level, base stats, tier and drop.",
    ),
    icon: "sparkles",
    color: "#8f4b3f",
    behavior: "monster",
    fields: [
      field("level", "等级", "Level", "integer", {
        min: 1,
        max: 100,
        defaultValue: 1,
      }),
      field("hp", "生命", "HP", "integer", { min: 0, defaultValue: 100 }),
      field("atk", "攻击", "Attack", "integer", { min: 0, defaultValue: 10 }),
      field("def", "防御", "Defense", "integer", { min: 0, defaultValue: 5 }),
      field("speed", "速度", "Speed", "decimal", {
        min: 0,
        max: 5,
        defaultValue: 1,
      }),
      field("crit", "暴击率", "Crit chance", "decimal", {
        min: 0,
        max: 1,
        defaultValue: 0.05,
      }),
      field("tier", "类型", "Tier", "enum", {
        enumValues: ["普通", "精英", "首领"],
        defaultValue: "普通",
      }),
      field("drop", "掉落", "Drop", "text", { defaultValue: "" }),
    ],
    createdAt: now,
    updatedAt: now,
  };
  const equipmentType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("装备", "Equipment"),
    summary: localized(
      "可掉落物：稀有度、部位、数值与词条。",
      "A drop: rarity, slot, stats and affix.",
    ),
    icon: "package",
    color: "#6f5a2f",
    behavior: "equipment",
    fields: [
      field("rarity", "稀有度", "Rarity", "enum", {
        enumValues: ["普通", "魔法", "稀有", "史诗", "传说"],
        defaultValue: "普通",
      }),
      field("slot", "部位", "Slot", "enum", {
        enumValues: ["武器", "头盔", "护甲", "靴子", "饰品"],
        defaultValue: "武器",
      }),
      field("atk", "攻击", "Attack", "integer", { min: 0, defaultValue: 0 }),
      field("hp", "生命", "HP", "integer", { min: 0, defaultValue: 0 }),
      field("affix", "词条", "Affix", "text", { defaultValue: "" }),
    ],
    createdAt: now,
    updatedAt: now,
  };

  const sceneMine = createCard(sceneType, {
    title: localized("腐化矿坑", "Corrupted Mine"),
    values: {
      levelMin: 5,
      levelMax: 10,
      waves: 3,
      boss: "矿坑守卫",
      lootBias: "武器",
      mood: "潮湿、幽闭、矿灯将熄",
    },
    now,
  });
  const sceneWoods = createCard(sceneType, {
    title: localized("静谧林地", "Quiet Woods"),
    values: {
      levelMin: 1,
      levelMax: 5,
      waves: 2,
      boss: "林地巨狼",
      lootBias: "防具",
      mood: "薄雾、鸟鸣、腐叶",
    },
    now,
  });
  const miner = createCard(monsterType, {
    title: localized("腐化矿工", "Corrupted Miner"),
    values: {
      level: 3,
      hp: 80,
      atk: 12,
      def: 4,
      speed: 1.2,
      crit: 0.05,
      tier: "普通",
      drop: "锈蚀短剑",
    },
    now,
  });
  const warden = createCard(monsterType, {
    title: localized("矿坑守卫", "Mine Warden"),
    values: {
      level: 8,
      hp: 900,
      atk: 45,
      def: 20,
      speed: 0.9,
      crit: 0.1,
      tier: "首领",
      drop: "矿工护符",
    },
    now,
  });
  const wolf = createCard(monsterType, {
    title: localized("林地狼", "Woodland Wolf"),
    values: {
      level: 2,
      hp: 60,
      atk: 10,
      def: 2,
      speed: 1.6,
      crit: 0.08,
      tier: "普通",
      drop: "狼牙",
    },
    now,
  });
  const giantWolf = createCard(monsterType, {
    title: localized("林地巨狼", "Giant Wolf"),
    values: {
      level: 5,
      hp: 180,
      atk: 22,
      def: 6,
      speed: 1.5,
      crit: 0.12,
      tier: "精英",
      drop: "狼王皮甲",
    },
    now,
  });
  const sword = createCard(equipmentType, {
    title: localized("锈蚀短剑", "Rusted Shortsword"),
    values: {
      rarity: "普通",
      slot: "武器",
      atk: 8,
      hp: 0,
      affix: "攻击速度 +5%",
    },
    now,
  });
  const charm = createCard(equipmentType, {
    title: localized("矿工护符", "Miner's Charm"),
    values: {
      rarity: "稀有",
      slot: "饰品",
      atk: 0,
      hp: 120,
      affix: "受到伤害 -3%",
    },
    now,
  });

  const edge = (
    sourceId: string,
    targetId: string,
    zh: string,
    en: string,
  ): CardEdge => ({
    id: createId("cedge"),
    sourceId,
    targetId,
    label: localized(zh, en),
    notes: "",
    createdAt: now,
    updatedAt: now,
  });

  return {
    types: [sceneType, monsterType, equipmentType],
    cards: [
      sceneMine,
      sceneWoods,
      miner,
      warden,
      wolf,
      giantWolf,
      sword,
      charm,
    ],
    edges: [
      edge(miner.id, sceneMine.id, "出没于", "Haunts"),
      edge(warden.id, sceneMine.id, "镇守", "Guards"),
      edge(wolf.id, sceneWoods.id, "出没于", "Haunts"),
      edge(giantWolf.id, sceneWoods.id, "镇守", "Guards"),
      edge(sword.id, miner.id, "掉落自", "Drops from"),
      edge(charm.id, warden.id, "掉落自", "Drops from"),
    ],
  };
}

function novelBibleConstruct(
  now: string,
  universeId: string,
  workId?: string,
): ConstructBuild {
  const characterType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("人物", "Character"),
    summary: localized(
      "故事核心角色：身份、阵营、状态与动机。",
      "Core cast card: role, faction, status and motivation.",
    ),
    icon: "users",
    color: "#367c75",
    behavior: "character",
    fields: [
      field("role", "身份", "Role", "text", { defaultValue: "" }),
      field("faction", "阵营", "Faction", "text", { defaultValue: "" }),
      field("status", "状态", "Status", "enum", {
        enumValues: ["活跃", "潜伏", "失踪", "退场"],
        defaultValue: "活跃",
      }),
      field("motivation", "核心动机", "Motivation", "text", {
        defaultValue: "",
      }),
      field("powerRank", "战力/位阶", "Power rank", "integer", {
        min: 1,
        max: 10,
        defaultValue: 1,
      }),
    ],
    createdAt: now,
    updatedAt: now,
  };
  const locationType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("地点", "Location"),
    summary: localized(
      "故事舞台：区域、通行条件、风险等级与氛围。",
      "Story stage: region, access, risk level and atmosphere.",
    ),
    icon: "world",
    color: "#2f7567",
    behavior: "location",
    fields: [
      field("region", "所属区域", "Region", "text", { defaultValue: "" }),
      field("access", "通行权限", "Access", "enum", {
        enumValues: ["公开", "受限", "禁区"],
        defaultValue: "公开",
      }),
      field("riskLevel", "风险等级", "Risk level", "integer", {
        min: 1,
        max: 5,
        defaultValue: 1,
      }),
      field("atmosphere", "氛围", "Atmosphere", "text", { defaultValue: "" }),
    ],
    createdAt: now,
    updatedAt: now,
  };
  const factionType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("势力", "Faction"),
    summary: localized(
      "组织与阵营：立场、影响力与核心目标。",
      "Organization or faction: alignment, influence and goal.",
    ),
    icon: "grid",
    color: "#5d4037",
    behavior: "faction",
    fields: [
      field("alignment", "立场", "Alignment", "enum", {
        enumValues: ["盟友", "中立", "对立", "未知"],
        defaultValue: "中立",
      }),
      field("influence", "影响力", "Influence", "integer", {
        min: 1,
        max: 10,
        defaultValue: 5,
      }),
      field("goal", "核心目标", "Goal", "text", { defaultValue: "" }),
    ],
    createdAt: now,
    updatedAt: now,
  };
  const objectType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("物件", "Story object"),
    summary: localized(
      "线索、信物与关键道具：分类、稀有度与状态。",
      "Clues, tokens and key props: category, rarity and status.",
    ),
    icon: "package",
    color: "#8b6f47",
    behavior: "object",
    fields: [
      field("category", "类别", "Category", "enum", {
        enumValues: ["线索", "信物", "器物", "文献"],
        defaultValue: "线索",
      }),
      field("rarity", "稀有度", "Rarity", "enum", {
        enumValues: ["常见", "稀有", "唯一"],
        defaultValue: "稀有",
      }),
      field("status", "当前状态", "Status", "enum", {
        enumValues: ["完好", "受损", "遗失", "封印"],
        defaultValue: "完好",
      }),
      field("effect", "作用与代价", "Effect / cost", "text", {
        defaultValue: "",
      }),
    ],
    createdAt: now,
    updatedAt: now,
  };
  const loreType: CardType = {
    id: createId("ctype"),
    universeId,
    ...(workId ? { workId } : {}),
    name: localized("设定", "Lore"),
    summary: localized(
      "世界底层法则、历史与禁忌条目。",
      "Underlying world rules, history and taboos.",
    ),
    icon: "book",
    color: "#4a5d73",
    behavior: "lore",
    fields: [
      field("category", "分类", "Category", "enum", {
        enumValues: ["规则", "历史", "文化", "科技", "力量", "谜团"],
        defaultValue: "规则",
      }),
      field("scope", "适用范围", "Scope", "enum", {
        enumValues: ["全宇宙", "局部区域", "特定势力"],
        defaultValue: "全宇宙",
      }),
      field("ruleText", "核心内容", "Summary", "text", { defaultValue: "" }),
    ],
    createdAt: now,
    updatedAt: now,
  };

  const protagonist = createCard(characterType, {
    title: localized("主角草稿", "Protagonist draft"),
    values: {
      role: "主角 · 调查者",
      faction: "无所属",
      status: "活跃",
      motivation: "查明故事开篇的异常事件",
      powerRank: 2,
    },
    now,
  });
  const hubLocation = createCard(locationType, {
    title: localized("起始据点", "Starting hub"),
    values: {
      region: "核心城区",
      access: "公开",
      riskLevel: 2,
      atmosphere: "信息交汇、暗流涌动",
    },
    now,
  });
  const guildFaction = createCard(factionType, {
    title: localized("守序机构", "Orderly guild"),
    values: {
      alignment: "中立",
      influence: 7,
      goal: "维持现有秩序并隐瞒旧案",
    },
    now,
  });
  const keyArtifact = createCard(objectType, {
    title: localized("关键信物", "Key token"),
    values: {
      category: "信物",
      rarity: "唯一",
      status: "完好",
      effect: "开启禁区入口的凭证",
    },
    now,
  });
  const coreRule = createCard(loreType, {
    title: localized("世界核心法则", "Core world rule"),
    values: {
      category: "规则",
      scope: "全宇宙",
      ruleText: "任何超越常识的能力都需要等价代价。",
    },
    now,
  });

  const edge = (
    sourceId: string,
    targetId: string,
    zh: string,
    en: string,
  ): CardEdge => ({
    id: createId("cedge"),
    sourceId,
    targetId,
    label: localized(zh, en),
    notes: "",
    createdAt: now,
    updatedAt: now,
  });

  return {
    types: [characterType, locationType, factionType, objectType, loreType],
    cards: [protagonist, hubLocation, guildFaction, keyArtifact, coreRule],
    edges: [
      edge(protagonist.id, hubLocation.id, "常驻", "Based in"),
      edge(protagonist.id, keyArtifact.id, "持有", "Holds"),
      edge(guildFaction.id, hubLocation.id, "管辖", "Controls"),
      edge(coreRule.id, keyArtifact.id, "约束", "Governs"),
    ],
  };
}

export const BUILT_IN_CONSTRUCTS: readonly BuiltInConstruct[] = [
  {
    id: "looter",
    name: localized("刷子游戏", "Looter game"),
    summary: localized(
      "从场景、怪物、装备三类节点开始，带基础数值和示例卡片，全部可改。",
      "Start from scene, monster and equipment nodes with base stats and sample cards. Everything is editable.",
    ),
    build: looterConstruct,
  },
  {
    id: "novel-bible",
    name: localized("小说设定包", "Novel starter pack"),
    summary: localized(
      "从人物、地点、势力、物件、设定五类可编辑卡片起步，附草稿卡片与关系。",
      "Start from editable character, location, faction, object and lore card types with draft cards and relations.",
    ),
    build: novelBibleConstruct,
  },
];

/**
 * Remove a type together with every card of that type and every relation that
 * touched one of those cards. Returns false when the type was already gone.
 */
export function deleteCardTypeFromDraft(
  draft: StudioWorkspace,
  typeId: string,
): boolean {
  if (!draft.cardTypes.some((type) => type.id === typeId)) return false;
  const cardIds = new Set(
    draft.cards.filter((card) => card.typeId === typeId).map((card) => card.id),
  );
  draft.cardTypes = draft.cardTypes.filter((type) => type.id !== typeId);
  draft.cards = draft.cards.filter((card) => card.typeId !== typeId);
  draft.cardEdges = draft.cardEdges.filter(
    (edge) => !cardIds.has(edge.sourceId) && !cardIds.has(edge.targetId),
  );
  return true;
}

export type ApplyConstructResult =
  | { status: "applied"; name: LocalizedText }
  | { status: "already-applied"; name: LocalizedText }
  | { status: "unknown" };

/**
 * Apply one built-in construct to a draft. Applying twice is refused so a
 * starter can never duplicate its types and sample cards.
 *
 * Called without `workId` the pack belongs to the whole world and is applied
 * once per world. Called with `workId` it is that work's own pack — a game's
 * node board — and is applied once per work, so two games in one world each
 * get their own set of types and cards.
 */
export function applyConstruct(
  draft: StudioWorkspace,
  constructId: string,
  universeId: string,
  now = new Date().toISOString(),
  workId?: string,
): ApplyConstructResult {
  const construct = BUILT_IN_CONSTRUCTS.find((item) => item.id === constructId);
  if (!construct) return { status: "unknown" };
  const work = workId
    ? draft.works.find((item) => item.id === workId)
    : undefined;
  if (workId && !work) return { status: "unknown" };
  if (!draft.universes.some((universe) => universe.id === universeId))
    return { status: "unknown" };
  if (work && work.universeId !== universeId) return { status: "unknown" };
  const recorded = draft.constructs.find(
    (item) =>
      item.id === constructId &&
      item.universeId === universeId &&
      (item.workId ?? undefined) === workId,
  );
  if (recorded) return { status: "already-applied", name: construct.name };
  const built = construct.build(now, universeId, workId);
  draft.cardTypes.push(...built.types);
  draft.cards.push(...built.cards);
  draft.cardEdges.push(...built.edges);
  const applied: AppliedConstruct = {
    id: construct.id,
    universeId,
    ...(workId ? { workId } : {}),
    name: construct.name,
    appliedAt: now,
  };
  draft.constructs.push(applied);
  return { status: "applied", name: construct.name };
}

/**
 * Constructs applied inside one universe — its own world-level packs and, when
 * `workId` is given, that work's packs — most recently used first.
 */
export function appliedConstructs(
  workspace: StudioWorkspace,
  universeId: string,
  workId?: string,
): AppliedConstruct[] {
  return workspace.constructs
    .filter(
      (item) =>
        item.universeId === universeId && (item.workId ?? undefined) === workId,
    )
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt));
}

/** The universe a card belongs to, through the type it instantiates. */
export function cardUniverseId(
  workspace: Pick<StudioWorkspace, "cardTypes">,
  card: Card,
): string | undefined {
  return workspace.cardTypes.find((type) => type.id === card.typeId)
    ?.universeId;
}
