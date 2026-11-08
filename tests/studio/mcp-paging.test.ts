import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  MCP_TOOL_COUNTS,
  MCP_TOOL_NAMES,
} from "../../apps/studio/src/core/mcp-tools.ts";
import type { StudioWorkspace } from "../../apps/studio/src/core/types.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";
import { createStudioMcpServer } from "../../apps/studio/mcp/server.ts";

/**
 * Issue #29 acceptance regressions, driven over InMemoryTransport against a
 * deliberately oversized workspace:
 *
 * - 243 chapters (three demo chapters plus 240 generated ones) make the novel
 *   chapter list span many pages.
 * - 24 generated story worlds with 500-character localized fields make even the
 *   world list page under its default budget.
 * - 60 generated lore entries titled exactly `harbor` sit in another world and
 *   out-score every in-scope hit, proving `world_id`/`kind` filter before
 *   ranking rather than after it.
 * - One 13k-character chapter and one 20k-character standard body exercise
 *   `offset`/`max_chars` windowing and exact reassembly.
 */

const NOW = "2026-11-07T00:00:00.000Z";
const RESPONSE_BUDGET_BYTES = 50_000;
const BULK_CHAPTERS = 240;
const BULK_WORLDS = 24;
const BULK_LORE = 60;
const LONG_CHAPTER_ID = "chapter_bulk_000";
const BULK_STANDARD_ID = "std_bulk_body";
const BULK_STANDARD_BODY = "潮".repeat(20_000);
const BULK_STANDARD_BODY_EN = "a".repeat(20_000);
const EMOJI_STANDARD_ID = "std_emoji_window";
const EMOJI_STANDARD_BODY = "😀潮";
const SPLIT_STANDARD_ID = "std_split_window";
const SPLIT_STANDARD_BODY_ZH = `aaaax${"潮".repeat(12)}`;
const SPLIT_STANDARD_BODY_EN = `aaaa😀${"y".repeat(12)}`;
const COMPACT_LORE_ID = "lore_compact_surrogate";
const COMPACT_LORE_BODY = `${"a".repeat(239)}😀tail`;
const BLOCKER_TASKS = 24;
const CHAPTER_CHARACTER_IDS = 25;

const LONG_PROSE = Array.from(
  { length: 500 },
  (_, index) =>
    `第${index + 1}段：雨落在旧钟塔的铜瓦上，林舟数着缺失的那一拍。`,
).join("\n");

const CJK_FILLER = "潮".repeat(500);
const ASCII_FILLER = "x".repeat(500);

function buildLargeWorkspace(): StudioWorkspace {
  const workspace = createDemoWorkspace("zh-CN", NOW);
  const novel = workspace.works.find((work) => work.id === "work_tide_clock");
  const template = novel?.chapters.find(
    (chapter) => chapter.id === "chapter_tide_001",
  );
  if (!novel || !template)
    throw new Error("Demo fixture lost work_tide_clock/chapter_tide_001.");

  for (let index = 0; index < BULK_CHAPTERS; index += 1) {
    const suffix = index.toString().padStart(3, "0");
    novel.chapters.push({
      ...template,
      id: `chapter_bulk_${suffix}`,
      number: 100 + index,
      title: `批量章节 ${suffix}`,
      titleEn: `Bulk chapter ${suffix}`,
      status: index % 3 === 0 ? "draft" : "outline",
      summary: `第 ${suffix} 章的生成摘要。${"雨声沿着旧钟塔的铜瓦滑落，林舟在柜台后面重新数着缺失的钟拍。".repeat(6)}`,
      outline: `第 ${suffix} 章的生成大纲：推进旧塔线索。`,
      content:
        index === 0
          ? LONG_PROSE
          : `第 ${suffix} 章正文占位。雨落在雾港的水面上。`,
      characterIds:
        index === 0
          ? Array.from(
              { length: CHAPTER_CHARACTER_IDS },
              (_, slot) => `char_extra_${slot.toString().padStart(2, "0")}`,
            )
          : [],
      beats: [],
      scenes: [],
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  for (let index = 0; index < BULK_WORLDS; index += 1) {
    const suffix = index.toString().padStart(2, "0");
    workspace.universes.push({
      id: `uni_bulk_${suffix}`,
      name: {
        zh: `群像世界 ${suffix} ${CJK_FILLER}`.slice(0, 500),
        en: `Bulk world ${suffix} ${ASCII_FILLER}`.slice(0, 500),
      },
      tagline: {
        zh: CJK_FILLER,
        en: `Tagline ${suffix} ${ASCII_FILLER}`.slice(0, 500),
      },
      summary: {
        zh: CJK_FILLER,
        en: `Summary ${suffix} ${ASCII_FILLER}`.slice(0, 500),
      },
      genres: [],
      themes: [],
      accent: "#2f7567",
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  for (let index = 0; index < BULK_LORE; index += 1) {
    const suffix = index.toString().padStart(2, "0");
    workspace.lore.push({
      id: `lore_bulk_${suffix}`,
      universeId: "uni_ninth_station",
      category: "mystery",
      title: { zh: "harbor", en: "harbor" },
      body: `Bulk lore entry ${suffix}.`,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  // A compacted field whose 240-code-unit cut would land inside a surrogate
  // pair pins `compactValue` to whole code points.
  workspace.lore.push({
    id: COMPACT_LORE_ID,
    universeId: "uni_ninth_station",
    category: "mystery",
    title: { zh: "截断边界", en: "Compact boundary" },
    body: COMPACT_LORE_BODY,
    createdAt: NOW,
    updatedAt: NOW,
  });

  const extraCharacterIds = Array.from(
    { length: CHAPTER_CHARACTER_IDS },
    (_, slot) => `char_extra_${slot.toString().padStart(2, "0")}`,
  );
  for (const [slot, id] of extraCharacterIds.entries()) {
    workspace.characters.push({
      id,
      universeIds: ["uni_mist_harbor"],
      name: { zh: `群像角色 ${slot}`, en: `Extra cast ${slot}` },
      role: { zh: "配角", en: "Supporting" },
      summary: { zh: "", en: "" },
      appearance: "",
      visualPrompt: "",
      personality: "",
      motivation: "",
      flaw: "",
      secret: "",
      voice: "",
      tags: [],
      color: "#2f7567",
      reusable: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  workspace.standards.push({
    id: BULK_STANDARD_ID,
    title: { zh: "大体量规则", en: "Bulk standard" },
    kind: "style",
    body: { zh: BULK_STANDARD_BODY, en: BULK_STANDARD_BODY_EN },
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });

  // A body whose first code point is a surrogate pair exercises the text
  // window at max_chars: 1 and at an offset that lands between the two halves.
  workspace.standards.push({
    id: EMOJI_STANDARD_ID,
    title: { zh: "表情窗口", en: "Emoji window" },
    kind: "style",
    body: { zh: EMOJI_STANDARD_BODY, en: "😀" },
    status: "draft",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });

  // At the same `body_max_chars` the Chinese window ends after "aaaax" while
  // the English one takes the whole surrogate pair, so each language has to
  // continue from its own offset instead of a shared one.
  workspace.standards.push({
    id: SPLIT_STANDARD_ID,
    title: { zh: "双语分窗", en: "Split window" },
    kind: "style",
    body: { zh: SPLIT_STANDARD_BODY_ZH, en: SPLIT_STANDARD_BODY_EN },
    status: "draft",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Many unfinished dependencies and pinned references make the preview caps
  // observable: `task_blocked` waits on 24 queued tasks and carries more
  // character ids than a page view echoes.
  const blockedCharacterIds = Array.from(
    { length: CHAPTER_CHARACTER_IDS },
    (_, slot) => `char_extra_${slot.toString().padStart(2, "0")}`,
  );
  const blockerIds: string[] = [];
  for (let index = 0; index < BLOCKER_TASKS; index += 1) {
    const id = `task_block_${index.toString().padStart(2, "0")}`;
    blockerIds.push(id);
    workspace.workflowTasks.push({
      id,
      title: { zh: `阻塞任务 ${id}`, en: `Blocker ${id}` },
      brief: { zh: "", en: "" },
      deliverable: { zh: "", en: "" },
      result: { zh: "", en: "" },
      kind: "world",
      template: "world",
      status: "queued",
      universeId: "uni_mist_harbor",
      workId: "work_tide_clock",
      characterIds: [],
      dependsOnIds: [],
      standardRefs: [{ id: EMOJI_STANDARD_ID, version: 1 }],
      createdAt: NOW,
      updatedAt: NOW,
    });
  }
  workspace.workflowTasks.push({
    id: "task_blocked",
    title: { zh: "等待全部前置", en: "Wait for every prerequisite" },
    brief: { zh: "", en: "" },
    deliverable: { zh: "", en: "" },
    result: { zh: "", en: "" },
    kind: "review",
    template: "review",
    status: "queued",
    universeId: "uni_mist_harbor",
    workId: "work_tide_clock",
    characterIds: blockedCharacterIds,
    dependsOnIds: blockerIds,
    standardRefs: [],
    createdAt: NOW,
    updatedAt: NOW,
  });

  return workspace;
}

interface InlineServer {
  client: Client;
  close: () => Promise<void>;
}

async function connectInline(workspacePath: string): Promise<InlineServer> {
  const client = new Client({
    name: "iploom-studio-paging-test",
    version: "0.3.0",
  });
  const server = createStudioMcpServer(workspacePath);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

interface PageBody<T> {
  total: number;
  offset: number;
  count: number;
  next_offset: number | null;
  truncated: boolean;
  items: T[];
}

interface TextWindowBody {
  text: string;
  offset: number;
  total_chars: number;
  next_offset: number | null;
  truncated: boolean;
}

interface HitView {
  kind: string;
  id: string;
  universe_id: string;
  universe_ids: string[];
  score: number;
}

function readPage<T = Record<string, unknown>>(
  body: Record<string, unknown>,
  key: string,
): PageBody<T> {
  const page = body[key] as PageBody<T> | undefined;
  if (!page || !Array.isArray(page.items))
    throw new Error(`Expected a page at body.${key}`);
  return page;
}

async function call(
  inline: InlineServer,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await inline.client.callTool({ name, arguments: args });
  const text = result.content.find(
    (item): item is { type: "text"; text: string } => item.type === "text",
  )?.text;
  if (!text) throw new Error("MCP tool result did not contain a text block.");
  return {
    isError: result.isError === true,
    text,
    body: JSON.parse(text) as Record<string, unknown>,
  };
}

function bytesOf(result: { text: string }): number {
  return Buffer.byteLength(result.text, "utf8");
}

function expectWithinBudget(result: { text: string }, label: string): void {
  const bytes = bytesOf(result);
  if (bytes > RESPONSE_BUDGET_BYTES)
    throw new Error(
      `${label} returned ${bytes} bytes, over the ${RESPONSE_BUDGET_BYTES}-byte budget.`,
    );
}

/** Follows `next_offset` to the end and returns every item in page order. */
async function walkPages<T = Record<string, unknown>>(
  inline: InlineServer,
  name: string,
  args: Record<string, unknown>,
  key: string,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  let expectedTotal: number | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const result = await call(inline, name, { ...args, offset });
    expect(result.isError).toBe(false);
    expectWithinBudget(result, `${name} page at ${offset}`);
    const page = readPage<T>(result.body, key);
    expect(page.offset).toBe(offset);
    expect(page.count).toBe(page.items.length);
    expect(page.count).toBeGreaterThan(0);
    expectedTotal ??= page.total;
    expect(page.total).toBe(expectedTotal);
    items.push(...page.items);
    if (page.next_offset === null) {
      expect(page.truncated).toBe(false);
      return items;
    }
    expect(page.truncated).toBe(true);
    expect(page.next_offset).toBeGreaterThan(offset);
    offset = page.next_offset;
  }
  throw new Error(`${name} did not finish paging.`);
}

let inline: InlineServer;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "iploom-studio-paging-"));
  const workspacePath = join(root, "workspace.json");
  await new WorkspaceStore(workspacePath).save(buildLargeWorkspace());
  inline = await connectInline(workspacePath);
});

afterAll(async () => {
  await inline?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("MCP paging, scoping and bounded responses", () => {
  test("registers exactly the shared tool registry", async () => {
    const listed = await inline.client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    expect(listed.tools).toHaveLength(MCP_TOOL_COUNTS.total);
  });

  test("reports invalid arguments and unknown ids as parseable JSON errors", async () => {
    const empty = await call(inline, "search_ip", { query: "" });
    expect(empty.isError).toBe(true);
    const invalid = empty.body.error as { code: string; issues?: unknown };
    expect(invalid.code).toBe("invalid_arguments");
    expect(Array.isArray(invalid.issues)).toBe(true);

    const missingBrief = await call(inline, "get_workflow_brief", {
      task_id: "nope",
    });
    expect(missingBrief.isError).toBe(true);
    const notFound = missingBrief.body.error as { code: string };
    expect(notFound.code).toBe("not_found");
    expect(missingBrief.text).toContain("nope");
  });

  test("filters search hits by world and kind before ranking", async () => {
    const unscoped = await call(inline, "search_ip", { query: "harbor" });
    const firstPage = readPage<HitView>(unscoped.body, "hits");
    expect(firstPage.total).toBeGreaterThanOrEqual(BULK_LORE);
    // Every out-of-scope lore title is an exact match, so the first page is
    // entirely these higher-scoring hits.
    expect(firstPage.items).toHaveLength(20);
    expect(
      firstPage.items.every((hit) => hit.kind === "lore" && hit.score >= 96),
    ).toBe(true);

    const scoped = await call(inline, "search_ip", {
      query: "harbor",
      world_id: "uni_mist_harbor",
      limit: 200,
    });
    expect(scoped.isError).toBe(false);
    const scopedHits = readPage<HitView>(scoped.body, "hits");
    expect(scopedHits.total).toBeGreaterThan(0);
    expect(scopedHits.items).toHaveLength(scopedHits.total);
    for (const hit of scopedHits.items) {
      expect(hit.universe_ids).toContain("uni_mist_harbor");
      expect(hit.id.startsWith("lore_bulk_")).toBe(false);
    }
    expect(scopedHits.items.some((hit) => hit.id === "uni_mist_harbor")).toBe(
      true,
    );

    const universes = await call(inline, "search_ip", {
      query: "harbor",
      kind: "universe",
      limit: 200,
    });
    expect(universes.isError).toBe(false);
    const universeHits = readPage<HitView>(universes.body, "hits");
    expect(universeHits.items.length).toBeGreaterThan(0);
    expect(universeHits.items.every((hit) => hit.kind === "universe")).toBe(
      true,
    );
  });

  test("keeps every default read within the response budget", async () => {
    const reads: Array<[string, Record<string, unknown>, string]> = [
      ["list_story_worlds", {}, "worlds"],
      ["get_story_world", { world_id: "uni_bulk_00" }, "world"],
      ["list_novels", {}, "novels"],
      ["get_novel", { novel_id: "work_tide_clock" }, "chapters"],
      ["get_chapter", { chapter_id: LONG_CHAPTER_ID }, "chapter"],
      ["search_ip", { query: "harbor" }, "hits"],
      ["get_relationship_graph", { world_id: "uni_mist_harbor" }, "nodes"],
      ["list_workflow_tasks", {}, "tasks"],
      ["get_workflow_brief", { task_id: "task_world_rules" }, "task"],
      ["list_standards", {}, "standards"],
      ["get_standard", { standard_id: BULK_STANDARD_ID }, "standard"],
    ];
    for (const [name, args, key] of reads) {
      const result = await call(inline, name, args);
      expect(result.isError).toBe(false);
      expectWithinBudget(result, name);
      expect(result.body[key]).toBeDefined();
    }
  });

  test("walks every page with each item appearing exactly once", async () => {
    const worlds = await walkPages<{ id: string }>(
      inline,
      "list_story_worlds",
      {},
      "worlds",
    );
    expect(worlds).toHaveLength(2 + BULK_WORLDS);
    const worldIds = new Set(worlds.map((world) => world.id));
    expect(worldIds.size).toBe(worlds.length);
    expect(worldIds.has("uni_mist_harbor")).toBe(true);
    expect(worldIds.has("uni_bulk_00")).toBe(true);
    expect(
      worldIds.has(`uni_bulk_${String(BULK_WORLDS - 1).padStart(2, "0")}`),
    ).toBe(true);

    const first = await call(inline, "get_novel", {
      novel_id: "work_tide_clock",
    });
    expect(readPage(first.body, "chapters").total).toBe(3 + BULK_CHAPTERS);
    expect(readPage(first.body, "chapters").truncated).toBe(true);

    const chapters = await walkPages<{ id: string; number: number }>(
      inline,
      "get_novel",
      { novel_id: "work_tide_clock" },
      "chapters",
    );
    expect(chapters).toHaveLength(3 + BULK_CHAPTERS);
    const chapterIds = new Set(chapters.map((chapter) => chapter.id));
    expect(chapterIds.size).toBe(chapters.length);
    expect(chapterIds.has("chapter_tide_001")).toBe(true);
    expect(
      chapterIds.has(
        `chapter_bulk_${String(BULK_CHAPTERS - 1).padStart(3, "0")}`,
      ),
    ).toBe(true);
    const numbers = chapters.map((chapter) => chapter.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test("reassembles chapter prose exactly from offset windows", async () => {
    const first = await call(inline, "get_chapter", {
      chapter_id: LONG_CHAPTER_ID,
    });
    const chapter = first.body.chapter as { content: TextWindowBody };
    expect(chapter.content.total_chars).toBe(LONG_PROSE.length);
    expect(chapter.content.text).toHaveLength(6_000);
    expect(chapter.content.next_offset).toBe(6_000);
    expect(chapter.content.truncated).toBe(true);

    const pieces: string[] = [];
    let offset = 0;
    let finished = false;
    for (let guard = 0; guard < 40 && !finished; guard += 1) {
      const result = await call(inline, "get_chapter", {
        chapter_id: LONG_CHAPTER_ID,
        offset,
        max_chars: 1_500,
      });
      expect(result.isError).toBe(false);
      const window = (result.body.chapter as { content: TextWindowBody })
        .content;
      expect(window.offset).toBe(offset);
      expect(window.total_chars).toBe(LONG_PROSE.length);
      pieces.push(window.text);
      if (window.next_offset === null) {
        expect(window.truncated).toBe(false);
        finished = true;
      } else {
        expect(window.next_offset).toBeGreaterThan(offset);
        offset = window.next_offset;
      }
    }
    expect(finished).toBe(true);
    expect(pieces.join("")).toBe(LONG_PROSE);
  });

  test("windows large standard bodies and reassembles them exactly", async () => {
    const first = await call(inline, "get_standard", {
      standard_id: BULK_STANDARD_ID,
    });
    expect(first.isError).toBe(false);
    const standard = first.body.standard as {
      body: { zh: TextWindowBody; en: TextWindowBody };
    };
    expect(standard.body.zh.total_chars).toBe(BULK_STANDARD_BODY.length);
    expect(standard.body.zh.text).toHaveLength(4_000);
    expect(standard.body.zh.next_offset).toBe(4_000);
    expect(standard.body.zh.truncated).toBe(true);
    expect(standard.body.en.total_chars).toBe(BULK_STANDARD_BODY_EN.length);
    expect(standard.body.en.text).toHaveLength(4_000);

    const pieces: string[] = [];
    let offset = 0;
    let finished = false;
    for (let guard = 0; guard < 20 && !finished; guard += 1) {
      const result = await call(inline, "get_standard", {
        standard_id: BULK_STANDARD_ID,
        body_offset: offset,
        body_max_chars: 3_000,
      });
      const window = (result.body.standard as { body: { zh: TextWindowBody } })
        .body.zh;
      expect(window.offset).toBe(offset);
      pieces.push(window.text);
      if (window.next_offset === null) {
        finished = true;
      } else {
        offset = window.next_offset;
      }
    }
    expect(finished).toBe(true);
    expect(pieces.join("")).toBe(BULK_STANDARD_BODY);
  });

  test("continues each standard body from its own offset", async () => {
    const first = await call(inline, "get_standard", {
      standard_id: SPLIT_STANDARD_ID,
      body_max_chars: 5,
    });
    expect(first.isError).toBe(false);
    const firstBody = (
      first.body.standard as {
        body: { zh: TextWindowBody; en: TextWindowBody };
      }
    ).body;
    // The English window takes the whole surrogate pair and is one code unit
    // longer, so a shared offset would skip or repeat text on the next call.
    expect(firstBody.zh.text).toBe("aaaax");
    expect(firstBody.zh.next_offset).toBe(5);
    expect(firstBody.en.text).toBe("aaaa😀");
    expect(firstBody.en.next_offset).toBe(6);

    // A language omitted from body_offsets falls back to body_offset.
    const mixed = await call(inline, "get_standard", {
      standard_id: SPLIT_STANDARD_ID,
      body_offset: 5,
      body_offsets: { en: 6 },
      body_max_chars: 5,
    });
    expect(mixed.isError).toBe(false);
    const mixedBody = (
      mixed.body.standard as {
        body: { zh: TextWindowBody; en: TextWindowBody };
      }
    ).body;
    expect(mixedBody.zh.offset).toBe(5);
    expect(mixedBody.en.offset).toBe(6);

    const zhPieces = [firstBody.zh.text];
    const enPieces = [firstBody.en.text];
    let zhOffset = firstBody.zh.next_offset;
    let enOffset = firstBody.en.next_offset;
    for (
      let guard = 0;
      guard < 20 && (zhOffset !== null || enOffset !== null);
      guard += 1
    ) {
      const result = await call(inline, "get_standard", {
        standard_id: SPLIT_STANDARD_ID,
        body_max_chars: 5,
        body_offsets: {
          ...(zhOffset === null ? {} : { zh: zhOffset }),
          ...(enOffset === null ? {} : { en: enOffset }),
        },
      });
      expect(result.isError).toBe(false);
      const body = (
        result.body.standard as {
          body: { zh: TextWindowBody; en: TextWindowBody };
        }
      ).body;
      if (zhOffset !== null) {
        expect(body.zh.offset).toBe(zhOffset);
        zhPieces.push(body.zh.text);
        zhOffset = body.zh.next_offset;
      }
      if (enOffset !== null) {
        expect(body.en.offset).toBe(enOffset);
        enPieces.push(body.en.text);
        enOffset = body.en.next_offset;
      }
    }
    expect(zhOffset).toBeNull();
    expect(enOffset).toBeNull();
    expect(zhPieces.join("")).toBe(SPLIT_STANDARD_BODY_ZH);
    expect(enPieces.join("")).toBe(SPLIT_STANDARD_BODY_EN);
  });

  test("lists foundation standards compactly by default", async () => {
    const result = await call(inline, "list_standards");
    expect(result.isError).toBe(false);
    const standards = readPage<Record<string, unknown>>(
      result.body,
      "standards",
    );
    expect(standards.total).toBe(9);
    for (const standard of standards.items) {
      expect(standard.body).toBeUndefined();
      expect(standard.body_chars).toBeDefined();
    }
    const bulk = standards.items.find(
      (standard) => standard.id === BULK_STANDARD_ID,
    );
    if (!bulk) throw new Error("bulk standard missing");
    expect((bulk.body_chars as { zh?: number }).zh).toBe(
      BULK_STANDARD_BODY.length,
    );
  });

  test("returns full standard bodies only when include_body is set", async () => {
    const firstPage = await call(inline, "list_standards", {
      kind: "style",
      include_body: true,
      limit: 200,
    });
    expect(firstPage.isError).toBe(false);
    const first = readPage<{ id: string; body?: { zh: string; en: string } }>(
      firstPage.body,
      "standards",
    );
    expect(first.items[0]?.id).toBe("std_baseline_language");
    expect(first.items[0]?.body).toBeDefined();
    expect(first.next_offset).toBe(1);

    const secondPage = await call(inline, "list_standards", {
      kind: "style",
      include_body: true,
      offset: 1,
      limit: 200,
    });
    expect(secondPage.isError).toBe(false);
    const second = readPage<{ id: string; body?: { zh: string; en: string } }>(
      secondPage.body,
      "standards",
    );
    expect(second.items[0]?.id).toBe(BULK_STANDARD_ID);
    expect(second.items[0]?.body?.zh).toBe(BULK_STANDARD_BODY);
    expect(second.items[0]?.body?.en).toBe(BULK_STANDARD_BODY_EN);
  });

  test("clips compact views without splitting a surrogate pair", async () => {
    const result = await call(inline, "get_story_world", {
      world_id: "uni_ninth_station",
      offsets: { lore: BULK_LORE },
      limit: 5,
    });
    expect(result.isError).toBe(false);
    const lore = readPage<{
      id: string;
      body: string;
      truncated_fields?: string[];
    }>(result.body, "lore");
    const entry = lore.items.find((item) => item.id === COMPACT_LORE_ID);
    expect(entry).toBeDefined();
    expect(entry?.body).toBe(`${"a".repeat(239)}😀…`);
    expect(entry?.truncated_fields).toContain("body");
  });

  test("pages each story-world collection at its own offset", async () => {
    const first = await call(inline, "get_story_world", {
      world_id: "uni_mist_harbor",
      limit: 1,
    });
    expect(first.isError).toBe(false);
    const firstCharacters = readPage<{ id: string }>(first.body, "characters");
    const firstNovels = readPage<{ id: string }>(first.body, "novels");
    expect(firstCharacters.total).toBeGreaterThan(1);
    expect(firstCharacters.offset).toBe(0);
    expect(firstNovels.offset).toBe(0);

    const second = await call(inline, "get_story_world", {
      world_id: "uni_mist_harbor",
      limit: 1,
      offsets: { characters: 1 },
    });
    expect(second.isError).toBe(false);
    const secondCharacters = readPage<{ id: string }>(
      second.body,
      "characters",
    );
    const secondNovels = readPage<{ id: string }>(second.body, "novels");
    expect(secondCharacters.offset).toBe(1);
    expect(secondCharacters.items[0]?.id).not.toBe(
      firstCharacters.items[0]?.id,
    );
    // Untouched collections keep their own first page instead of skipping.
    expect(secondNovels.offset).toBe(0);
    expect(secondNovels.items[0]?.id).toBe(firstNovels.items[0]?.id);
  });

  test("pages graph nodes and edges independently", async () => {
    const first = await call(inline, "get_relationship_graph", {
      world_id: "uni_mist_harbor",
      limit: 1,
    });
    expect(first.isError).toBe(false);
    const firstNodes = readPage<{ id: string }>(first.body, "nodes");
    const firstEdges = readPage<{ id: string }>(first.body, "edges");
    expect(firstNodes.total).toBeGreaterThan(1);
    expect(firstEdges.total).toBeGreaterThan(1);

    const second = await call(inline, "get_relationship_graph", {
      world_id: "uni_mist_harbor",
      limit: 1,
      nodes_offset: 1,
    });
    expect(second.isError).toBe(false);
    const secondNodes = readPage<{ id: string }>(second.body, "nodes");
    const secondEdges = readPage<{ id: string }>(second.body, "edges");
    expect(secondNodes.offset).toBe(1);
    expect(secondNodes.items[0]?.id).not.toBe(firstNodes.items[0]?.id);
    expect(secondEdges.offset).toBe(0);
    expect(secondEdges.items[0]?.id).toBe(firstEdges.items[0]?.id);
  });

  test("never splits a surrogate pair when windowing text", async () => {
    const clipped = await call(inline, "get_standard", {
      standard_id: EMOJI_STANDARD_ID,
      body_max_chars: 1,
    });
    expect(clipped.isError).toBe(false);
    const clippedBody = (
      clipped.body.standard as {
        body: { zh: TextWindowBody; en: TextWindowBody };
      }
    ).body;
    expect(clippedBody.zh.text).toBe("😀");
    expect(clippedBody.zh.offset).toBe(0);
    expect(clippedBody.zh.next_offset).toBe(2);
    expect(clippedBody.zh.truncated).toBe(true);
    expect(clippedBody.en.text).toBe("😀");
    expect(clippedBody.en.next_offset).toBeNull();
    expect(clippedBody.en.truncated).toBe(false);

    // An offset between the two halves is pulled back instead of opening the
    // window with a lone low surrogate.
    const between = await call(inline, "get_standard", {
      standard_id: EMOJI_STANDARD_ID,
      body_offset: 1,
      body_max_chars: 1,
    });
    expect(between.isError).toBe(false);
    const betweenZh = (
      between.body.standard as { body: { zh: TextWindowBody } }
    ).body.zh;
    expect(betweenZh.offset).toBe(0);
    expect(betweenZh.text).toBe("😀");

    const rest = await call(inline, "get_standard", {
      standard_id: EMOJI_STANDARD_ID,
      body_offset: 2,
      body_max_chars: 1,
    });
    expect(rest.isError).toBe(false);
    const restZh = (rest.body.standard as { body: { zh: TextWindowBody } }).body
      .zh;
    expect(restZh.text).toBe("潮");
    expect(restZh.next_offset).toBeNull();
    expect(restZh.truncated).toBe(false);
  });

  test("caps fan-out previews and reports the true counts", async () => {
    const list = await call(inline, "list_workflow_tasks", { limit: 200 });
    expect(list.isError).toBe(false);
    const tasks = readPage<Record<string, unknown>>(list.body, "tasks");
    const blocked = tasks.items.find((task) => task.id === "task_blocked");
    expect(blocked).toBeDefined();
    if (!blocked) throw new Error("blocked task missing");
    expect(blocked.blocker_count).toBe(BLOCKER_TASKS);
    expect((blocked.blockers as unknown[]).length).toBe(10);
    expect((blocked.depends_on_ids as unknown[]).length).toBe(20);
    expect(blocked.depends_on_id_count).toBe(BLOCKER_TASKS);
    expect((blocked.character_ids as unknown[]).length).toBe(20);
    expect(blocked.character_id_count).toBe(CHAPTER_CHARACTER_IDS);

    const chapter = await call(inline, "get_chapter", {
      chapter_id: LONG_CHAPTER_ID,
    });
    const chapterBody = chapter.body.chapter as {
      character_ids: string[];
      character_id_count: number;
    };
    expect(chapterBody.character_ids).toHaveLength(20);
    expect(chapterBody.character_id_count).toBe(CHAPTER_CHARACTER_IDS);

    const standard = await call(inline, "get_standard", {
      standard_id: EMOJI_STANDARD_ID,
    });
    expect(standard.isError).toBe(false);
    expect(standard.body.pinned_by_task_count).toBe(BLOCKER_TASKS);
    expect((standard.body.pinned_by_task_ids as unknown[]).length).toBe(20);
  });

  test("rejects an unknown story world instead of returning empty standards", async () => {
    const result = await call(inline, "list_standards", {
      universe_id: "uni_missing",
    });
    expect(result.isError).toBe(true);
    expect((result.body.error as { code: string }).code).toBe("not_found");

    const created = await call(inline, "create_standard", {
      kind: "style",
      title: { zh: "未知世界", en: "Unknown world" },
      body: { zh: "正文", en: "Body" },
      universe_id: "uni_missing",
    });
    expect(created.isError).toBe(true);
    expect((created.body.error as { code: string }).code).toBe("not_found");

    const updated = await call(inline, "update_standard", {
      standard_id: SPLIT_STANDARD_ID,
      universe_id: "uni_missing",
    });
    expect(updated.isError).toBe(true);
    expect((updated.body.error as { code: string }).code).toBe("not_found");
  });

  test("write acknowledgements report sizes and merge language patches", async () => {
    const created = await call(inline, "create_standard", {
      kind: "style",
      title: { zh: "局部更新", en: "Partial patch" },
      body: { zh: "中文正文", en: "English body" },
    });
    expect(created.isError).toBe(false);
    const createdView = created.body.standard as Record<string, unknown>;
    expect(createdView.body).toBeUndefined();
    expect(createdView.body_chars).toEqual({ zh: 4, en: 12 });
    const id = createdView.id as string;

    const patched = await call(inline, "update_standard", {
      standard_id: id,
      title: { zh: "更新后的标题" },
    });
    expect(patched.isError).toBe(false);
    const patchedView = patched.body.standard as {
      title: { zh: string; en: string };
      body_chars: { zh: number; en: number };
    };
    expect(patchedView.title).toEqual({
      zh: "更新后的标题",
      en: "Partial patch",
    });
    expect(patchedView.body_chars).toEqual({ zh: 4, en: 12 });
  });

  test("reports export totals while previewing long lists", async () => {
    const result = await call(inline, "export_arcreel_bundle", {
      novel_id: "work_tide_clock",
    });
    expect(result.isError).toBe(false);
    expectWithinBudget(result, "export_arcreel_bundle");
    expect(result.body.chapter_count).toBe(3 + BULK_CHAPTERS);
    expect((result.body.chapters as unknown[]).length).toBe(50);
    const pathCount = result.body.path_count as number;
    expect(pathCount).toBe(result.body.files_written as number);
    expect(pathCount).toBeGreaterThan(50);
    expect((result.body.paths as unknown[]).length).toBe(50);
    expect(result.body.warning_count).toBeGreaterThan(20);
    expect((result.body.warnings as unknown[]).length).toBe(20);
    const directory = result.body.directory as string;
    expect(existsSync(join(directory, "manifest.json"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    ) as {
      files: unknown[];
      adaptation: { totals: { chapters: number } };
    };
    expect(manifest.files).toHaveLength(pathCount - 1);
    expect(manifest.adaptation.totals.chapters).toBe(3 + BULK_CHAPTERS);
  });
});
