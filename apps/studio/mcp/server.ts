import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  McpServer,
  type CallToolResult,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { buildArcReelBundle } from "../src/core/arcreel.ts";
import { countWords } from "../src/core/factory.ts";
import { buildRelationshipGraph } from "../src/core/graph.ts";
import { searchWorkspace } from "../src/core/search.ts";
import {
  buildWorkflowBrief,
  workflowSummary,
  workflowTaskReadiness,
} from "../src/core/workflow.ts";
import type {
  Chapter,
  Character,
  LoreEntry,
  Relationship,
  StoryFaction,
  StoryLocation,
  StoryScene,
  StoryUniverse,
  StoryWork,
  StudioWorkspace,
  UiLocale,
  WorkflowTask,
} from "../src/core/types.ts";
import { APP_VERSION } from "../src/core/version.ts";
import { WorkspaceStore } from "../src/node/workspace-store.ts";

const MCP_SCHEMA = "iploom.studio.mcp/v1";
const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const EXPORT_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const localeSchema = z
  .enum(["zh-CN", "en"])
  .optional()
  .describe("输出语言 / Output locale; defaults to the workspace locale.");
const worldIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("故事世界 ID（universe ID）/ Story-world ID.");
const novelIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("小说作品 ID（work ID）/ Novel ID.");
const chapterIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("章节 ID / Chapter ID.");
const workflowTaskIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("AI 任务 ID / Workflow task ID.");

function workspaceMeta(workspace: StudioWorkspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    revision: workspace.revision,
    locale: workspace.settings.locale,
  };
}

function findWorld(workspace: StudioWorkspace, worldId: string): StoryUniverse {
  const world = workspace.universes.find((item) => item.id === worldId);
  if (!world) throw new Error(`Unknown story world: ${worldId}`);
  return world;
}

function findNovel(workspace: StudioWorkspace, novelId: string): StoryWork {
  const novel = workspace.works.find((item) => item.id === novelId);
  if (!novel) throw new Error(`Unknown novel: ${novelId}`);
  return novel;
}

function worldStats(workspace: StudioWorkspace, worldId: string) {
  const novels = workspace.works.filter(
    (novel) => novel.universeId === worldId,
  );
  const chapters = novels.flatMap((novel) => novel.chapters);
  return {
    novels: novels.length,
    chapters: chapters.length,
    approved_chapters: chapters.filter(
      (chapter) => chapter.status === "approved",
    ).length,
    words: chapters.reduce(
      (total, chapter) => total + countWords(chapter.content),
      0,
    ),
    characters: workspace.characters.filter((character) =>
      character.universeIds.includes(worldId),
    ).length,
    locations: workspace.locations.filter(
      (location) => location.universeId === worldId,
    ).length,
    factions: workspace.factions.filter(
      (faction) => faction.universeId === worldId,
    ).length,
    lore: workspace.lore.filter((entry) => entry.universeId === worldId).length,
    relationships: workspace.relationships.filter(
      (relationship) => relationship.universeId === worldId,
    ).length,
  };
}

function worldView(workspace: StudioWorkspace, world: StoryUniverse) {
  return {
    id: world.id,
    name: world.name,
    tagline: world.tagline,
    summary: world.summary,
    genres: world.genres,
    themes: world.themes,
    accent: world.accent,
    updated_at: world.updatedAt,
    stats: worldStats(workspace, world.id),
  };
}

function chapterCounts(chapter: Chapter) {
  return {
    word_count: countWords(chapter.content),
    scene_count: chapter.scenes.length,
    shot_count: chapter.scenes.reduce(
      (total, scene) => total + scene.shots.length,
      0,
    ),
  };
}

function novelView(novel: StoryWork) {
  const chapters = novel.chapters;
  return {
    id: novel.id,
    world_id: novel.universeId,
    title: novel.title,
    logline: novel.logline,
    status: novel.status,
    language: novel.language,
    genre: novel.genre,
    themes: novel.themes,
    target_words: novel.targetWords,
    cover_color: novel.coverColor,
    chapter_count: chapters.length,
    approved_chapter_count: chapters.filter(
      (chapter) => chapter.status === "approved",
    ).length,
    word_count: chapters.reduce(
      (total, chapter) => total + countWords(chapter.content),
      0,
    ),
    scene_count: chapters.reduce(
      (total, chapter) => total + chapter.scenes.length,
      0,
    ),
    shot_count: chapters.reduce(
      (total, chapter) =>
        total +
        chapter.scenes.reduce(
          (sceneTotal, scene) => sceneTotal + scene.shots.length,
          0,
        ),
      0,
    ),
    updated_at: novel.updatedAt,
  };
}

function chapterPlanView(chapter: Chapter) {
  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    title_en: chapter.titleEn,
    status: chapter.status,
    pov: chapter.pov,
    summary: chapter.summary,
    outline: chapter.outline,
    beats: chapter.beats,
    character_ids: chapter.characterIds,
    location_id: chapter.locationId,
    adaptation_notes: chapter.adaptationNotes,
    revision: chapter.revision,
    updated_at: chapter.updatedAt,
    ...chapterCounts(chapter),
  };
}

function sceneView(scene: StoryScene) {
  return {
    id: scene.id,
    title: scene.title,
    summary: scene.summary,
    location_id: scene.locationId,
    character_ids: scene.characterIds,
    shots: scene.shots.map((shot) => ({
      id: shot.id,
      shot_type: shot.shotType,
      description: shot.description,
      dialogue: shot.dialogue,
      camera: shot.camera,
      duration_ms: shot.durationMs,
      visual_prompt: shot.visualPrompt,
    })),
  };
}

function chapterView(chapter: Chapter) {
  return {
    ...chapterPlanView(chapter),
    content: chapter.content,
    created_at: chapter.createdAt,
    scenes: chapter.scenes.map(sceneView),
  };
}

function characterView(character: Character) {
  return {
    id: character.id,
    universe_ids: character.universeIds,
    name: character.name,
    role: character.role,
    summary: character.summary,
    appearance: character.appearance,
    visual_prompt: character.visualPrompt,
    personality: character.personality,
    motivation: character.motivation,
    flaw: character.flaw,
    secret: character.secret,
    voice: character.voice,
    tags: character.tags,
    color: character.color,
    reusable: character.reusable,
  };
}

function locationView(location: StoryLocation) {
  return {
    id: location.id,
    name: location.name,
    summary: location.summary,
    atmosphere: location.atmosphere,
    visual_prompt: location.visualPrompt,
  };
}

function factionView(faction: StoryFaction) {
  return {
    id: faction.id,
    name: faction.name,
    summary: faction.summary,
    goal: faction.goal,
    visual_motif: faction.visualMotif,
  };
}

function workflowTaskView(
  workspace: StudioWorkspace,
  task: WorkflowTask,
) {
  const readiness = workflowTaskReadiness(workspace, task);
  return {
    id: task.id,
    title: task.title,
    brief: task.brief,
    deliverable: task.deliverable,
    result: task.result,
    kind: task.kind,
    status: task.status,
    ready: readiness.ready,
    blockers: readiness.blockers.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
    })),
    world_id: task.universeId ?? null,
    novel_id: task.workId ?? null,
    chapter_id: task.chapterId ?? null,
    parent_id: task.parentId ?? null,
    character_ids: task.characterIds,
    depends_on_ids: task.dependsOnIds,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function loreView(entry: LoreEntry) {
  return {
    id: entry.id,
    category: entry.category,
    title: entry.title,
    body: entry.body,
  };
}

function relationshipView(relationship: Relationship) {
  return {
    id: relationship.id,
    source_id: relationship.sourceId,
    target_id: relationship.targetId,
    type: relationship.type,
    label: relationship.label,
    strength: relationship.strength,
    status: relationship.status,
    mutual: relationship.mutual,
    notes: relationship.notes,
  };
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .split("\n")
    .filter((line) => !/^\s+at\s/.test(line))
    .join("\n")
    .trim();
  return message || "Unknown IPloom Studio MCP error.";
}

function errorCode(message: string): string {
  if (/^Unknown (story world|novel):/.test(message)) return "not_found";
  if (/Chapter not found:/.test(message)) return "not_found";
  if (/Workspace is missing or invalid/.test(message))
    return "workspace_unavailable";
  if (/No chapters selected/.test(message)) return "empty_selection";
  return "tool_error";
}

function ok(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function fail(error: unknown): CallToolResult {
  const message = errorMessage(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: { code: errorCode(message), message },
        }),
      },
    ],
  };
}

async function run(action: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await action());
  } catch (error) {
    return fail(error);
  }
}

export function createStudioMcpServer(workspaceFile: string): McpServer {
  const store = new WorkspaceStore(workspaceFile);
  const workspaceDirectory = dirname(store.filePath);
  const server = new McpServer(
    { name: "IPloom Studio", version: APP_VERSION },
    {
      instructions:
        "IPloom Studio 本地 IP 记忆库：先列故事世界，再读小说、章节、关系与 AI 工作流；search_ip 支持中英双语子串检索。前九个工具只读。export_arcreel_bundle 是唯一会写盘的本地导出工具，默认写入工作区同目录的 exports。\n" +
        "IPloom Studio local IP memory: list story worlds before reading novels, chapters, relationships and AI workflow. The first nine tools are read-only. export_arcreel_bundle is the only tool that writes files and defaults to an exports directory beside the workspace file.",
    },
  );

  server.registerTool(
    "list_story_worlds",
    {
      title: "故事世界列表 / Story worlds",
      description:
        "列出全部故事世界及小说、章节、角色、关系等规模统计。List every story world with compact scale statistics.",
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      run(async () => {
        const { workspace } = await store.load();
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          count: workspace.universes.length,
          worlds: workspace.universes.map((world) =>
            worldView(workspace, world),
          ),
        };
      }),
  );

  server.registerTool(
    "get_story_world",
    {
      title: "读取故事世界 / Read story world",
      description:
        "读取一个故事世界的世界观、通用角色、地点、势力、传说、小说与关系。Read one story world with reusable cast, locations, factions, lore, novels and relationships.",
      inputSchema: z.object({ world_id: worldIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        const world = findWorld(workspace, args.world_id);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          world: worldView(workspace, world),
          novels: workspace.works
            .filter((novel) => novel.universeId === world.id)
            .map((novel) => novelView(novel)),
          characters: workspace.characters
            .filter((character) => character.universeIds.includes(world.id))
            .map(characterView),
          locations: workspace.locations
            .filter((location) => location.universeId === world.id)
            .map(locationView),
          factions: workspace.factions
            .filter((faction) => faction.universeId === world.id)
            .map(factionView),
          lore: workspace.lore
            .filter((entry) => entry.universeId === world.id)
            .map(loreView),
          relationships: workspace.relationships
            .filter((relationship) => relationship.universeId === world.id)
            .map(relationshipView),
        };
      }),
  );

  server.registerTool(
    "list_novels",
    {
      title: "小说列表 / Novels",
      description:
        "列出小说作品，可按故事世界过滤，并返回章节与字数统计。List novels, optionally within one story world, with chapter and word statistics.",
      inputSchema: z.object({ world_id: worldIdSchema.optional() }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        if (args.world_id) findWorld(workspace, args.world_id);
        const novels = workspace.works.filter(
          (novel) => !args.world_id || novel.universeId === args.world_id,
        );
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          world_id: args.world_id ?? null,
          count: novels.length,
          novels: novels.map((novel) => novelView(novel)),
        };
      }),
  );

  server.registerTool(
    "get_novel",
    {
      title: "读取小说 / Read novel",
      description:
        "读取小说元数据、简介、章节计划、节拍与写作统计，不返回整章正文。Read novel metadata, synopsis, chapter plans, beats and writing statistics without full chapter prose.",
      inputSchema: z.object({ novel_id: novelIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        const novel = findNovel(workspace, args.novel_id);
        const world = findWorld(workspace, novel.universeId);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          novel: {
            ...novelView(novel),
            synopsis: novel.synopsis,
            created_at: novel.createdAt,
            chapters: novel.chapters
              .slice()
              .sort((left, right) => left.number - right.number)
              .map(chapterPlanView),
          },
          world: {
            id: world.id,
            name: world.name,
            tagline: world.tagline,
          },
        };
      }),
  );

  server.registerTool(
    "get_chapter",
    {
      title: "读取章节 / Read chapter",
      description:
        "读取章节全文、大纲、节拍、角色/地点与现有分镜。novel_id 可选，用于消歧。Read chapter prose, outline, beats, cast/location references and existing scenes. novel_id is optional and resolves ambiguity.",
      inputSchema: z.object({
        chapter_id: chapterIdSchema,
        novel_id: novelIdSchema.optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        let novel: StoryWork | undefined;
        let chapter: Chapter | undefined;
        if (args.novel_id) {
          novel = findNovel(workspace, args.novel_id);
          chapter = novel.chapters.find((item) => item.id === args.chapter_id);
        } else {
          for (const candidate of workspace.works) {
            const found = candidate.chapters.find(
              (item) => item.id === args.chapter_id,
            );
            if (found) {
              novel = candidate;
              chapter = found;
              break;
            }
          }
        }
        if (!novel || !chapter)
          throw new Error(`Chapter not found: ${args.chapter_id}`);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          novel: {
            id: novel.id,
            world_id: novel.universeId,
            title: novel.title,
            language: novel.language,
          },
          chapter: chapterView(chapter),
        };
      }),
  );

  server.registerTool(
    "search_ip",
    {
      title: "检索 IP / Search IP",
      description:
        "跨故事世界、小说、章节、角色、地点、势力与传说做中英子串检索。Search the whole IP library with Chinese/English substring matching.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe("检索词 / Search query."),
        world_id: worldIdSchema.optional(),
        kind: z
          .enum([
            "universe",
            "work",
            "chapter",
            "character",
            "location",
            "faction",
            "lore",
          ])
          .optional()
          .describe("限定结果类型 / Optional result kind."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("最多返回条数 / Maximum number of hits."),
        locale: localeSchema,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        if (args.world_id) findWorld(workspace, args.world_id);
        const locale: UiLocale = args.locale ?? workspace.settings.locale;
        let hits = searchWorkspace(workspace, args.query, locale, 50);
        if (args.world_id) {
          const worldId = args.world_id;
          hits = hits.filter((hit) => {
            if (hit.kind === "character") {
              return Boolean(
                workspace.characters
                  .find((character) => character.id === hit.id)
                  ?.universeIds.includes(worldId),
              );
            }
            return hit.universeId === worldId;
          });
        }
        if (args.kind) hits = hits.filter((hit) => hit.kind === args.kind);
        hits = hits.slice(0, args.limit);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          query: args.query,
          locale,
          world_id: args.world_id ?? null,
          count: hits.length,
          hits: hits.map((hit) => ({
            kind: hit.kind,
            id: hit.id,
            universe_id: hit.universeId,
            work_id: hit.workId,
            chapter_id: hit.chapterId,
            title: hit.title,
            subtitle: hit.subtitle,
            excerpt: hit.excerpt,
            score: hit.score,
          })),
        };
      }),
  );

  server.registerTool(
    "get_relationship_graph",
    {
      title: "关系图 / Relationship graph",
      description:
        "读取故事世界的角色关系图节点、边、角色度数与一致性警告。Read the cast relationship graph with nodes, edges, degrees and consistency warnings.",
      inputSchema: z.object({
        world_id: worldIdSchema,
        locale: localeSchema,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        const world = findWorld(workspace, args.world_id);
        const locale: UiLocale = args.locale ?? workspace.settings.locale;
        const graph = buildRelationshipGraph(workspace, world.id, locale);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          world_id: world.id,
          locale,
          nodes: graph.nodes,
          edges: graph.edges,
          warnings: graph.warnings,
        };
      }),
  );

  server.registerTool(
    "list_workflow_tasks",
    {
      title: "AI 工作流任务 / Workflow tasks",
      description:
        "列出有依赖与独立启动状态的创作任务，可按世界、小说和状态过滤。List authoring tasks with dependency readiness, optionally filtered by world, novel and status.",
      inputSchema: z.object({
        world_id: worldIdSchema.optional(),
        novel_id: novelIdSchema.optional(),
        status: z
          .enum(["queued", "active", "review", "done"])
          .optional()
          .describe("任务状态 / Task status."),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        if (args.world_id) findWorld(workspace, args.world_id);
        if (args.novel_id) findNovel(workspace, args.novel_id);
        const tasks = workspace.workflowTasks.filter(
          (task) =>
            (!args.world_id || task.universeId === args.world_id) &&
            (!args.novel_id || task.workId === args.novel_id) &&
            (!args.status || task.status === args.status),
        );
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          filters: {
            world_id: args.world_id ?? null,
            novel_id: args.novel_id ?? null,
            status: args.status ?? null,
          },
          count: tasks.length,
          summary: workflowSummary(workspace),
          tasks: tasks.map((task) => workflowTaskView(workspace, task)),
        };
      }),
  );

  server.registerTool(
    "get_workflow_brief",
    {
      title: "AI 任务简报 / Workflow brief",
      description:
        "生成一份确定性的 Markdown 简报，只包含该任务相关的世界、小说、章节、人物、关系与依赖。Build a deterministic Markdown brief scoped to one task, including only related world, novel, chapter, cast, relationships and dependencies.",
      inputSchema: z.object({
        task_id: workflowTaskIdSchema,
        locale: localeSchema,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        const task = workspace.workflowTasks.find(
          (item) => item.id === args.task_id,
        );
        if (!task) throw new Error("Unknown workflow task: " + args.task_id);
        const locale: UiLocale = args.locale ?? workspace.settings.locale;
        const readiness = workflowTaskReadiness(workspace, task);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          task: workflowTaskView(workspace, task),
          ready: readiness.ready,
          markdown: buildWorkflowBrief(workspace, task.id, locale),
        };
      }),
  );

  server.registerTool(
    "export_arcreel_bundle",
    {
      title: "导出 ArcReel 包 / Export ArcReel bundle",
      description:
        "构建并写入 ArcReel/3D 漫剧交接包。output_dir 可为绝对路径或相对工作区目录的路径；省略时写入工作区同目录 exports。Build and write an ArcReel / stylized 3D comic-drama handoff. output_dir may be absolute or relative to the workspace directory; the default is exports beside workspace.json.",
      inputSchema: z.object({
        novel_id: novelIdSchema,
        chapter_ids: z
          .array(chapterIdSchema)
          .min(1)
          .optional()
          .describe(
            "仅导出指定章节；省略则导出全部章节 / Optional chapter subset.",
          ),
        locale: localeSchema,
        aspect_ratio: z
          .enum(["9:16", "16:9", "1:1"])
          .optional()
          .describe("画幅；省略则使用工作区默认值 / Optional aspect ratio."),
        approved_only: z
          .boolean()
          .optional()
          .describe(
            "只导出已批准章节；省略则使用工作区设置 / Export approved chapters only; defaults to the workspace setting.",
          ),
        output_dir: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "导出根目录，绝对路径或相对工作区目录 / Absolute or workspace-relative export root.",
          ),
      }),
      annotations: EXPORT_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const { workspace } = await store.load();
        const novel = findNovel(workspace, args.novel_id);
        const outputRoot = args.output_dir
          ? resolve(workspaceDirectory, args.output_dir)
          : join(workspaceDirectory, "exports");
        const bundle = await buildArcReelBundle(workspace, {
          workId: novel.id,
          chapterIds: args.chapter_ids,
          locale: args.locale,
          aspectRatio: args.aspect_ratio,
          approvedOnly:
            args.approved_only ?? workspace.settings.exportApprovedOnly,
        });
        const written = await store.exportArcReel(bundle, outputRoot);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(workspace),
          directory: written.directory,
          output_root: outputRoot,
          files_written: written.files,
          bytes: written.bytes,
          manifest_sha256: bundle.manifestSha256,
          novel_id: novel.id,
          generated_at: bundle.generatedAt,
          language: bundle.workLanguage,
          aspect_ratio: bundle.aspectRatio,
          chapters: bundle.chapters,
          totals: {
            words: bundle.totalWords,
            scenes: bundle.totalScenes,
            shots: bundle.totalShots,
          },
          paths: bundle.files.map((file) => file.path),
          warnings: bundle.warnings,
        };
      }),
  );

  return server;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string", short: "w" },
    },
    strict: true,
  });
  if (!values.workspace)
    throw new Error(
      "Missing required --workspace <workspace.json> / 缺少 --workspace 参数。",
    );
  const server = createStudioMcpServer(values.workspace);
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`IPloom Studio MCP: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
