import { createId, localized } from "./factory.ts";
import type {
  AppliedConstruct,
  Card,
  CardEdge,
  CardType,
  LocalizedText,
  StudioWorkspace,
} from "./types.ts";

/** Field keys are local to one card type, not workspace identifiers. */
export const CARD_FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

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
    color: "#3f6f8f",
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
    color: "#8f4b3f",
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
    color: "#6f5a2f",
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
