import { applyConstruct } from "./cards.ts";
import { createId, localized } from "./factory.ts";
import type {
  AbilityTemplate,
  Character,
  ItemStatTemplate,
  LocalizedText,
  LoreEntry,
  Relationship,
  RuleAttribute,
  RuleEffect,
  RuleSystem,
  RuleSystemKind,
  StandardKind,
  StoryFaction,
  StoryLocation,
  StoryObject,
  StudioWorkspace,
  WorkspaceStandard,
} from "./types.ts";

/**
 * Starting foundation templates for a new world. A template only seeds ordinary
 * editable records — draft standards, optional draft power/attribute scaffolds,
 * ability/item placeholders, lore, locations, factions, characters,
 * relationships and optionally one built-in card construct — so everything it
 * writes stays renameable, retypable and deletable. Nothing is locked as canon
 * and nothing is applied to a world that already exists.
 */
export interface WorldTemplateSeed {
  standards: WorkspaceStandard[];
  ruleSystems: RuleSystem[];
  abilityTemplates: AbilityTemplate[];
  itemStatTemplates: ItemStatTemplate[];
  storyObjects: StoryObject[];
  lore: LoreEntry[];
  locations: StoryLocation[];
  factions: StoryFaction[];
  characters: Character[];
  relationships: Relationship[];
}

export interface WorldTemplate {
  id: string;
  name: LocalizedText;
  summary: LocalizedText;
  /** Suggested look, prefilled by the create dialog. */
  accent: string;
  genres: string[];
  themes: string[];
  /** Whether this template seeds a draft structured rule/attribute scaffold. */
  hasPowerScaffold: boolean;
  /** A built-in construct from core/cards.ts seeded as this world's card pack. */
  constructId?: string;
  build: (now: string, universeId: string) => WorldTemplateSeed;
}

type StandardInput = {
  kind: StandardKind;
  title: [string, string];
  body: [string, string];
};

type TierInput = {
  key: string;
  name: [string, string];
  rank: number;
  minValue?: number;
  maxValue?: number;
  summary: string;
};

type RuleSystemInput = {
  title: [string, string];
  kind: RuleSystemKind;
  summary: string;
  unit: string;
  tiers: TierInput[];
  attributes: RuleAttribute[];
};

type AbilityInput = {
  name: [string, string];
  summary: [string, string];
  tierKey?: string;
  effects: RuleEffect[];
  cost: string;
};

type ItemStatInput = {
  name: [string, string];
  category: [string, string];
  summary: [string, string];
  tierKey?: string;
  stats: RuleEffect[];
};

type StoryObjectInput = {
  name: [string, string];
  category: [string, string];
  summary: [string, string];
  sourceNotes: string;
};

type LoreInput = {
  category: LoreEntry["category"];
  title: [string, string];
  body: string;
};

type LocationInput = {
  name: [string, string];
  summary: [string, string];
  atmosphere: string;
};

type FactionInput = {
  name: [string, string];
  summary: [string, string];
  goal: string;
  motif: string;
};

type CharacterInput = {
  name: [string, string];
  role: [string, string];
  summary: [string, string];
  color: string;
  tags: string[];
};

type RelationshipInput = {
  source: number;
  target: number;
  type: Relationship["type"];
  label: [string, string];
  strength: number;
  notes: string;
};

/**
 * Turn terse template literals into full records, minting fresh ids each time
 * so two worlds made from the same template never share an id.
 *
 * All seeded standards and structured rule systems start as `draft`: templates
 * are editable starting scaffolds, never locked canon.
 */
function seedWorld(
  now: string,
  universeId: string,
  input: {
    standards?: StandardInput[];
    ruleSystem?: RuleSystemInput;
    abilities?: AbilityInput[];
    itemStats?: ItemStatInput[];
    storyObjects?: StoryObjectInput[];
    lore: LoreInput[];
    locations: LocationInput[];
    factions: FactionInput[];
    characters: CharacterInput[];
    relationships: RelationshipInput[];
  },
): WorldTemplateSeed {
  const standards: WorkspaceStandard[] = (input.standards ?? []).map(
    (entry) => ({
      id: createId("std"),
      universeId,
      kind: entry.kind,
      title: localized(...entry.title),
      body: localized(...entry.body),
      status: "draft",
      version: 1,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const ruleSystems: RuleSystem[] = [];
  const abilityTemplates: AbilityTemplate[] = [];
  const itemStatTemplates: ItemStatTemplate[] = [];
  if (input.ruleSystem) {
    const ruleSystemId = createId("rules");
    const tierIds = new Map<string, string>();
    const tiers = input.ruleSystem.tiers.map((tier) => {
      const id = createId("tier");
      tierIds.set(tier.key, id);
      return {
        id,
        name: localized(...tier.name),
        rank: tier.rank,
        ...(tier.minValue === undefined ? {} : { minValue: tier.minValue }),
        ...(tier.maxValue === undefined ? {} : { maxValue: tier.maxValue }),
        summary: tier.summary,
      };
    });
    ruleSystems.push({
      id: ruleSystemId,
      universeId,
      title: localized(...input.ruleSystem.title),
      kind: input.ruleSystem.kind,
      summary: input.ruleSystem.summary,
      unit: input.ruleSystem.unit,
      tiers,
      attributes: input.ruleSystem.attributes.map((attribute) => ({
        ...attribute,
        label: { ...attribute.label },
        enumValues: [...attribute.enumValues],
      })),
      status: "draft",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    for (const ability of input.abilities ?? []) {
      const tierId = ability.tierKey ? tierIds.get(ability.tierKey) : undefined;
      abilityTemplates.push({
        id: createId("ability"),
        universeId,
        ruleSystemId,
        name: localized(...ability.name),
        summary: localized(...ability.summary),
        ...(tierId ? { tierId } : {}),
        effects: ability.effects.map((effect) => ({ ...effect })),
        cost: ability.cost,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const item of input.itemStats ?? []) {
      const tierId = item.tierKey ? tierIds.get(item.tierKey) : undefined;
      itemStatTemplates.push({
        id: createId("item"),
        universeId,
        ruleSystemId,
        name: localized(...item.name),
        category: localized(...item.category),
        ...(tierId ? { tierId } : {}),
        stats: item.stats.map((stat) => ({ ...stat })),
        summary: localized(...item.summary),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const storyObjects: StoryObject[] = (input.storyObjects ?? []).map(
    (entry) => ({
      id: createId("obj"),
      universeId,
      name: localized(...entry.name),
      category: localized(...entry.category),
      summary: localized(...entry.summary),
      visualPrompt: "",
      sourceNotes: entry.sourceNotes,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const lore: LoreEntry[] = input.lore.map((entry) => ({
    id: createId("lore"),
    universeId,
    category: entry.category,
    title: localized(...entry.title),
    body: entry.body,
    createdAt: now,
    updatedAt: now,
  }));
  const locations: StoryLocation[] = input.locations.map((entry) => ({
    id: createId("loc"),
    universeId,
    name: localized(...entry.name),
    summary: localized(...entry.summary),
    atmosphere: entry.atmosphere,
    visualPrompt: "",
    createdAt: now,
    updatedAt: now,
  }));
  const factions: StoryFaction[] = input.factions.map((entry) => ({
    id: createId("fac"),
    universeId,
    name: localized(...entry.name),
    summary: localized(...entry.summary),
    goal: entry.goal,
    visualMotif: entry.motif,
    createdAt: now,
    updatedAt: now,
  }));
  const characters: Character[] = input.characters.map((entry) => ({
    id: createId("char"),
    universeIds: [universeId],
    name: localized(...entry.name),
    role: localized(...entry.role),
    summary: localized(...entry.summary),
    appearance: "",
    visualPrompt: "",
    personality: "",
    motivation: "",
    flaw: "",
    secret: "",
    voice: "",
    tags: entry.tags,
    color: entry.color,
    reusable: false,
    createdAt: now,
    updatedAt: now,
  }));
  const relationships: Relationship[] = input.relationships.map((entry) => ({
    id: createId("rel"),
    universeId,
    sourceId: characters[entry.source]!.id,
    targetId: characters[entry.target]!.id,
    type: entry.type,
    label: localized(...entry.label),
    strength: entry.strength,
    status: "active",
    mutual: false,
    notes: entry.notes,
    createdAt: now,
    updatedAt: now,
  }));
  return {
    standards,
    ruleSystems,
    abilityTemplates,
    itemStatTemplates,
    storyObjects,
    lore,
    locations,
    factions,
    characters,
    relationships,
  };
}

function genericNovel(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
    standards: [
      {
        kind: "continuity",
        title: [
          "世界事实与视角约束（草案）",
          "World facts and POV guardrails (draft)",
        ],
        body: [
          "开写前先确认核心地点、主要人物与关键物件的既有状态；章节中只能使用视角人物可得知的信息，新增设定先标为提案再升级为正典。",
          "Confirm key locations, cast states and anchor objects before drafting. Keep each scene inside the POV character's knowledge and mark new facts as proposals before promoting them to canon.",
        ],
      },
      {
        kind: "style",
        title: [
          "叙事基调与对话风格（草案）",
          "Narrative tone and dialogue voice (draft)",
        ],
        body: [
          "先写清本书的叙事人称、节奏与对话特征（克制/冷峻/轻快等），避免同一部作品在不同章节之间无故切换语域。",
          "Define the book's point of view, pacing and dialogue voice up front so tone does not drift silently between chapters.",
        ],
      },
    ],
    storyObjects: [
      {
        name: ["关键信物（占位）", "Anchor keepsake (placeholder)"],
        category: ["关键物件", "Key object"],
        summary: [
          "串联主线冲突或人物秘密的随身物件，可替换为你的故事核心道具。",
          "A personal object tied to the central conflict or a character secret; replace with your story's anchor prop.",
        ],
        sourceNotes: "模板占位条目：开写前按你的故事改名并写明归属与来历。",
      },
    ],
    lore: [
      {
        category: "rule",
        title: ["世界核心约束（占位）", "Core world constraint (placeholder)"],
        body: "写下一条让这个世界与现实不同、或限制主角行动的核心规矩。\n\nWrite down one rule that distinguishes this setting or constrains what characters can do.",
      },
      {
        category: "history",
        title: ["前史转折点（占位）", "Backstory turning point (placeholder)"],
        body: "记录故事开始前已经发生、并至今影响主要人物的关键事件。\n\nRecord one past event that already happened before chapter 1 and still shapes the cast.",
      },
    ],
    locations: [
      {
        name: ["主舞台（占位）", "Primary setting (placeholder)"],
        summary: [
          "故事最常发生的核心场所，可替换为城镇、学院、船舱或街道。",
          "The anchor setting where most scenes unfold; rename to a town, campus, vessel or street.",
        ],
        atmosphere: "日常秩序与暗流交汇的空间",
      },
    ],
    factions: [
      {
        name: ["核心阵营（占位）", "Core faction (placeholder)"],
        summary: [
          "掌握关键资源或制定地方规则的组织，为主线提供阻力或庇护。",
          "An institution or group holding resources or enforcing local norms.",
        ],
        goal: "维持既有秩序或争夺稀缺资源",
        motif: "徽记、制服或共同称呼",
      },
    ],
    characters: [
      {
        name: ["主角（占位）", "Protagonist (placeholder)"],
        role: ["主角", "Protagonist"],
        summary: [
          "推动故事前进的核心人物：写清他的目标、顾虑与不能轻易说出口的秘密。",
          "The central driver of the plot: fill in their goal, flaw and hidden stake.",
        ],
        color: "#2f7567",
        tags: ["主角", "待完善"],
      },
      {
        name: ["对照人物（占位）", "Foil / ally (placeholder)"],
        role: ["搭档或对手", "Ally or foil"],
        summary: [
          "与主角共享同一段过去或目标、但做法截然不同的人物。",
          "Someone who shares a past or goal with the protagonist but chooses a different method.",
        ],
        color: "#7a6a55",
        tags: ["对照", "待完善"],
      },
    ],
    relationships: [
      {
        source: 0,
        target: 1,
        type: "ally",
        label: ["脆弱同盟", "Fragile alliance"],
        strength: 3,
        notes: "开写前写明双方互相需要什么、又在防备什么。",
      },
    ],
  });
}

function cultivation(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
    standards: [
      {
        kind: "numeric",
        title: [
          "境界跨阶与灵力代价（草案）",
          "Realm gap and qi cost rules (draft)",
        ],
        body: [
          "严格沿用本世界登记的境界阶位与灵力数值区间；跨阶对敌必须付出明确代价（丹药、阵法、寿元或伤势），不得临场凭空拔高战力。",
          "Follow the world's registered realm tiers and qi ranges strictly. Fighting across tiers must carry an explicit cost (elixir, formation, lifespan or injury) rather than an ungrounded power spike.",
        ],
      },
      {
        kind: "naming",
        title: [
          "宗门、功法与法器命名（草案）",
          "Sect, technique and artifact naming (draft)",
        ],
        body: [
          "功法与法器统一标明品阶与所属属性；同一宗门功法保留统一意象前缀，登记后全文沿用同一写法。",
          "Tag every technique and artifact with its tier and elemental affinity. Keep one consistent naming motif per sect once registered.",
        ],
      },
    ],
    ruleSystem: {
      title: [
        "修真境界与灵力体系（草案）",
        "Cultivation realms & qi scale (draft)",
      ],
      kind: "power",
      summary:
        "可自由改名与调数的四阶修真骨架：炼气、筑基、金丹、元婴，配套灵力/体魄/神识与灵根属性。",
      unit: "点灵力",
      tiers: [
        {
          key: "qi",
          name: ["炼气境", "Qi Condensation"],
          rank: 1,
          minValue: 1,
          maxValue: 99,
          summary: "引气入体，开启经脉与基础术法。",
        },
        {
          key: "foundation",
          name: ["筑基境", "Foundation Establishment"],
          rank: 2,
          minValue: 100,
          maxValue: 499,
          summary: "灵力液化，可御器飞行并延寿百年。",
        },
        {
          key: "core",
          name: ["金丹境", "Golden Core"],
          rank: 3,
          minValue: 500,
          maxValue: 1999,
          summary: "丹成一体，足以镇守一峰或开宗立派。",
        },
        {
          key: "nascent",
          name: ["元婴境", "Nascent Soul"],
          rank: 4,
          minValue: 2000,
          maxValue: 9999,
          summary: "碎丹成婴，神识覆盖百里，可短距瞬移。",
        },
      ],
      attributes: [
        {
          key: "qi",
          label: localized("灵力", "Qi"),
          type: "integer",
          unit: "点",
          min: 0,
          max: 10000,
          enumValues: [],
          defaultValue: 20,
          description: "修士丹田可调动的灵力总量。",
        },
        {
          key: "physique",
          label: localized("体魄", "Physique"),
          type: "integer",
          unit: "点",
          min: 0,
          max: 1000,
          enumValues: [],
          defaultValue: 10,
          description: "肉身承受冲击与反噬的能力。",
        },
        {
          key: "spiritSense",
          label: localized("神识", "Spirit sense"),
          type: "integer",
          unit: "丈",
          min: 0,
          max: 5000,
          enumValues: [],
          defaultValue: 5,
          description: "神识探查与御剑操控的有效半径。",
        },
        {
          key: "root",
          label: localized("灵根", "Spirit root"),
          type: "enum",
          unit: "",
          enumValues: ["金", "木", "水", "火", "土"],
          defaultValue: "木",
          description: "决定功法契合度的五行灵根属性。",
        },
      ],
    },
    abilities: [
      {
        name: ["吐纳引气诀", "Qi Breathing Art"],
        summary: [
          "入门吐纳功法，稳步提升丹田灵力蓄积。",
          "Starter breathing method that steadily raises usable qi.",
        ],
        tierKey: "qi",
        effects: [{ attributeKey: "qi", operation: "add", value: 15 }],
        cost: "每轮打坐需静室与灵气环境，耗费半个时辰。",
      },
      {
        name: ["青莲剑意", "Azure Lotus Sword Intent"],
        summary: [
          "以神识御剑的进阶剑诀，攻防兼备但消耗较大。",
          "An advanced sword-control form pairing qi surge with wider spirit sense.",
        ],
        tierKey: "foundation",
        effects: [
          { attributeKey: "qi", operation: "add", value: 40 },
          { attributeKey: "spiritSense", operation: "add", value: 10 },
        ],
        cost: "每次施展消耗 30 点灵力，神识不足时会引起反噬。",
      },
    ],
    itemStats: [
      {
        name: ["青锋灵剑", "Spirit Edge Blade"],
        category: ["下品法器 · 飞剑", "Low-grade spirit blade"],
        summary: [
          "宗门外门制式飞剑，便于注灵御使。",
          "Standard outer-sect flying sword suited for basic qi channeling.",
        ],
        tierKey: "qi",
        stats: [{ attributeKey: "qi", operation: "add", value: 25 }],
      },
      {
        name: ["聚灵玉佩", "Qi-Gathering Jade"],
        category: ["辅助法器", "Support talisman"],
        summary: [
          "缓慢聚拢周身灵气，适合低阶弟子日常吐纳。",
          "Gently condenses ambient qi for low-tier cultivation.",
        ],
        tierKey: "qi",
        stats: [
          { attributeKey: "qi", operation: "add", value: 10 },
          { attributeKey: "spiritSense", operation: "add", value: 5 },
        ],
      },
    ],
    storyObjects: [
      {
        name: ["残缺玉简", "Cracked Jade Slip"],
        category: ["传承物件", "Legacy relic"],
        summary: [
          "刻有半篇古功法的玉简，后半段需筑基神识才能读出。",
          "A jade slip holding half an ancient scripture; the rest stays unreadable until Foundation Establishment.",
        ],
        sourceNotes: "模板占位物件：可作为主角早期机缘与宗门争夺线索。",
      },
    ],
    lore: [
      {
        category: "power",
        title: ["天劫与灵脉衰减", "Tribulations and fading ley lines"],
        body: "近三百年中洲灵脉日渐稀薄，金丹以上每破一境必引天劫，散修几乎无法独自渡过。\n\nMiddle-realm ley lines have thinned for three centuries; every breakthrough past Golden Core draws tribulation that lone cultivators rarely survive.",
      },
      {
        category: "rule",
        title: ["宗门试炼禁令", "Sect trial taboo"],
        body: "秘境试炼期间不得损毁灵脉阵眼，违者废除修为逐出山门。\n\nDamaging a ley-line anchor during trials means stripped cultivation and permanent exile.",
      },
    ],
    locations: [
      {
        name: ["青岚外门山谷", "Azure Mist Outer Valley"],
        summary: [
          "灵气最淡却人丁最旺的试炼山谷，外门弟子在此争抢灵田与丹药配额。",
          "The outer valley with the thinnest qi and fiercest competition for herb plots and pill stipends.",
        ],
        atmosphere: "晨雾药田、石阶山门、悬崖剑痕",
      },
      {
        name: ["碎灵秘境", "Shattered Spirit Realm"],
        summary: [
          "十年一开的上古折叠洞天，深处灵气充沛但法则残缺。",
          "An ancient pocket realm opening once a decade, rich in qi yet fractured in law.",
        ],
        atmosphere: "断碑、浮石、漂移灵雾",
      },
    ],
    factions: [
      {
        name: ["青岚宗", "Azure Mist Sect"],
        summary: [
          "坐落东境灵脉之上的剑修大派，表面清正却暗分内门与世家两脉。",
          "A major sword sect anchored on an eastern ley line, outwardly upright yet split between elders and noble houses.",
        ],
        goal: "在灵脉衰退前保住宗门元婴传承",
        motif: "青玉剑穗、山门云纹、炼丹炉烟",
      },
    ],
    characters: [
      {
        name: ["林清河", "Lin Qinghe"],
        role: ["主角 · 外门杂役弟子", "Protagonist · Outer-sect disciple"],
        summary: [
          "杂灵根出身的药田弟子，靠一枚残缺玉简摸清了灵力精控之法。",
          "A mixed-root herb-plot disciple who learned fine qi control from a cracked jade slip.",
        ],
        color: "#2f7567",
        tags: ["炼气", "杂灵根", "药田"],
      },
      {
        name: ["苏照雪", "Su Zhaoxue"],
        role: [
          "同门/对照 · 内门剑修",
          "Peer / foil · Inner-sect sword cultivator",
        ],
        summary: [
          "单系剑骨天才，怀疑宗门长老隐瞒了灵脉枯竭的真相。",
          "A single-root sword prodigy who suspects the elders are hiding why the ley lines are drying up.",
        ],
        color: "#3f6f8f",
        tags: ["筑基", "剑修", "内门"],
      },
    ],
    relationships: [
      {
        source: 0,
        target: 1,
        type: "ally",
        label: ["秘境互保之约", "Trial-realm pact"],
        strength: 3,
        notes: "林清河提供辨药与阵法眼力，苏照雪提供正面护持。",
      },
    ],
  });
}

function urbanFantasy(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
    standards: [
      {
        kind: "continuity",
        title: [
          "帷幕保密与现实代价（草案）",
          "Veil secrecy and real-world cost (draft)",
        ],
        body: [
          "异能事件在普通市民面前必须有可信的世俗掩盖口径；每次超限动用能力都会累积负荷或留下可追踪痕迹。",
          "Every supernatural incident needs a plausible mundane cover story. Pushing past limits always raises backlash strain or leaves traceable evidence.",
        ],
      },
      {
        kind: "numeric",
        title: [
          "共鸣评级与负荷上限（草案）",
          "Resonance tiers and strain cap (draft)",
        ],
        body: [
          "共鸣值与负荷百分比沿用本世界规则体系；负荷达到 100% 时必然触发失控或休克，不得无代价连续爆发。",
          "Use the registered resonance scale and strain percentage. Hitting 100% strain triggers backlash or collapse; never allow cost-free chained bursts.",
        ],
      },
    ],
    ruleSystem: {
      title: [
        "异能共鸣与负荷体系（草案）",
        "Awakening resonance & strain (draft)",
      ],
      kind: "power",
      summary:
        "都市异能四阶评级骨架：按共鸣度划分能力规模，并用负荷百分比约束每次施放的代价。",
      unit: "共鸣度",
      tiers: [
        {
          key: "flicker",
          name: ["微光级 (D)", "Flicker (D)"],
          rank: 1,
          minValue: 1,
          maxValue: 25,
          summary: "局限于自身感官或近距微调，难以被常人察觉。",
        },
        {
          key: "manifest",
          name: ["显化级 (C)", "Manifest (C)"],
          rank: 2,
          minValue: 26,
          maxValue: 60,
          summary: "可在单间或街口范围稳定显化异象。",
        },
        {
          key: "domain",
          name: ["领域级 (B)", "Domain (B)"],
          rank: 3,
          minValue: 61,
          maxValue: 120,
          summary: "短时间改写整栋建筑或街区的局部法则。",
        },
        {
          key: "cataclysm",
          name: ["灾厄级 (A)", "Cataclysm (A)"],
          rank: 4,
          minValue: 121,
          maxValue: 250,
          summary: "足以迫使异常署封锁城区的高危个体。",
        },
      ],
      attributes: [
        {
          key: "resonance",
          label: localized("共鸣度", "Resonance"),
          type: "integer",
          unit: "点",
          min: 0,
          max: 300,
          enumValues: [],
          defaultValue: 15,
          description: "觉醒者与裂隙频率同步的强度。",
        },
        {
          key: "strain",
          label: localized("负荷值", "Backlash strain"),
          type: "integer",
          unit: "%",
          min: 0,
          max: 100,
          enumValues: [],
          defaultValue: 0,
          description: "持续施放异能累积的精神与生理反噬。",
        },
        {
          key: "affinity",
          label: localized("异能序列", "Affinity"),
          type: "enum",
          unit: "",
          enumValues: ["perception", "kinetics", "distortion", "pact"],
          defaultValue: "perception",
          description: "能力所属的主要表现序列。",
        },
      ],
    },
    abilities: [
      {
        name: ["回响听觉", "Echo Perception"],
        summary: [
          "从静止物件上听见过去三十分钟内残留的声纹碎片。",
          "Reads thirty minutes of residual acoustic echoes from an untouched object.",
        ],
        tierKey: "flicker",
        effects: [
          { attributeKey: "resonance", operation: "add", value: 10 },
          { attributeKey: "strain", operation: "add", value: 15 },
        ],
        cost: "连续使用两次后会耳鸣失衡，负荷 +15%。",
      },
      {
        name: ["折光屏障", "Refraction Ward"],
        summary: [
          "扭曲三米内的视线与监控镜头，制造短暂盲区。",
          "Bends sightlines and security cameras across three meters to open a brief blind spot.",
        ],
        tierKey: "manifest",
        effects: [
          { attributeKey: "resonance", operation: "add", value: 20 },
          { attributeKey: "strain", operation: "add", value: 25 },
        ],
        cost: "每维持十秒负荷 +25%，强光环境下消耗翻倍。",
      },
    ],
    itemStats: [
      {
        name: ["镇静银戒", "Grounding Silver Ring"],
        category: ["抑能遗物", "Suppressor relic"],
        summary: [
          "刻有稳定回路的旧银戒，用于缓释异能反噬。",
          "An engraved silver band that vents part of an ability's backlash.",
        ],
        tierKey: "flicker",
        stats: [{ attributeKey: "strain", operation: "add", value: -10 }],
      },
    ],
    storyObjects: [
      {
        name: ["无号异常证物袋", "Unnumbered Anomaly Pouch"],
        category: ["封印物件", "Containment prop"],
        summary: [
          "屏蔽共鸣信号的铅衬证物袋，袋口封条写着不存在的部门编号。",
          "A lead-lined evidence pouch bearing a seal from a bureau branch that does not officially exist.",
        ],
        sourceNotes: "模板占位物件：用于串起官方调查与地下黑市两条线。",
      },
    ],
    lore: [
      {
        category: "power",
        title: ["裂隙频率与城市帷幕", "Rift frequency and the urban veil"],
        body: "只有频率与城市地脉错拍的瞬间，异能才会显化；绝大多数市民只会把异常当成停电、信号干扰或错觉。\n\nAbilities surface only when someone slips out of phase with the city grid; most bystanders write anomalies off as blackouts or interference.",
      },
      {
        category: "rule",
        title: ["零点静默条款", "Midnight silence clause"],
        body: "已登记觉醒者在地铁与医院范围内禁止主动展开 B 级以上能力，违者立刻转入强制收容。\n\nRegistered awakeners may not deploy Domain-tier abilities inside transit or hospitals under penalty of immediate containment.",
      },
    ],
    locations: [
      {
        name: ["南站地下通道", "South Station Underpass"],
        summary: [
          "凌晨关灯后变成半地下遗物交换点的长走廊，监控永远慢三秒。",
          "A long pedestrian tunnel that turns into a quiet relic exchange after lights-out, its cameras always three seconds behind.",
        ],
        atmosphere: "荧光灯频闪、湿滑瓷砖、远处末班车震动",
      },
      {
        name: ["异常事务处理科", "Office of Anomalous Affairs"],
        summary: [
          "挂着市政设施维护牌子的外勤办公楼，负责善后与记忆掩饰。",
          "A field office disguised as municipal maintenance, tasked with cleanup and cover stories.",
        ],
        atmosphere: "百叶窗、封存柜、永远开着的频谱仪",
      },
    ],
    factions: [
      {
        name: ["夜巡事务科", "Nightwatch Bureau"],
        summary: [
          "维持城市帷幕与觉醒者登记册的半公开机构。",
          "The semi-official agency guarding the veil and maintaining the awakener registry.",
        ],
        goal: "把裂隙事件压在市民察觉阈值以下",
        motif: "深灰风衣、频谱胸卡、铅衬公文箱",
      },
    ],
    characters: [
      {
        name: ["周栖", "Zhou Qi"],
        role: [
          "主角 · 声音修复师 / 未登记觉醒者",
          "Protagonist · Audio restorer / unregistered awakener",
        ],
        summary: [
          "经营旧磁带修复店的年轻人，能听见物件上残留的声音，却一直隐瞒自己的共鸣体质。",
          "Runs an analog tape shop and hears acoustic echoes left on objects while staying off the Bureau's registry.",
        ],
        color: "#6b4c8a",
        tags: ["感知系", "未登记", "声纹"],
      },
      {
        name: ["程砚", "Cheng Yan"],
        role: [
          "搭档/监视者 · 外勤调查官",
          "Handler / partner · Field investigator",
        ],
        summary: [
          "夜巡事务科的善后调查官，为了追查一桩失踪遗物案暂时没有上报周栖的身份。",
          "A Bureau cleanup officer keeping Zhou Qi off the books while chasing a missing relic.",
        ],
        color: "#3f6f8f",
        tags: ["事务科", "调查官", "遗物"],
      },
    ],
    relationships: [
      {
        source: 1,
        target: 0,
        type: "debt",
        label: ["互相捏住把柄的合作", "Uneasy leverage"],
        strength: 3,
        notes: "程砚替周栖压下登记表，换取他协助辨认黑市遗物来源。",
      },
    ],
  });
}

function mysteryCity(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
    standards: [
      {
        kind: "continuity",
        title: [
          "公平线索与时间线约束（草案）",
          "Fair-play clues and timeline discipline (draft)",
        ],
        body: [
          "所有关键真相必须提前埋下可核验的物证或目击记录；不同人物关于十年前事故的供词差异要写明来源与时间戳。",
          "Every major reveal must be grounded in an earlier clue or witness record. Track discrepancies in testimony about the ten-year-old accident with explicit sources and timestamps.",
        ],
      },
    ],
    storyObjects: [
      {
        name: ["未归档胶片照片", "Unlisted Film Photograph"],
        category: ["关键物证", "Key evidence"],
        summary: [
          "沈岚相机里留存的事故当晚站台照片，角落里出现了一名不在官方名单上的身影。",
          "A platform photograph from the night of the accident showing a figure absent from the official passenger list.",
        ],
        sourceNotes: "模板占位物证：可绑定至核心时间线事件并在正文逐层揭示。",
      },
    ],
    lore: [
      {
        category: "rule",
        title: ["夜航守则", "Night-navigation code"],
        body: "凌晨两点后，旧城区的路灯只照亮主路；离开主路的人，第二天不会记得自己走过哪里。\n\nAfter 2 a.m. the old-quarter lamps only light the main road. Whoever leaves it will not remember where they went.",
      },
      {
        category: "history",
        title: ["十年前的地铁事故", "The subway accident ten years ago"],
        body: '一辆末班列车在环线隧道里停运了四十分钟，官方记录写着“设备调试”，但当晚的乘客名单至今没有公开。\n\nA last train stalled in the loop tunnel for forty minutes. The official log says "equipment test"; the passenger list has never been published.',
      },
    ],
    locations: [
      {
        name: ["旧城区", "Old Quarter"],
        summary: [
          "被高架桥切成两半的老街区，监视器密度全市最低。",
          "A district split by an overpass, with the lowest camera density in the city.",
        ],
        atmosphere: "潮湿的霓虹、关门早的店铺、永远修不好的井盖",
      },
      {
        name: ["钟楼广场", "Clocktower Square"],
        summary: [
          "所有线索最终都会绕回这里，但广场上的钟十年没有走准过。",
          "Every lead eventually loops back here, though the square's clock has not kept time in ten years.",
        ],
        atmosphere: "凌晨的雾、石板路、抬头看钟的人",
      },
    ],
    factions: [
      {
        name: ["市政档案室", "Municipal Archive"],
        summary: [
          "掌管旧案卷宗，也掌管卷宗里被抽走的那几页。",
          "Keeps the old case files — and the pages that were quietly removed from them.",
        ],
        goal: "让旧案永远停留在“证据不足”",
        motif: "灰色金属卷宗柜、印章、日光灯",
      },
    ],
    characters: [
      {
        name: ["沈岚", "Shen Lan"],
        role: ["主角 · 调查记者", "Protagonist · Investigative journalist"],
        summary: [
          "追着十年前地铁事故不放的记者。她的相机里有一张不该存在的照片。",
          "A journalist still chasing the ten-year-old subway accident. Her camera holds a photo that should not exist.",
        ],
        color: "#3f6f8f",
        tags: ["记者", "旧案", "照片"],
      },
      {
        name: ["老闵", "Lao Min"],
        role: ["导师 · 退休警探", "Mentor · Retired detective"],
        summary: [
          "经手过地铁事故后被调离的警探，如今在旧城区开了一间钟表铺。",
          "The detective reassigned after the subway case, now running a clock shop in the Old Quarter.",
        ],
        color: "#7a6a55",
        tags: ["警探", "钟表铺", "沉默"],
      },
    ],
    relationships: [
      {
        source: 1,
        target: 0,
        type: "mentor",
        label: ["师徒", "Mentor and student"],
        strength: 3,
        notes: "老闵只肯回答被问到第二遍的问题。",
      },
    ],
  });
}

function wuxiaJianghu(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
    standards: [
      {
        kind: "continuity",
        title: [
          "武学招式与伤势代价（草案）",
          "Martial code and injury realism (draft)",
        ],
        body: [
          "出招受兵器长度、身法空间与旧伤影响；江湖名声与门派恩怨需前后呼应，不得让重伤人物无故恢复。",
          "Fights respect weapon reach, terrain and prior wounds. Track sect grudges and reputation consistently; never silently heal a serious injury.",
        ],
      },
    ],
    ruleSystem: {
      title: ["江湖武学阶位（草案）", "Jianghu martial ranks (draft)"],
      kind: "custom",
      summary:
        "定性武学阶位与内力/轻功指标骨架，适合不强绑数值换算的武侠世界。",
      unit: "成",
      tiers: [
        {
          key: "initiate",
          name: ["初入江湖", "Initiate"],
          rank: 1,
          summary: "熟稔门派根基招式，尚缺临阵生死经验。",
        },
        {
          key: "journeyman",
          name: ["二流好手", "Journeyman"],
          rank: 2,
          summary: "足以独行一方，护镖或巡山皆能胜任。",
        },
        {
          key: "master",
          name: ["一流高手", "Master"],
          rank: 3,
          summary: "名动一省，内力与招式皆已自成法度。",
        },
        {
          key: "grandmaster",
          name: ["当世宗师", "Grandmaster"],
          rank: 4,
          summary: "可凭一剑定门派气数，整个江湖屈指可数。",
        },
      ],
      attributes: [
        {
          key: "neili",
          label: localized("内力", "Inner force"),
          type: "integer",
          unit: "成",
          min: 0,
          max: 100,
          enumValues: [],
          defaultValue: 20,
          description: "真气修为与持久对拼的底气。",
        },
        {
          key: "qinggong",
          label: localized("轻功", "Footwork"),
          type: "integer",
          unit: "点",
          min: 0,
          max: 100,
          enumValues: [],
          defaultValue: 15,
          description: "身法腾挪与脱身速度。",
        },
      ],
    },
    abilities: [
      {
        name: ["听雨剑诀", "Rain-Listening Sword Form"],
        summary: [
          "以静制动、借雨声掩步的守势剑法。",
          "A defensive sword form using rain noise to mask footwork.",
        ],
        tierKey: "journeyman",
        effects: [{ attributeKey: "qinggong", operation: "add", value: 12 }],
        cost: "起手需守三招后发制人，受限于狭小地形。",
      },
    ],
    itemStats: [
      {
        name: ["未开刃长剑", "Unsharpened Longsword"],
        category: ["兵器 · 铁剑", "Weapon · Iron sword"],
        summary: [
          "谢无咎随身佩剑，分量沉重但未开锋，只伤筋骨不轻易取命。",
          "Xie Wujiu's heavy unsharpened blade — bruising rather than lethal.",
        ],
        tierKey: "initiate",
        stats: [{ attributeKey: "neili", operation: "add", value: 5 }],
      },
    ],
    storyObjects: [
      {
        name: ["未开刃长剑", "Unsharpened Longsword"],
        category: ["随身兵器", "Signature weapon"],
        summary: [
          "师父临终前留下的旧剑，剑脊刻有断剑崖旧历年号。",
          "An unsharpened sword left by the protagonist's master, marked with the year of Broken Sword Cliff.",
        ],
        sourceNotes: "模板占位物件：既是人物视觉锚点，也是查明师父死因的证物。",
      },
    ],
    lore: [
      {
        category: "rule",
        title: ["江湖规矩", "Jianghu code"],
        body: "刀剑可以决胜负，但不许追杀已经背身离开的人；破了这条规矩的门派，会被整个江湖记住。\n\nBlades may settle a duel, but never chase someone who has turned their back. A sect that breaks this rule is remembered by the whole jianghu.",
      },
      {
        category: "history",
        title: ["断剑崖之战", "The battle of Broken Sword Cliff"],
        body: "二十年前，六大门派在断剑崖围剿一人，最后活下来的却只有被围剿的那一个。\n\nTwenty years ago six great sects cornered one man at Broken Sword Cliff. Only the cornered man walked away.",
      },
    ],
    locations: [
      {
        name: ["听雨楼", "Rain-Listening Pavilion"],
        summary: [
          "消息与酒一样贵的酒楼，掌柜记得每个客人的刀。",
          "A tavern where rumor costs as much as wine; the keeper remembers every guest's blade.",
        ],
        atmosphere: "雨檐、二层雅间、楼下说书人",
      },
      {
        name: ["断剑崖", "Broken Sword Cliff"],
        summary: [
          "崖上插满断剑，风大的夜里能听见剑鸣。",
          "Broken blades stud the cliff; on windy nights they seem to sing.",
        ],
        atmosphere: "乱石、长风、旧剑冢",
      },
    ],
    factions: [
      {
        name: ["青锋剑派", "Azure Edge Sect"],
        summary: [
          "自诩名门正派，却在暗中收买断剑崖的旧人。",
          "Claims to be the righteous sect, yet quietly buys the survivors of Broken Sword Cliff.",
        ],
        goal: "把断剑崖之战写成自己的功绩",
        motif: "青衫、长剑、山门石阶",
      },
    ],
    characters: [
      {
        name: ["谢无咎", "Xie Wujiu"],
        role: ["主角 · 少年剑客", "Protagonist · Young swordsman"],
        summary: [
          "带着一柄没有开刃的剑下山，只想问清师父的死因。",
          "Descends the mountain with an unsharpened sword, meaning only to ask how his master died.",
        ],
        color: "#2f7567",
        tags: ["剑客", "复仇", "未开刃"],
      },
      {
        name: ["白婆婆", "Granny Bai"],
        role: ["长老 · 听雨楼掌柜", "Elder · Pavilion keeper"],
        summary: [
          "断剑崖一战唯一的旁观者，如今用一壶茶换一个故事。",
          "The only witness of Broken Sword Cliff, now trading a pot of tea for a story.",
        ],
        color: "#8a4f3d",
        tags: ["掌柜", "见证者", "茶"],
      },
    ],
    relationships: [
      {
        source: 1,
        target: 0,
        type: "ally",
        label: ["一茶之盟", "Tea-bound allies"],
        strength: 2,
        notes: "白婆婆只肯在雨夜谈断剑崖。",
      },
    ],
  });
}

function starfarer(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
    standards: [
      {
        kind: "numeric",
        title: [
          "航道物理与跃迁单位（草案）",
          "Orbital physics and jump units (draft)",
        ],
        body: [
          "航程一律使用 AU、船体完整度使用 0–100% 表示；环带内跃迁禁令的违约后果与通讯延迟必须在全文保持一致。",
          "State jump distances in AU and hull integrity on a 0–100% scale. Keep signal delay and ring-interdiction penalties consistent across chapters.",
        ],
      },
    ],
    ruleSystem: {
      title: ["舰船与航道参数（草案）", "Vessel & lane parameters (draft)"],
      kind: "attribute",
      summary:
        "科幻航行核心属性骨架：跃迁航程、船体完整度与航道许可等级，便于统一装备与航行描写。",
      unit: "AU",
      tiers: [],
      attributes: [
        {
          key: "jumpRange",
          label: localized("跃迁航程", "Jump range"),
          type: "decimal",
          unit: "AU",
          min: 0,
          max: 500,
          enumValues: [],
          defaultValue: 12,
          description: "单次安全跃迁的最大距离。",
        },
        {
          key: "hull",
          label: localized("船体完整度", "Hull integrity"),
          type: "integer",
          unit: "%",
          min: 0,
          max: 100,
          enumValues: [],
          defaultValue: 100,
          description: "舰体耐压与护盾余量。",
        },
        {
          key: "clearance",
          label: localized("航道许可", "Lane clearance"),
          type: "enum",
          unit: "",
          enumValues: ["civilian", "cargo", "bureau", "restricted"],
          defaultValue: "civilian",
          description: "深空航道局授予的通行权限。",
        },
      ],
    },
    abilities: [
      {
        name: ["跃迁噪声校准", "Jump-Noise Calibration"],
        summary: [
          "通过听辨共振杂音微调跃迁窗口，略微延伸单次航程。",
          "Tunes the jump window by ear from resonance noise, stretching safe jump range.",
        ],
        effects: [{ attributeKey: "jumpRange", operation: "add", value: 2.5 }],
        cost: "需要人工接管导航台，若误判将导致船体失压。",
      },
    ],
    itemStats: [
      {
        name: ["旧版星图加密芯", "Legacy Star-Chart Core"],
        category: ["舰载模块", "Navigation module"],
        summary: [
          "保留第七码头旧航路参数的非官方芯片，可拓宽安全跃迁计算范围。",
          "An unofficial nav-core preserving Seventh Dock trajectories.",
        ],
        stats: [{ attributeKey: "jumpRange", operation: "add", value: 5 }],
      },
    ],
    storyObjects: [
      {
        name: ["第七码头星图芯片", "Seventh Dock Chart Chip"],
        category: ["航道证物", "Navigation artifact"],
        summary: [
          "刻有四十七年前殖民舰最后航迹的只读存储芯，被航道局列为违禁物。",
          "A read-only nav chip holding the derelict colony ship's final track, banned by the Bureau.",
        ],
        sourceNotes: "模板占位物件：串联洛玫与马库合作的关键线索。",
      },
    ],
    lore: [
      {
        category: "technology",
        title: ["跃迁禁令", "Jump interdiction"],
        body: "在环带以内禁止跃迁：航道局的说法是安全，走私船的说法是垄断。\n\nNo jumps inside the ring. The Navigation Bureau calls it safety; smugglers call it a monopoly.",
      },
      {
        category: "mystery",
        title: ["失踪的第七码头", "The missing Seventh Dock"],
        body: "所有星图都标注第七码头，但没有任何一艘船在那里停靠过。\n\nEvery chart lists Seventh Dock, yet no ship has ever berthed there.",
      },
    ],
    locations: [
      {
        name: ["环带空间站", "Ring Station"],
        summary: [
          "环带唯一的补给港，港口广播每十分钟重复一次禁令。",
          "The ring's only supply port; its broadcast repeats the interdiction every ten minutes.",
        ],
        atmosphere: "循环广播、冷白舱灯、排队加注的货船",
      },
      {
        name: ["废弃殖民舰", "Derelict Colony Ship"],
        summary: [
          "导航记录停在四十七年前，船上的时间却一直在走。",
          "Its navigation log stops forty-seven years ago, yet time aboard keeps running.",
        ],
        atmosphere: "失压的走廊、仍在运转的休眠舱",
      },
    ],
    factions: [
      {
        name: ["深空航道局", "Deep-Space Navigation Bureau"],
        summary: [
          "垄断环带跃迁许可的机构，档案里没有第七码头。",
          "Monopolizes ring jump permits; its registry has no Seventh Dock.",
        ],
        goal: "让第七码头从所有星图上消失",
        motif: "白色制服、蓝色舱徽、全息星图",
      },
    ],
    characters: [
      {
        name: ["洛玫", "Luo Mei"],
        role: ["主角 · 领航员", "Protagonist · Navigator"],
        summary: [
          "能在跃迁噪声里听出异常，却因此被航道局停飞。",
          "Can hear anomalies in jump noise — which got her grounded by the Bureau.",
        ],
        color: "#2f5f8f",
        tags: ["领航员", "停飞", "听觉"],
      },
      {
        name: ["船长马库", "Captain Maku"],
        role: ["对手/盟友 · 走私船长", "Rival/ally · Smuggling captain"],
        summary: [
          "声称去过第七码头，却拿不出任何证据。",
          "Claims he has been to Seventh Dock, with nothing to show for it.",
        ],
        color: "#6f5a2f",
        tags: ["走私", "第七码头", "证据"],
      },
    ],
    relationships: [
      {
        source: 1,
        target: 0,
        type: "rival",
        label: ["互相利用", "Mutual use"],
        strength: 3,
        notes: "马库要的是领航员，洛玫要的是那条航线的坐标。",
      },
    ],
  });
}

function gameLevel(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
    standards: [
      {
        kind: "numeric",
        title: [
          "关卡数值曲线与掉落边界（草案）",
          "Level curve and loot bounds (draft)",
        ],
        body: [
          "怪物与装备数值受当前关卡等级区间约束；每通关一阶，掉落上限只允许抬升半档，避免数值失控。",
          "Keep monster and gear numbers inside the active level tier bounds; raise loot caps by half a tier per stage to prevent runaway scaling.",
        ],
      },
    ],
    ruleSystem: {
      title: [
        "关卡等级与战斗数值（草案）",
        "Stage tiers & combat stats (draft)",
      ],
      kind: "power",
      summary:
        "刷子关卡三阶数值骨架，可与节点卡包配合调整怪物血量、攻击与装备掉落。",
      unit: "级",
      tiers: [
        {
          key: "stage1",
          name: ["矿坑入口 (1–3 级)", "Mine Entry (Lv 1–3)"],
          rank: 1,
          minValue: 1,
          maxValue: 3,
          summary: "教学波次与基础装备掉落。",
        },
        {
          key: "stage2",
          name: ["深层坑道 (4–7 级)", "Deep Shaft (Lv 4–7)"],
          rank: 2,
          minValue: 4,
          maxValue: 7,
          summary: "精英怪与词条装备开始出现。",
        },
        {
          key: "stage3",
          name: ["矿心巢穴 (8–10 级)", "Core Nest (Lv 8–10)"],
          rank: 3,
          minValue: 8,
          maxValue: 10,
          summary: "首领战与稀有核心掉落。",
        },
      ],
      attributes: [
        {
          key: "hp",
          label: localized("生命", "HP"),
          type: "integer",
          unit: "点",
          min: 1,
          max: 10000,
          enumValues: [],
          defaultValue: 100,
          description: "角色或怪物基础生命值。",
        },
        {
          key: "attack",
          label: localized("攻击", "Attack"),
          type: "integer",
          unit: "点",
          min: 0,
          max: 5000,
          enumValues: [],
          defaultValue: 12,
          description: "单次普通攻击基准伤害。",
        },
        {
          key: "defense",
          label: localized("防御", "Defense"),
          type: "integer",
          unit: "点",
          min: 0,
          max: 5000,
          enumValues: [],
          defaultValue: 5,
          description: "减伤基准防御值。",
        },
      ],
    },
    abilities: [
      {
        name: ["破甲重击", "Armor-Break Strike"],
        summary: [
          "针对高防精英怪的起手重击技能。",
          "Heavy opener tuned for armored elites.",
        ],
        tierKey: "stage1",
        effects: [{ attributeKey: "attack", operation: "add", value: 18 }],
        cost: "冷却 6 秒。",
      },
    ],
    itemStats: [
      {
        name: ["矿坑生铁镐", "Mine Iron Pick"],
        category: ["新手武器", "Starter weapon"],
        summary: [
          "矿坑入口常见掉落，稳定提升前期输出。",
          "Common entry-mine drop providing an early attack bump.",
        ],
        tierKey: "stage1",
        stats: [{ attributeKey: "attack", operation: "add", value: 8 }],
      },
    ],
    storyObjects: [
      {
        name: ["矿坑通行铜牌", "Mine Entry Token"],
        category: ["关卡钥匙", "Stage key"],
        summary: [
          "拾荒者公会签发的矿坑入口通行牌，凭牌可进入深层坑道。",
          "A brass token issued by the Scavenger Guild granting access to deeper shafts.",
        ],
        sourceNotes: "模板占位物件：连接 NPC 铁匠与深层关卡解锁条件。",
      },
    ],
    lore: [
      {
        category: "rule",
        title: ["关卡节奏", "Level pacing"],
        body: "每一关：教学一波、压力一波、首领一波；掉落必须比上一关高半档。\n\nEvery level: a teaching wave, a pressure wave, a boss wave. Loot must sit half a tier above the last one.",
      },
    ],
    locations: [
      {
        name: ["新手矿坑", "Starter Mine"],
        summary: [
          "第一条主线必经的地下矿坑，怪物等级 1 到 3。",
          "The first story dungeon, monsters level 1 to 3.",
        ],
        atmosphere: "潮湿矿灯、碎石路、远处滴水声",
      },
    ],
    factions: [
      {
        name: ["拾荒者公会", "Scavenger Guild"],
        summary: [
          "靠回收玩家战利品为生的中立商会。",
          "A neutral guild that lives off salvaged player loot.",
        ],
        goal: "垄断矿坑入口的回收生意",
        motif: "补丁斗篷、秤、旧矿灯",
      },
    ],
    characters: [
      {
        name: ["铁匠阿岚", "Smith A'Lan"],
        role: ["NPC · 铁匠", "NPC · Blacksmith"],
        summary: [
          "矿坑门口的铁匠，什么装备都收，连来路不明的也收。",
          "The smith at the mine gate buys anything, provenance optional.",
        ],
        color: "#8f4b3f",
        tags: ["铁匠", "回收", "情报"],
      },
    ],
    relationships: [],
  });
}

export const WORLD_TEMPLATES: readonly WorldTemplate[] = [
  {
    id: "generic-novel",
    name: localized("通用小说", "Generic fiction"),
    summary: localized(
      "轻量文字骨架：草案规则、占位人物、地点阵营与关键物件，不强加战力体系。",
      "A clean prose starter: draft rules, placeholder cast, setting and anchor item without a forced power ladder.",
    ),
    accent: "#2f7567",
    genres: ["通用", "长篇"],
    themes: ["规则", "人物", "冲突"],
    hasPowerScaffold: false,
    build: genericNovel,
  },
  {
    id: "cultivation",
    name: localized("修仙玄幻", "Cultivation"),
    summary: localized(
      "预置四阶境界与灵力数值草案、功法/法器占位与宗门人物，全部可编辑。",
      "Seeds an editable four-realm qi scaffold, starter techniques/artifacts, and a sect cast — all as drafts.",
    ),
    accent: "#2d6a62",
    genres: ["修仙", "玄幻"],
    themes: ["境界", "宗门", "灵脉"],
    hasPowerScaffold: true,
    build: cultivation,
  },
  {
    id: "urban-fantasy",
    name: localized("都市异能", "Urban fantasy"),
    summary: localized(
      "都市帷幕规则、异能共鸣与负荷草案、遗物占位与夜巡事务科起点。",
      "Urban veil rules, a draft resonance-and-strain ladder, relic placeholders and a field bureau cast.",
    ),
    accent: "#6b4c8a",
    genres: ["都市", "异能"],
    themes: ["帷幕", "代价", "遗物"],
    hasPowerScaffold: true,
    build: urbanFantasy,
  },
  {
    id: "mystery-city",
    name: localized("悬疑都市", "Mystery city"),
    summary: localized(
      "旧案、旧城区、公平线索规则草案与关键物证占位，适合直接起稿。",
      "An old case, an old quarter, draft clue-discipline rules and an anchor piece of evidence.",
    ),
    accent: "#3f6f8f",
    genres: ["悬疑", "都市"],
    themes: ["记忆", "真相", "档案"],
    hasPowerScaffold: false,
    build: mysteryCity,
  },
  {
    id: "wuxia-jianghu",
    name: localized("武侠江湖", "Wuxia jianghu"),
    summary: localized(
      "断剑崖旧战、江湖规矩与定性武学阶位草案，配剑法与佩剑占位。",
      "An old cliff battle, jianghu code and a draft qualitative martial rank scaffold with sword-form placeholders.",
    ),
    accent: "#2f7567",
    genres: ["武侠", "古风"],
    themes: ["师承", "复仇", "规矩"],
    hasPowerScaffold: true,
    build: wuxiaJianghu,
  },
  {
    id: "starfarer",
    name: localized("星海科幻", "Starfarer"),
    summary: localized(
      "环带航道、舰船跃迁参数草案、失踪码头与领航员起点。",
      "Ring lanes, draft vessel jump parameters, a missing dock and a grounded navigator.",
    ),
    accent: "#2f5f8f",
    genres: ["科幻", "太空"],
    themes: ["垄断", "失踪", "证据"],
    hasPowerScaffold: true,
    build: starfarer,
  },
  {
    id: "game-level",
    name: localized("游戏关卡", "Game level"),
    summary: localized(
      "带刷子游戏节点卡包与三阶关卡数值草案：场景、怪物、装备与掉落边界。",
      "Comes with the looter card pack and a draft three-tier stage stat scaffold for scenes, monsters and gear.",
    ),
    accent: "#6f5a2f",
    genres: ["游戏", "奇幻"],
    themes: ["节奏", "掉落", "成长"],
    hasPowerScaffold: true,
    constructId: "looter",
    build: gameLevel,
  },
];

export function findWorldTemplate(
  templateId: string | undefined,
): WorldTemplate | undefined {
  if (!templateId) return undefined;
  return WORLD_TEMPLATES.find((template) => template.id === templateId);
}

/**
 * Seed one new world from a template. Must run in the same mutation that
 * inserts the universe, so the workspace validates (or rejects) as one unit.
 * Returns false when the template id is unknown or the universe is missing;
 * an existing, non-empty world is never seeded.
 */
export function applyWorldTemplate(
  draft: StudioWorkspace,
  templateId: string,
  universeId: string,
  now = new Date().toISOString(),
): boolean {
  const template = findWorldTemplate(templateId);
  if (!template) return false;
  if (!draft.universes.some((universe) => universe.id === universeId))
    return false;
  const alreadySeeded =
    draft.standards.some((entry) => entry.universeId === universeId) ||
    draft.ruleSystems.some((entry) => entry.universeId === universeId) ||
    draft.storyObjects.some((entry) => entry.universeId === universeId) ||
    draft.lore.some((entry) => entry.universeId === universeId) ||
    draft.locations.some((entry) => entry.universeId === universeId) ||
    draft.factions.some((entry) => entry.universeId === universeId) ||
    draft.characters.some((character) =>
      character.universeIds.includes(universeId),
    ) ||
    draft.cardTypes.some((type) => type.universeId === universeId);
  if (alreadySeeded) return false;
  // Apply the card pack first: if it refuses, nothing has been written yet.
  if (template.constructId) {
    const result = applyConstruct(draft, template.constructId, universeId, now);
    if (result.status !== "applied") return false;
  }
  const seed = template.build(now, universeId);
  draft.standards.push(...seed.standards);
  draft.ruleSystems.push(...seed.ruleSystems);
  draft.abilityTemplates.push(...seed.abilityTemplates);
  draft.itemStatTemplates.push(...seed.itemStatTemplates);
  draft.storyObjects.push(...seed.storyObjects);
  draft.lore.push(...seed.lore);
  draft.locations.push(...seed.locations);
  draft.factions.push(...seed.factions);
  draft.characters.push(...seed.characters);
  draft.relationships.push(...seed.relationships);
  return true;
}
