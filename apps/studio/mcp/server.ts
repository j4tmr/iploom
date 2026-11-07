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
import { countWords, createId } from "../src/core/factory.ts";
import { buildRelationshipGraph } from "../src/core/graph.ts";
import { reassignStandardUniverse } from "../src/core/integrity.ts";
import { standardSchema } from "../src/core/schemas.ts";
import { searchWorkspace } from "../src/core/search.ts";
import { applicableStandards, STANDARD_KINDS } from "../src/core/standards.ts";
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
  WorkspaceStandard,
  WorkflowTask,
} from "../src/core/types.ts";
import { APP_VERSION } from "../src/core/version.ts";
import {
  isWithin,
  realPathWithExistingAncestor,
} from "../src/node/desktop-guards.ts";
import {
  WorkspaceStore,
  type LoadedWorkspace,
} from "../src/node/workspace-store.ts";

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
const STANDARD_WRITE_ANNOTATIONS: ToolAnnotations = {
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
const standardScopeSchema = z
  .union([worldIdSchema, z.literal(""), z.null()])
  .optional()
  .describe(
    "限定到某个故事世界；传 null 或空字符串可清除范围、改为全项目；省略时新建默认全项目、更新保持原范围 / Story-world scope; pass null or an empty string to clear it to project-wide; omit to create project-wide or keep the current scope on update.",
  );
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
const standardIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("基础规则 ID / Foundation standard ID.");
const standardKindSchema = z
  .enum([
    "style",
    "format",
    "naming",
    "numeric",
    "entity-prompt",
    "continuity",
  ])
  .describe("规则类型 / Foundation standard kind.");
const standardStatusSchema = z
  .enum(["draft", "active", "disabled"])
  .describe("规则状态 / Foundation standard status.");
const standardWriteKindSchema = z
  .string()
  .trim()
  .min(1)
  .describe(
    "规则类型，取值 style、format、naming、numeric、entity-prompt 或 continuity / Foundation standard kind; one of style, format, naming, numeric, entity-prompt, continuity.",
  );
const standardWriteStatusSchema = z
  .string()
  .trim()
  .min(1)
  .describe(
    "规则状态，取值 draft、active 或 disabled / Foundation standard status; one of draft, active, disabled.",
  );
const standardTitleSchema = z
  .object({
    zh: z.string().max(500).default("").describe("中文标题 / Chinese title."),
    en: z.string().max(500).default("").describe("英文标题 / English title."),
  })
  .strict()
  .describe("双语标题 / Localized standard title.");
const standardBodySchema = z
  .object({
    zh: z.string().max(20_000).default("").describe("中文规则正文 / Chinese body."),
    en: z.string().max(20_000).default("").describe("英文规则正文 / English body."),
  })
  .strict()
  .describe("双语规则正文 / Localized standard body.");

export function workspaceMeta(loaded: LoadedWorkspace) {
  const { workspace } = loaded;
  return {
    id: workspace.id,
    name: workspace.name,
    revision: workspace.revision,
    locale: workspace.settings.locale,
    // Surfaced so an MCP client can tell that the file it just read is the
    // `.bak` fallback rather than the primary workspace.
    recovered_from_backup: loaded.recoveredFromBackup,
    ...(loaded.rejectedPath
      ? {
          rejected_primary_file: loaded.rejectedPath,
          rejected_primary_reason: loaded.rejectedReason ?? null,
        }
      : {}),
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
    result_superseded: task.resultSuperseded === true,
    previous_result: task.previousResult ?? null,
    last_run: task.lastRun ?? null,
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

const STANDARD_KIND_RANK = new Map(
  STANDARD_KINDS.map((kind, index) => [kind, index] as const),
);

function compareStandards(
  left: WorkspaceStandard,
  right: WorkspaceStandard,
): number {
  const rank =
    (STANDARD_KIND_RANK.get(left.kind) ?? 99) -
    (STANDARD_KIND_RANK.get(right.kind) ?? 99);
  if (rank !== 0) return rank;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function standardView(standard: WorkspaceStandard) {
  return {
    id: standard.id,
    title: standard.title,
    kind: standard.kind,
    status: standard.status,
    version: standard.version,
    universe_id: standard.universeId ?? null,
    body: standard.body,
    createdAt: standard.createdAt,
    updatedAt: standard.updatedAt,
  };
}

class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

function invalidStandard(error: unknown): ToolError {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "standard"}: ${issue.message}`)
      .join("; ");
    return new ToolError(
      "invalid_argument",
      `Invalid foundation standard: ${issues || "validation failed"}`,
    );
  }
  return new ToolError("invalid_argument", errorMessage(error));
}

function parseStandard(value: unknown): WorkspaceStandard {
  try {
    return standardSchema.parse(value) as WorkspaceStandard;
  } catch (error) {
    throw invalidStandard(error);
  }
}

function findStandard(
  workspace: StudioWorkspace,
  standardId: string,
): WorkspaceStandard {
  const standard = workspace.standards.find((item) => item.id === standardId);
  if (!standard)
    throw new ToolError(
      "not_found",
      `Foundation standard not found: ${standardId}`,
    );
  return standard;
}

function ensureUniverse(workspace: StudioWorkspace, universeId: string): void {
  if (!workspace.universes.some((universe) => universe.id === universeId))
    throw new ToolError(
      "invalid_argument",
      `Unknown story world: ${universeId}`,
    );
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
  const code = error instanceof ToolError ? error.code : errorCode(message);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: { code, message },
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

export interface StudioMcpServerOptions {
  /**
   * Extra export roots explicitly enabled by the operator (repeatable
   * `--export-root`). Tool arguments can narrow a root, never widen the set.
   */
  exportRoots?: readonly string[];
}

export function createStudioMcpServer(
  workspaceFile: string,
  options: StudioMcpServerOptions = {},
): McpServer {
  const store = new WorkspaceStore(workspaceFile);
  const workspaceDirectory = dirname(store.filePath);
  const defaultExportRoot = join(workspaceDirectory, "exports");
  const exportRoots = [
    defaultExportRoot,
    ...(options.exportRoots ?? []).map((root) => resolve(root)),
  ];
  const assertExportRoot = async (candidate: string): Promise<void> => {
    const realCandidate = await realPathWithExistingAncestor(candidate);
    for (const root of exportRoots) {
      try {
        if (
          isWithin(await realPathWithExistingAncestor(root), realCandidate)
        ) {
          return;
        }
      } catch {
        // An unreadable root cannot authorize a write.
      }
    }
    throw new Error(
      `Export root is outside the allowed export directories: ${candidate}`,
    );
  };
  const server = new McpServer(
    { name: "IPloom Studio", version: APP_VERSION },
    {
      instructions:
        "IPloom Studio 本地 IP 记忆库：先列故事世界，再读小说、章节、关系、AI 工作流与项目基础规则；search_ip 支持中英双语子串检索。前 11 个工具只读；create_standard 与 update_standard 只修改工作区内的基础规则；export_arcreel_bundle 是唯一写盘导出工具，只能写入工作区同目录的 exports，或服务端启动时用 --export-root 显式允许的目录。\n" +
        "IPloom Studio local IP memory: list story worlds before reading novels, chapters, relationships, AI workflow and foundation standards. The first 11 tools are read-only; create_standard and update_standard only change foundation standards inside the workspace; export_arcreel_bundle is the only tool that writes files and may only write inside the exports directory beside workspace.json or a directory enabled with --export-root at server start.",
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
        const loaded = await store.load();
        const { workspace } = loaded;
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(loaded),
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
        const loaded = await store.load();
        const { workspace } = loaded;
        const world = findWorld(workspace, args.world_id);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(loaded),
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
        const loaded = await store.load();
        const { workspace } = loaded;
        if (args.world_id) findWorld(workspace, args.world_id);
        const novels = workspace.works.filter(
          (novel) => !args.world_id || novel.universeId === args.world_id,
        );
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(loaded),
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
        const loaded = await store.load();
        const { workspace } = loaded;
        const novel = findNovel(workspace, args.novel_id);
        const world = findWorld(workspace, novel.universeId);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(loaded),
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
        const loaded = await store.load();
        const { workspace } = loaded;
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
          workspace: workspaceMeta(loaded),
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
        "跨故事世界、小说、章节、角色、地点、物件、势力、传说与故事时间线做中英子串检索。Search the whole IP library, including props and story timeline events, with Chinese/English substring matching.",
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
            "object",
            "faction",
            "lore",
            "timeline",
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
        const loaded = await store.load();
        const { workspace } = loaded;
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
          workspace: workspaceMeta(loaded),
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
        const loaded = await store.load();
        const { workspace } = loaded;
        const world = findWorld(workspace, args.world_id);
        const locale: UiLocale = args.locale ?? workspace.settings.locale;
        const graph = buildRelationshipGraph(workspace, world.id, locale);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(loaded),
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
        const loaded = await store.load();
        const { workspace } = loaded;
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
          workspace: workspaceMeta(loaded),
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
        const loaded = await store.load();
        const { workspace } = loaded;
        const task = workspace.workflowTasks.find(
          (item) => item.id === args.task_id,
        );
        if (!task) throw new Error("Unknown workflow task: " + args.task_id);
        const locale: UiLocale = args.locale ?? workspace.settings.locale;
        const readiness = workflowTaskReadiness(workspace, task);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(loaded),
          task: workflowTaskView(workspace, task),
          ready: readiness.ready,
          markdown: buildWorkflowBrief(workspace, task.id, locale),
        };
      }),
  );

  server.registerTool(
    "list_standards",
    {
      title: "基础规则列表 / Foundation standards",
      description:
        "列出项目基础规则，可按状态、类型和故事世界过滤；active_applied 是当前范围内实际生效的规则数。List project foundation standards, optionally filtered by status, kind and story world; active_applied reports how many active standards apply to that scope.",
      inputSchema: z.object({
        status: standardStatusSchema
          .optional()
          .describe("只看指定状态 / Only this status."),
        kind: standardKindSchema
          .optional()
          .describe("只看指定类型 / Only this kind."),
        universe_id: worldIdSchema
          .optional()
          .describe(
            "只看属于该故事世界的规则 / Only standards scoped to this story world.",
          ),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const loaded = await store.load();
        const { workspace } = loaded;
        const standards = workspace.standards
          .filter(
            (standard) =>
              (!args.status || standard.status === args.status) &&
              (!args.kind || standard.kind === args.kind) &&
              (!args.universe_id || standard.universeId === args.universe_id),
          )
          .slice()
          .sort(compareStandards);
        return {
          schema: MCP_SCHEMA,
          count: standards.length,
          active_applied: applicableStandards(workspace, args.universe_id)
            .length,
          standards: standards.map((standard) => standardView(standard)),
        };
      }),
  );

  server.registerTool(
    "get_standard",
    {
      title: "读取基础规则 / Read foundation standard",
      description:
        "读取一条基础规则，并返回其适用范围与引用它的 AI 工作流任务。Read one foundation standard with its scope and the workflow tasks that pin it by id.",
      inputSchema: z.object({ standard_id: standardIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const loaded = await store.load();
        const { workspace } = loaded;
        const standard = findStandard(workspace, args.standard_id);
        return {
          schema: MCP_SCHEMA,
          workspace: workspaceMeta(loaded),
          standard: standardView(standard),
          applies_to: standard.universeId ?? "project",
          pinned_by_task_ids: workspace.workflowTasks
            .filter((task) =>
              task.standardRefs.some((ref) => ref.id === standard.id),
            )
            .map((task) => task.id),
        };
      }),
  );

  server.registerTool(
    "create_standard",
    {
      title: "新建基础规则 / Create foundation standard",
      description:
        "登记一条项目基础规则，默认保存为草稿；标题和正文至少一种语言必须非空，且故事世界必须已存在。Register a project foundation standard, saved as a draft by default; title and body need at least one non-empty language and any story world must already exist.",
      inputSchema: z.object({
        kind: standardWriteKindSchema,
        title: standardTitleSchema,
        body: standardBodySchema,
        status: standardWriteStatusSchema
          .optional()
          .describe("省略时保存为草稿 / Defaults to draft."),
        universe_id: standardScopeSchema,
      }),
      annotations: STANDARD_WRITE_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const now = new Date().toISOString();
        const universeId = args.universe_id || undefined;
        const standard = parseStandard({
          id: createId("std"),
          title: args.title,
          kind: args.kind,
          ...(universeId ? { universeId } : {}),
          body: args.body,
          status: args.status ?? "draft",
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        const workspace = await store.update((current) => {
          if (current.standards.length >= 1_000)
            throw new ToolError(
              "invalid_argument",
              "The workspace already contains the maximum of 1000 foundation standards.",
            );
          if (standard.universeId)
            ensureUniverse(current, standard.universeId);
          current.standards.push(standard);
          current.updatedAt = now;
        });
        return {
          schema: MCP_SCHEMA,
          revision: workspace.revision,
          standard: standardView(standard),
        };
      }),
  );

  server.registerTool(
    "update_standard",
    {
      title: "更新基础规则 / Update foundation standard",
      description:
        "更新一条基础规则；标题、正文、类型或适用范围变化时版本号加一，仅修改状态不改版本。Update a foundation standard; title, body, kind or scope changes bump the version, while a status-only change does not.",
      inputSchema: z.object({
        standard_id: standardIdSchema,
        title: standardTitleSchema.optional(),
        body: standardBodySchema.optional(),
        kind: standardWriteKindSchema.optional(),
        status: standardWriteStatusSchema.optional(),
        universe_id: standardScopeSchema,
      }),
      annotations: STANDARD_WRITE_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const now = new Date().toISOString();
        let updated: WorkspaceStandard | undefined;
        let versionBumped = false;
        const workspace = await store.update((current) => {
          const index = current.standards.findIndex(
            (item) => item.id === args.standard_id,
          );
          if (index < 0)
            throw new ToolError(
              "not_found",
              `Foundation standard not found: ${args.standard_id}`,
            );
          const existing = current.standards[index] as WorkspaceStandard;
          const scopeProvided = args.universe_id !== undefined;
          const universeId = scopeProvided
            ? args.universe_id || undefined
            : existing.universeId;
          if (universeId) ensureUniverse(current, universeId);
          const title = args.title ?? existing.title;
          const body = args.body ?? existing.body;
          const kind = args.kind ?? existing.kind;
          const contentChanged =
            title.zh !== existing.title.zh ||
            title.en !== existing.title.en ||
            body.zh !== existing.body.zh ||
            body.en !== existing.body.en ||
            kind !== existing.kind ||
            universeId !== existing.universeId;
          const nextInput = {
            ...existing,
            title,
            body,
            kind,
            status: args.status ?? existing.status,
            version: existing.version + (contentChanged ? 1 : 0),
            updatedAt: now,
          };
          if (scopeProvided) {
            if (universeId) nextInput.universeId = universeId;
            else delete nextInput.universeId;
          }
          const next = parseStandard(nextInput);
          current.standards[index] = next;
          if (universeId !== existing.universeId)
            reassignStandardUniverse(current, args.standard_id, universeId);
          current.updatedAt = now;
          updated = next;
          versionBumped = contentChanged;
        });
        if (!updated)
          throw new ToolError(
            "tool_error",
            "Foundation standard update did not run.",
          );
        return {
          schema: MCP_SCHEMA,
          revision: workspace.revision,
          standard: standardView(updated),
          version_bumped: versionBumped,
        };
      }),
  );

  server.registerTool(
    "export_arcreel_bundle",
    {
      title: "导出 ArcReel 包 / Export ArcReel bundle",
      description:
        "构建并写入 ArcReel/3D 漫剧交接包。output_dir 必须位于工作区 exports 目录或服务端启动时用 --export-root 显式允许的目录内；省略时写入工作区同目录 exports。Build and write an ArcReel / stylized 3D comic-drama handoff. output_dir must stay inside the workspace exports directory or a directory enabled with --export-root at server start; the default is exports beside workspace.json.",
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
            "导出根目录，必须位于 exports 或 --export-root 允许的目录内；相对路径按工作区目录解析 / Export root inside exports or an allowed --export-root; relative paths resolve against the workspace directory.",
          ),
      }),
      annotations: EXPORT_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const loaded = await store.load();
        const { workspace } = loaded;
        const novel = findNovel(workspace, args.novel_id);
        const outputRoot = args.output_dir
          ? resolve(workspaceDirectory, args.output_dir)
          : defaultExportRoot;
        await assertExportRoot(outputRoot);
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
          workspace: workspaceMeta(loaded),
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
      "export-root": { type: "string", multiple: true },
    },
    strict: true,
  });
  if (!values.workspace)
    throw new Error(
      "Missing required --workspace <workspace.json> / 缺少 --workspace 参数。",
    );
  const server = createStudioMcpServer(values.workspace, {
    exportRoots: values["export-root"]?.map((root) => resolve(root)),
  });
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`IPloom Studio MCP: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
