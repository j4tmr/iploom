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
  "list_workflow_tasks",
  "get_workflow_brief",
  "list_standards",
  "get_standard",
  "create_standard",
  "update_standard",
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
  const trainTask = structuredClone(workspace.workflowTasks[0]!);
  trainTask.id = "task_train_standards";
  trainTask.universeId = "uni_ninth_station";
  trainTask.workId = "work_last_train";
  trainTask.chapterId = "chapter_train_001";
  trainTask.characterIds = ["char_echo"];
  trainTask.parentId = undefined;
  trainTask.dependsOnIds = [];
  trainTask.standardRefs = [{ id: "std_baseline_language", version: 1 }];
  workspace.workflowTasks.push(trainTask);
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
      TOOL_NAMES.slice(0, 11)
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

    const tasks = await call(client, "list_workflow_tasks", {
      novel_id: "work_tide_clock",
    });
    expect(tasks.isError).toBe(false);
    expect(tasks.body.count).toBe(3);
    expect((tasks.body.summary as { ready: number }).ready).toBe(1);
    const taskItems = tasks.body.tasks as Array<{
      id: string;
      ready: boolean;
    }>;
    expect(taskItems.find((task) => task.id === "task_review_first")?.ready).toBe(
      true,
    );
    expect(taskItems.find((task) => task.id === "task_chapter_three")?.ready).toBe(
      false,
    );

    const taskBrief = await call(client, "get_workflow_brief", {
      task_id: "task_chapter_three",
      locale: "zh-CN",
    });
    expect(taskBrief.isError).toBe(false);
    expect(taskBrief.body.ready).toBe(false);
    expect(taskBrief.body.markdown).toContain("AI 任务简报");
    expect(taskBrief.body.markdown).toContain("task_world_rules");

    const missing = await call(client, "get_story_world", {
      world_id: "uni_missing",
    });
    expect(missing.isError).toBe(true);
    expect((missing.body.error as { code: string; message: string }).code).toBe(
      "not_found",
    );
    expect(missing.text).not.toContain("stack");
    expect(missing.text).not.toContain("\n    at ");

    const standards = await call(client, "list_standards");
    expect(standards.isError).toBe(false);
    expect(standards.text).not.toContain("\n");
    expect(standards.body.count).toBe(6);
    expect(standards.body.active_applied).toBe(6);
    const standardItems = standards.body.standards as Array<{
      id: string;
      kind: string;
      status: string;
      version: number;
      universe_id: string | null;
    }>;
    expect(standardItems.map((standard) => standard.id)).toEqual([
      "std_baseline_language",
      "std_baseline_format",
      "std_baseline_numeric",
      "std_baseline_entity_prompt",
      "std_baseline_canon",
      "std_baseline_text_source",
    ]);
    expect(
      standardItems.every(
        (standard) =>
          standard.status === "active" &&
          standard.version === 1 &&
          standard.universe_id === null,
      ),
    ).toBe(true);

    const continuity = await call(client, "list_standards", {
      kind: "continuity",
    });
    expect(continuity.isError).toBe(false);
    expect(continuity.body.count).toBe(2);

    const draftStandards = await call(client, "list_standards", {
      status: "draft",
    });
    expect(draftStandards.isError).toBe(false);
    expect(draftStandards.body.count).toBe(0);

    const standard = await call(client, "get_standard", {
      standard_id: "std_baseline_language",
    });
    expect(standard.isError).toBe(false);
    expect(standard.body.applies_to).toBe("project");
    const pinnedBy = standard.body.pinned_by_task_ids as string[];
    expect(pinnedBy).toHaveLength(5);
    expect(pinnedBy).toContain("task_world_rules");
    const standardData = standard.body.standard as {
      id: string;
      kind: string;
      universe_id: string | null;
      title: { zh: string; en: string };
    };
    expect(standardData.id).toBe("std_baseline_language");
    expect(standardData.kind).toBe("style");
    expect(standardData.universe_id).toBeNull();
    expect(standardData.title.zh.length).toBeGreaterThan(0);

    const missingStandard = await call(client, "get_standard", {
      standard_id: "std_missing",
    });
    expect(missingStandard.isError).toBe(true);
    expect(
      (missingStandard.body.error as { code: string; message: string }).code,
    ).toBe("not_found");
    expect(missingStandard.text).not.toContain("\n    at ");

    expect(readFileSync(workspacePath, "utf8")).toBe(before);

    const created = await call(client, "create_standard", {
      kind: "naming",
      title: {
        zh: "地名命名规范",
        en: "Place naming convention",
      },
      body: {
        zh: "所有地名先登记后使用，正文沿用登记写法。",
        en: "Register every place name before use and reuse the registered spelling.",
      },
    });
    expect(created.isError).toBe(false);
    expect(created.body.revision).toBe(8);
    const createdStandard = created.body.standard as {
      id: string;
      kind: string;
      status: string;
      version: number;
      universe_id: string | null;
      title: { zh: string; en: string };
    };
    expect(createdStandard.id.startsWith("std_")).toBe(true);
    expect(createdStandard.kind).toBe("naming");
    expect(createdStandard.status).toBe("draft");
    expect(createdStandard.version).toBe(1);
    expect(createdStandard.universe_id).toBeNull();
    const afterCreate = readFileSync(workspacePath, "utf8");
    expect(afterCreate).not.toBe(before);
    const writtenAfterCreate = JSON.parse(afterCreate) as {
      revision: number;
      standards: Array<{ id: string }>;
    };
    expect(writtenAfterCreate.revision).toBe(8);
    expect(writtenAfterCreate.standards).toHaveLength(7);
    expect(
      writtenAfterCreate.standards.some(
        (item) => item.id === createdStandard.id,
      ),
    ).toBe(true);

    const contentEdit = await call(client, "update_standard", {
      standard_id: createdStandard.id,
      title: {
        zh: "地名命名规范（修订）",
        en: "Place naming convention",
      },
    });
    expect(contentEdit.isError).toBe(false);
    expect(contentEdit.body.revision).toBe(9);
    expect(contentEdit.body.version_bumped).toBe(true);
    const contentEdited = contentEdit.body.standard as {
      version: number;
      status: string;
      title: { zh: string; en: string };
    };
    expect(contentEdited.version).toBe(2);
    expect(contentEdited.title.zh).toContain("修订");

    const statusEdit = await call(client, "update_standard", {
      standard_id: createdStandard.id,
      status: "active",
    });
    expect(statusEdit.isError).toBe(false);
    expect(statusEdit.body.revision).toBe(10);
    expect(statusEdit.body.version_bumped).toBe(false);
    const statusEdited = statusEdit.body.standard as {
      version: number;
      status: string;
    };
    expect(statusEdited.version).toBe(2);
    expect(statusEdited.status).toBe("active");

    const retarget = await call(client, "update_standard", {
      standard_id: "std_baseline_language",
      universe_id: "uni_mist_harbor",
    });
    expect(retarget.isError).toBe(false);
    expect(retarget.body.revision).toBe(11);
    expect(retarget.body.version_bumped).toBe(true);
    const retargeted = retarget.body.standard as {
      universe_id: string | null;
      version: number;
    };
    expect(retargeted.universe_id).toBe("uni_mist_harbor");
    expect(retargeted.version).toBe(2);

    const invalidKind = await call(client, "create_standard", {
      kind: "bogus",
      title: { zh: "无效类型", en: "Invalid kind" },
      body: { zh: "正文", en: "Body" },
    });
    expect(invalidKind.isError).toBe(true);
    expect(
      (invalidKind.body.error as { code: string; message: string }).code,
    ).toBe("invalid_argument");
    expect(invalidKind.text).not.toContain("\n    at ");

    const emptyTitle = await call(client, "create_standard", {
      kind: "style",
      title: { zh: "", en: "" },
      body: { zh: "正文", en: "Body" },
    });
    expect(emptyTitle.isError).toBe(true);
    expect(
      (emptyTitle.body.error as { code: string; message: string }).code,
    ).toBe("invalid_argument");
    expect(emptyTitle.text).not.toContain("\n    at ");

    const unknownUpdate = await call(client, "update_standard", {
      standard_id: "std_missing",
      status: "active",
    });
    expect(unknownUpdate.isError).toBe(true);
    expect(
      (unknownUpdate.body.error as { code: string; message: string }).code,
    ).toBe("not_found");

    const afterWrites = readFileSync(workspacePath, "utf8");
    const writtenAfterWrites = JSON.parse(afterWrites) as {
      revision: number;
      standards: Array<{ id: string; version: number; status: string }>;
      workflowTasks: Array<{
        id: string;
        standardRefs: Array<{ id: string; version: number }>;
      }>;
    };
    expect(writtenAfterWrites.revision).toBe(11);
    const trainAfterRetarget = writtenAfterWrites.workflowTasks.find(
      (task) => task.id === "task_train_standards",
    );
    expect(
      trainAfterRetarget?.standardRefs.some(
        (ref) => ref.id === "std_baseline_language",
      ),
    ).toBe(false);
    const tideAfterRetarget = writtenAfterWrites.workflowTasks.find(
      (task) => task.id === "task_review_first",
    );
    expect(
      tideAfterRetarget?.standardRefs.some(
        (ref) => ref.id === "std_baseline_language",
      ),
    ).toBe(true);
    expect(writtenAfterWrites.standards).toHaveLength(7);
    const persisted = writtenAfterWrites.standards.find(
      (item) => item.id === createdStandard.id,
    );
    expect(persisted?.version).toBe(2);
    expect(persisted?.status).toBe("active");

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
    expect(readFileSync(workspacePath, "utf8")).toBe(afterWrites);

    const keepScope = await call(client, "update_standard", {
      standard_id: "std_baseline_language",
      status: "draft",
    });
    expect(keepScope.isError).toBe(false);
    expect(keepScope.body.revision).toBe(12);
    expect(keepScope.body.version_bumped).toBe(false);
    expect(
      (keepScope.body.standard as { universe_id: string | null }).universe_id,
    ).toBe("uni_mist_harbor");

    const cleared = await call(client, "update_standard", {
      standard_id: "std_baseline_language",
      universe_id: null,
    });
    expect(cleared.isError).toBe(false);
    expect(cleared.body.revision).toBe(13);
    expect(cleared.body.version_bumped).toBe(true);
    const clearedStandard = cleared.body.standard as {
      universe_id: string | null;
      version: number;
    };
    expect(clearedStandard.universe_id).toBeNull();
    expect(clearedStandard.version).toBe(3);

    const keptCleared = await call(client, "update_standard", {
      standard_id: "std_baseline_language",
      status: "active",
    });
    expect(keptCleared.isError).toBe(false);
    expect(
      (keptCleared.body.standard as { universe_id: string | null }).universe_id,
    ).toBeNull();

    const emptyScope = await call(client, "create_standard", {
      kind: "style",
      title: { zh: "空范围规则", en: "Empty scope standard" },
      body: { zh: "正文", en: "Body" },
      universe_id: "",
    });
    expect(emptyScope.isError).toBe(false);
    expect(
      (emptyScope.body.standard as { universe_id: string | null }).universe_id,
    ).toBeNull();

    const finalWrite = JSON.parse(readFileSync(workspacePath, "utf8")) as {
      revision: number;
      standards: Array<{ id: string; universe_id?: string; version: number }>;
    };
    expect(finalWrite.revision).toBe(15);
    const baseline = finalWrite.standards.find(
      (item) => item.id === "std_baseline_language",
    );
    expect(baseline?.universe_id).toBeUndefined();
    expect(baseline?.version).toBe(3);
  } finally {
    await client.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

test("WorkspaceStore.update serializes concurrent mutations and recovers from failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-store-"));
  const workspacePath = join(root, "workspace.json");
  const store = new WorkspaceStore(workspacePath);
  try {
    await store.save(
      createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
    );
    const now = "2026-11-06T00:00:01.000Z";
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        store.update((workspace) => {
          workspace.standards.push({
            id: `std_concurrent_${index}`,
            title: { zh: `并发规则 ${index}`, en: `Concurrent ${index}` },
            kind: "naming",
            body: { zh: "正文", en: "Body" },
            status: "draft",
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        }),
      ),
    );
    expect(results.map((result) => result.revision).sort((a, b) => a - b)).toEqual(
      [8, 9, 10, 11, 12],
    );
    let current = (await store.load()).workspace;
    expect(current.standards).toHaveLength(11);
    expect(current.revision).toBe(12);

    await expect(
      store.update(() => {
        throw new Error("mutator failed");
      }),
    ).rejects.toThrow("mutator failed");
    current = (await store.load()).workspace;
    expect(current.revision).toBe(12);

    const recovered = await store.update((workspace) => {
      workspace.name = "Recovered";
    });
    expect(recovered.revision).toBe(13);
    expect(recovered.name).toBe("Recovered");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
