import { countWords, displayText } from "./factory.ts";
import { buildRelationshipGraph } from "./graph.ts";
import { sha256Text } from "./hash.ts";
import { storyboardWriteSchema } from "./storyboard-contract.ts";
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

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "untitled";
}

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

function paragraphScenes(
  chapter: Chapter,
  characters: Character[],
  location: StoryLocation | undefined,
  locale: UiLocale,
): StoryScene[] {
  const paragraphs = chapter.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const source =
    paragraphs.length > 0
      ? paragraphs
      : [
          chapter.outline ||
            chapter.summary ||
            `${chapter.title} — scene breakdown pending.`,
        ];
  const scenes: StoryScene[] = [];
  const shotsPerScene = 5;
  const sceneGroups = Math.min(12, Math.ceil(source.length / shotsPerScene));
  for (let sceneIndex = 0; sceneIndex < sceneGroups; sceneIndex += 1) {
    const group = source.slice(
      sceneIndex * shotsPerScene,
      sceneIndex * shotsPerScene + shotsPerScene,
    );
    const sceneId = `scene_${String(sceneIndex + 1).padStart(2, "0")}`;
    const shots: StoryShot[] = group.map((paragraph, shotIndex) => {
      const camera = ["wide establishing", "medium two-shot", "close-up", "detail insert", "slow push-in"][
        shotIndex % 5
      ]!;
      const dialogue = quoteOf(paragraph);
      return {
        id: `shot_${String(shotIndex + 1).padStart(2, "0")}`,
        shotType: ["wide", "medium", "close", "insert", "medium"][shotIndex % 5]!,
        description: paragraph,
        dialogue,
        camera,
        durationMs: clampShotDuration(paragraph),
        visualPrompt: "",
      };
    });
    scenes.push({
      id: sceneId,
      title: `${chapter.title} · Scene ${sceneIndex + 1}`,
      summary: group[0] ?? "",
      locationId: chapter.locationId,
      characterIds: characters.map((character) => character.id),
      shots,
    });
  }
  if (!scenes.length)
    scenes.push({
      id: "scene_01",
      title: `${chapter.title} · Scene 1`,
      summary: chapter.summary,
      locationId: chapter.locationId,
      characterIds: characters.map((character) => character.id),
      shots: [
        {
          id: "shot_01",
          shotType: "wide",
          description:
            chapter.outline || chapter.summary || "Scene direction pending.",
          dialogue: "",
          camera: "wide establishing",
          durationMs: 3_000,
          visualPrompt: "",
        },
      ],
    });
  void location;
  void locale;
  return scenes;
}

function hydrateShots(
  chapter: Chapter,
  scenes: StoryScene[],
  universe: StoryUniverse,
  allCharacters: Character[],
  locations: StoryLocation[],
  locale: UiLocale,
  aspectRatio: string,
): StoryScene[] {
  const charactersById = new Map(
    allCharacters.map((character) => [character.id, character]),
  );
  const locationsById = new Map(
    locations.map((location) => [location.id, location]),
  );
  let totalShots = 0;
  return scenes.slice(0, 12).map((scene, sceneIndex) => {
    const sceneCharacters = scene.characterIds
      .map((id) => charactersById.get(id))
      .filter((character): character is Character => Boolean(character));
    const location = scene.locationId
      ? locationsById.get(scene.locationId)
      : chapter.locationId
        ? locationsById.get(chapter.locationId)
        : undefined;
    const availableShots = Math.max(0, 60 - totalShots);
    const sourceShots = scene.shots.slice(0, availableShots);
    const shotsToHydrate = sourceShots.length
      ? sourceShots
      : [
          {
            id: "shot_01",
            shotType: "wide",
            description:
              scene.summary || "Shot direction pending author review.",
            dialogue: "",
            camera: "wide establishing",
            durationMs: 3_000,
            visualPrompt: "",
          } satisfies StoryShot,
        ].slice(0, availableShots);
    const shots = shotsToHydrate.map((shot, shotIndex) => {
        totalShots += 1;
        const hydrated: StoryShot = {
          ...shot,
          id: `shot_${String(shotIndex + 1).padStart(2, "0")}`,
          visualPrompt: "",
        };
        hydrated.visualPrompt = buildShotPrompt(
          chapter,
          scene,
          hydrated,
          universe,
          sceneCharacters,
          location,
          locale,
          aspectRatio,
        );
        return hydrated;
      });
    return {
      ...scene,
      id: `scene_${String(sceneIndex + 1).padStart(2, "0")}`,
      title:
        scene.title.trim() ||
        `Scene ${sceneIndex + 1} / 场景 ${sceneIndex + 1}`,
      characterIds: sceneCharacters.map((character) => character.id),
      shots,
    };
  });
}

function markdownHandoff(input: {
  workTitle: string;
  universeTitle: string;
  locale: UiLocale;
  chapters: Chapter[];
  aspectRatio: string;
}): string {
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
    const scenes = hydrateShots(
      chapter,
      chapter.scenes.length
        ? chapter.scenes
        : paragraphScenes(chapter, chapterCharacters, location, locale),
      universe,
      universeCharacters,
      locations,
      locale,
      aspectRatio,
    );
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

    const storyboard = storyboardWriteSchema.parse({
      contract_version: 4,
      expected_revision: workspace.revision,
      id: `storyboard_${sequence}`,
      episode_id: `episode_${sequence}`,
      source_prose_version_id: `local_${chapter.id}_r${chapter.revision}`,
      source_prose_sha256: contentHash,
      title: `${chapter.number}. ${chapter.title}`,
      data: {
        format: "vertical-short-drama",
        medium: "stylized-3d-animation",
        style_direction: ARC_REEL_STYLE,
        negative_prompt: ARC_REEL_NEGATIVE_PROMPT,
        language: work.language,
        aspect_ratio: aspectRatio,
        source: "iploom-studio",
      },
      scenes: scenes.map((scene, sceneIndex) => ({
        id: `scene_${String(sceneIndex + 1).padStart(2, "0")}`,
        sequence: sceneIndex + 1,
        heading:
          scene.title.trim() ||
          `Scene ${sceneIndex + 1} / 场景 ${sceneIndex + 1}`,
        description: scene.summary,
        location: scene.locationId
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
        story_time: chapter.pov,
        data: {
          character_ids: scene.characterIds,
          source_chapter_id: chapter.id,
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
            style: "stylized-3d-animation",
          },
        })),
      })),
    });

    files.push({
      path: `storyboards/${base}.storyboard.json`,
      mediaType: "application/json",
      content: json(storyboard),
    });
  }

  files.push({
    path: "handoff.md",
    mediaType: "text/markdown",
    content: markdownHandoff({
      workTitle: displayText(work.title, locale),
      universeTitle: displayText(universe.name, locale),
      locale,
      chapters,
      aspectRatio,
    }),
  });

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

  const hashedFiles = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      media_type: file.mediaType,
      bytes: new TextEncoder().encode(file.content).byteLength,
      sha256: await sha256Text(file.content),
    })),
  );
  const manifest = {
    schema: "iploom.arcreel.manifest/v1",
    generated_at: generatedAt,
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
