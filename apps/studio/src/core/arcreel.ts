import { ZodError } from "zod";
import { countWords, displayText } from "./factory.ts";
import { buildRelationshipGraph } from "./graph.ts";
import { sha256Text } from "./hash.ts";
import {
  STORYBOARD_LIMITS,
  storyboardWriteSchema,
} from "./storyboard-contract.ts";
import type {
  ArcReelBundle,
  ArcReelFile,
  Chapter,
  Character,
  StoryLocation,
  StoryScene,
  StoryShot,
  StoryUniverse,
  StudioWorkspace,
  UiLocale,
} from "./types.ts";
import { APP_VERSION } from "./version.ts";
import { validateWorkspace } from "./validate.ts";

export const ARC_REEL_STYLE =
  "stylized 3D animation / 3D comic drama (3D漫), expressive characters, cinematic staging, consistent model sheets, non-photorealistic, no live-action";

export const ARC_REEL_NEGATIVE_PROMPT =
  "photorealistic, live-action, real human actor, 2D flat illustration, inconsistent face, extra fingers, warped hands, text artifacts, watermark";

export interface BuildArcReelOptions {
  workId: string;
  chapterIds?: string[];
  locale?: UiLocale;
  aspectRatio?: string;
  approvedOnly?: boolean;
  generatedAt?: string;
}

/** Shared with workspace-store so package directory names keep Chinese titles. */
export function arcReelSlug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, surrogateSafeCut(normalized, 48)) || "untitled";
}

const slug = arcReelSlug;

export { sha256Text };

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function quoteOf(paragraph: string): string {
  const matches = paragraph.match(/[“"]([^”"]{1,500})[”"]/g);
  return matches?.join(" / ") ?? "";
}

function clampShotDuration(paragraph: string): number {
  const chars = Math.max(1, paragraph.trim().length);
  return Math.min(9_000, Math.max(2_500, Math.round((chars / 7) * 1_000)));
}

function characterPrompt(characters: Character[], locale: UiLocale): string {
  if (!characters.length) return "No named character required in frame.";
  return characters
    .map(
      (character) =>
        `${displayText(character.name, locale)}: ${character.visualPrompt || character.appearance}`,
    )
    .join(" | ");
}

function locationPrompt(
  location: StoryLocation | undefined,
  locale: UiLocale,
): string {
  if (!location) return "Location defined by the scene description.";
  return `${displayText(location.name, locale)}: ${
    location.visualPrompt || displayText(location.summary, locale)
  }`;
}

function buildShotPrompt(
  chapter: Chapter,
  scene: StoryScene,
  shot: StoryShot,
  universe: StoryUniverse,
  characters: Character[],
  location: StoryLocation | undefined,
  locale: UiLocale,
  aspectRatio: string,
): string {
  return [
    ARC_REEL_STYLE,
    `World: ${displayText(universe.name, locale)} — ${displayText(
      universe.tagline,
      locale,
    )}.`,
    `Location: ${locationPrompt(location, locale)}`,
    `Cast: ${characterPrompt(characters, locale)}`,
    `Scene: ${scene.title}. ${scene.summary}`,
    `Shot ${shot.id}: ${shot.description}`,
    shot.dialogue ? `Dialogue/subtitle: ${shot.dialogue}` : "",
    shot.camera ? `Camera: ${shot.camera}` : "",
    `Composition: ${aspectRatio}, safe title area, readable silhouettes, consistent costume and props across shots.`,
    `Avoid: ${ARC_REEL_NEGATIVE_PROMPT}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

interface PlannedShot {
  shot: StoryShot;
  sourceShotId: string;
}

interface PlannedScene {
  sourceSceneId: string;
  title: string;
  summary: string;
  locationId?: string;
  characterIds: string[];
  shots: PlannedShot[];
}

interface HydratedScene {
  scene: StoryScene;
  sourceSceneId: string;
  sourceShotIds: string[];
}

const SHOTS_PER_GENERATED_SCENE = 5;
const PARAGRAPH_SHOT_TARGET = 600;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Step back one code unit when `cut` would split a surrogate pair. */
function surrogateSafeCut(value: string, cut: number): number {
  return isHighSurrogate(value.charCodeAt(cut - 1)) &&
    isLowSurrogate(value.charCodeAt(cut))
    ? cut - 1
    : cut;
}

function clipText(
  value: string,
  max: number,
  ellipsis: boolean,
): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  let cut = ellipsis && max > 1 ? max - 1 : max;
  cut = surrogateSafeCut(value, cut);
  if (cut <= 0) return { text: ellipsis ? "…" : value.slice(0, max), truncated: true };
  const text = value.slice(0, cut).trimEnd();
  return {
    text: ellipsis && max > 1 ? `${text}…` : text,
    truncated: true,
  };
}

function splitLongParagraph(paragraph: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > max) {
    let cut = -1;
    const floor = Math.floor(max * 0.5);
    for (let index = Math.min(max, rest.length - 1); index >= floor; index -= 1) {
      if ("。！？!?".includes(rest[index]!)) {
        cut = index + 1;
        break;
      }
    }
    if (cut <= 0) {
      cut = surrogateSafeCut(rest, max);
      if (cut <= 0) cut = 2;
    }
    const piece = rest.slice(0, cut).trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.length ? pieces : [paragraph];
}

/**
 * Chinese manuscripts commonly put one paragraph per line without blank lines.
 * Treat a single newline as a paragraph break unless the text uses blank lines
 * for English-style paragraph separation. Indented Chinese prose is split by
 * line even when blank lines also appear.
 */
function chapterParagraphs(chapter: Chapter): string[] {
  const content = chapter.content;
  const hasBlankLine = /\n[ \t　\r]*\n/.test(content);
  const hasFullWidthIndent = /(?:^|\n)[ \t　\r]*　　/.test(content);
  const splitter =
    hasBlankLine && !hasFullWidthIndent ? /\n[ \t　\r]*\n/ : /\r?\n+/;
  return content
    .split(splitter)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph, PARAGRAPH_SHOT_TARGET));
}

function sampleEvenly<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return items.slice();
  if (limit <= 0) return [];
  if (limit === 1) return [items[Math.floor((items.length - 1) / 2)]!];
  return Array.from(
    { length: limit },
    (_, index) =>
      items[Math.round((index * (items.length - 1)) / (limit - 1))]!,
  );
}

function paragraphScenes(
  chapter: Chapter,
  characters: Character[],
): { scenes: PlannedScene[]; droppedParagraphs: number } {
  const paragraphs = chapterParagraphs(chapter);
  const all =
    paragraphs.length > 0
      ? paragraphs
      : [
          chapter.outline ||
            chapter.summary ||
            `${chapter.title} — scene breakdown pending.`,
        ];
  const source = sampleEvenly(all, STORYBOARD_LIMITS.shots);
  const droppedParagraphs = all.length - source.length;
  const scenes: PlannedScene[] = [];
  const sceneGroups = Math.min(
    STORYBOARD_LIMITS.scenes,
    Math.ceil(source.length / SHOTS_PER_GENERATED_SCENE),
  );
  for (let sceneIndex = 0; sceneIndex < sceneGroups; sceneIndex += 1) {
    const group = source.slice(
      sceneIndex * SHOTS_PER_GENERATED_SCENE,
      sceneIndex * SHOTS_PER_GENERATED_SCENE + SHOTS_PER_GENERATED_SCENE,
    );
    const sceneId = `scene_${String(sceneIndex + 1).padStart(2, "0")}`;
    const shots: PlannedShot[] = group.map((paragraph, shotIndex) => {
      const camera = [
        "wide establishing",
        "medium two-shot",
        "close-up",
        "detail insert",
        "slow push-in",
      ][shotIndex % 5]!;
      const shotId = `shot_${String(
        sceneIndex * SHOTS_PER_GENERATED_SCENE + shotIndex + 1,
      ).padStart(2, "0")}`;
      return {
        sourceShotId: shotId,
        shot: {
          id: shotId,
          shotType: ["wide", "medium", "close", "insert", "medium"][
            shotIndex % 5
          ]!,
          description: paragraph,
          dialogue: quoteOf(paragraph),
          camera,
          durationMs: clampShotDuration(paragraph),
          visualPrompt: "",
        },
      };
    });
    scenes.push({
      sourceSceneId: sceneId,
      title: `${chapter.title} · Scene ${sceneIndex + 1}`,
      summary: group[0] ?? "",
      locationId: chapter.locationId,
      characterIds: characters.map((character) => character.id),
      shots,
    });
  }
  return { scenes, droppedParagraphs };
}

function authorScenes(chapter: Chapter): {
  scenes: PlannedScene[];
  droppedScenes: number;
} {
  const source =
    chapter.scenes.length > STORYBOARD_LIMITS.scenes
      ? sampleEvenly(chapter.scenes, STORYBOARD_LIMITS.scenes)
      : chapter.scenes;
  return {
    droppedScenes: chapter.scenes.length - source.length,
    scenes: source.map((scene) => ({
      sourceSceneId: scene.id,
      title: scene.title,
      summary: scene.summary,
      locationId: scene.locationId,
      characterIds: scene.characterIds,
      shots: scene.shots.map((shot) => ({
        shot,
        sourceShotId: shot.id,
      })),
    })),
  };
}

function ensureSceneShots(scenes: PlannedScene[], chapter: Chapter): PlannedScene[] {
  return scenes.map((scene, sceneIndex) => {
    if (scene.shots.length) return scene;
    const shotId = `shot_${String(sceneIndex + 1).padStart(2, "0")}`;
    return {
      ...scene,
      shots: [
        {
          sourceShotId: shotId,
          shot: {
            id: shotId,
            shotType: "wide",
            description:
              scene.summary ||
              chapter.outline ||
              chapter.summary ||
              "Shot direction pending author review.",
            dialogue: "",
            camera: "wide establishing",
            durationMs: 3_000,
            visualPrompt: "",
          },
        },
      ],
    };
  });
}

function splitOversizedScenes(
  scenes: PlannedScene[],
  chapter: Chapter,
  warnings: string[],
): PlannedScene[] {
  const parts = scenes.reduce(
    (sum, scene) =>
      sum + Math.max(1, Math.ceil(scene.shots.length / STORYBOARD_LIMITS.shotsPerScene)),
    0,
  );
  if (parts === scenes.length || parts > STORYBOARD_LIMITS.scenes) return scenes;
  let splitScenes = 0;
  const result: PlannedScene[] = [];
  for (const scene of scenes) {
    if (scene.shots.length <= STORYBOARD_LIMITS.shotsPerScene) {
      result.push(scene);
      continue;
    }
    splitScenes += 1;
    for (
      let offset = 0, part = 1;
      offset < scene.shots.length;
      offset += STORYBOARD_LIMITS.shotsPerScene, part += 1
    ) {
      const shots = scene.shots.slice(
        offset,
        offset + STORYBOARD_LIMITS.shotsPerScene,
      );
      result.push({
        ...scene,
        title: part === 1 ? scene.title : `${scene.title} (part ${part})`,
        summary:
          part === 1
            ? scene.summary
            : shots[0]?.shot.description.trim() ||
              `${scene.summary} (part ${part})`,
        shots,
      });
    }
  }
  warnings.push(
    `Chapter ${chapter.number}: split ${splitScenes} scene(s) with more than ${STORYBOARD_LIMITS.shotsPerScene} shots.`,
  );
  return result;
}

function allocateShots(
  scenes: PlannedScene[],
  chapter: Chapter,
  warnings: string[],
): PlannedScene[] {
  const upper = scenes.map((scene) =>
    Math.min(STORYBOARD_LIMITS.shotsPerScene, scene.shots.length),
  );
  const keep: number[] = upper.map((value) => (value > 0 ? 1 : 0));
  let remaining =
    STORYBOARD_LIMITS.shots - keep.reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    let added = false;
    for (let index = 0; index < scenes.length && remaining > 0; index += 1) {
      if (keep[index]! < upper[index]!) {
        keep[index] = keep[index]! + 1;
        remaining -= 1;
        added = true;
      }
    }
    if (!added) break;
  }
  const total = scenes.reduce(
    (sum, scene) => sum + scene.shots.length,
    0,
  );
  const kept = keep.reduce((sum, value) => sum + value, 0);
  if (total > kept)
    warnings.push(
      `Chapter ${chapter.number}: ${total - kept} of ${total} scene shots were dropped to respect the ${STORYBOARD_LIMITS.shots}-shot storyboard limit.`,
    );
  return scenes.map((scene, index) => ({
    ...scene,
    shots: sampleEvenly(scene.shots, keep[index]!),
  }));
}

function hydrateScenes(
  chapter: Chapter,
  planned: PlannedScene[],
  universe: StoryUniverse,
  allCharacters: Character[],
  locations: StoryLocation[],
  locale: UiLocale,
  aspectRatio: string,
  warnings: string[],
): HydratedScene[] {
  const charactersById = new Map(
    allCharacters.map((character) => [character.id, character]),
  );
  const locationsById = new Map(
    locations.map((location) => [location.id, location]),
  );
  let truncatedShotDescriptions = 0;
  let truncatedSceneDescriptions = 0;
  let truncatedHeadings = 0;
  const hydrated = planned.map((plannedScene, sceneIndex) => {
    const sceneCharacters = plannedScene.characterIds
      .map((id) => charactersById.get(id))
      .filter((character): character is Character => Boolean(character));
    const locationId = plannedScene.locationId ?? chapter.locationId;
    const location = locationId ? locationsById.get(locationId) : undefined;
    const fallbackHeading = `Scene ${sceneIndex + 1} / 场景 ${sceneIndex + 1}`;
    const heading = clipText(
      plannedScene.title.trim() || fallbackHeading,
      STORYBOARD_LIMITS.sceneHeading,
      true,
    );
    const summary = clipText(
      plannedScene.summary,
      STORYBOARD_LIMITS.sceneDescription,
      true,
    );
    if (heading.truncated) truncatedHeadings += 1;
    if (summary.truncated) truncatedSceneDescriptions += 1;
    const scene: StoryScene = {
      id: `scene_${String(sceneIndex + 1).padStart(2, "0")}`,
      title: heading.text,
      summary: summary.text,
      locationId,
      characterIds: sceneCharacters.map((character) => character.id),
      shots: [],
    };
    const sourceShotIds: string[] = [];
    scene.shots = plannedScene.shots.map((entry, shotIndex) => {
      const description = clipText(
        entry.shot.description.trim() ||
          `Shot ${shotIndex + 1} direction pending author review.`,
        STORYBOARD_LIMITS.shotDescription,
        true,
      );
      if (description.truncated) truncatedShotDescriptions += 1;
      const shot: StoryShot = {
        id: `shot_${String(shotIndex + 1).padStart(2, "0")}`,
        shotType: clipText(
          entry.shot.shotType.trim() || "medium",
          STORYBOARD_LIMITS.shotType,
          true,
        ).text,
        description: description.text,
        dialogue: clipText(
          entry.shot.dialogue,
          STORYBOARD_LIMITS.dialogue,
          true,
        ).text,
        camera: clipText(entry.shot.camera, STORYBOARD_LIMITS.camera, true).text,
        durationMs: entry.shot.durationMs,
        visualPrompt: "",
      };
      shot.visualPrompt = clipText(
        buildShotPrompt(
          chapter,
          scene,
          shot,
          universe,
          sceneCharacters,
          location,
          locale,
          aspectRatio,
        ),
        STORYBOARD_LIMITS.prompt,
        true,
      ).text;
      sourceShotIds.push(entry.sourceShotId);
      return shot;
    });
    return {
      scene,
      sourceSceneId: plannedScene.sourceSceneId,
      sourceShotIds,
    };
  });
  if (truncatedShotDescriptions)
    warnings.push(
      `Chapter ${chapter.number}: truncated ${truncatedShotDescriptions} shot description(s) to ${STORYBOARD_LIMITS.shotDescription} characters.`,
    );
  if (truncatedSceneDescriptions)
    warnings.push(
      `Chapter ${chapter.number}: truncated ${truncatedSceneDescriptions} scene description(s) to ${STORYBOARD_LIMITS.sceneDescription} characters.`,
    );
  if (truncatedHeadings)
    warnings.push(
      `Chapter ${chapter.number}: truncated ${truncatedHeadings} scene heading(s) to ${STORYBOARD_LIMITS.sceneHeading} characters.`,
    );
  return hydrated;
}

function markdownHandoff(input: {
  workTitle: string;
  universeTitle: string;
  locale: UiLocale;
  chapters: Chapter[];
  aspectRatio: string;
  paths: string[];
}): string {
  const pathLines = input.paths.map((path) => `- \`${path}\``).join("\n");
  const zh = `# ArcReel / 漫剧改编交接包

本包由 IPloom Studio 生成，面向 ArcReel、3D 漫剧、动态漫画或同类分镜制作工具。

## 不可变来源

- IP：${input.universeTitle}
- 小说：${input.workTitle}
- 章节：${input.chapters.map((chapter) => chapter.number).join(", ")}
- 画幅：${input.aspectRatio}
- 视觉：风格化 3D 动画（3D 漫），禁止真人写实

## 文件说明

- \`manifest.json\`：文件哈希、来源版本与统计。
- \`world.json\`：世界规则、地点、势力、通用角色与关系。
- \`production-structure.json\`：与 IPloom 制作编排兼容的系列/季/集映射。
- \`episodes/\`：逐章改编文本、人物锚点、场景草稿。
- \`storyboards/\`：可映射到 IPloom \`production/storyboards\` 的分镜载荷。
- \`production/approved-designs.json\`：本作品已完成的文字设计规格与可复用提示词。

## 文件路径

${pathLines}

## 使用边界

自动场景与镜头是**导演草案**，不是最终分镜。制作前必须逐章核对：角色登场、服装/道具连续性、揭示边界、对白时长与字幕安全区。任何生成调用、费用确认与成片验收仍需作者显式执行。
`;
  const en = `# ArcReel / Comic Drama Handoff

Generated by IPloom Studio for ArcReel, stylized 3D animation, motion comic and similar storyboard tools.

## Immutable source

- IP: ${input.universeTitle}
- Novel: ${input.workTitle}
- Chapters: ${input.chapters.map((chapter) => chapter.number).join(", ")}
- Aspect ratio: ${input.aspectRatio}
- Visual direction: stylized 3D animation (3D comic drama); photorealistic live action is prohibited.

## Files

- \`manifest.json\`: hashes, source revision and adaptation stats.
- \`world.json\`: world rules, locations, factions, reusable cast and relationships.
- \`production-structure.json\`: series/season/episode mapping compatible with IPloom production orchestration.
- \`episodes/\`: chapter-level adaptation text, cast anchors and scene drafts.
- \`storyboards/\`: IPloom-compatible storyboard payloads.
- \`production/approved-designs.json\`: completed author-reviewed design specifications and reusable prompts.

## Package paths

${pathLines}

## Boundary

Automatic scenes and shots are a **director's draft**, not approved final storyboards. Before production, verify character introduction, costume and prop continuity, reveal boundaries, dialogue timing and subtitle safe areas. Generation calls, cost confirmation and final acceptance remain explicit author actions.
`;
  return input.locale === "en" ? en : `${zh}\n---\n\n${en}`;
}

export async function buildArcReelBundle(
  workspaceInput: StudioWorkspace,
  options: BuildArcReelOptions,
): Promise<ArcReelBundle> {
  const workspace = validateWorkspace(workspaceInput);
  const work = workspace.works.find((item) => item.id === options.workId);
  if (!work) throw new Error(`Unknown work: ${options.workId}`);
  const universe = workspace.universes.find(
    (item) => item.id === work.universeId,
  );
  if (!universe) throw new Error(`Unknown universe: ${work.universeId}`);
  const locale = options.locale ?? work.language;
  const aspectRatio = options.aspectRatio ?? workspace.settings.defaultAspectRatio;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const requested = options.chapterIds?.length
    ? new Set(options.chapterIds)
    : null;
  let chapters = work.chapters
    .filter((chapter) => !requested || requested.has(chapter.id))
    .sort((a, b) => a.number - b.number);
  const warnings: string[] = [];
  if (requested && chapters.length !== requested.size) {
    const found = new Set(chapters.map((chapter) => chapter.id));
    for (const id of requested) {
      if (!found.has(id)) warnings.push(`Chapter not found: ${id}`);
    }
  }
  if (options.approvedOnly) {
    const filtered = chapters.filter((chapter) => chapter.status === "approved");
    if (filtered.length !== chapters.length)
      warnings.push(
        `Excluded ${chapters.length - filtered.length} chapter(s) that are not approved.`,
      );
    chapters = filtered;
  }
  if (!chapters.length) throw new Error("No chapters selected for export.");

  const universeCharacters = workspace.characters.filter((character) =>
    character.universeIds.includes(universe.id),
  );
  const locations = workspace.locations.filter(
    (location) => location.universeId === universe.id,
  );
  const factions = workspace.factions.filter(
    (faction) => faction.universeId === universe.id,
  );
  const lore = workspace.lore.filter((entry) => entry.universeId === universe.id);
  const relationships = workspace.relationships.filter(
    (relationship) => relationship.universeId === universe.id,
  );
  const graph = buildRelationshipGraph(workspace, universe.id, locale);
  warnings.push(...graph.warnings);

  const files: ArcReelFile[] = [];
  const castFile = universeCharacters.map((character) => ({
    ...character,
    display_name: displayText(character.name, locale),
    display_role: displayText(character.role, locale),
    display_summary: displayText(character.summary, locale),
  }));
  files.push({
    path: "world.json",
    mediaType: "application/json",
    content: json({
      schema: "iploom.arcreel.world/v1",
      universe: {
        ...universe,
        display_name: displayText(universe.name, locale),
        display_tagline: displayText(universe.tagline, locale),
        display_summary: displayText(universe.summary, locale),
      },
      characters: castFile,
      locations,
      factions,
      lore,
      relationships,
      relationship_graph: graph,
    }),
  });

  const episodes = chapters.map((chapter) => ({
    id: `episode_${String(chapter.number).padStart(4, "0")}`,
    sequence: chapter.number,
    chapter_node_id: chapter.id,
  }));
  files.push({
    path: "production-structure.json",
    mediaType: "application/json",
    content: json({
      schema: "iploom.production-structure/v1",
      contract_version: 4,
      expected_revision: workspace.revision,
      series: [
        {
          id: `${work.id}_series`,
          position: 1,
          title: displayText(work.title, locale),
          synopsis: displayText(work.logline, locale),
        },
      ],
      seasons: [
        {
          id: `${work.id}_season_01`,
          series_id: `${work.id}_series`,
          sequence: 1,
          title: "Season 1 / 第一季",
          synopsis: work.synopsis,
        },
      ],
      episodes: episodes.map((episode) => ({
        id: episode.id,
        season_id: `${work.id}_season_01`,
        sequence: episode.sequence,
        chapter_node_id: episode.chapter_node_id,
      })),
    }),
  });

  let totalScenes = 0;
  let totalShots = 0;
  const chapterPreviews = [];
  for (const chapter of chapters) {
    const chapterCharacters = chapter.characterIds
      .map((id) => universeCharacters.find((character) => character.id === id))
      .filter((character): character is Character => Boolean(character));
    const location = chapter.locationId
      ? locations.find((item) => item.id === chapter.locationId)
      : undefined;
    let source: {
      scenes: PlannedScene[];
      droppedScenes: number;
      droppedParagraphs: number;
    };
    if (chapter.scenes.length) {
      source = { ...authorScenes(chapter), droppedParagraphs: 0 };
    } else {
      source = { ...paragraphScenes(chapter, chapterCharacters), droppedScenes: 0 };
    }
    if (source.droppedScenes)
      warnings.push(
        `Chapter ${chapter.number}: ${source.droppedScenes} scene(s) were dropped to respect the ${STORYBOARD_LIMITS.scenes}-scene storyboard limit.`,
      );
    if (source.droppedParagraphs)
      warnings.push(
        `Chapter ${chapter.number}: ${source.droppedParagraphs} paragraph segment(s) were dropped to respect the ${STORYBOARD_LIMITS.shots}-shot storyboard limit.`,
      );
    const planned = allocateShots(
      splitOversizedScenes(
        ensureSceneShots(source.scenes, chapter),
        chapter,
        warnings,
      ),
      chapter,
      warnings,
    );
    const hydratedScenes = hydrateScenes(
      chapter,
      planned,
      universe,
      universeCharacters,
      locations,
      locale,
      aspectRatio,
      warnings,
    );
    const scenes = hydratedScenes.map((item) => item.scene);
    if (!chapter.content.trim())
      warnings.push(`Chapter ${chapter.number} has no prose; export contains a director draft only.`);
    if (chapter.status !== "approved")
      warnings.push(
        `Chapter ${chapter.number} status is ${chapter.status}; approve before production.`,
      );
    const sceneCount = scenes.length;
    const shotCount = scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
    totalScenes += sceneCount;
    totalShots += shotCount;
    const sequence = String(chapter.number).padStart(4, "0");
    const base = `${sequence}-${slug(chapter.titleEn || chapter.title)}`;
    const contentHash = await sha256Text(chapter.content);
    chapterPreviews.push({
      chapterId: chapter.id,
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      words: countWords(chapter.content),
      sceneCount,
      shotCount,
    });

    files.push({
      path: `episodes/${base}.json`,
      mediaType: "application/json",
      content: json({
        schema: "iploom.arcreel.episode/v1",
        source: {
          workspace_id: workspace.id,
          workspace_revision: workspace.revision,
          universe_id: universe.id,
          work_id: work.id,
          chapter_id: chapter.id,
          chapter_revision: chapter.revision,
          content_sha256: contentHash,
        },
        episode: {
          id: `episode_${sequence}`,
          sequence: chapter.number,
          title: chapter.title,
          title_en: chapter.titleEn,
          status: chapter.status,
          language: work.language,
          pov: chapter.pov,
          summary: chapter.summary,
          word_count: countWords(chapter.content),
        },
        story: {
          outline: chapter.outline,
          beats: chapter.beats,
          prose: chapter.content,
          adaptation_notes: chapter.adaptationNotes,
        },
        cast: chapterCharacters,
        location,
        relationship_context: graph.edges.filter(
          (edge) =>
            chapter.characterIds.includes(edge.source) ||
            chapter.characterIds.includes(edge.target),
        ),
        scenes,
        style: {
          direction: ARC_REEL_STYLE,
          negative_prompt: ARC_REEL_NEGATIVE_PROMPT,
          aspect_ratio: aspectRatio,
        },
      }),
    });

    const storyboardInput = {
      contract_version: 4,
      expected_revision: workspace.revision,
      id: `storyboard_${sequence}`,
      episode_id: `episode_${sequence}`,
      source_prose_version_id: `local_${chapter.id}_r${chapter.revision}`,
      source_prose_sha256: contentHash,
      title: clipText(
        `${chapter.number}. ${chapter.title}`,
        STORYBOARD_LIMITS.title,
        true,
      ).text,
      data: {
        format: "vertical-short-drama",
        medium: "stylized-3d-animation",
        style_direction: ARC_REEL_STYLE,
        negative_prompt: ARC_REEL_NEGATIVE_PROMPT,
        language: work.language,
        aspect_ratio: aspectRatio,
        source: "iploom-studio",
        pov: chapter.pov,
      },
      scenes: hydratedScenes.map(({ scene, sourceSceneId, sourceShotIds }, sceneIndex) => ({
        id: `scene_${String(sceneIndex + 1).padStart(2, "0")}`,
        sequence: sceneIndex + 1,
        heading:
          scene.title.trim() ||
          `Scene ${sceneIndex + 1} / 场景 ${sceneIndex + 1}`,
        description: scene.summary,
        location: clipText(
          scene.locationId
            ? displayText(
                locations.find((item) => item.id === scene.locationId)?.name ?? {
                  zh: scene.locationId,
                  en: scene.locationId,
                },
                locale,
              )
            : location
              ? displayText(location.name, locale)
              : "",
          STORYBOARD_LIMITS.location,
          true,
        ).text,
        story_time: "",
        data: {
          character_ids: scene.characterIds,
          source_chapter_id: chapter.id,
          source_scene_id: sourceSceneId,
          pov: chapter.pov,
        },
        shots: scene.shots.map((shot, shotIndex) => ({
          id: `shot_${String(shotIndex + 1).padStart(2, "0")}`,
          sequence: shotIndex + 1,
          shot_type: shot.shotType.trim() || "medium",
          description:
            shot.description.trim() ||
            `Shot ${shotIndex + 1} direction pending author review.`,
          dialogue: shot.dialogue,
          camera: shot.camera,
          duration_ms: shot.durationMs,
          prompt: shot.visualPrompt,
          data: {
            source_chapter_id: chapter.id,
            source_scene_id: sourceSceneId,
            source_shot_id: sourceShotIds[shotIndex]!,
            style: "stylized-3d-animation",
          },
        })),
      })),
    };
    let storyboard: ReturnType<typeof storyboardWriteSchema.parse>;
    try {
      storyboard = storyboardWriteSchema.parse(storyboardInput);
    } catch (error) {
      const detail =
        error instanceof ZodError
          ? error.issues
              .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
              .join("; ")
          : String(error);
      throw new Error(
        `Storyboard export failed for chapter ${chapter.number} "${chapter.title}": ${detail}`,
      );
    }

    files.push({
      path: `storyboards/${base}.storyboard.json`,
      mediaType: "application/json",
      content: json(storyboard),
    });
  }

  const exportedChapterIds = new Set(chapters.map((chapter) => chapter.id));
  const approvedDesigns = workspace.workflowTasks.filter((task) =>
    task.status === "done" &&
    (task.workId === work.id || (!task.workId && task.universeId === universe.id)) &&
    (!task.chapterId || exportedChapterIds.has(task.chapterId)) &&
    (task.result.zh.trim() || task.result.en.trim()),
  );
  files.push({
    path: "production/approved-designs.json",
    mediaType: "application/json",
    content: json({
      schema: "iploom.production-designs/v1",
      source_workspace_revision: workspace.revision,
      work_id: work.id,
      note: "Author-reviewed text specifications and reusable prompts. Not rendered media or automatically applied storyboard data.",
      tasks: approvedDesigns,
    }),
  });

  const packagePaths = [
    ...files.map((file) => file.path),
    "handoff.md",
    "manifest.json",
  ];
  files.push({
    path: "handoff.md",
    mediaType: "text/markdown",
    content: markdownHandoff({
      workTitle: displayText(work.title, locale),
      universeTitle: displayText(universe.name, locale),
      locale,
      chapters,
      aspectRatio,
      paths: packagePaths,
    }),
  });

  const hashedFiles = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      media_type: file.mediaType,
      bytes: new TextEncoder().encode(file.content).byteLength,
      sha256: await sha256Text(file.content),
    })),
  );
  // The content hash excludes the generation timestamp so identical content
  // produces an identical hash across repeated exports.
  const manifestBody = {
    schema: "iploom.arcreel.manifest/v1",
    generator: {
      name: "IPloom Studio",
      version: APP_VERSION,
      homepage: "https://github.com/j4tmr/iploom",
    },
    source: {
      workspace_id: workspace.id,
      workspace_revision: workspace.revision,
      universe_id: universe.id,
      work_id: work.id,
      work_revision: work.chapters.reduce(
        (max, chapter) => Math.max(max, chapter.revision),
        0,
      ),
    },
    adaptation: {
      title: displayText(work.title, locale),
      language: work.language,
      aspect_ratio: aspectRatio,
      style: "stylized-3d-animation",
      style_direction: ARC_REEL_STYLE,
      negative_prompt: ARC_REEL_NEGATIVE_PROMPT,
      chapters: chapterPreviews,
      totals: {
        chapters: chapters.length,
        words: chapterPreviews.reduce((sum, chapter) => sum + chapter.words, 0),
        scenes: totalScenes,
        shots: totalShots,
      },
    },
    warnings,
    files: hashedFiles,
  };
  const contentSha256 = await sha256Text(json(manifestBody));
  const manifest = {
    schema: manifestBody.schema,
    generated_at: generatedAt,
    content_sha256: contentSha256,
    generator: manifestBody.generator,
    source: manifestBody.source,
    adaptation: manifestBody.adaptation,
    warnings: manifestBody.warnings,
    files: manifestBody.files,
  };
  const manifestContent = json(manifest);
  const manifestSha256 = await sha256Text(manifestContent);
  files.push({
    path: "manifest.json",
    mediaType: "application/json",
    content: manifestContent,
  });

  return {
    schema: "iploom.arcreel/v1",
    generatedAt,
    workspaceRevision: workspace.revision,
    universeId: universe.id,
    workId: work.id,
    workTitle: displayText(work.title, locale),
    workLanguage: work.language,
    aspectRatio,
    style: "stylized-3d-animation",
    chapters: chapterPreviews,
    totalWords: chapterPreviews.reduce((sum, chapter) => sum + chapter.words, 0),
    totalScenes,
    totalShots,
    warnings,
    files,
    manifestSha256,
  };
}
