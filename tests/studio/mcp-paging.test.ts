import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, rmSync } from "node:fs";
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
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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
      firstPage.items.every(
        (hit) => hit.kind === "lore" && hit.score >= 96,
      ),
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
    expect(worldIds.has(`uni_bulk_${String(BULK_WORLDS - 1).padStart(2, "0")}`)).toBe(
      true,
    );

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
    expect(chapterIds.has(`chapter_bulk_${String(BULK_CHAPTERS - 1).padStart(3, "0")}`)).toBe(
      true,
    );
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
      const window = (
        result.body.standard as { body: { zh: TextWindowBody } }
      ).body.zh;
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

  test("lists foundation standards compactly by default", async () => {
    const result = await call(inline, "list_standards");
    expect(result.isError).toBe(false);
    const standards = readPage<Record<string, unknown>>(
      result.body,
      "standards",
    );
    expect(standards.total).toBe(7);
    for (const standard of standards.items) {
      expect(standard.body).toBeUndefined();
      expect(standard.body_chars).toBeDefined();
    }
    const bulk = standards.items.find(
      (standard) => standard.id === BULK_STANDARD_ID,
    );
    expect((bulk?.body_chars as { zh?: number }).zh).toBe(
      BULK_STANDARD_BODY.length,
    );
  });
});
