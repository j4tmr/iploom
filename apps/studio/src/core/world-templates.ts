import { applyConstruct } from "./cards.ts";
import { createId, localized } from "./factory.ts";
import type {
  Character,
  LocalizedText,
  LoreEntry,
  Relationship,
  StoryFaction,
  StoryLocation,
  StudioWorkspace,
} from "./types.ts";

/**
 * Starting templates for a new world. A template only seeds ordinary records
 * — lore, locations, factions, characters, relationships and optionally one
 * built-in card construct — so everything it writes stays renameable,
 * retypable and deletable. Nothing is locked and nothing is applied to a world
 * that already exists.
 */
export interface WorldTemplateSeed {
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
  /** A built-in construct from core/cards.ts seeded as this world's card pack. */
  constructId?: string;
  build: (now: string, universeId: string) => WorldTemplateSeed;
}

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
 */
function seedWorld(
  now: string,
  universeId: string,
  input: {
    lore: LoreInput[];
    locations: LocationInput[];
    factions: FactionInput[];
    characters: CharacterInput[];
    relationships: RelationshipInput[];
  },
): WorldTemplateSeed {
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
  return { lore, locations, factions, characters, relationships };
}

function mysteryCity(now: string, universeId: string): WorldTemplateSeed {
  return seedWorld(now, universeId, {
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
    id: "mystery-city",
    name: localized("悬疑都市", "Mystery city"),
    summary: localized(
      "旧案、旧城区与一个不肯放弃的记者：一套可以直接开写的悬疑起点。",
      "An old case, an old quarter and a journalist who won't let go.",
    ),
    accent: "#3f6f8f",
    genres: ["悬疑", "都市"],
    themes: ["记忆", "真相", "档案"],
    build: mysteryCity,
  },
  {
    id: "wuxia-jianghu",
    name: localized("武侠江湖", "Wuxia jianghu"),
    summary: localized(
      "一场没有赢家的旧战，一个带着未开刃长剑下山的少年。",
      "An old battle with no winner, and a youth descending with an unsharpened blade.",
    ),
    accent: "#2f7567",
    genres: ["武侠", "古风"],
    themes: ["师承", "复仇", "规矩"],
    build: wuxiaJianghu,
  },
  {
    id: "starfarer",
    name: localized("星海科幻", "Starfarer"),
    summary: localized(
      "环带航道、失踪的码头，和一个被停飞的领航员。",
      "Ring lanes, a missing dock and a grounded navigator.",
    ),
    accent: "#2f5f8f",
    genres: ["科幻", "太空"],
    themes: ["垄断", "失踪", "证据"],
    build: starfarer,
  },
  {
    id: "game-level",
    name: localized("游戏关卡", "Game level"),
    summary: localized(
      "带一张刷子游戏节点卡包：场景、怪物、装备三类节点与示例卡片。",
      "Comes with a looter card pack: scene, monster and equipment nodes plus sample cards.",
    ),
    accent: "#6f5a2f",
    genres: ["游戏", "奇幻"],
    themes: ["节奏", "掉落", "成长"],
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
  draft.lore.push(...seed.lore);
  draft.locations.push(...seed.locations);
  draft.factions.push(...seed.factions);
  draft.characters.push(...seed.characters);
  draft.relationships.push(...seed.relationships);
  return true;
}
