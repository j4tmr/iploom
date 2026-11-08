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
import { standardSchema, timelineEventSchema } from "../src/core/schemas.ts";
import { searchWorkspace } from "../src/core/search.ts";
import { applicableStandards, STANDARD_KINDS } from "../src/core/standards.ts";
import {
  sortTimelineEvents,
  timelineAnchorLabel,
  timelineSubjectLabel,
} from "../src/core/timeline.ts";
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
  TimelineEvent,
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
/** Chapter previews and file paths echoed by an export report. */
const EXPORT_PREVIEW_ITEMS = 50;
/** Export warnings echoed before the rest are only counted. */
const EXPORT_WARNING_ITEMS = 20;
/** Unfinished dependencies listed per workflow task; the rest are counted. */
const BLOCKER_PREVIEW_ITEMS = 10;

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
const WORKSPACE_WRITE_ANNOTATIONS: ToolAnnotations = {
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
  const offset = Math.min(total, Math.max(0, Math.trunc(options.offset ?? 0)));
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

/**
 * Budget left for a paged collection once the fixed fields of a response are
 * accounted for. It never drops below 1 KB: an unusually large fixed payload
 * shrinks the page but can never stall paging.
 */
function remainingBudget(...fixed: readonly unknown[]): number {
  const used = fixed.reduce<number>(
    (total, value) => total + byteSize(value),
    0,
  );
  return Math.max(1_000, ITEM_BUDGET_BYTES - used);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Slices without ever splitting a surrogate pair at the end of the window. */
function clipEnd(value: string, start: number, maxChars: number): string {
  let end = Math.min(value.length, start + Math.max(1, maxChars));
  if (
    end < value.length &&
    isHighSurrogate(value.charCodeAt(end - 1)) &&
    isLowSurrogate(value.charCodeAt(end))
  ) {
    // Take the low surrogate too: the window is one code unit longer than
    // asked rather than returning half a pair that no client can decode.
    end += 1;
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
  let start = Math.min(total, Math.max(0, Math.trunc(offset)));
  if (
    start > 0 &&
    start < total &&
    isLowSurrogate(value.charCodeAt(start)) &&
    isHighSurrogate(value.charCodeAt(start - 1))
  ) {
    // A caller-supplied offset can land between the halves of a pair; start
    // one code unit earlier so the window never opens with a lone surrogate.
    start -= 1;
  }
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
    return `${clipEnd(value, 0, COMPACT_STRING_CHARS)}…`;
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
  .enum(["style", "format", "naming", "numeric", "entity-prompt", "continuity"])
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
    zh: z
      .string()
      .max(20_000)
      .default("")
      .describe("中文规则正文 / Chinese body."),
    en: z
      .string()
      .max(20_000)
      .default("")
      .describe("英文规则正文 / English body."),
  })
  .strict()
  .describe("双语规则正文 / Localized standard body.");
/**
 * Update patches have no per-language defaults: an omitted language keeps the
 * stored text, so revising one language can never erase the other. An explicit
 * empty string still clears that language.
 */
const standardTitlePatchSchema = z
  .object({
    zh: z.string().max(500).optional().describe("中文标题 / Chinese title."),
    en: z.string().max(500).optional().describe("英文标题 / English title."),
  })
  .strict()
  .describe(
    "双语标题补丁；省略的语言保持原值 / Localized title patch; omitted languages keep their value.",
  );
const standardBodyPatchSchema = z
  .object({
    zh: z
      .string()
      .max(20_000)
      .optional()
      .describe("中文规则正文 / Chinese body."),
    en: z
      .string()
      .max(20_000)
      .optional()
      .describe("英文规则正文 / English body."),
  })
  .strict()
  .describe(
    "双语正文补丁；省略的语言保持原值 / Localized body patch; omitted languages keep their value.",
  );

const pageOffsetSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("分页起点（从 0 开始）/ Zero-based item offset.");

const timelineSubjectKindSchema = z
  .enum(["character", "scene", "location", "object"])
  .describe("事件主体类型 / Timeline subject kind.");
const timelineEventKindSchema = z
  .enum([
    "introduction",
    "state-change",
    "transfer",
    "reveal",
    "loss",
    "recovery",
    "other",
  ])
  .describe("事件类型 / Timeline event kind.");
const timelineCanonStatusSchema = z
  .enum(["proposed", "canon"])
  .describe(
    "正典状态；proposed 为待作者确认的提案，canon 为已确认事实 / Canon status; proposed awaits author confirmation, canon is confirmed.",
  );
const timelineEventIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("时间线事件 ID / Story timeline event ID.");
const timelineSubjectIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("事件主体 ID / Timeline subject ID.");
const timelineTitleSchema = z
  .object({
    zh: z.string().max(500).default("").describe("中文标题 / Chinese title."),
    en: z.string().max(500).default("").describe("英文标题 / English title."),
  })
  .strict()
  .describe(
    "双语事件标题，至少一种语言非空 / Localized event title; at least one language must be non-empty.",
  );
const timelineTitlePatchSchema = z
  .object({
    zh: z.string().max(500).optional().describe("中文标题 / Chinese title."),
    en: z.string().max(500).optional().describe("英文标题 / English title."),
  })
  .strict()
  .describe(
    "双语标题补丁；省略的语言保持原值 / Localized title patch; omitted languages keep their value.",
  );
const timelineStoryTimeSchema = z
  .string()
  .max(500)
  .describe(
    "故事内时间标签；无章节时必须非空 / In-story time label; must be non-empty when no chapter is given.",
  );
const timelineOrderSchema = z
  .number()
  .int()
  .min(0)
  .describe("同一故事时间内的排序序号 / Order within the same story time.");
const timelineRelatedIdsSchema = z
  .array(z.string().trim().min(1))
  .max(100)
  .describe("关联 ID 列表 / Related IDs.");
const timelineSceneIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe(
    "场景 ID；给出时必须同时给出章节 / Scene ID; requires a chapter when present.",
  );
const timelineChapterPatchSchema = z
  .union([z.string().trim().min(1), z.null()])
  .optional()
  .describe(
    "新章节 ID；传 null 清除章节并同时清除场景；省略时保持原值 / New chapter ID; pass null to clear it along with any scene; omit to keep the stored chapter.",
  );
const timelineScenePatchSchema = z
  .union([z.string().trim().min(1), z.null()])
  .optional()
  .describe(
    "新场景 ID；传 null 清除场景；省略时保持原值 / New scene ID; pass null to clear it; omit to keep the stored scene.",
  );

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
  if (!world)
    throw new ToolError("not_found", `Unknown story world: ${worldId}`);
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
    genres: world.genres.slice(0, COMPACT_ARRAY_ITEMS),
    genre_count: world.genres.length,
    themes: world.themes.slice(0, COMPACT_ARRAY_ITEMS),
    theme_count: world.themes.length,
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
    themes: novel.themes.slice(0, COMPACT_ARRAY_ITEMS),
    theme_count: novel.themes.length,
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
    character_ids: chapter.characterIds.slice(0, COMPACT_ARRAY_ITEMS),
    character_id_count: chapter.characterIds.length,
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
    character_ids: chapter.characterIds.slice(0, COMPACT_ARRAY_ITEMS),
    character_id_count: chapter.characterIds.length,
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

/**
 * One timeline event as MCP clients read it. The default list view is run
 * through `compactRecord`, which clips the long state, evidence and prompt
 * fields and names them in `truncated_fields`; `include_details` returns the
 * record untouched.
 */
function timelineEventView(
  workspace: StudioWorkspace,
  event: TimelineEvent,
  locale: UiLocale,
) {
  return {
    id: event.id,
    world_id: event.universeId,
    novel_id: event.workId,
    chapter_id: event.chapterId ?? null,
    scene_id: event.sceneId ?? null,
    story_time: event.storyTime,
    order: event.order,
    anchor: timelineAnchorLabel(workspace, event, locale),
    subject: {
      kind: event.subjectKind,
      id: event.subjectId,
      label: timelineSubjectLabel(workspace, event, locale),
    },
    event_kind: event.eventKind,
    title: event.title,
    canon_status: event.canonStatus,
    state_before: event.stateBefore,
    state_after: event.stateAfter,
    related_character_ids: event.relatedCharacterIds.slice(
      0,
      COMPACT_ARRAY_ITEMS,
    ),
    related_character_id_count: event.relatedCharacterIds.length,
    related_location_ids: event.relatedLocationIds.slice(
      0,
      COMPACT_ARRAY_ITEMS,
    ),
    related_location_id_count: event.relatedLocationIds.length,
    related_object_ids: event.relatedObjectIds.slice(0, COMPACT_ARRAY_ITEMS),
    related_object_id_count: event.relatedObjectIds.length,
    evidence: event.evidence,
    production_prompt: event.productionPrompt,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
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

/** One unfinished dependency, with its title clipped to a readable preview. */
function workflowBlockerView(task: WorkflowTask) {
  return {
    id: task.id,
    title: {
      zh: previewText(task.title.zh, COMPACT_STRING_CHARS),
      en: previewText(task.title.en, COMPACT_STRING_CHARS),
    },
    status: task.status,
  };
}

function workflowTaskView(workspace: StudioWorkspace, task: WorkflowTask) {
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
    blockers: readiness.blockers
      .slice(0, BLOCKER_PREVIEW_ITEMS)
      .map(workflowBlockerView),
    blocker_count: readiness.blockers.length,
    world_id: task.universeId ?? null,
    novel_id: task.workId ?? null,
    chapter_id: task.chapterId ?? null,
    parent_id: task.parentId ?? null,
    character_ids: task.characterIds.slice(0, COMPACT_ARRAY_ITEMS),
    character_id_count: task.characterIds.length,
    depends_on_ids: task.dependsOnIds.slice(0, COMPACT_ARRAY_ITEMS),
    depends_on_id_count: task.dependsOnIds.length,
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
    blockers: readiness.blockers
      .slice(0, BLOCKER_PREVIEW_ITEMS)
      .map(workflowBlockerView),
    blocker_count: readiness.blockers.length,
    world_id: task.universeId ?? null,
    novel_id: task.workId ?? null,
    chapter_id: task.chapterId ?? null,
    parent_id: task.parentId ?? null,
    character_ids: task.characterIds.slice(0, COMPACT_ARRAY_ITEMS),
    character_id_count: task.characterIds.length,
    depends_on_ids: task.dependsOnIds.slice(0, COMPACT_ARRAY_ITEMS),
    depends_on_id_count: task.dependsOnIds.length,
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
      .map(
        (issue) => `${issue.path.join(".") || "standard"}: ${issue.message}`,
      );
    return new ToolError(
      "invalid_arguments",
      `Invalid foundation standard: ${issues.join("; ") || "validation failed"}`,
      issues,
    );
  }
  return new ToolError("invalid_arguments", errorMessage(error));
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

function invalidTimelineEvent(error: unknown): ToolError {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "event"}: ${issue.message}`);
    return new ToolError(
      "invalid_arguments",
      `Invalid story timeline event: ${issues.join("; ") || "validation failed"}`,
      issues,
    );
  }
  return new ToolError("invalid_arguments", errorMessage(error));
}

function parseTimelineEvent(value: unknown): TimelineEvent {
  try {
    return timelineEventSchema.parse(value) as TimelineEvent;
  } catch (error) {
    throw invalidTimelineEvent(error);
  }
}

/**
 * Checks that a timeline event's references resolve inside the workspace, the
 * same rules `validateWorkspace` applies on save. Running them inside the
 * update mutator turns an invalid reference into a readable tool error instead
 * of a workspace validation failure with no field context.
 */
function assertTimelineReferences(
  workspace: StudioWorkspace,
  event: TimelineEvent,
): void {
  findWorld(workspace, event.universeId);
  const novel = findNovel(workspace, event.workId);
  if (novel.universeId !== event.universeId)
    throw new ToolError(
      "invalid_arguments",
      `Novel ${event.workId} belongs to story world ${novel.universeId}, not ${event.universeId}.`,
    );
  let chapter: Chapter | undefined;
  if (event.chapterId) {
    chapter = novel.chapters.find((item) => item.id === event.chapterId);
    if (!chapter)
      throw new ToolError(
        "not_found",
        `Chapter not found in novel ${event.workId}: ${event.chapterId}`,
      );
  }
  if (event.sceneId) {
    if (!chapter)
      throw new ToolError(
        "invalid_arguments",
        "A timeline event with a scene must also name its chapter.",
      );
    if (!chapter.scenes.some((scene) => scene.id === event.sceneId))
      throw new ToolError(
        "not_found",
        `Scene not found in chapter ${chapter.id}: ${event.sceneId}`,
      );
  }
  if (event.subjectKind === "character") {
    const character = workspace.characters.find(
      (item) => item.id === event.subjectId,
    );
    if (!character)
      throw new ToolError("not_found", `Unknown character: ${event.subjectId}`);
    if (!character.universeIds.includes(event.universeId))
      throw new ToolError(
        "invalid_arguments",
        `Character ${event.subjectId} does not belong to story world ${event.universeId}.`,
      );
  } else if (event.subjectKind === "location") {
    const location = workspace.locations.find(
      (item) => item.id === event.subjectId,
    );
    if (!location)
      throw new ToolError("not_found", `Unknown location: ${event.subjectId}`);
    if (location.universeId !== event.universeId)
      throw new ToolError(
        "invalid_arguments",
        `Location ${event.subjectId} belongs to another story world.`,
      );
  } else if (event.subjectKind === "object") {
    const object = workspace.storyObjects.find(
      (item) => item.id === event.subjectId,
    );
    if (!object)
      throw new ToolError(
        "not_found",
        `Unknown story object: ${event.subjectId}`,
      );
    if (object.universeId !== event.universeId)
      throw new ToolError(
        "invalid_arguments",
        `Story object ${event.subjectId} belongs to another story world.`,
      );
  } else {
    if (!chapter)
      throw new ToolError(
        "invalid_arguments",
        "A scene subject requires the event's chapter.",
      );
    if (!chapter.scenes.some((scene) => scene.id === event.subjectId))
      throw new ToolError(
        "not_found",
        `Scene not found in chapter ${chapter.id}: ${event.subjectId}`,
      );
  }
  for (const characterId of event.relatedCharacterIds) {
    const character = workspace.characters.find(
      (item) => item.id === characterId,
    );
    if (!character)
      throw new ToolError("not_found", `Unknown character: ${characterId}`);
    if (!character.universeIds.includes(event.universeId))
      throw new ToolError(
        "invalid_arguments",
        `Related character ${characterId} does not belong to story world ${event.universeId}.`,
      );
  }
  for (const locationId of event.relatedLocationIds) {
    const location = workspace.locations.find((item) => item.id === locationId);
    if (!location)
      throw new ToolError("not_found", `Unknown location: ${locationId}`);
    if (location.universeId !== event.universeId)
      throw new ToolError(
        "invalid_arguments",
        `Related location ${locationId} belongs to another story world.`,
      );
  }
  for (const objectId of event.relatedObjectIds) {
    const object = workspace.storyObjects.find((item) => item.id === objectId);
    if (!object)
      throw new ToolError("not_found", `Unknown story object: ${objectId}`);
    if (object.universeId !== event.universeId)
      throw new ToolError(
        "invalid_arguments",
        `Related story object ${objectId} belongs to another story world.`,
      );
  }
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
        if (isWithin(await realPathWithExistingAncestor(root), realCandidate)) {
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
        `IPloom Studio 本地 IP 记忆库：先列故事世界，再读小说、章节、关系、AI 工作流与项目基础规则；search_ip 支持中英双语子串检索。共 ${total} 个工具：前 ${read} 个只读查询、${write} 个工作区写入、${exportCount} 个本地导出。列表类工具统一返回分页对象 { total, offset, count, next_offset, truncated, items }，next_offset 为 null 表示已到末页，默认单次结果不超过 50 KB。create_standard 与 update_standard 修改基础规则；create_timeline_event 与 update_timeline_event 新建或修订故事时间线事件，canon_status 默认为 proposed，只有显式传 canon 才标记为正典；export_arcreel_bundle 是唯一写盘导出工具，只能写入工作区同目录的 exports，或服务端启动时用 --export-root 显式允许的目录。\n` +
        `IPloom Studio local IP memory: list story worlds before reading novels, chapters, relationships, AI workflow and foundation standards. ${total} tools: the first ${read} are read-only queries, ${write} write workspace records, ${exportCount} writes a local export. Every list tool returns a page object { total, offset, count, next_offset, truncated, items }; next_offset === null ends paging, and a default response stays under 50 KB. create_standard and update_standard change foundation standards; create_timeline_event and update_timeline_event create or revise story timeline events, with canon_status defaulting to proposed unless canon is explicit; export_arcreel_bundle is the only tool that writes files and may only write inside the exports directory beside workspace.json or a directory enabled with --export-root at server start.`,
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
      const meta = workspaceMeta(loaded);
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        worlds: pageOf(
          workspace.universes.map((world) => worldView(workspace, world)),
          {
            offset: args.offset,
            limit: args.limit,
            budget: remainingBudget(meta),
          },
        ),
      };
    },
  );

  register(
    "get_story_world",
    {
      title: "读取故事世界 / Read story world",
      description:
        "读取一个故事世界的世界观，并分页返回其通用角色、地点、势力、传说、小说与关系；每一类都带 total 与 next_offset，且各自使用 offsets 中对应的分页起点。Read one story world and page through its reusable cast, locations, factions, lore, novels and relationships; every collection reports total and next_offset and uses its own offset from offsets.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema,
      offsets: z
        .object({
          novels: pageOffsetSchema,
          characters: pageOffsetSchema,
          locations: pageOffsetSchema,
          factions: pageOffsetSchema,
          lore: pageOffsetSchema,
          relationships: pageOffsetSchema,
        })
        .strict()
        .default({
          novels: 0,
          characters: 0,
          locations: 0,
          factions: 0,
          lore: 0,
          relationships: 0,
        })
        .describe(
          "各集合独立的分页起点；把每个集合自己的 next_offset 传回来 / Independent zero-based offset per collection; pass each collection's own next_offset back in.",
        ),
      limit: pageLimit,
      include_details: detailSchema,
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      const world = findWorld(workspace, args.world_id);
      const meta = workspaceMeta(loaded);
      const worldPayload = worldView(workspace, world);
      const compact = (value: object): Record<string, unknown> =>
        args.include_details
          ? (value as Record<string, unknown>)
          : compactRecord(value);
      let remaining = remainingBudget(meta, worldPayload);
      const take = <T>(
        items: readonly T[],
        view: (item: T) => object,
        offset: number,
        collectionsLeft: number,
      ): Page<Record<string, unknown>> => {
        const page = pageOf(
          items.map((item) => compact(view(item))),
          {
            offset,
            limit: args.limit,
            budget: Math.max(
              1_000,
              Math.floor(remaining / Math.max(1, collectionsLeft)),
            ),
          },
        );
        remaining = Math.max(0, remaining - byteSize(page.items));
        return page;
      };
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        world: worldPayload,
        novels: take(
          workspace.works.filter((novel) => novel.universeId === world.id),
          novelView,
          args.offsets.novels,
          6,
        ),
        characters: take(
          workspace.characters.filter((character) =>
            character.universeIds.includes(world.id),
          ),
          characterView,
          args.offsets.characters,
          5,
        ),
        locations: take(
          workspace.locations.filter(
            (location) => location.universeId === world.id,
          ),
          locationView,
          args.offsets.locations,
          4,
        ),
        factions: take(
          workspace.factions.filter(
            (faction) => faction.universeId === world.id,
          ),
          factionView,
          args.offsets.factions,
          3,
        ),
        lore: take(
          workspace.lore.filter((entry) => entry.universeId === world.id),
          loreView,
          args.offsets.lore,
          2,
        ),
        relationships: take(
          workspace.relationships.filter(
            (relationship) => relationship.universeId === world.id,
          ),
          relationshipView,
          args.offsets.relationships,
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
      const meta = workspaceMeta(loaded);
      const filters = { world_id: args.world_id ?? null };
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        world_id: args.world_id ?? null,
        novels: pageOf(
          novels.map((novel) => novelView(novel)),
          {
            offset: args.offset,
            limit: args.limit,
            budget: remainingBudget(meta, filters),
          },
        ),
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
      const meta = workspaceMeta(loaded);
      const novelPayload = {
        ...novelView(novel),
        synopsis_chars: novel.synopsis.length,
        created_at: novel.createdAt,
      };
      const worldHeader = {
        id: world.id,
        name: world.name,
        tagline: world.tagline,
      };
      const synopsis = textWindow(
        novel.synopsis,
        args.synopsis_offset,
        args.synopsis_max_chars,
      );
      const chapterBudget = remainingBudget(
        meta,
        novelPayload,
        worldHeader,
        synopsis,
      );
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        novel: novelPayload,
        world: worldHeader,
        synopsis,
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
              ? chapterBudget
              : Math.min(NOVEL_CHAPTERS_BUDGET_BYTES, chapterBudget),
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
      const meta = workspaceMeta(loaded);
      const novelHeader = {
        id: novel.id,
        world_id: novel.universeId,
        title: novel.title,
        language: novel.language,
      };
      const chapterPayload = {
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
        character_ids: chapter.characterIds.slice(0, COMPACT_ARRAY_ITEMS),
        character_id_count: chapter.characterIds.length,
        location_id: chapter.locationId ?? null,
        revision: chapter.revision,
        created_at: chapter.createdAt,
        updated_at: chapter.updatedAt,
        ...chapterCounts(chapter),
        content: textWindow(chapter.content, args.offset, args.max_chars),
      };
      const budget = remainingBudget(meta, novelHeader, chapterPayload);
      const beats = pageOf(chapter.beats, {
        offset: args.beats_offset,
        limit: args.beats_limit,
        budget: args.include_scenes
          ? Math.max(1_000, Math.floor(budget / 2))
          : budget,
      });
      const scenes = args.include_scenes
        ? pageOf(
            chapter.scenes.map((scene) => compactRecord(sceneView(scene))),
            {
              offset: args.scenes_offset,
              limit: args.scenes_limit,
              budget: Math.max(1_000, budget - byteSize(beats.items)),
            },
          )
        : null;
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        novel: novelHeader,
        chapter: { ...chapterPayload, beats, scenes },
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
      const meta = workspaceMeta(loaded);
      const echo = {
        query: args.query,
        locale,
        world_id: args.world_id ?? null,
        kind: args.kind ?? null,
      };
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        ...echo,
        hits: pageOf(
          results.hits.map((hit) => hitView(hit)),
          {
            offset: args.offset,
            limit: args.limit,
            budget: remainingBudget(meta, echo),
          },
        ),
      };
    },
  );

  register(
    "get_relationship_graph",
    {
      title: "关系图 / Relationship graph",
      description:
        "分页读取故事世界的角色关系图节点、边、角色度数与一致性警告；节点与边各自使用 nodes_offset 与 edges_offset 翻页。Read the cast relationship graph with paged nodes and edges, degrees and consistency warnings; nodes and edges page independently with nodes_offset and edges_offset.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema,
      locale: localeSchema,
      nodes_offset: pageOffsetSchema,
      edges_offset: pageOffsetSchema,
      limit: pageLimit,
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      const world = findWorld(workspace, args.world_id);
      const locale: UiLocale = args.locale ?? workspace.settings.locale;
      const graph = buildRelationshipGraph(workspace, world.id, locale);
      const meta = workspaceMeta(loaded);
      const available = remainingBudget(meta);
      const nodes = pageOf(graph.nodes, {
        offset: args.nodes_offset,
        limit: args.limit,
        budget: Math.floor(available * 0.45),
      });
      const edges = pageOf(
        graph.edges.map((edge) => compactRecord(edge)),
        {
          offset: args.edges_offset,
          limit: args.limit,
          budget: Math.max(1_000, available - byteSize(nodes.items)),
        },
      );
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        world_id: world.id,
        locale,
        warnings: graph.warnings.slice(0, COMPACT_ARRAY_ITEMS),
        warning_count: graph.warnings.length,
        nodes,
        edges,
      };
    },
  );

  register(
    "list_timeline_events",
    {
      title: "故事时间线 / Story timeline",
      description:
        "按章节号、故事时间与顺序稳定排序，分页列出故事时间线事件；可按世界、小说、章节、主体类型/ID 与 canon 状态过滤，默认返回精简视图，include_details 返回完整状态、依据与制作提示。List story timeline events in deterministic chapter/story-time/order order, optionally filtered by world, novel, chapter, subject kind/id and canon status; the default view is compact, while include_details returns full states, evidence and production prompts.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema.optional(),
      novel_id: novelIdSchema.optional(),
      chapter_id: chapterIdSchema.optional(),
      subject_kind: z
        .enum(["character", "scene", "location", "object"])
        .optional()
        .describe("事件主体类型 / Timeline subject kind."),
      subject_id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("事件主体 ID / Timeline subject ID."),
      canon_status: z
        .enum(["proposed", "canon"])
        .optional()
        .describe("设定状态 / Canon status."),
      offset: pageOffsetSchema,
      limit: pageLimit,
      include_details: detailSchema,
      locale: localeSchema,
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      if (args.world_id) findWorld(workspace, args.world_id);
      if (args.novel_id) findNovel(workspace, args.novel_id);
      if (args.chapter_id) {
        const known = workspace.works.some((work) =>
          work.chapters.some((chapter) => chapter.id === args.chapter_id),
        );
        if (!known)
          throw new ToolError(
            "not_found",
            `Chapter not found: ${args.chapter_id}`,
          );
      }
      const locale: UiLocale = args.locale ?? workspace.settings.locale;
      // The shared sorter keeps list order identical to the app's timeline
      // view, so paging is stable while the workspace revision is unchanged.
      const events = sortTimelineEvents(
        workspace,
        workspace.timelineEvents.filter(
          (event) =>
            (!args.world_id || event.universeId === args.world_id) &&
            (!args.novel_id || event.workId === args.novel_id) &&
            (!args.chapter_id || event.chapterId === args.chapter_id) &&
            (!args.subject_kind || event.subjectKind === args.subject_kind) &&
            (!args.subject_id || event.subjectId === args.subject_id) &&
            (!args.canon_status || event.canonStatus === args.canon_status),
        ),
      );
      const meta = workspaceMeta(loaded);
      const filters = {
        world_id: args.world_id ?? null,
        novel_id: args.novel_id ?? null,
        chapter_id: args.chapter_id ?? null,
        subject_kind: args.subject_kind ?? null,
        subject_id: args.subject_id ?? null,
        canon_status: args.canon_status ?? null,
      };
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        locale,
        filters,
        events: pageOf(
          events.map((event) => {
            const view = timelineEventView(workspace, event, locale);
            return args.include_details ? view : compactRecord(view);
          }),
          {
            offset: args.offset,
            limit: args.limit,
            budget: remainingBudget(meta, filters),
          },
        ),
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
      const meta = workspaceMeta(loaded);
      const filters = {
        world_id: args.world_id ?? null,
        novel_id: args.novel_id ?? null,
        status: args.status ?? null,
      };
      const summary = workflowSummary(workspace);
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        filters,
        summary,
        tasks: pageOf(
          tasks.map((task) =>
            args.include_details
              ? workflowTaskView(workspace, task)
              : workflowTaskSummaryView(workspace, task),
          ),
          {
            offset: args.offset,
            limit: args.limit,
            budget: remainingBudget(meta, filters, summary),
          },
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
          "返回完整规则正文，而不是只返回字数；正文可能让本次响应超出默认 50 KB 预算，长篇正文请改用 get_standard 分窗读取 / Return the full rule text instead of only its size; large bodies can push this response past the default 50 KB budget, so window long rules with get_standard instead.",
        ),
    }),
    async (args) => {
      const loaded = await store.load();
      const { workspace } = loaded;
      if (args.universe_id) findWorld(workspace, args.universe_id);
      const standards = workspace.standards
        .filter(
          (standard) =>
            (!args.status || standard.status === args.status) &&
            (!args.kind || standard.kind === args.kind) &&
            (!args.universe_id || standard.universeId === args.universe_id),
        )
        .slice()
        .sort(compareStandards);
      const meta = workspaceMeta(loaded);
      const activeApplied = applicableStandards(
        workspace,
        args.universe_id,
      ).length;
      return {
        schema: MCP_SCHEMA,
        workspace: meta,
        active_applied: activeApplied,
        standards: pageOf(
          standards.map((standard) =>
            args.include_body
              ? standardView(standard)
              : standardListView(standard),
          ),
          {
            offset: args.offset,
            limit: args.limit,
            budget: remainingBudget(meta, activeApplied),
          },
        ),
      };
    },
  );

  register(
    "get_standard",
    {
      title: "读取基础规则 / Read foundation standard",
      description:
        "读取一条基础规则，返回分窗的规则正文、适用范围与引用它的 AI 工作流任务；两种语言各自用 body_offsets 中对应的 next_offset 续读。Read one foundation standard with its scope and the workflow tasks that pin it by id; each language body continues from its own next_offset via body_offsets.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      standard_id: standardIdSchema,
      body_offset: pageOffsetSchema.describe(
        "两种语言共享的起始位置；后续请用 body_offsets 按语言分别续读 / Shared starting offset for both languages; continue per language with body_offsets.",
      ),
      body_offsets: z
        .object({
          zh: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("中文正文起点 / Chinese body offset."),
          en: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("英文正文起点 / English body offset."),
        })
        .strict()
        .optional()
        .describe(
          "按语言分别续读，把每种语言自己的 next_offset 传回；省略的语言从 body_offset 开始 / Per-language continuation; pass each language's own next_offset. Omitted languages start at body_offset.",
        ),
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
      const pinnedBy = workspace.workflowTasks
        .filter((task) =>
          task.standardRefs.some((ref) => ref.id === standard.id),
        )
        .map((task) => task.id);
      return {
        schema: MCP_SCHEMA,
        workspace: workspaceMeta(loaded),
        standard: {
          ...standardView(standard),
          body: {
            zh: textWindow(
              standard.body.zh,
              args.body_offsets?.zh ?? args.body_offset,
              args.body_max_chars,
            ),
            en: textWindow(
              standard.body.en,
              args.body_offsets?.en ?? args.body_offset,
              args.body_max_chars,
            ),
          },
        },
        applies_to: standard.universeId ?? "project",
        pinned_by_task_ids: pinnedBy.slice(0, COMPACT_ARRAY_ITEMS),
        pinned_by_task_count: pinnedBy.length,
      };
    },
  );

  register(
    "create_standard",
    {
      title: "新建基础规则 / Create foundation standard",
      description:
        "登记一条项目基础规则，默认保存为草稿；标题和正文至少一种语言必须非空，且故事世界必须已存在。Register a project foundation standard, saved as a draft by default; title and body need at least one non-empty language and any story world must already exist.",
      annotations: WORKSPACE_WRITE_ANNOTATIONS,
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
            "invalid_arguments",
            "The workspace already contains the maximum of 1000 foundation standards.",
          );
        if (standard.universeId) findWorld(current, standard.universeId);
        current.standards.push(standard);
        current.updatedAt = now;
      });
      return {
        schema: MCP_SCHEMA,
        revision: workspace.revision,
        standard: standardListView(standard),
      };
    },
  );

  register(
    "update_standard",
    {
      title: "更新基础规则 / Update foundation standard",
      description:
        "更新一条基础规则；标题、正文、类型或适用范围变化时版本号加一，仅修改状态不改版本。Update a foundation standard; title, body, kind or scope changes bump the version, while a status-only change does not.",
      annotations: WORKSPACE_WRITE_ANNOTATIONS,
    },
    z.object({
      standard_id: standardIdSchema,
      title: standardTitlePatchSchema.optional(),
      body: standardBodyPatchSchema.optional(),
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
        if (universeId) findWorld(current, universeId);
        const title = {
          zh: args.title?.zh ?? existing.title.zh,
          en: args.title?.en ?? existing.title.en,
        };
        const body = {
          zh: args.body?.zh ?? existing.body.zh,
          en: args.body?.en ?? existing.body.en,
        };
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
        standard: standardListView(updated),
        version_bumped: versionBumped,
      };
    },
  );

  register(
    "create_timeline_event",
    {
      title: "新建时间线事件 / Create timeline event",
      description:
        "新建一条故事时间线事件并写入工作区；默认保存为 proposed，只有显式传 canon 才标记为正典；世界、小说、章节、场景、主体与关联 ID 必须存在且属于同一故事世界。Create a story timeline event in the workspace, saved as proposed unless canon is explicit; every world, novel, chapter, scene, subject and related ID must exist and belong to the same story world.",
      annotations: WORKSPACE_WRITE_ANNOTATIONS,
    },
    z.object({
      world_id: worldIdSchema,
      novel_id: novelIdSchema,
      chapter_id: chapterIdSchema.optional(),
      scene_id: timelineSceneIdSchema.optional(),
      story_time: timelineStoryTimeSchema.default(""),
      order: timelineOrderSchema.default(0),
      subject_kind: timelineSubjectKindSchema,
      subject_id: timelineSubjectIdSchema,
      event_kind: timelineEventKindSchema,
      title: timelineTitleSchema,
      state_before: z
        .string()
        .max(20_000)
        .default("")
        .describe("事件前状态 / State before the event."),
      state_after: z
        .string()
        .max(20_000)
        .default("")
        .describe("事件后状态 / State after the event."),
      canon_status: timelineCanonStatusSchema
        .default("proposed")
        .describe("省略时保存为 proposed / Defaults to proposed."),
      related_character_ids: timelineRelatedIdsSchema.default([]),
      related_location_ids: timelineRelatedIdsSchema.default([]),
      related_object_ids: timelineRelatedIdsSchema.default([]),
      evidence: z
        .string()
        .max(100_000)
        .default("")
        .describe("原文依据或来源 / Evidence or source."),
      production_prompt: z
        .string()
        .max(20_000)
        .default("")
        .describe("制作提示 / Production prompt."),
      locale: localeSchema,
    }),
    async (args) => {
      const now = new Date().toISOString();
      let created: TimelineEvent | undefined;
      const workspace = await store.update((current) => {
        const event = parseTimelineEvent({
          id: createId("timeline"),
          universeId: args.world_id,
          workId: args.novel_id,
          ...(args.chapter_id ? { chapterId: args.chapter_id } : {}),
          ...(args.scene_id ? { sceneId: args.scene_id } : {}),
          storyTime: args.story_time,
          order: args.order,
          subjectKind: args.subject_kind,
          subjectId: args.subject_id,
          eventKind: args.event_kind,
          title: args.title,
          stateBefore: args.state_before,
          stateAfter: args.state_after,
          canonStatus: args.canon_status,
          relatedCharacterIds: args.related_character_ids,
          relatedLocationIds: args.related_location_ids,
          relatedObjectIds: args.related_object_ids,
          evidence: args.evidence,
          productionPrompt: args.production_prompt,
          createdAt: now,
          updatedAt: now,
        });
        assertTimelineReferences(current, event);
        current.timelineEvents.push(event);
        current.updatedAt = now;
        created = event;
      });
      if (!created)
        throw new ToolError(
          "tool_error",
          "Story timeline event creation did not run.",
        );
      const locale: UiLocale = args.locale ?? workspace.settings.locale;
      return {
        schema: MCP_SCHEMA,
        revision: workspace.revision,
        event: compactRecord(timelineEventView(workspace, created, locale)),
      };
    },
  );

  register(
    "update_timeline_event",
    {
      title: "更新时间线事件 / Update timeline event",
      description:
        "按 event_id 修订一条时间线事件；省略的字段保持原值，章节或场景可传 null 清除，修改后重新校验全部引用并递增工作区修订号。Revise a story timeline event by event_id; omitted fields keep their stored values, chapter or scene can be cleared with null, and every reference is re-validated before the workspace revision is bumped.",
      annotations: WORKSPACE_WRITE_ANNOTATIONS,
    },
    z.object({
      event_id: timelineEventIdSchema,
      chapter_id: timelineChapterPatchSchema,
      scene_id: timelineScenePatchSchema,
      story_time: timelineStoryTimeSchema.optional(),
      order: timelineOrderSchema.optional(),
      subject_kind: timelineSubjectKindSchema.optional(),
      subject_id: timelineSubjectIdSchema.optional(),
      event_kind: timelineEventKindSchema.optional(),
      title: timelineTitlePatchSchema.optional(),
      state_before: z
        .string()
        .max(20_000)
        .optional()
        .describe("事件前状态 / State before the event."),
      state_after: z
        .string()
        .max(20_000)
        .optional()
        .describe("事件后状态 / State after the event."),
      canon_status: timelineCanonStatusSchema.optional(),
      related_character_ids: timelineRelatedIdsSchema.optional(),
      related_location_ids: timelineRelatedIdsSchema.optional(),
      related_object_ids: timelineRelatedIdsSchema.optional(),
      evidence: z
        .string()
        .max(100_000)
        .optional()
        .describe("原文依据或来源 / Evidence or source."),
      production_prompt: z
        .string()
        .max(20_000)
        .optional()
        .describe("制作提示 / Production prompt."),
      locale: localeSchema,
    }),
    async (args) => {
      const now = new Date().toISOString();
      let updated: TimelineEvent | undefined;
      const workspace = await store.update((current) => {
        const index = current.timelineEvents.findIndex(
          (item) => item.id === args.event_id,
        );
        if (index < 0)
          throw new ToolError(
            "not_found",
            `Story timeline event not found: ${args.event_id}`,
          );
        const existing = current.timelineEvents[index] as TimelineEvent;
        const chapterId =
          args.chapter_id === undefined
            ? existing.chapterId
            : (args.chapter_id ?? undefined);
        const sceneId =
          args.scene_id === undefined
            ? existing.sceneId
            : (args.scene_id ?? undefined);
        const nextInput: Record<string, unknown> = {
          ...existing,
          storyTime: args.story_time ?? existing.storyTime,
          order: args.order ?? existing.order,
          subjectKind: args.subject_kind ?? existing.subjectKind,
          subjectId: args.subject_id ?? existing.subjectId,
          eventKind: args.event_kind ?? existing.eventKind,
          title: {
            zh: args.title?.zh ?? existing.title.zh,
            en: args.title?.en ?? existing.title.en,
          },
          stateBefore: args.state_before ?? existing.stateBefore,
          stateAfter: args.state_after ?? existing.stateAfter,
          canonStatus: args.canon_status ?? existing.canonStatus,
          relatedCharacterIds:
            args.related_character_ids ?? existing.relatedCharacterIds,
          relatedLocationIds:
            args.related_location_ids ?? existing.relatedLocationIds,
          relatedObjectIds:
            args.related_object_ids ?? existing.relatedObjectIds,
          evidence: args.evidence ?? existing.evidence,
          productionPrompt: args.production_prompt ?? existing.productionPrompt,
          updatedAt: now,
        };
        if (args.scene_id && !chapterId)
          throw new ToolError(
            "invalid_arguments",
            "A timeline event with a scene must also name its chapter.",
          );
        if (chapterId) nextInput.chapterId = chapterId;
        else delete nextInput.chapterId;
        // A scene only exists inside a chapter, so clearing the chapter clears
        // the scene with it rather than leaving a dangling reference.
        if (chapterId && sceneId) nextInput.sceneId = sceneId;
        else delete nextInput.sceneId;
        const next = parseTimelineEvent(nextInput);
        assertTimelineReferences(current, next);
        current.timelineEvents[index] = next;
        current.updatedAt = now;
        updated = next;
      });
      if (!updated)
        throw new ToolError(
          "tool_error",
          "Story timeline event update did not run.",
        );
      const locale: UiLocale = args.locale ?? workspace.settings.locale;
      return {
        schema: MCP_SCHEMA,
        revision: workspace.revision,
        event: compactRecord(timelineEventView(workspace, updated, locale)),
      };
    },
  );

  register(
    "export_arcreel_bundle",
    {
      title: "导出 ArcReel 包 / Export ArcReel bundle",
      description:
        "构建并写入 ArcReel/3D 漫剧交接包。output_dir 必须位于工作区 exports 目录或服务端启动时用 --export-root 显式允许的目录内；省略时写入工作区同目录 exports。返回写入报告：files_written 与 bytes 是真实总数，chapters、paths、warnings 只回显前若干项，完整的清单在目录内的 manifest.json。Build and write an ArcReel / stylized 3D comic-drama handoff. output_dir must stay inside the workspace exports directory or a directory enabled with --export-root at server start; the default is exports beside workspace.json. Returns the write report: files_written and bytes are true totals while chapters, paths and warnings echo only the first few; the complete manifest is manifest.json inside the directory.",
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
        chapters: bundle.chapters.slice(0, EXPORT_PREVIEW_ITEMS),
        chapter_count: bundle.chapters.length,
        totals: {
          words: bundle.totalWords,
          scenes: bundle.totalScenes,
          shots: bundle.totalShots,
        },
        paths: bundle.files
          .slice(0, EXPORT_PREVIEW_ITEMS)
          .map((file) => file.path),
        path_count: bundle.files.length,
        warnings: bundle.warnings.slice(0, EXPORT_WARNING_ITEMS),
        warning_count: bundle.warnings.length,
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
