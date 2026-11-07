import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  McpServer,
  type CallToolResult,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { buildArcReelBundle } from "../src/core/arcreel.ts";
import { countWords, createId } from "../src/core/factory.ts";
import { buildRelationshipGraph } from "../src/core/graph.ts";
import { reassignStandardUniverse } from "../src/core/integrity.ts";
import {
  MCP_TOOL_COUNTS,
  MCP_TOOL_NAMES,
  type McpToolName,
} from "../src/core/mcp-tools.ts";
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
  LocalizedText,
  LoreEntry,
  Relationship,
  SearchHit,
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
/**
 * Default byte ceiling for one tool result. A single read must never flood a
 * model context, so every collection is paged until its JSON fits this budget.
 */
const RESPONSE_BUDGET_BYTES = 50_000;
/** Reserved for the schema/workspace/error envelope around a paged collection. */
const RESPONSE_ENVELOPE_BYTES = 6_000;
const ITEM_BUDGET_BYTES = RESPONSE_BUDGET_BYTES - RESPONSE_ENVELOPE_BYTES;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 200;
/** Chapter prose returned per `get_chapter` call unless the caller asks for more. */
const CHAPTER_TEXT_CHARS = 6_000;
const CHAPTER_MAX_TEXT_CHARS = 60_000;
const BEATS_BUDGET_BYTES = 6_000;
const SCENES_BUDGET_BYTES = 6_000;
const NOVEL_CHAPTERS_BUDGET_BYTES = 30_000;
/** Synopsis window returned by `get_novel` unless the caller asks for more. */
const NOVEL_SYNOPSIS_CHARS = 2_000;
const SYNOPSIS_MAX_CHARS = 100_000;
const BRIEF_CHARS = 8_000;
const BRIEF_MAX_CHARS = 100_000;
/** Rule text returned per language by `get_standard` unless asked for more. */
const STANDARD_BODY_CHARS = 4_000;
const SUMMARY_PREVIEW_CHARS = 1_000;
const OUTLINE_PREVIEW_CHARS = 1_200;
const NOTES_PREVIEW_CHARS = 1_000;
const CHAPTER_SUMMARY_PREVIEW_CHARS = 400;
const RESULT_EXCERPT_CHARS = 200;
/** Strings longer than this are clipped in compact list views. */
const COMPACT_STRING_CHARS = 240;
/** Arrays longer than this are clipped in compact list views. */
const COMPACT_ARRAY_ITEMS = 20;

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

/** One page of a collection, whatever the collection holds. */
interface Page<T> {
  /** Items in the whole filtered collection, before the window. */
  total: number;
  /** Zero-based index of the first returned item. */
  offset: number;
  /** Items returned in this page. */
  count: number;
  /** Offset of the next page, or null when this page ends the collection. */
  next_offset: number | null;
  /** True when items exist after this page. */
  truncated: boolean;
  items: T[];
}

const UTF8 = new TextEncoder();

function byteSize(value: unknown): number {
  return UTF8.encode(JSON.stringify(value) ?? "").length;
}

/**
 * Deterministic paging. Items are added until the next one would exceed the
 * byte budget, but a page always holds at least one item so a single oversized
 * record can never stall paging.
 */
function pageOf<T>(
  items: readonly T[],
  options: { offset?: number; limit?: number; budget?: number } = {},
): Page<T> {
  const total = items.length;
  const offset = Math.min(
    total,
    Math.max(0, Math.trunc(options.offset ?? 0)),
  );
  const limit = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_PAGE_LIMIT)),
  );
  const budget = Math.max(0, Math.trunc(options.budget ?? ITEM_BUDGET_BYTES));
  const page: T[] = [];
  let used = 0;
  let next = offset;
  while (next < total && page.length < limit) {
    const item = items[next] as T;
    // The +1 accounts for the separating comma in the serialized array.
    const size = byteSize(item) + 1;
    if (page.length > 0 && used + size > budget) break;
    page.push(item);
    used += size;
    next += 1;
  }
  return {
    total,
    offset,
    count: page.length,
    next_offset: next < total ? next : null,
    truncated: next < total,
    items: page,
  };
}

/** Slices without ever splitting a surrogate pair at the end of the window. */
function clipEnd(value: string, start: number, maxChars: number): string {
  let end = Math.min(value.length, start + Math.max(1, maxChars));
  if (end < value.length) {
    const code = value.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    if (end <= start) end = start + 1;
  }
  return value.slice(start, end);
}

function boundedText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return { text: value, total_chars: value.length, truncated: false };
  }
  return {
    text: `${clipEnd(value, 0, maxChars)}…`,
    total_chars: value.length,
    truncated: true,
  };
}

function previewText(value: string, maxChars: number): string {
  return boundedText(value, maxChars).text;
}

/**
 * A contiguous text window. Concatenating every window reassembles the source
 * exactly, so `offset` from one response can be passed straight back in.
 */
function textWindow(value: string, offset: number, maxChars: number) {
  const total = value.length;
  const start = Math.min(total, Math.max(0, Math.trunc(offset)));
  const text = clipEnd(value, start, maxChars);
  const next = start + text.length;
  return {
    text,
    offset: start,
    total_chars: total,
    next_offset: next < total ? next : null,
    truncated: next < total,
  };
}

function compactValue(
  value: unknown,
  path: string,
  clipped: string[],
): unknown {
  if (typeof value === "string") {
    if (value.length <= COMPACT_STRING_CHARS) return value;
    clipped.push(path);
    return `${value.slice(0, COMPACT_STRING_CHARS)}…`;
  }
  if (Array.isArray(value)) {
    const items = value.map((item, index) =>
      compactValue(item, `${path}[${index}]`, clipped),
    );
    if (items.length > COMPACT_ARRAY_ITEMS) {
      clipped.push(path);
      return items.slice(0, COMPACT_ARRAY_ITEMS);
    }
    return items;
  }
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (item === undefined) continue;
      record[key] = compactValue(item, path ? `${path}.${key}` : key, clipped);
    }
    return record;
  }
  return value;
}

/**
 * Clips the long free-text fields of a record and records what was clipped, so
 * a list view stays small while still telling the caller what to re-read with
 * `include_details`.
 */
function compactRecord(value: object): Record<string, unknown> {
  const clipped: string[] = [];
  const record = compactValue(value, "", clipped) as Record<string, unknown>;
  return clipped.length ? { ...record, truncated_fields: clipped } : record;
}

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

const pageOffsetSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("分页起点（从 0 开始）/ Zero-based item offset.");

function pageLimitSchema(defaultLimit: number, maxLimit: number) {
  return z
    .number()
    .int()
    .min(1)
    .max(maxLimit)
    .default(defaultLimit)
    .describe(
      `最多返回条数，默认 ${defaultLimit}，上限 ${maxLimit} / Page size; default ${defaultLimit}, max ${maxLimit}.`,
    );
}

const pageLimit = pageLimitSchema(DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

const detailSchema = z
  .boolean()
  .default(false)
  .describe(
    "返回完整记录而不是裁剪摘要；可能超过默认结果预算 / Return full records instead of compact summaries; may exceed the default response budget.",
  );

/**
 * The MCP SDK validates arguments against the advertised JSON Schema before the
 * tool callback runs, and a schema that rejects there becomes an opaque
 * protocol error rather than a tool result. This wrapper advertises the real
 * JSON Schema but accepts every payload, so the callback can report a
 * structured `invalid_arguments` error the client can actually read.
 */
function permissive<S extends z.ZodType>(
  schema: S,
): StandardSchemaWithJSON<z.input<S>, z.output<S>> {
  let inputJson: Record<string, unknown> | undefined;
  let outputJson: Record<string, unknown> | undefined;
  const convert = (
    io: "input" | "output",
    target: unknown,
  ): Record<string, unknown> => {
    return z.toJSONSchema(schema, {
      target: zodTarget(target),
      io,
    }) as Record<string, unknown>;
  };
  const jsonSchema = {
    input: (options: { target: unknown }) => {
      inputJson ??= convert("input", options.target);
      return inputJson;
    },
    output: (options: { target: unknown }) => {
      outputJson ??= convert("output", options.target);
      return outputJson;
    },
  };
  return {
    "~standard": {
      version: 1,
      vendor: "iploom-studio",
      validate: (value: unknown) => ({ value: value as z.output<S> }),
      jsonSchema,
    },
  };
}

/** The SDK names JSON Schema drafts slightly differently from zod. */
function zodTarget(
  target: unknown,
): "draft-4" | "draft-7" | "draft-2020-12" | "openapi-3.0" {
  if (target === "draft-07") return "draft-7";
  if (target === "draft-4") return "draft-4";
  if (target === "openapi-3.0") return "openapi-3.0";
  return "draft-2020-12";
}

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
  if (!world) throw new ToolError("not_found", `Unknown story world: ${worldId}`);
  return world;
}

function findNovel(workspace: StudioWorkspace, novelId: string): StoryWork {
  const novel = workspace.works.find((item) => item.id === novelId);
  if (!novel) throw new ToolError("not_found", `Unknown novel: ${novelId}`);
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

/** One row of a novel's chapter list; the prose is read via `get_chapter`. */
function chapterListEntry(chapter: Chapter) {
  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    title_en: chapter.titleEn,
    status: chapter.status,
    pov: chapter.pov,
    summary: previewText(chapter.summary, CHAPTER_SUMMARY_PREVIEW_CHARS),
    summary_chars: chapter.summary.length,
    outline_chars: chapter.outline.length,
    beat_count: chapter.beats.length,
    character_ids: chapter.characterIds,
    location_id: chapter.locationId ?? null,
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

function localizedChars(value: LocalizedText) {
  return { zh: value.zh.length, en: value.en.length };
}

/**
 * The list view of a workflow task: no brief, deliverable or result bodies,
 * just their sizes and a short excerpt, so `list_workflow_tasks` stays small
 * no matter how long the model output was.
 */
function workflowTaskSummaryView(
  workspace: StudioWorkspace,
  task: WorkflowTask,
) {
  const readiness = workflowTaskReadiness(workspace, task);
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: task.status,
    result_superseded: task.resultSuperseded === true,
    brief_chars: localizedChars(task.brief),
    deliverable_chars: localizedChars(task.deliverable),
    result_chars: localizedChars(task.result),
    result_excerpt: {
      zh: previewText(task.result.zh, RESULT_EXCERPT_CHARS),
      en: previewText(task.result.en, RESULT_EXCERPT_CHARS),
    },
    previous_result_chars: task.previousResult
      ? localizedChars(task.previousResult)
      : null,
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

function hitView(hit: SearchHit) {
  return {
    kind: hit.kind,
    id: hit.id,
    universe_id: hit.universeId,
    universe_ids: hit.universeIds ?? [hit.universeId],
    ...(hit.workId ? { work_id: hit.workId } : {}),
    ...(hit.chapterId ? { chapter_id: hit.chapterId } : {}),
    title: hit.title,
    subtitle: hit.subtitle,
    excerpt: hit.excerpt,
    score: hit.score,
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

/** List view: bodies are reported by size; `include_body` returns them. */
function standardListView(standard: WorkspaceStandard) {
  const view = standardView(standard);
  return {
    id: view.id,
    title: view.title,
    kind: view.kind,
    status: view.status,
    version: view.version,
    universe_id: view.universe_id,
    body_chars: localizedChars(standard.body),
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

class ToolError extends Error {
  readonly code: string;
  readonly issues?: readonly string[];

  constructor(code: string, message: string, issues?: readonly string[]) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    if (issues) this.issues = issues;
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
  if (/Workspace is missing or invalid/.test(message))
    return "workspace_unavailable";
  if (/No chapters selected/.test(message)) return "empty_selection";
  return "tool_error";
}

/**
 * Validates arguments inside the tool callback, where a failure becomes a
 * readable `invalid_arguments` result instead of a protocol-level error.
 */
function parseArguments<S extends z.ZodType>(
  tool: string,
  schema: S,
  raw: unknown,
): z.output<S> {
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`);
  throw new ToolError(
    "invalid_arguments",
    `Invalid arguments for ${tool}: ${issues.join("; ") || "validation failed"}`,
    issues,
  );
}

function ok(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function fail(error: unknown): CallToolResult {
  const message = errorMessage(error);
  const code = error instanceof ToolError ? error.code : errorCode(message);
  const issues = error instanceof ToolError ? error.issues : undefined;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            code,
            message,
            ...(issues?.length ? { issues } : {}),
          },
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
  const { total, read, write, export: exportCount } = MCP_TOOL_COUNTS;
  const server = new McpServer(
    { name: "IPloom Studio", version: APP_VERSION },
    {
      instructions:
        `IPloom Studio 本地 IP 记忆库：先列故事世界，再读小说、章节、关系、AI 工作流与项目基础规则；search_ip 支持中英双语子串检索。共 ${total} 个工具：前 ${read} 个只读查询、${write} 个基础规则写入、${exportCount} 个本地导出。列表类工具统一返回分页对象 { total, offset, count, next_offset, truncated, items }，next_offset 为 null 表示已到末页，默认单次结果不超过 50 KB。create_standard 与 update_standard 只修改工作区内的基础规则；export_arcreel_bundle 是唯一写盘导出工具，只能写入工作区同目录的 exports，或服务端启动时用 --export-root 显式允许的目录。\n` +
        `IPloom Studio local IP memory: list story worlds before reading novels, chapters, relationships, AI workflow and foundation standards. ${total} tools: the first ${read} are read-only queries, ${write} write foundation standards, ${exportCount} writes a local export. Every list tool returns a page object { total, offset, count, next_offset, truncated, items }; next_offset === null ends paging, and a default response stays under 50 KB. create_standard and update_standard only change foundation standards inside the workspace; export_arcreel_bundle is the only tool that writes files and may only write inside the exports directory beside workspace.json or a directory enabled with --export-root at server start.`,
    },
  );

  const registered: McpToolName[] = [];
  const register = <S extends z.ZodType>(
    name: McpToolName,
    config: {
      title: string;
      description: string;
      annotations: ToolAnnotations;
    },
    schema: S,
    handler: (args: z.output<S>) => Promise<unknown>,
  ): void => {
    registered.push(name);
    server.registerTool(
      name,
      { ...config, inputSchema: permissive(schema) },
      (args) => run(async () => handler(parseArguments(name, schema, args))),
    );
  };

  register(
    "list_story_worlds",
    {
      title: "故事世界列表 / Story worlds",
      description:
        "分页列出全部故事世界及小说、章节、角色、关系等规模统计；用 next_offset 翻页。List every story world, one page at a time, with compact scale statistics; follow next_offset to page.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({ offset: pageOffsetSchema, limit: pageLimit }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        worlds: pageOf(
          workspace.universes.map((world) => worldView(workspace, world)),
          { offset: args.offset, limit: args.limit },
        ),
      };
    },
  );

  register(
    "get_story_world",
    {
      title: "读取故事世界 / Read story world",
      description:
        "读取一个故事世界的世界观，并分页返回其通用角色、地点、势力、传说、小说与关系；每一类都带 total 与 next_offset。Read one story world and page through its reusable cast, locations, factions, lore, novels and relationships; every collection reports total and next_offset.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema,
      offset: pageOffsetSchema,
      limit: pageLimit,
      include_details: detailSchema,
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      const world = findWorld(workspace, args.world_id);
      const compact = (value: object): Record<string, unknown> =>
        args.include_details
          ? (value as Record<string, unknown>)
          : compactRecord(value);
      let remaining = ITEM_BUDGET_BYTES;
      const take = <T>(
        items: readonly T[],
        view: (item: T) => object,
        collectionsLeft: number,
      ): Page<Record<string, unknown>> => {
        const page = pageOf(items.map((item) => compact(view(item))), {
          offset: args.offset,
          limit: args.limit,
          budget: Math.max(
            1_000,
            Math.floor(remaining / Math.max(1, collectionsLeft)),
          ),
        });
        remaining = Math.max(0, remaining - byteSize(page.items));
        return page;
      };
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        world: worldView(workspace, world),
        novels: take(
          workspace.works.filter((novel) => novel.universeId === world.id),
          novelView,
          6,
        ),
        characters: take(
          workspace.characters.filter((character) =>
            character.universeIds.includes(world.id),
          ),
          characterView,
          5,
        ),
        locations: take(
          workspace.locations.filter(
            (location) => location.universeId === world.id,
          ),
          locationView,
          4,
        ),
        factions: take(
          workspace.factions.filter(
            (faction) => faction.universeId === world.id,
          ),
          factionView,
          3,
        ),
        lore: take(
          workspace.lore.filter((entry) => entry.universeId === world.id),
          loreView,
          2,
        ),
        relationships: take(
          workspace.relationships.filter(
            (relationship) => relationship.universeId === world.id,
          ),
          relationshipView,
          1,
        ),
      };
    },
  );

  register(
    "list_novels",
    {
      title: "小说列表 / Novels",
      description:
        "分页列出小说作品，可按故事世界过滤，并返回章节与字数统计。List novels one page at a time, optionally within one story world, with chapter and word statistics.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema.optional(),
      offset: pageOffsetSchema,
      limit: pageLimit,
    }),
    async (args) => {
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
        novels: pageOf(novels.map((novel) => novelView(novel)), {
          offset: args.offset,
          limit: args.limit,
        }),
      };
    },
  );

  register(
    "get_novel",
    {
      title: "读取小说 / Read novel",
      description:
        "读取小说元数据、分页简介与分页章节计划，不返回整章正文；用 synopsis_offset 与 synopsis_max_chars 续读简介，用 offset 与 next_offset 翻章节。Read novel metadata, a paged synopsis and a paged chapter plan without chapter prose; continue the synopsis with synopsis_offset and synopsis_max_chars, and page chapters with offset and next_offset.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      novel_id: novelIdSchema,
      offset: pageOffsetSchema,
      limit: pageLimit,
      synopsis_offset: pageOffsetSchema,
      synopsis_max_chars: z
        .number()
        .int()
        .min(1)
        .max(SYNOPSIS_MAX_CHARS)
        .default(NOVEL_SYNOPSIS_CHARS)
        .describe(
          `简介单次最多字符数，默认 ${NOVEL_SYNOPSIS_CHARS} / Synopsis window size; default ${NOVEL_SYNOPSIS_CHARS}.`,
        ),
      include_details: detailSchema,
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      const novel = findNovel(workspace, args.novel_id);
      const world = findWorld(workspace, novel.universeId);
      const chapters = novel.chapters
        .slice()
        .sort((left, right) => left.number - right.number);
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        novel: {
          ...novelView(novel),
          synopsis_chars: novel.synopsis.length,
          created_at: novel.createdAt,
        },
        world: {
          id: world.id,
          name: world.name,
          tagline: world.tagline,
        },
        synopsis: textWindow(
          novel.synopsis,
          args.synopsis_offset,
          args.synopsis_max_chars,
        ),
        chapters: pageOf(
          chapters.map((chapter) =>
            args.include_details
              ? chapterPlanView(chapter)
              : chapterListEntry(chapter),
          ),
          {
            offset: args.offset,
            limit: args.limit,
            budget: args.include_details
              ? ITEM_BUDGET_BYTES
              : NOVEL_CHAPTERS_BUDGET_BYTES,
          },
        ),
      };
    },
  );

  register(
    "get_chapter",
    {
      title: "读取章节 / Read chapter",
      description:
        "读取章节正文、大纲、节拍、角色/地点与现有分镜。正文按 offset 与 max_chars 分窗返回，next_offset 为 null 即读完；节拍与分镜分别分页。novel_id 可选，用于消歧。Read chapter prose, outline, beats, cast/location references and existing scenes. Prose is windowed by offset and max_chars; next_offset === null ends the text. Beats and scenes page independently. novel_id is optional and resolves ambiguity.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      chapter_id: chapterIdSchema,
      novel_id: novelIdSchema.optional(),
      offset: pageOffsetSchema,
      max_chars: z
        .number()
        .int()
        .min(1)
        .max(CHAPTER_MAX_TEXT_CHARS)
        .default(CHAPTER_TEXT_CHARS)
        .describe(
          `正文单次最多字符数，默认 ${CHAPTER_TEXT_CHARS} / Prose window size; default ${CHAPTER_TEXT_CHARS}.`,
        ),
      beats_offset: pageOffsetSchema,
      beats_limit: pageLimitSchema(DEFAULT_PAGE_LIMIT, 100),
      scenes_offset: pageOffsetSchema,
      scenes_limit: pageLimitSchema(DEFAULT_PAGE_LIMIT, 100),
      include_scenes: z
        .boolean()
        .default(false)
        .describe("是否返回分镜页 / Whether to include a page of scenes."),
      include_details: z
        .boolean()
        .default(false)
        .describe(
          "返回完整的大纲、摘要与改编备注，而不是预览 / Return the full outline, summary and adaptation notes instead of previews.",
        ),
    }),
    async (args) => {
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
        throw new ToolError(
          "not_found",
          `Chapter not found: ${args.chapter_id}`,
        );
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        novel: {
          id: novel.id,
          world_id: novel.universeId,
          title: novel.title,
          language: novel.language,
        },
        chapter: {
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          title_en: chapter.titleEn,
          status: chapter.status,
          pov: chapter.pov,
          summary: args.include_details
            ? chapter.summary
            : previewText(chapter.summary, SUMMARY_PREVIEW_CHARS),
          summary_chars: chapter.summary.length,
          outline: args.include_details
            ? chapter.outline
            : previewText(chapter.outline, OUTLINE_PREVIEW_CHARS),
          outline_chars: chapter.outline.length,
          adaptation_notes: args.include_details
            ? chapter.adaptationNotes
            : previewText(chapter.adaptationNotes, NOTES_PREVIEW_CHARS),
          adaptation_notes_chars: chapter.adaptationNotes.length,
          character_ids: chapter.characterIds,
          location_id: chapter.locationId ?? null,
          revision: chapter.revision,
          created_at: chapter.createdAt,
          updated_at: chapter.updatedAt,
          ...chapterCounts(chapter),
          content: textWindow(chapter.content, args.offset, args.max_chars),
          beats: pageOf(chapter.beats, {
            offset: args.beats_offset,
            limit: args.beats_limit,
            budget: BEATS_BUDGET_BYTES,
          }),
          scenes: args.include_scenes
            ? pageOf(
                chapter.scenes.map((scene) => compactRecord(sceneView(scene))),
                {
                  offset: args.scenes_offset,
                  limit: args.scenes_limit,
                  budget: SCENES_BUDGET_BYTES,
                },
              )
            : null,
        },
      };
    },
  );

  register(
    "search_ip",
    {
      title: "检索 IP / Search IP",
      description:
        "跨故事世界、小说、章节、角色、地点、物件、势力、传说与故事时间线做中英子串检索；world_id 与 kind 在排序前过滤，分页用 offset 与 next_offset。Search the whole IP library, including props and story timeline events, with Chinese/English substring matching; world_id and kind filter before ranking, and offset/next_offset page the hits.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
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
      offset: pageOffsetSchema,
      limit: pageLimit,
      locale: localeSchema,
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      if (args.world_id) findWorld(workspace, args.world_id);
      const locale: UiLocale = args.locale ?? workspace.settings.locale;
      // Scope filters run inside the search, before ranking, so an out-of-scope
      // hit can never push an in-scope one past the caller's window.
      const results = searchWorkspace(workspace, args.query, locale, {
        limit: Number.MAX_SAFE_INTEGER,
        universeId: args.world_id,
        kind: args.kind,
      });
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        query: args.query,
        locale,
        world_id: args.world_id ?? null,
        kind: args.kind ?? null,
        hits: pageOf(results.hits.map((hit) => hitView(hit)), {
          offset: args.offset,
          limit: args.limit,
          budget: ITEM_BUDGET_BYTES - 2_000,
        }),
      };
    },
  );

  register(
    "get_relationship_graph",
    {
      title: "关系图 / Relationship graph",
      description:
        "分页读取故事世界的角色关系图节点、边、角色度数与一致性警告。Read the cast relationship graph with paged nodes and edges, degrees and consistency warnings.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema,
      locale: localeSchema,
      offset: pageOffsetSchema,
      limit: pageLimit,
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      const world = findWorld(workspace, args.world_id);
      const locale: UiLocale = args.locale ?? workspace.settings.locale;
      const graph = buildRelationshipGraph(workspace, world.id, locale);
      const nodes = pageOf(graph.nodes, {
        offset: args.offset,
        limit: args.limit,
        budget: Math.floor(ITEM_BUDGET_BYTES * 0.45),
      });
      const edges = pageOf(graph.edges, {
        offset: args.offset,
        limit: args.limit,
        budget: Math.max(2_000, ITEM_BUDGET_BYTES - byteSize(nodes.items)),
      });
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        world_id: world.id,
        locale,
        warnings: graph.warnings,
        nodes,
        edges,
      };
    },
  );

  register(
    "list_workflow_tasks",
    {
      title: "AI 工作流任务 / Workflow tasks",
      description:
        "分页列出有依赖与独立启动状态的创作任务，可按世界、小说和状态过滤；默认返回精简视图，include_details 返回完整简报与结果。List authoring tasks with dependency readiness, optionally filtered by world, novel and status; the default view is compact, while include_details returns full briefs and results.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema.optional(),
      novel_id: novelIdSchema.optional(),
      status: z
        .enum(["queued", "active", "review", "done"])
        .optional()
        .describe("任务状态 / Task status."),
      offset: pageOffsetSchema,
      limit: pageLimit,
      include_details: detailSchema,
    }),
    async (args) => {
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
        summary: workflowSummary(workspace),
        tasks: pageOf(
          tasks.map((task) =>
            args.include_details
              ? workflowTaskView(workspace, task)
              : workflowTaskSummaryView(workspace, task),
          ),
          { offset: args.offset, limit: args.limit },
        ),
      };
    },
  );

  register(
    "get_workflow_brief",
    {
      title: "AI 任务简报 / Workflow brief",
      description:
        "生成一份确定性的 Markdown 简报，只包含该任务相关的世界、小说、章节、人物、关系与依赖；简报按 offset 与 max_chars 分窗返回。Build a deterministic Markdown brief scoped to one task, including only related world, novel, chapter, cast, relationships and dependencies; the brief is windowed by offset and max_chars.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      task_id: workflowTaskIdSchema,
      locale: localeSchema,
      offset: pageOffsetSchema,
      max_chars: z
        .number()
        .int()
        .min(1)
        .max(BRIEF_MAX_CHARS)
        .default(BRIEF_CHARS)
        .describe(
          `简报单次最多字符数，默认 ${BRIEF_CHARS} / Brief window size; default ${BRIEF_CHARS}.`,
        ),
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      const task = workspace.workflowTasks.find(
        (item) => item.id === args.task_id,
      );
      if (!task)
        throw new ToolError(
          "not_found",
          `Unknown workflow task: ${args.task_id}`,
        );
      const locale: UiLocale = args.locale ?? workspace.settings.locale;
      const readiness = workflowTaskReadiness(workspace, task);
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        task: workflowTaskSummaryView(workspace, task),
        ready: readiness.ready,
        markdown: textWindow(
          buildWorkflowBrief(workspace, task.id, locale),
          args.offset,
          args.max_chars,
        ),
      };
    },
  );

  register(
    "list_standards",
    {
      title: "基础规则列表 / Foundation standards",
      description:
        "分页列出项目基础规则，可按状态、类型和故事世界过滤；active_applied 是当前范围内实际生效的规则数，规则正文用 include_body 取回。List project foundation standards, optionally filtered by status, kind and story world; active_applied reports how many active standards apply to that scope, and include_body returns the rule text.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
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
      offset: pageOffsetSchema,
      limit: pageLimit,
      include_body: z
        .boolean()
        .default(false)
        .describe(
          "返回规则正文，而不是只返回字數 / Return the rule text instead of only its size.",
        ),
    }),
    async (args) => {
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
        workspace: workspaceMeta(loaded),
        active_applied: applicableStandards(workspace, args.universe_id).length,
        standards: pageOf(
          standards.map((standard) =>
            args.include_body
              ? standardView(standard)
              : standardListView(standard),
          ),
          { offset: args.offset, limit: args.limit },
        ),
      };
    },
  );

  register(
    "get_standard",
    {
      title: "读取基础规则 / Read foundation standard",
      description:
        "读取一条基础规则，返回分窗的规则正文、适用范围与引用它的 AI 工作流任务；用 body_offset 与 next_offset 续读。Read one foundation standard with its scope and the workflow tasks that pin it by id; the rule text is windowed, continue it with body_offset and next_offset.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      standard_id: standardIdSchema,
      body_offset: pageOffsetSchema,
      body_max_chars: z
        .number()
        .int()
        .min(1)
        .max(SYNOPSIS_MAX_CHARS)
        .default(STANDARD_BODY_CHARS)
        .describe(
          `每种语言的正文单次最多字符数，默认 ${STANDARD_BODY_CHARS} / Text window per language; default ${STANDARD_BODY_CHARS}.`,
        ),
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      const standard = findStandard(workspace, args.standard_id);
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        standard: {
          ...standardView(standard),
          body: {
            zh: textWindow(standard.body.zh, args.body_offset, args.body_max_chars),
            en: textWindow(standard.body.en, args.body_offset, args.body_max_chars),
          },
        },
        applies_to: standard.universeId ?? "project",
        pinned_by_task_ids: workspace.workflowTasks
          .filter((task) => task.standardRefs.some((ref) => ref.id === standard.id))
          .map((task) => task.id),
      };
    },
  );

  register(
    "create_standard",
    {
      title: "新建基础规则 / Create foundation standard",
      description:
        "登记一条项目基础规则，默认保存为草稿；标题和正文至少一种语言必须非空，且故事世界必须已存在。Register a project foundation standard, saved as a draft by default; title and body need at least one non-empty language and any story world must already exist.",
      annotations: STANDARD_WRITE_ANNOTATIONS,
    },
    z.object({
      kind: standardWriteKindSchema,
      title: standardTitleSchema,
      body: standardBodySchema,
      status: standardWriteStatusSchema
        .optional()
        .describe("省略时保存为草稿 / Defaults to draft."),
      universe_id: standardScopeSchema,
    }),
    async (args) => {
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
        if (standard.universeId) ensureUniverse(current, standard.universeId);
        current.standards.push(standard);
        current.updatedAt = now;
      });
      return {
        schema: MCP_SCHEMA,
        revision: workspace.revision,
        standard: standardView(standard),
      };
    },
  );

  register(
    "update_standard",
    {
      title: "更新基础规则 / Update foundation standard",
      description:
        "更新一条基础规则；标题、正文、类型或适用范围变化时版本号加一，仅修改状态不改版本。Update a foundation standard; title, body, kind or scope changes bump the version, while a status-only change does not.",
      annotations: STANDARD_WRITE_ANNOTATIONS,
    },
    z.object({
      standard_id: standardIdSchema,
      title: standardTitleSchema.optional(),
      body: standardBodySchema.optional(),
      kind: standardWriteKindSchema.optional(),
      status: standardWriteStatusSchema.optional(),
      universe_id: standardScopeSchema,
    }),
    async (args) => {
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
    },
  );

  register(
    "export_arcreel_bundle",
    {
      title: "导出 ArcReel 包 / Export ArcReel bundle",
      description:
        "构建并写入 ArcReel/3D 漫剧交接包。output_dir 必须位于工作区 exports 目录或服务端启动时用 --export-root 显式允许的目录内；省略时写入工作区同目录 exports。返回完整的写入报告。Build and write an ArcReel / stylized 3D comic-drama handoff. output_dir must stay inside the workspace exports directory or a directory enabled with --export-root at server start; the default is exports beside workspace.json. Returns the full write report.",
      annotations: EXPORT_ANNOTATIONS,
    },
    z.object({
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
    async (args) => {
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
    },
  );

  // The registry in mcp-tools.ts drives the settings copy, so a drifted
  // registration order or a missing/extra tool must fail loudly at startup.
  if (
    registered.length !== MCP_TOOL_NAMES.length ||
    registered.some((name, index) => name !== MCP_TOOL_NAMES[index])
  ) {
    throw new Error(
      `MCP tool registry mismatch: registered ${registered.join(", ")}; expected ${MCP_TOOL_NAMES.join(", ")}.`,
    );
  }

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
