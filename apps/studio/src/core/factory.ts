import { validateWorkspace } from "./validate.ts";
import { wordCount } from "./word-count.ts";
import { createBaselineStandards } from "./standards.ts";
import type {
  Chapter,
  LocalizedText,
  StoryWork,
  StudioWorkspace,
  UiLocale,
  WorkspaceStats,
  WorkflowTask,
} from "./types.ts";
import { WORKSPACE_SCHEMA_VERSION } from "./types.ts";

export function localized(zh: string, en = ""): LocalizedText {
  return { zh, en };
}

export function displayText(value: LocalizedText, locale: UiLocale): string {
  return locale === "en"
    ? value.en.trim() || value.zh.trim()
    : value.zh.trim() || value.en.trim();
}

export function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36);
  return `${prefix}_${random.replaceAll("-", "").slice(0, 12)}`;
}

export function countWords(value: string): number {
  return wordCount(value);
}

export function workWords(work: StoryWork): number {
  return work.chapters.reduce(
    (sum, chapter) => sum + countWords(chapter.content),
    0,
  );
}

export function workspaceStats(workspace: StudioWorkspace): WorkspaceStats {
  const chapters = workspace.works.flatMap((work) => work.chapters);
  return {
    standards: workspace.standards.length,
    activeStandards: workspace.standards.filter(
      (standard) => standard.status === "active",
    ).length,
    universes: workspace.universes.length,
    works: workspace.works.length,
    chapters: chapters.length,
    approvedChapters: chapters.filter((chapter) => chapter.status === "approved")
      .length,
    words: chapters.reduce(
      (sum, chapter) => sum + countWords(chapter.content),
      0,
    ),
    characters: workspace.characters.length,
    storyObjects: workspace.storyObjects.length,
    relationships: workspace.relationships.length,
    timelineEvents: workspace.timelineEvents.length,
    workflowTasks: workspace.workflowTasks.length,
  };
}

export function findWork(
  workspace: StudioWorkspace,
  workId: string,
): StoryWork | undefined {
  return workspace.works.find((work) => work.id === workId);
}

export function findChapter(
  workspace: StudioWorkspace,
  workId: string,
  chapterId: string,
): { work: StoryWork; chapter: Chapter } | undefined {
  const work = findWork(workspace, workId);
  const chapter = work?.chapters.find((item) => item.id === chapterId);
  return work && chapter ? { work, chapter } : undefined;
}

export function nextChapterNumber(work: StoryWork): number {
  return Math.max(0, ...work.chapters.map((chapter) => chapter.number)) + 1;
}

export function emptyChapter(
  input: Partial<Chapter> & { title: string },
  now = new Date().toISOString(),
): Chapter {
  return {
    id: input.id ?? createId("chapter"),
    number: input.number ?? 1,
    title: input.title,
    titleEn: input.titleEn ?? "",
    status: input.status ?? "idea",
    pov: input.pov ?? "",
    summary: input.summary ?? "",
    outline: input.outline ?? "",
    content: input.content ?? "",
    beats: input.beats ?? [],
    characterIds: input.characterIds ?? [],
    locationId: input.locationId,
    adaptationNotes: input.adaptationNotes ?? "",
    scenes: input.scenes ?? [],
    revision: input.revision ?? 0,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

export function createEmptyWorkspace(
  name: string,
  locale: UiLocale = "zh-CN",
  now = new Date().toISOString(),
): StudioWorkspace {
  return {
    schema_version: WORKSPACE_SCHEMA_VERSION,
    id: createId("workspace"),
    name,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    settings: {
      locale,
      theme: "system",
      defaultAspectRatio: "9:16",
      exportApprovedOnly: false,
    },
    standards: createBaselineStandards(now),
    universes: [],
    characters: [],
    locations: [],
    storyObjects: [],
    factions: [],
    lore: [],
    relationships: [],
    timelineEvents: [],
    workflowTasks: [],
    works: [],
    exports: [],
  };
}

export function createDemoWorkspace(
  locale: UiLocale = "zh-CN",
  now = new Date().toISOString(),
): StudioWorkspace {
  const createdAt = now;
  const baselineStandards = createBaselineStandards(createdAt);
  const baselineRefs = baselineStandards.map((standard) => ({
    id: standard.id,
    version: standard.version,
  }));
  const demo: StudioWorkspace = {
    schema_version: WORKSPACE_SCHEMA_VERSION,
    id: "workspace_demo",
    name: locale === "en" ? "My Story Multiverse" : "我的故事宇宙",
    revision: 7,
    createdAt,
    updatedAt: createdAt,
    lastOpenedWorkId: "work_tide_clock",
    settings: {
      locale,
      theme: "system",
      defaultAspectRatio: "9:16",
      exportApprovedOnly: false,
    },
    standards: baselineStandards,
    universes: [
      {
        id: "uni_mist_harbor",
        name: localized("雾港", "Mist Harbor"),
        tagline: localized(
          "潮声会记得所有被隐瞒的名字。",
          "The tide remembers every hidden name.",
        ),
        summary: localized(
          "一座被永雾包围的港城。七座钟楼共同维持潮汐钟，任何一次错响都会让一段记忆从居民脑中消失。修钟匠、走私者和潮汐公会都在争夺钟声的解释权。",
          "A harbor city wrapped in permanent fog. Seven towers keep the Tide Clock; every wrong chime erases a memory. Clockmakers, smugglers and the Tide Guild fight over who may interpret the bells.",
        ),
        genres: ["悬疑", "奇幻", "新怪谈"],
        themes: ["记忆", "承诺", "解释权"],
        accent: "#2f7567",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "uni_ninth_station",
        name: localized("第九站", "Ninth Station"),
        tagline: localized(
          "终点站之前，没有人真正下过车。",
          "No one has truly left before the final station.",
        ),
        summary: localized(
          "一列永远在凌晨零点七分抵达的列车，连接七座已经消失的城市。乘务员替旅客保管秘密，也替城市保管最后一次选择。",
          "A train that always arrives at 00:07 connects seven vanished cities. Its conductor keeps passengers' secrets — and each city's last choice.",
        ),
        genres: ["科幻", "公路", "悬疑"],
        themes: ["选择", "告别", "身份"],
        accent: "#8a4f3d",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    characters: [
      {
        id: "char_lin",
        universeIds: ["uni_mist_harbor"],
        name: localized("林舟", "Lin Zhou"),
        role: localized("主角 · 修钟学徒", "Protagonist · Clock apprentice"),
        summary: localized(
          "能在钟声里听见缺失的一拍。父亲十年前在停钟事故中失踪，只留下一把缺口铜钥匙。",
          "He hears the missing beat inside every chime. His father vanished ten years ago, leaving only a notched brass key.",
        ),
        appearance:
          "二十七岁，清瘦，右手虎口有握镊子的薄茧；深蓝短斗篷，胸前挂着停走的怀表。",
        visualPrompt:
          "Lin Zhou, 27, slender Chinese man, dark blue short cloak, worn brass pocket watch, fog-soaked hair, stylized 3D animation character sheet, teal-and-amber palette",
        personality: "克制、敏锐，习惯先修好东西再问原因。",
        motivation: "找回父亲失踪那一夜缺失的钟声。",
        flaw: "把所有人都当成可以被修好的机器。",
        secret: "他可能是停钟事故中唯一被保留下来的记忆副本。",
        voice: "低声、短句；紧张时描述机械细节。",
        tags: ["修钟匠", "钥匙持有者", "记忆异常"],
        color: "#367c75",
        reusable: false,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "char_shen",
        universeIds: ["uni_mist_harbor"],
        name: localized("沈雁", "Shen Yan"),
        role: localized("同盟/对手 · 潮汐调查员", "Ally/Rival · Tide investigator"),
        summary: localized(
          "负责登记错误钟声的调查员。她相信制度能救人，却私下替父亲销毁过一份记录。",
          "An investigator who logs wrong chimes. She believes in the system, yet once destroyed a record for her father.",
        ),
        appearance:
          "三十一岁，高挑，灰绿长风衣，左耳戴一枚旧铜铃；随身携带防水档案箱。",
        visualPrompt:
          "Shen Yan, 31, tall investigator, faded green trench coat, old brass bell earring, waterproof archive case, stylized 3D animation character sheet, mist and brass",
        personality: "冷静、讲证据，幽默感干涩。",
        motivation: "证明钟声不是命运，而是可以被追责的选择。",
        flaw: "为了维护秩序，会替制度掩盖错误。",
        secret: "她父亲是潮汐公会现任会长。",
        voice: "语气平稳，喜欢用编号和日期；说谎时先整理袖口。",
        tags: ["调查员", "档案", "公会亲属"],
        color: "#8b6f47",
        reusable: false,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "char_gu",
        universeIds: ["uni_mist_harbor", "uni_ninth_station"],
        name: localized("顾望潮", "Gu Wangchao"),
        role: localized("对手 · 潮汐公会会长", "Antagonist · Tide Guild master"),
        summary: localized(
          "把整座城的记忆当成可调度资源的人。他相信忘记是秩序的成本，也相信只有自己能承担这笔账。",
          "He treats the city's memory as a dispatchable resource. Forgetting is the price of order, and only he can carry the ledger.",
        ),
        appearance:
          "五十余岁，银灰背头，黑高领长外套；右手戴一只永不校准的潮汐表。",
        visualPrompt:
          "Gu Wangchao, 50s, silver swept-back hair, long black high-collar coat, uncalibrated tidal watch, stylized 3D animation character sheet",
        personality: "礼貌、耐心，把威胁说成天气预报。",
        motivation: "让雾港在记忆损耗中继续运转。",
        flaw: "无法承认自己也在被同一套制度消耗。",
        secret: "他保留了所有被删除记忆的私人民间副本。",
        voice: "缓慢、完整句，常用航海和账本隐喻。",
        tags: ["公会", "记忆账本", "跨宇宙"],
        color: "#5d4037",
        reusable: true,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "char_echo",
        universeIds: ["uni_mist_harbor", "uni_ninth_station"],
        name: localized("回声", "Echo"),
        role: localized("通用角色 · 无名信使", "Reusable · Nameless courier"),
        summary: localized(
          "没有固定面孔的信使，只在故事需要一封无法退回的信时出现。每个世界都记得她的声音，却没人记得她离开的方向。",
          "A courier with no fixed face who appears whenever a story needs a letter that cannot be returned. Every world remembers her voice; no one remembers which way she left.",
        ),
        appearance:
          "兜帽遮住上半张脸，米白围巾，深铜色邮差包；不同宇宙中服装材质随世界规则改变。",
        visualPrompt:
          "Echo, androgynous courier, hood obscuring upper face, cream scarf, deep copper satchel, silhouette-first design, stylized 3D animation, adaptable across worlds",
        personality: "温和、疏离，从不多解释。",
        motivation: "把每个世界最后未送达的消息交到正确的人手里。",
        flaw: "她不认为收信人有权拒绝真相。",
        secret: "她可能不是同一个人，而是一套跨世界传递机制。",
        voice: "轻声，停顿多；只回答被真正问出的问题。",
        tags: ["通用角色", "信使", "跨宇宙"],
        color: "#9c6b45",
        reusable: true,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    locations: [
      {
        id: "loc_old_tower",
        universeId: "uni_mist_harbor",
        name: localized("旧钟塔", "The Old Clock Tower"),
        summary: localized(
          "七座潮汐钟楼中最早的一座，十年前停摆后再未对外开放。",
          "The oldest of the seven tidal towers, sealed since it stopped ten years ago.",
        ),
        atmosphere: "潮湿石阶、停滞齿轮、隔着雾传出的单声钟响。",
        visualPrompt:
          "abandoned tidal clock tower interior, wet stone stairs, giant stopped gears, teal fog, warm brass highlights, stylized 3D animation environment",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "loc_platform_seven",
        universeId: "uni_ninth_station",
        name: localized("七号站台", "Platform Seven"),
        summary: localized(
          "只在地图之外出现的站台，电子屏永远显示 00:07。",
          "A platform that exists off every map. The display always reads 00:07.",
        ),
        atmosphere: "冷白灯、无风的雨、听不见名字的到站广播。",
        visualPrompt:
          "empty surreal train platform, cold white lights, rain without wind, analog clock frozen at 00:07, stylized 3D animation environment",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    storyObjects: [
      {
        id: "object_brass_key",
        universeId: "uni_mist_harbor",
        name: localized("缺口铜钥匙", "Notched Brass Key"),
        category: localized("线索 / 可传递道具", "Clue / hand prop"),
        summary: localized(
          "父亲留下的旧塔钥匙，齿口缺口是人为打磨。它既证明钥匙的来历，也会随着持有者改变关键场次中的手部动作与特写。",
          "A tower key left by Lin's father. Its deliberately notched teeth identify its origin and change hand action and close-up continuity as it changes hands.",
        ),
        visualPrompt:
          "old brass clock-tower key, one deliberately notched tooth, green-black oxidation in the grooves, teal fog reflections, readable silhouette, stylized 3D animation prop sheet, front side and wear-detail views, non-photorealistic",
        sourceNotes:
          "Chapter 1: found inside a decade-old letter. Chapter 2: the notch is found to be intentional.",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "object_archive_case",
        universeId: "uni_mist_harbor",
        name: localized("防水档案箱", "Waterproof Archive Case"),
        category: localized("调查员随身物件", "Investigator prop"),
        summary: localized(
          "沈雁随身携带的调查档案箱，表面留有一道盐蚀划痕。她用箱子的摆放位置表达警惕与信任。",
          "Shen's investigation case, marked by a salt-scoured scratch. Where she places it visually communicates suspicion and trust.",
        ),
        visualPrompt:
          "faded green waterproof investigator case, brass clasps, one diagonal salt-scour scratch on the lid, damp leather handle, stylized 3D animation prop sheet, front and side views, non-photorealistic",
        sourceNotes: "Chapter 1: kept beside the exit. Later scenes may show it opened or handed over.",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "object_memory_ledger",
        universeId: "uni_mist_harbor",
        name: localized("记忆账本", "Memory Ledger"),
        category: localized("公会秘藏", "Guild secret"),
        summary: localized(
          "潮汐公会用来登记被删除记忆的黑色账本。它可能存在，也可能只是顾望潮用于控制他人的叙事工具。",
          "A black ledger said to record deleted memories. It may exist, or may be a narrative instrument used by Gu to control others.",
        ),
        visualPrompt:
          "sealed black tidal ledger, salt-stained brass corners, seven blank clock dials embossed on the cover, no legible text, ominous teal rim light, stylized 3D animation prop, non-photorealistic",
        sourceNotes: "Proposal for chapters 3+. Do not treat as canon until revealed in manuscript.",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    factions: [
      {
        id: "fac_tide_guild",
        universeId: "uni_mist_harbor",
        name: localized("潮汐公会", "The Tide Guild"),
        summary: localized(
          "垄断潮汐钟解释权的半官方组织，负责记录、删改和补偿被钟声带走的记忆。",
          "A semi-official body that monopolizes interpretation of the Tide Clock while recording and revising lost memories.",
        ),
        goal: "维持港城的潮汐秩序，即使代价是集体遗忘。",
        visualMotif: "铜制潮汐表、黑潮纹章、密封档案柜。",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "fac_night_line",
        universeId: "uni_ninth_station",
        name: localized("夜线乘务组", "Night Line Conductor Corps"),
        summary: localized(
          "负责列车完整抵达的管理员，口径统一：没有人可以在终点前下车。",
          "Administrators who ensure the train arrives whole. Nobody may leave before the terminus.",
        ),
        goal: "让第九站继续存在于所有线路图上。",
        visualMotif: "深酒红制服、黄铜票夹、没有面部的广播头像。",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    lore: [
      {
        id: "lore_clock_rule",
        universeId: "uni_mist_harbor",
        category: "rule",
        title: localized("第七响不可记录", "The Seventh Chime Cannot Be Recorded"),
        body: "任何试图用文字、录音或图像保存第七响的行为，都会让记录者失去一段与钟声相关的记忆。该规则只能通过重复事件显形。",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "lore_old_tower",
        universeId: "uni_mist_harbor",
        category: "history",
        title: localized("十年前的停钟夜", "The Night the Clock Stopped"),
        body: "旧塔在十年前的同一分钟连续停摆七次，官方称无人伤亡，实际有十三名修钟匠失踪。",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "lore_night_fare",
        universeId: "uni_ninth_station",
        category: "rule",
        title: localized("一张票只能换一次真话", "One Ticket Buys One Truth"),
        body: "车票可以指定一个答案，但同一名旅客不能连续问两个问题。违反者会在下一站忘记问题本身。",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    relationships: [
      {
        id: "rel_lin_shen",
        universeId: "uni_mist_harbor",
        sourceId: "char_lin",
        targetId: "char_shen",
        type: "ally",
        label: localized("互相利用的盟友", "Allies using each other"),
        strength: 3,
        status: "hidden",
        mutual: true,
        notes: "林舟需要一个有权调档的人；沈雁需要一把能打开旧塔的钥匙。",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "rel_shen_gu",
        universeId: "uni_mist_harbor",
        sourceId: "char_shen",
        targetId: "char_gu",
        type: "family",
        label: localized("父女，公开关系被封存", "Father and daughter, sealed publicly"),
        strength: 5,
        status: "hidden",
        mutual: true,
        notes: "沈雁对外称顾望潮为“公会负责人”，从不使用亲属称呼。",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "rel_lin_gu",
        universeId: "uni_mist_harbor",
        sourceId: "char_lin",
        targetId: "char_gu",
        type: "enemy",
        label: localized("被庇护的追查者", "The investigator under protection"),
        strength: 4,
        status: "active",
        mutual: false,
        notes: "顾望潮知道林舟的身世，却故意让他继续调查。",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "rel_echo_lin",
        universeId: "uni_mist_harbor",
        sourceId: "char_echo",
        targetId: "char_lin",
        type: "debt",
        label: localized("送达一封不能退回的信", "Delivered a letter that cannot be returned"),
        strength: 2,
        status: "active",
        mutual: false,
        notes: "回声把 POV 之外的信息带进故事，但不解释自己属于哪一方。",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    timelineEvents: [
      {
        id: "timeline_rain_key_handoff",
        universeId: "uni_mist_harbor",
        workId: "work_tide_clock",
        chapterId: "chapter_tide_001",
        storyTime: "雨夜 22:40 / 第七响之前",
        order: 10,
        subjectKind: "object",
        subjectId: "object_brass_key",
        eventKind: "transfer",
        title: localized("铜钥匙由林舟交给沈雁", "Lin hands the brass key to Shen"),
        stateBefore: "林舟在修表铺收到钥匙，钥匙贴着柜台，尚未交给任何人。",
        stateAfter: "沈雁短暂握住钥匙，缺口正对门口；她尚未正式收下。",
        canonStatus: "canon",
        relatedCharacterIds: ["char_lin", "char_shen"],
        relatedLocationIds: ["loc_old_tower"],
        relatedObjectIds: ["object_archive_case"],
        evidence: "第一章：沈雁的手指停在钥匙上，没有拿起来。",
        productionPrompt:
          "Keep the notched brass key and Shen's archive case visually distinct. Frame the transfer as a tense close-up: Lin's soot-marked fingers release the key while Shen's glove stops it on the counter. End with the notch aimed toward the doorway.",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "timeline_lin_rain_costume",
        universeId: "uni_mist_harbor",
        workId: "work_tide_clock",
        chapterId: "chapter_tide_001",
        storyTime: "雨夜 22:41",
        order: 20,
        subjectKind: "character",
        subjectId: "char_lin",
        eventKind: "state-change",
        title: localized("林舟进入雨湿状态", "Lin enters a rain-soaked state"),
        stateBefore: "深蓝短斗篷与头发基本干燥，怀表停在十点四十分。",
        stateAfter: "斗篷肩部与发梢被雾雨打湿，右手仍留有握镊子的薄茧；怀表没有恢复。",
        canonStatus: "canon",
        relatedCharacterIds: ["char_shen"],
        relatedLocationIds: ["loc_old_tower"],
        relatedObjectIds: ["object_brass_key"],
        evidence: "第一章：雨在屋檐外散成白雾；林舟伸手后掌心只沾到冷。",
        productionPrompt:
          "Costume state for Chapter 1 after 22:40: dark-blue short cloak dry at the hem but visibly damp at both shoulders, fog-moistened hair, stopped brass pocket watch unchanged, worn callus on the right thumb-index web. Preserve the exact identity and silhouette.",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "timeline_key_notch_reveal",
        universeId: "uni_mist_harbor",
        workId: "work_tide_clock",
        chapterId: "chapter_tide_002",
        storyTime: "次日清晨",
        order: 10,
        subjectKind: "object",
        subjectId: "object_brass_key",
        eventKind: "reveal",
        title: localized("缺口被确认是设计", "The notch is confirmed as intentional"),
        stateBefore: "众人把钥匙缺口理解为损坏或旧塔磨损。",
        stateAfter: "缺口对齐机芯盒划痕后能触发夹层，证明它是钥匙设计的一部分。",
        canonStatus: "canon",
        relatedCharacterIds: ["char_lin", "char_shen"],
        relatedLocationIds: ["loc_old_tower"],
        relatedObjectIds: ["object_archive_case"],
        evidence: "第二章：铜片边缘整齐，沈雁指出“这不是损坏”。",
        productionPrompt:
          "Prop reveal: keep the notched key silhouette unchanged from Chapter 1. Match the notch precisely to a shallow scratch on the clock-heart box. Show a thin brass shard emerging from a concealed layer; avoid turning the key into a new or repaired object.",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "timeline_tower_interior",
        universeId: "uni_mist_harbor",
        workId: "work_tide_clock",
        chapterId: "chapter_tide_003",
        storyTime: "十年前的同一分钟",
        order: 10,
        subjectKind: "location",
        subjectId: "loc_old_tower",
        eventKind: "state-change",
        title: localized("旧塔内部展开十三钟摆空间", "The tower reveals thirteen-pendulum space"),
        stateBefore: "旧塔被封锁，外观是狭窄、潮湿、停摆的石制钟楼。",
        stateAfter: "内部空间明显大于外观，十三条钟摆各自停在失踪者最后一刻。",
        canonStatus: "proposed",
        relatedCharacterIds: ["char_lin", "char_shen", "char_gu"],
        relatedLocationIds: ["loc_old_tower"],
        relatedObjectIds: ["object_brass_key"],
        evidence: "第三章大纲：十三条钟摆对应十三名失踪修钟匠。尚未写成正文。",
        productionPrompt:
          "Proposed environment state for Chapter 3. Preserve the exterior stone tower scale, but stage an impossibly deep interior with thirteen suspended pendulums at distinct angles. Keep routes traversable and avoid duplicating the key in background props.",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    works: [
      {
        id: "work_tide_clock",
        universeId: "uni_mist_harbor",
        title: localized("潮汐钟", "The Tide Clock"),
        logline: localized(
          "修钟学徒追查父亲失踪的那一夜，却发现整座港城都在替钟声保守同一个秘密。",
          "A clock apprentice investigates the night his father vanished, only to learn the whole harbor is keeping one secret for the bells.",
        ),
        synopsis:
          "林舟收到父亲十年前寄出的迟到信件，循着缺口铜钥匙进入旧钟塔。他与调查员沈雁结盟，逐步发现潮汐公会通过删除记忆维持城市稳定。终局必须回答：当真相会摧毁秩序时，谁有资格决定让谁忘记？",
        status: "drafting",
        language: "zh-CN",
        genre: "悬疑奇幻",
        themes: ["记忆", "承诺", "解释权"],
        targetWords: 260_000,
        coverColor: "#2f7567",
        createdAt,
        updatedAt: createdAt,
        chapters: [
          {
            id: "chapter_tide_001",
            number: 1,
            title: "雨中的托付",
            titleEn: "A Handover in the Rain",
            status: "approved",
            pov: "第三人称限知 · 林舟",
            summary:
              "林舟在修表铺收到一封迟到十年的信，并在旧城门把铜钥匙交给沈雁。钟塔在错误的时辰响起一次。",
            outline:
              "建立雾港的潮汐钟规则；用一封没有寄件人的信引出父亲失踪案；林舟与沈雁完成第一次交易；结尾用错误钟响制造下一章钩子。",
            content:
              "雾港的雨从不下在水面上。\n\n林舟推开修表铺后门时，雨线正斜落在屋檐之外，像一层被谁剪断的珠帘，落到码头上空便散成更细的白雾。他伸手试了试，掌心只沾到冷。\n\n柜台上放着一封信。信封没有邮戳，只有一枚被旧水泡开的蓝章，章里是一座钟塔的侧影。收件人写着他的名字，字迹却是父亲的。\n\n“林舟，听见第七响以前，不要修那只表。”\n\n他把信翻过来。背面还有一行更小的字：钥匙不要留在铺里。\n\n铜钥匙从信封里滑出来，落在玻璃柜台上，发出一声很轻的响。钥匙齿口缺了一角，像被某种更硬的东西咬过。\n\n门铃响了。沈雁收起湿淋淋的伞，没有看柜台上的信，只看见钥匙。\n\n“旧塔的。”她说。\n\n“你认得？”\n\n“我登记过十三把一模一样的。”她把档案箱放到脚边，雨水顺着箱角滴成一条细线，“十三把都在十年前失踪了。你手上是第十四把。”\n\n林舟没有立刻收手。他想起父亲第一次教他拆机芯时说过，钟表不会骗人，骗人的是替钟表读时间的人。\n\n“你想要什么？”他问。\n\n沈雁从风衣内袋里取出一张旧车票，推到信旁边。车票背面写着明晚的旧塔地址，墨迹比信还旧。\n\n“明晚，带我进去。”\n\n“钥匙给你，我自己也能去。”\n\n“你不是需要一个进去的人。”她终于抬眼，视线平静得像一张没有写字的档案纸，“你需要一个出来以后还记得你的人。”\n\n林舟把钥匙推过去。沈雁的手指停在钥匙上，没有拿起来。门外传来一声钟响。\n\n不是整点。\n\n林舟抬头，墙上的钟还停在十点四十分。那是父亲失踪时，铺子里唯一一只没有走完的表。\n\n沈雁的手收紧。铜钥匙在她掌心里转了一下，缺口正对着门。\n\n“第七响。”她低声说。\n\n雾港的雨忽然停了。街上所有钟同时开始走，只有林舟听见，它们少了同一拍。",
            beats: [
              "无邮戳的信与缺口钥匙出现",
              "沈雁认出第十三把失踪钥匙的同类",
              "双方以进入旧塔为条件结盟",
              "错误的钟响证明规则正在失效",
            ],
            characterIds: ["char_lin", "char_shen", "char_echo"],
            locationId: "loc_old_tower",
            adaptationNotes:
              "开场用雨线与雾的视觉反差建立世界观。信件内容用 3D 纸面推镜，避免长旁白。结尾钟声覆盖全城，但只让林舟听见缺失拍。",
            scenes: [],
            revision: 2,
            createdAt,
            updatedAt: createdAt,
          },
          {
            id: "chapter_tide_002",
            number: 2,
            title: "缺口钥匙",
            titleEn: "The Notched Key",
            status: "draft",
            pov: "第三人称限知 · 林舟",
            summary:
              "林舟试开父亲留下的机芯盒，发现钥匙缺口是人为打磨；沈雁承认自己见过同样缺口。",
            outline:
              "深入父亲留下的机芯盒；让沈雁的秘密第一次露出破绽；为旧塔之行提供可执行计划。",
            content:
              "机芯盒藏在修表铺最旧的那只落地钟里。\n\n林舟把钟背板卸下来时，沈雁正用布擦档案箱。她把箱子放在离门最近的位置，像随时准备带着它跑。\n\n盒盖上有三道划痕，深浅不同。林舟用钥匙缺口对齐第一道，轻轻一拧。齿轮没有动，却有一小片薄铜从夹层里滑出来。\n\n铜片边缘磨得极整齐，像是有人刻意让它缺在同一个位置。\n\n“这不是损坏。”沈雁说。\n\n林舟回头。她已经走到他身后，视线落在铜片中央那一圈极细的刻纹上。\n\n“你见过？”\n\n“见过。”她停了很久，“昨天之前，我会说没有。”",
            beats: [
              "机芯盒中的铜片证明缺口是设计而非事故",
              "沈雁暴露自己掌握旧塔内部信息",
              "两人第一次围绕谁在说谎发生冲突",
            ],
            characterIds: ["char_lin", "char_shen"],
            locationId: "loc_old_tower",
            adaptationNotes:
              "本场使用手部特写但不做成物件展陈。铜片出现时切到沈雁手背，建立她先于台词认出铜片。",
            scenes: [],
            revision: 3,
            createdAt,
            updatedAt: createdAt,
          },
          {
            id: "chapter_tide_003",
            number: 3,
            title: "第十三次停摆",
            titleEn: "The Thirteenth Stop",
            status: "outline",
            pov: "第三人称限知 · 林舟",
            summary:
              "旧塔内部出现十三条不同时间的钟摆，每条都指向父亲失踪的同一分钟。",
            outline:
              "旧塔内部空间展开；十三条钟摆对应十三名失踪修钟匠；揭示顾望潮曾亲自到场。",
            content: "",
            beats: [
              "旧塔内部空间比外观更大",
              "每条钟摆记录一个失踪者的最后时刻",
              "顾望潮的名字出现在十年前的维修名单",
            ],
            characterIds: ["char_lin", "char_shen", "char_gu"],
            locationId: "loc_old_tower",
            adaptationNotes:
              "用 3D 空间纵深与钟摆轨迹制造压迫感；以物件位置完成信息揭示。",
            scenes: [],
            revision: 1,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      },
      {
        id: "work_last_train",
        universeId: "uni_ninth_station",
        title: localized("末班列车", "The Last Train"),
        logline: localized(
          "一名替人保管秘密的乘务员，在末班车上遇到一个问自己终点之后是什么的乘客。",
          "A conductor who safeguards secrets meets a passenger asking what lies beyond the terminus.",
        ),
        synopsis:
          "第九站的夜线列车每周只出现一次。乘务员叶宁必须守住一个规则：不能回答连续两个问题。一个带着空白车票的女孩却知道叶宁真正的名字。",
        status: "outlining",
        language: "zh-CN",
        genre: "科幻悬疑",
        themes: ["身份", "告别", "选择"],
        targetWords: 120_000,
        coverColor: "#8a4f3d",
        createdAt,
        updatedAt: createdAt,
        chapters: [
          {
            id: "chapter_train_001",
            number: 1,
            title: "零点七分",
            titleEn: "Seven Minutes Past Midnight",
            status: "outline",
            pov: "第三人称限知 · 叶宁",
            summary:
              "叶宁在末班车上接待一名没有目的地、却持有空白车票的女孩。",
            outline:
              "建立列车规则与叶宁的职责；让女孩用第一张票换一个与剧情无关的真话；结尾揭示女孩知道叶宁的旧名字。",
            content: "",
            beats: [
              "列车在 00:07 抵达不存在的站台",
              "女孩用票问出叶宁真正在等谁",
              "空白车票背后显出叶宁已经忘记的旧名",
            ],
            characterIds: ["char_echo"],
            locationId: "loc_platform_seven",
            adaptationNotes:
              "气质与雾港区分：更冷、更空、更少雨；回声的围巾与邮差包作为跨作品连续性锚点。",
            scenes: [],
            revision: 1,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      },
    ],
    workflowTasks: [
      {
        id: "task_world_rules",
        title: localized("锁定雾港钟声规则", "Lock the Mist Harbor bell rules"),
        brief: localized(
          "对照已有正文与世界设定，确认第七响、记忆删除和解释权的因果关系，不改写已定稿事实。",
          "Reconcile the seventh chime, memory erasure and interpretive authority with published prose. Do not rewrite established facts.",
        ),
        deliverable: localized(
          "一份带来源章节与冲突清单的规则审查。",
          "A rule review with source chapters and a conflict list.",
        ),
        result: localized("", ""),
        kind: "world",
        status: "active",
        universeId: "uni_mist_harbor",
        characterIds: ["char_lin", "char_shen"],
        dependsOnIds: [],
        standardRefs: baselineRefs,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "task_chapter_three",
        title: localized("补写第三章停摆现场", "Draft the third tower stop"),
        brief: localized(
          "只使用已确立的十三条钟摆、父亲失踪夜与旧塔空间规则，写出可感知的后果和代价。",
          "Use only the established thirteen pendulums, the father's disappearance and tower geography. Show consequences and costs.",
        ),
        deliverable: localized(
          "第三章正文草案与待核验事实清单。",
          "A chapter-three prose draft and a facts-to-check list.",
        ),
        result: localized("", ""),
        kind: "chapter",
        status: "queued",
        universeId: "uni_mist_harbor",
        workId: "work_tide_clock",
        chapterId: "chapter_tide_003",
        parentId: "task_world_rules",
        characterIds: ["char_lin", "char_shen", "char_gu"],
        dependsOnIds: ["task_world_rules"],
        standardRefs: baselineRefs,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "task_review_first",
        title: localized("审校第一章的连续性", "Review chapter-one continuity"),
        brief: localized(
          "检查钥匙、信件、沈雁到访顺序和第七响是否与后续章节一致。",
          "Check the key, letter, Shen Yan's arrival and seventh chime against later chapters.",
        ),
        deliverable: localized("逐条 finding 与证据位置。", "Itemized findings with evidence."),
        result: localized("", ""),
        kind: "review",
        status: "queued",
        universeId: "uni_mist_harbor",
        workId: "work_tide_clock",
        chapterId: "chapter_tide_001",
        parentId: "task_world_rules",
        characterIds: ["char_lin", "char_shen"],
        dependsOnIds: [],
        standardRefs: baselineRefs,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "task_adaptation_pass",
        title: localized("生成 3D 漫剧镜头清单", "Prepare the 3D comic shot list"),
        brief: localized(
          "按风格化 3D 动画、9:16 和现有制作边界，把已定稿章节转成可审查的镜头草案。",
          "Turn approved chapters into reviewable shots for stylized 3D animation in 9:16 within the existing production boundary.",
        ),
        deliverable: localized(
          "包含场景、镜头、角色锚点与风险的 ArcReel 交接草案。",
          "An ArcReel handoff draft with scenes, shots, character anchors and risks.",
        ),
        result: localized("", ""),
        kind: "adaptation",
        status: "queued",
        universeId: "uni_mist_harbor",
        workId: "work_tide_clock",
        characterIds: ["char_lin", "char_shen"],
        dependsOnIds: ["task_review_first"],
        standardRefs: baselineRefs,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    exports: [],
  };
  return validateWorkspace(demo);
}
