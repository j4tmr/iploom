import { expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { MCP_TOOL_COUNTS } from "../../apps/studio/src/core/mcp-tools.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";
import { createStudioMcpServer } from "../../apps/studio/mcp/server.ts";

/**
 * In-process exercises of `createStudioMcpServer` over InMemoryTransport.
 * The stdio suite in `mcp.test.ts` spawns the server as a subprocess, which
 * real clients use but coverage cannot observe; this file drives the same
 * registered tools inside the test process.
 */

interface InlineServer {
  client: Client;
  close: () => Promise<void>;
}

async function connectInline(
  workspacePath: string,
  options: Parameters<typeof createStudioMcpServer>[1] = {},
): Promise<InlineServer> {
  const client = new Client({
    name: "iploom-studio-inline-test",
    version: "0.3.0",
  });
  const server = createStudioMcpServer(workspacePath, options);
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
  count: number;
  next_offset: number | null;
  items: T[];
}

function pageOf<T = Record<string, unknown>>(
  body: Record<string, unknown>,
  key: string,
): PageBody<T> {
  const page = body[key] as PageBody<T> | undefined;
  if (!page || !Array.isArray(page.items)) {
    throw new Error(`Expected a page at body.${key}`);
  }
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

test("inline MCP server exposes every tool and answers reads, writes and exports", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-inline-mcp-"));
  const workspacePath = join(root, "workspace.json");
  await new WorkspaceStore(workspacePath).save(
    createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z"),
  );
  const inline = await connectInline(workspacePath);
  try {
    const listed = await inline.client.listTools();
    expect(listed.tools).toHaveLength(MCP_TOOL_COUNTS.total);
    expect(
      listed.tools.filter((tool) => tool.annotations?.readOnlyHint === true),
    ).toHaveLength(MCP_TOOL_COUNTS.read);

    const worlds = await call(inline, "list_story_worlds");
    expect(worlds.isError).toBe(false);
    expect(pageOf(worlds.body, "worlds").total).toBe(2);

    const world = await call(inline, "get_story_world", {
      world_id: "uni_mist_harbor",
    });
    expect(world.isError).toBe(false);
    expect((world.body.world as { id: string }).id).toBe("uni_mist_harbor");
    expect(Array.isArray(pageOf(world.body, "characters").items)).toBe(true);

    const novels = await call(inline, "list_novels");
    expect(novels.isError).toBe(false);
    expect(pageOf(novels.body, "novels").total).toBe(2);

    const novel = await call(inline, "get_novel", {
      novel_id: "work_tide_clock",
    });
    expect(novel.isError).toBe(false);
    expect((novel.body.world as { id: string }).id).toBe("uni_mist_harbor");

    const chapter = await call(inline, "get_chapter", {
      chapter_id: "chapter_tide_001",
    });
    expect(chapter.isError).toBe(false);
    expect((chapter.body.chapter as { id: string }).id).toBe(
      "chapter_tide_001",
    );
    const missingChapter = await call(inline, "get_chapter", {
      chapter_id: "chapter_missing",
    });
    expect(missingChapter.isError).toBe(true);
    expect(missingChapter.body.error).toBeDefined();

    const search = await call(inline, "search_ip", {
      query: "潮",
      locale: "zh-CN",
    });
    expect(search.isError).toBe(false);
    expect(pageOf(search.body, "hits").total).toBeGreaterThan(0);

    const graph = await call(inline, "get_relationship_graph", {
      world_id: "uni_mist_harbor",
      locale: "zh-CN",
    });
    expect(graph.isError).toBe(false);
    expect(Array.isArray(pageOf(graph.body, "nodes").items)).toBe(true);

    const tasks = await call(inline, "list_workflow_tasks");
    expect(tasks.isError).toBe(false);
    expect(pageOf(tasks.body, "tasks").total).toBe(4);

    const brief = await call(inline, "get_workflow_brief", {
      task_id: "task_chapter_three",
      locale: "en",
    });
    expect(brief.isError).toBe(false);
    expect((brief.body.markdown as { text: string }).text).toContain(
      "task_chapter_three",
    );

    const standards = await call(inline, "list_standards");
    expect(standards.isError).toBe(false);
    expect(pageOf(standards.body, "standards").total).toBe(6);

    const standard = await call(inline, "get_standard", {
      standard_id: "std_baseline_language",
    });
    expect(standard.isError).toBe(false);
    expect((standard.body.standard as { id: string }).id).toBe(
      "std_baseline_language",
    );

    const created = await call(inline, "create_standard", {
      kind: "naming",
      title: { zh: "地名命名规范", en: "Place naming convention" },
      body: {
        zh: "所有地名先登记后使用。",
        en: "Register every place name before use.",
      },
    });
    expect(created.isError).toBe(false);
    const createdStandard = created.body.standard as {
      id: string;
      version: number;
      status: string;
    };
    expect(createdStandard.id.startsWith("std_")).toBe(true);
    expect(createdStandard.version).toBe(1);
    expect(createdStandard.status).toBe("draft");

    const statusEdit = await call(inline, "update_standard", {
      standard_id: createdStandard.id,
      status: "active",
    });
    expect(statusEdit.isError).toBe(false);
    expect(statusEdit.body.version_bumped).toBe(false);

    const exported = await call(inline, "export_arcreel_bundle", {
      novel_id: "work_tide_clock",
      chapter_ids: ["chapter_tide_001"],
      approved_only: true,
      output_dir: "exports/inline",
    });
    expect(exported.isError).toBe(false);
    const directory = exported.body.directory as string;
    expect(dirname(directory)).toBe(join(root, "exports", "inline"));
    expect(existsSync(join(directory, "manifest.json"))).toBe(true);
    expect(readdirSync(join(root, "exports"))).toEqual(["inline"]);
  } finally {
    await inline.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("inline MCP server confines exports to allowed roots and honours exportRoots", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-inline-root-"));
  const outside = mkdtempSync(join(tmpdir(), "iploom-studio-inline-out-"));
  const extra = mkdtempSync(join(tmpdir(), "iploom-studio-inline-extra-"));
  const workspacePath = join(root, "workspace.json");
  await new WorkspaceStore(workspacePath).save(
    createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
  );
  try {
    const inline = await connectInline(workspacePath);
    try {
      const escaped = await call(inline, "export_arcreel_bundle", {
        novel_id: "work_tide_clock",
        approved_only: true,
        output_dir: outside,
      });
      expect(escaped.isError).toBe(true);
      expect(escaped.text).toContain("allowed export directories");
      expect(readdirSync(outside)).toEqual([]);

      const traversed = await call(inline, "export_arcreel_bundle", {
        novel_id: "work_tide_clock",
        approved_only: true,
        output_dir: `../${basename(root)}-escape`,
      });
      expect(traversed.isError).toBe(true);
      expect(existsSync(join(root, "..", `${basename(root)}-escape`))).toBe(
        false,
      );
    } finally {
      await inline.close();
    }

    const widened = await connectInline(workspacePath, {
      exportRoots: [extra],
    });
    try {
      const inExtra = await call(widened, "export_arcreel_bundle", {
        novel_id: "work_tide_clock",
        approved_only: true,
        output_dir: extra,
      });
      expect(inExtra.isError).toBe(false);
      expect(dirname(inExtra.body.directory as string)).toBe(extra);
      expect(existsSync(join(root, "exports"))).toBe(false);

      const stillOutside = await call(widened, "export_arcreel_bundle", {
        novel_id: "work_tide_clock",
        approved_only: true,
        output_dir: outside,
      });
      expect(stillOutside.isError).toBe(true);
      expect(stillOutside.text).toContain("allowed export directories");
    } finally {
      await widened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(extra, { recursive: true, force: true });
  }
});
