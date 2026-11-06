import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";

const TOOL_NAMES = [
  "list_story_worlds",
  "get_story_world",
  "list_novels",
  "get_novel",
  "get_chapter",
  "search_ip",
  "get_relationship_graph",
  "export_arcreel_bundle",
] as const;

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const text = result.content.find(
    (item): item is { type: "text"; text: string } => item.type === "text",
  )?.text;
  if (!text) throw new Error("MCP tool result did not contain a text block.");
  return text;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  const text = resultText(result);
  return {
    isError: result.isError === true,
    text,
    body: JSON.parse(text) as Record<string, unknown>,
  };
}

test("real stdio MCP exposes all Studio tools and writes readable ArcReel packages", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-mcp-"));
  const workspacePath = join(root, "workspace.json");
  const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
  await new WorkspaceStore(workspacePath).save(workspace);
  const before = readFileSync(workspacePath, "utf8");
  const serverPath = resolve(
    import.meta.dir,
    "../../apps/studio/mcp/server.ts",
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, "--workspace", workspacePath],
    cwd: root,
    stderr: "pipe",
  });
  const client = new Client({
    name: "iploom-studio-mcp-test",
    version: "0.3.0",
  });

  try {
    await client.connect(transport);
    expect(client.getServerVersion()?.name).toBe("IPloom Studio");
    expect(client.getServerCapabilities()?.tools).toBeDefined();

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(TOOL_NAMES.length);
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      [...TOOL_NAMES].sort(),
    );
    for (const tool of listed.tools) {
      expect(tool.description ?? "").toMatch(/[\u3400-\u9fff]/);
      expect(tool.description ?? "").toMatch(/[A-Za-z]{3}/);
    }
    const readOnlyNames = listed.tools
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name)
      .sort();
    expect(readOnlyNames).toEqual(
      TOOL_NAMES.slice(0, 7)
        .map((name) => name)
        .sort(),
    );
    expect(
      listed.tools.find((tool) => tool.name === "export_arcreel_bundle")
        ?.annotations?.readOnlyHint,
    ).toBe(false);

    const worlds = await call(client, "list_story_worlds");
    expect(worlds.isError).toBe(false);
    expect(worlds.body.count).toBe(2);
    expect(worlds.text).not.toContain("\n");

    const world = await call(client, "get_story_world", {
      world_id: "uni_mist_harbor",
    });
    expect(world.isError).toBe(false);
    const worldData = world.body.world as {
      name: { zh: string; en: string };
      stats: { characters: number; relationships: number };
    };
    expect(worldData.name).toEqual({
      zh: "雾港",
      en: "Mist Harbor",
    });
    expect(worldData.stats).toMatchObject({
      characters: 4,
      relationships: 4,
    });
    expect(
      (world.body.characters as Array<{ reusable: boolean }>).filter(
        (character) => character.reusable,
      ),
    ).toHaveLength(2);

    const novels = await call(client, "list_novels", {
      world_id: "uni_mist_harbor",
    });
    expect(novels.isError).toBe(false);
    expect(novels.body.count).toBe(1);
    expect((novels.body.novels as Array<{ id: string }>)[0]?.id).toBe(
      "work_tide_clock",
    );

    const novel = await call(client, "get_novel", {
      novel_id: "work_tide_clock",
    });
    expect(novel.isError).toBe(false);
    expect((novel.body.novel as { chapters: unknown[] }).chapters).toHaveLength(
      3,
    );

    const chapter = await call(client, "get_chapter", {
      novel_id: "work_tide_clock",
      chapter_id: "chapter_tide_001",
    });
    expect(chapter.isError).toBe(false);
    const chapterData = chapter.body.chapter as {
      content: string;
      word_count: number;
      character_ids: string[];
    };
    expect(chapterData.content).toContain("雾港的雨从不下在水面上");
    expect(chapterData.word_count).toBeGreaterThan(100);
    expect(chapterData.character_ids).toContain("char_lin");

    const search = await call(client, "search_ip", {
      query: "钥匙",
      world_id: "uni_mist_harbor",
      locale: "zh-CN",
    });
    expect(search.isError).toBe(false);
    const hits = search.body.hits as Array<{
      kind: string;
      id: string;
    }>;
    expect(hits.some((hit) => hit.kind === "chapter")).toBe(true);
    expect(hits.some((hit) => hit.id === "chapter_tide_002")).toBe(true);

    const graph = await call(client, "get_relationship_graph", {
      world_id: "uni_mist_harbor",
      locale: "en",
    });
    expect(graph.isError).toBe(false);
    expect(graph.body.edges).toHaveLength(4);
    const nodes = graph.body.nodes as Array<{
      id: string;
      degree: number;
    }>;
    expect(nodes.find((node) => node.id === "char_lin")?.degree).toBe(3);
    expect(graph.body.warnings).toEqual([]);

    const missing = await call(client, "get_story_world", {
      world_id: "uni_missing",
    });
    expect(missing.isError).toBe(true);
    expect((missing.body.error as { code: string; message: string }).code).toBe(
      "not_found",
    );
    expect(missing.text).not.toContain("stack");
    expect(missing.text).not.toContain("\n    at ");

    expect(readFileSync(workspacePath, "utf8")).toBe(before);

    const exported = await call(client, "export_arcreel_bundle", {
      novel_id: "work_tide_clock",
    });
    expect(exported.isError).toBe(false);
    const exportedData = exported.body as unknown as {
      directory: string;
      files_written: number;
      paths: string[];
      totals: { chapters?: number; shots: number };
    };
    expect(exportedData.directory.startsWith(join(root, "exports"))).toBe(true);
    expect(dirname(exportedData.directory)).toBe(join(root, "exports"));
    expect(exportedData.files_written).toBe(exportedData.paths.length);
    expect(exportedData.paths).toContain("manifest.json");
    expect(exportedData.paths).toContain("handoff.md");
    expect(exportedData.totals.shots).toBeGreaterThan(0);
    for (const relativePath of exportedData.paths) {
      expect(
        readFileSync(join(exportedData.directory, relativePath), "utf8").length,
      ).toBeGreaterThan(0);
    }
    const manifest = JSON.parse(
      readFileSync(join(exportedData.directory, "manifest.json"), "utf8"),
    ) as {
      schema: string;
      adaptation: {
        style: string;
        totals: { chapters: number; shots: number };
      };
      files: unknown[];
    };
    expect(manifest.schema).toBe("iploom.arcreel.manifest/v1");
    expect(manifest.adaptation.style).toBe("stylized-3d-animation");
    expect(manifest.adaptation.totals.chapters).toBe(3);
    expect(manifest.files).toHaveLength(exportedData.files_written - 1);
    const worldBundle = JSON.parse(
      readFileSync(join(exportedData.directory, "world.json"), "utf8"),
    ) as {
      relationships: unknown[];
      relationship_graph: { edges: unknown[] };
    };
    expect(worldBundle.relationships).toHaveLength(4);
    expect(worldBundle.relationship_graph.edges).toHaveLength(4);

    const custom = await call(client, "export_arcreel_bundle", {
      novel_id: "work_tide_clock",
      chapter_ids: ["chapter_tide_001"],
      output_dir: "custom-exports",
      approved_only: true,
    });
    expect(custom.isError).toBe(false);
    const customData = custom.body as unknown as {
      directory: string;
      chapters: Array<{ chapterId: string }>;
    };
    expect(dirname(customData.directory)).toBe(join(root, "custom-exports"));
    expect(customData.chapters).toHaveLength(1);
    expect(customData.chapters[0]?.chapterId).toBe("chapter_tide_001");
    expect(readFileSync(workspacePath, "utf8")).toBe(before);
  } finally {
    await client.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
