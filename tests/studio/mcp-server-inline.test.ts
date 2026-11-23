import { expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyConstruct } from "../../apps/studio/src/core/cards.ts";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { quickBuildWork } from "../../apps/studio/src/core/quick-build.ts";
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

async function connectInline(workspacePath: string): Promise<InlineServer> {
  const client = new Client({
    name: "iploom-studio-inline-test",
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

test("inline MCP server exposes every tool and answers reads and writes", async () => {
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

    const timelineCreated = await call(inline, "create_timeline_event", {
      world_id: "uni_mist_harbor",
      novel_id: "work_tide_clock",
      chapter_id: "chapter_tide_002",
      story_time: "第二夜 / Night two",
      subject_kind: "character",
      subject_id: "char_lin",
      event_kind: "state-change",
      title: { zh: "林接下守夜", en: "Lin takes the night watch" },
      state_before: "Lin avoids the tower.",
      state_after: "Lin keeps the night watch.",
      related_character_ids: ["char_shen"],
      related_location_ids: ["loc_old_tower"],
      related_object_ids: ["object_brass_key"],
      evidence: "Chapter two draft.",
    });
    expect(timelineCreated.isError).toBe(false);
    const createdEvent = timelineCreated.body.event as {
      id: string;
      chapter_id: string | null;
      canon_status: string;
      subject: { kind: string; id: string; label: string };
      related_character_id_count: number;
      created_at: string;
    };
    expect(createdEvent.id.startsWith("timeline_")).toBe(true);
    expect(createdEvent.chapter_id).toBe("chapter_tide_002");
    expect(createdEvent.canon_status).toBe("proposed");
    expect(createdEvent.subject.kind).toBe("character");
    expect(createdEvent.subject.id).toBe("char_lin");
    expect(createdEvent.related_character_id_count).toBe(1);

    const timelineRevised = await call(inline, "update_timeline_event", {
      event_id: createdEvent.id,
      canon_status: "canon",
      title: { en: "Lin keeps the night watch alone" },
      chapter_id: null,
    });
    expect(timelineRevised.isError).toBe(false);
    const revisedEvent = timelineRevised.body.event as {
      chapter_id: string | null;
      story_time: string;
      canon_status: string;
      title: { zh: string; en: string };
      state_before: string;
      created_at: string;
    };
    expect(revisedEvent.chapter_id).toBeNull();
    expect(revisedEvent.story_time).toBe("第二夜 / Night two");
    expect(revisedEvent.canon_status).toBe("canon");
    expect(revisedEvent.title.zh).toBe("林接下守夜");
    expect(revisedEvent.title.en).toBe("Lin keeps the night watch alone");
    expect(revisedEvent.state_before).toBe("Lin avoids the tower.");
    expect(revisedEvent.created_at).toBe(createdEvent.created_at);

    const missingEvent = await call(inline, "update_timeline_event", {
      event_id: "timeline_missing",
      canon_status: "canon",
    });
    expect(missingEvent.isError).toBe(true);
    expect((missingEvent.body.error as { code: string }).code).toBe(
      "not_found",
    );

    const unanchoredEvent = await call(inline, "create_timeline_event", {
      world_id: "uni_mist_harbor",
      novel_id: "work_tide_clock",
      subject_kind: "character",
      subject_id: "char_lin",
      event_kind: "state-change",
      title: { zh: "没有锚点的事件", en: "Event without an anchor" },
    });
    expect(unanchoredEvent.isError).toBe(true);
    expect((unanchoredEvent.body.error as { code: string }).code).toBe(
      "invalid_arguments",
    );
  } finally {
    await inline.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("get_workflow_result returns full text and the first snapshot without writing", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-inline-result-read-"));
  const workspacePath = join(root, "workspace.json");
  const store = new WorkspaceStore(workspacePath);
  await store.save(createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z"));
  const inline = await connectInline(workspacePath);
  const zhFirst = "世界规则审查：潮汐每日提前十一分钟。";
  const enFirst =
    "World rule review: the tide advances eleven minutes each day.";
  const zhSecond = "世界规则审查（修订）：潮汐提前，钟声晚一拍。";
  try {
    const empty = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
    });
    expect(empty.isError).toBe(false);
    expect(empty.body.revision).toBe(7);
    expect(empty.body.result).toEqual({ zh: "", en: "" });
    expect(empty.body.previous_result).toBeNull();
    const emptyTask = empty.body.task as {
      id: string;
      result?: unknown;
      result_chars: { zh: number; en: number };
    };
    expect(emptyTask.id).toBe("task_world_rules");
    // The summary keeps its compact shape; full text lives in `result`.
    expect(emptyTask.result).toBeUndefined();
    expect(emptyTask.result_chars).toEqual({ zh: 0, en: 0 });

    const firstSave = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: { zh: zhFirst, en: enFirst },
    });
    expect(firstSave.isError).toBe(false);
    const secondSave = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: { zh: zhSecond },
    });
    expect(secondSave.isError).toBe(false);
    expect(secondSave.body.revision).toBe(9);

    const read = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
    });
    expect(read.isError).toBe(false);
    expect(read.body.revision).toBe(9);
    // Both languages come back in full, including the one the patch omitted.
    expect(read.body.result).toEqual({ zh: zhSecond, en: enFirst });
    // The first pre-change snapshot survives the later revision.
    expect(read.body.previous_result).toEqual({ zh: zhFirst, en: enFirst });
    expect(
      (read.body.task as { result_chars: { zh: number; en: number } })
        .result_chars,
    ).toEqual({ zh: zhSecond.length, en: enFirst.length });

    // Reading never writes or bumps the revision.
    expect((await store.load()).workspace.revision).toBe(9);

    const missing = await call(inline, "get_workflow_result", {
      task_id: "task_missing",
    });
    expect(missing.isError).toBe(true);
    expect((missing.body.error as { code: string }).code).toBe("not_found");

    // A window reassembles both languages exactly, one page at a time.
    const win1 = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      offset: 0,
      max_chars: 4,
    });
    expect(win1.isError).toBe(false);
    const win1Body = win1.body as {
      result: Record<
        "zh" | "en",
        {
          text: string;
          total_chars: number;
          next_offset: number | null;
          truncated: boolean;
        }
      >;
    };
    expect(win1Body.result.zh.text).toBe(zhSecond.slice(0, 4));
    expect(win1Body.result.en.text).toBe(enFirst.slice(0, 4));
    expect(win1Body.result.zh.next_offset).toBe(4);
    expect(win1Body.result.zh.truncated).toBe(true);

    const win2 = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      result_offsets: { zh: 4, en: 4 },
      max_chars: 4,
    });
    expect(win2.isError).toBe(false);
    const win2Body = win2.body as {
      result: Record<
        "zh" | "en",
        {
          text: string;
          total_chars: number;
          next_offset: number | null;
          truncated: boolean;
        }
      >;
    };
    expect(win2Body.result.zh.text).toBe(zhSecond.slice(4, 8));
    expect(win2Body.result.zh.next_offset).toBe(8);
    expect(win2Body.result.zh.truncated).toBe(true);
    expect(win2Body.result.en.next_offset).toBe(8);

    // A past-the-end offset returns empty text and ends paging.
    const win3 = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      result_offsets: { zh: 22, en: 61 },
      max_chars: 4,
    });
    expect(win3.isError).toBe(false);
    const win3Body = win3.body as {
      result: Record<
        "zh" | "en",
        {
          text: string;
          total_chars: number;
          next_offset: number | null;
          truncated: boolean;
        }
      >;
    };
    expect(win3Body.result.zh.text).toBe("");
    expect(win3Body.result.zh.next_offset).toBeNull();
    expect(win3Body.result.en.text).toBe("");
    expect(win3Body.result.en.next_offset).toBeNull();

    // The pre-change snapshot pages with the same offsets: the shared window
    // cuts both texts at the same positions, each carrying its own length.
    const snap1 = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      offset: 0,
      max_chars: 4,
    });
    expect(snap1.isError).toBe(false);
    const snap1Body = snap1.body as {
      previous_result: Record<
        "zh" | "en",
        {
          text: string;
          total_chars: number;
          next_offset: number | null;
          truncated: boolean;
        }
      >;
    };
    expect(snap1Body.previous_result.zh.text).toBe(zhFirst.slice(0, 4));
    expect(snap1Body.previous_result.zh.total_chars).toBe(zhFirst.length);
    expect(snap1Body.previous_result.zh.truncated).toBe(true);
    expect(snap1Body.previous_result.en.text).toBe(enFirst.slice(0, 4));
    expect(snap1Body.previous_result.en.total_chars).toBe(enFirst.length);
    expect(snap1Body.previous_result.en.next_offset).toBe(4);

    const snap2 = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      result_offsets: { zh: 4, en: 4 },
      max_chars: 4,
    });
    expect(snap2.isError).toBe(false);
    const snap2Body = snap2.body as {
      previous_result: Record<
        "zh" | "en",
        {
          text: string;
          next_offset: number | null;
          truncated: boolean;
        }
      >;
    };
    expect(snap2Body.previous_result.zh.text).toBe(zhFirst.slice(4, 8));
    // zh is exactly 18 chars, so zh finishes one page before en does.
    expect(snap2Body.previous_result.zh.next_offset).toBe(
      zhFirst.length === 8 ? 8 : zhFirst.length > 8 ? 8 : null,
    );
    expect(snap2Body.previous_result.en.next_offset).toBe(8);

    // The snapshot reassembles exactly, language by language.
    const snapLast = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      result_offsets: {
        zh: zhFirst.length,
        en: enFirst.length,
      },
      max_chars: 4,
    });
    expect(snapLast.isError).toBe(false);
    const snapLastBody = snapLast.body as {
      previous_result: Record<
        "zh" | "en",
        { text: string; next_offset: number | null }
      >;
    };
    expect(snapLastBody.previous_result.zh.text).toBe("");
    expect(snapLastBody.previous_result.zh.next_offset).toBeNull();
    expect(snapLastBody.previous_result.en.text).toBe("");
    expect(snapLastBody.previous_result.en.next_offset).toBeNull();

    // A full snapshot read in lockstep windows rebuilds both texts: zh pages
    // by half its length; en is longer, so its windows chain by next_offset.
    const snapHalf = Math.ceil(zhFirst.length / 2);
    const snapA = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      offset: 0,
      max_chars: snapHalf,
    });
    expect(snapA.isError).toBe(false);
    const snapABody = snapA.body as {
      previous_result: Record<
        "zh" | "en",
        { text: string; next_offset: number | null }
      >;
    };
    const enMid = snapABody.previous_result.en.next_offset;
    expect(enMid).not.toBeNull();
    const snapB = await call(inline, "get_workflow_result", {
      task_id: "task_world_rules",
      result_offsets: {
        zh: snapHalf,
        en: enMid as number,
      },
      max_chars: snapHalf,
    });
    expect(snapB.isError).toBe(false);
    const snapBBody = snapB.body as {
      previous_result: Record<
        "zh" | "en",
        { text: string; next_offset: number | null }
      >;
    };
    expect(
      snapABody.previous_result.zh.text + snapBBody.previous_result.zh.text,
    ).toBe(zhFirst);
    // zh is done after page B; en keeps chaining from its own next_offset
    // until its own end, reassembling the whole snapshot.
    expect(snapBBody.previous_result.zh.next_offset).toBeNull();
    let enText = snapABody.previous_result.en.text;
    let enOffset: number | null = snapABody.previous_result.en.next_offset;
    let guard = 0;
    while (enOffset !== null && guard < 20) {
      const page = await call(inline, "get_workflow_result", {
        task_id: "task_world_rules",
        result_offsets: {
          zh: zhFirst.length,
          en: enOffset,
        },
        max_chars: snapHalf,
      });
      expect(page.isError).toBe(false);
      const pageBody = page.body as {
        previous_result: Record<
          "zh" | "en",
          { text: string; next_offset: number | null }
        >;
      };
      expect(pageBody.previous_result.zh.text).toBe("");
      enText += pageBody.previous_result.en.text;
      enOffset = pageBody.previous_result.en.next_offset;
      guard += 1;
    }
    expect(enText).toBe(enFirst);
    expect(enOffset).toBeNull();
  } finally {
    await inline.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("save_workflow_result merges languages, keeps the first snapshot and protects done tasks", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-inline-result-"));
  const workspacePath = join(root, "workspace.json");
  const store = new WorkspaceStore(workspacePath);
  await store.save(createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z"));
  const inline = await connectInline(workspacePath);
  const zhFirst = "世界规则审查：潮汐每日提前十一分钟。";
  const enFirst =
    "World rule review: the tide advances eleven minutes each day.";
  try {
    const first = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: { zh: zhFirst, en: enFirst },
    });
    expect(first.isError).toBe(false);
    expect(first.body.revision).toBe(8);
    const firstTask = first.body.task as {
      id: string;
      status: string;
      result?: unknown;
      result_chars: { zh: number; en: number };
      result_excerpt: { zh: string; en: string };
      previous_result_chars: { zh: number; en: number } | null;
      result_superseded: boolean;
    };
    expect(firstTask.id).toBe("task_world_rules");
    expect(firstTask.status).toBe("review");
    // The full result is stored but not echoed back.
    expect(firstTask.result).toBeUndefined();
    expect(firstTask.result_chars).toEqual({
      zh: zhFirst.length,
      en: enFirst.length,
    });
    expect(firstTask.result_excerpt.zh).toBe(zhFirst);
    expect(firstTask.previous_result_chars).toBeNull();
    expect(firstTask.result_superseded).toBe(false);

    const zhSecond = "世界规则审查（修订）：潮汐提前，钟声晚一拍。";
    const zhOnly = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: { zh: zhSecond },
    });
    expect(zhOnly.isError).toBe(false);
    expect(zhOnly.body.revision).toBe(9);
    const zhOnlyTask = zhOnly.body.task as {
      result_chars: { zh: number; en: number };
      previous_result_chars: { zh: number; en: number } | null;
    };
    // Omitting en keeps the stored English text.
    expect(zhOnlyTask.result_chars).toEqual({
      zh: zhSecond.length,
      en: enFirst.length,
    });
    // The first pre-change snapshot survives later revisions.
    expect(zhOnlyTask.previous_result_chars).toEqual({
      zh: zhFirst.length,
      en: enFirst.length,
    });

    await store.update((workspace) => {
      const dependent = workspace.workflowTasks.find(
        (task) => task.id === "task_chapter_three",
      );
      const producer = workspace.workflowTasks.find(
        (task) => task.id === "task_world_rules",
      );
      if (dependent) dependent.status = "done";
      if (producer) producer.resultSuperseded = true;
    });

    const zhThird = "世界规则审查（终稿）：潮汐提前且钟楼停摆。";
    const changed = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: { zh: zhThird },
    });
    expect(changed.isError).toBe(false);
    expect(changed.body.revision).toBe(11);
    expect(
      (changed.body.task as { result_superseded: boolean }).result_superseded,
    ).toBe(false);
    let current = (await store.load()).workspace;
    // A done task that consumes the changed result is flagged for re-review.
    expect(
      current.workflowTasks.find((task) => task.id === "task_chapter_three")
        ?.resultSuperseded,
    ).toBe(true);

    // A done task keeps its approved result until an author reopens it.
    const doneTask = await call(inline, "save_workflow_result", {
      task_id: "task_chapter_three",
      result: { zh: "未经审阅的新结果。" },
    });
    expect(doneTask.isError).toBe(true);
    const doneError = doneTask.body.error as { code: string; message: string };
    expect(doneError.code).toBe("invalid_arguments");
    expect(doneError.message).toContain("done");
    current = (await store.load()).workspace;
    expect(current.revision).toBe(11);

    const cleared = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: { en: "" },
    });
    expect(cleared.isError).toBe(false);
    expect(cleared.body.revision).toBe(12);
    expect(
      (cleared.body.task as { result_chars: { zh: number; en: number } })
        .result_chars,
    ).toEqual({ zh: zhThird.length, en: 0 });

    // Neither language can both be empty, and neither can the patch be empty.
    const bothEmpty = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: { zh: "", en: "" },
    });
    expect(bothEmpty.isError).toBe(true);
    expect((bothEmpty.body.error as { code: string }).code).toBe(
      "invalid_arguments",
    );
    const emptyPatch = await call(inline, "save_workflow_result", {
      task_id: "task_world_rules",
      result: {},
    });
    expect(emptyPatch.isError).toBe(true);
    expect((emptyPatch.body.error as { code: string }).code).toBe(
      "invalid_arguments",
    );
    const missingTask = await call(inline, "save_workflow_result", {
      task_id: "task_missing",
      result: { zh: "无此任务。" },
    });
    expect(missingTask.isError).toBe(true);
    expect((missingTask.body.error as { code: string }).code).toBe("not_found");

    const stored = (await store.load()).workspace;
    expect(stored.revision).toBe(12);
    const storedProducer = stored.workflowTasks.find(
      (task) => task.id === "task_world_rules",
    );
    expect(storedProducer?.status).toBe("review");
    expect(storedProducer?.result).toEqual({ zh: zhThird, en: "" });
    expect(storedProducer?.previousResult).toEqual({
      zh: zhFirst,
      en: enFirst,
    });
  } finally {
    await inline.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("get_workflow_brief injects approved ancestor outputs only when opted in", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-inline-brief-"));
  const workspacePath = join(root, "workspace.json");
  const store = new WorkspaceStore(workspacePath);
  await store.save(createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z"));

  // No demo task is done, so approve the direct dependency first: without a
  // result there is nothing to inject even when the ancestor counts as done.
  await store.update((workspace) => {
    const rules = workspace.workflowTasks.find(
      (task) => task.id === "task_world_rules",
    );
    if (!rules) throw new Error("demo workspace lost task_world_rules");
    rules.status = "done";
    rules.result = {
      zh: "潮汐规则已定稿：潮水每日提前十一分钟，钟楼在满潮时鸣钟。",
      en: "Tide rule finalized: the tide advances eleven minutes each day, and the clock tower tolls at high tide.",
    };
  });

  const inline = await connectInline(workspacePath);
  try {
    // Default call stays untouched: no approved-outputs section appears.
    const plain = await call(inline, "get_workflow_brief", {
      task_id: "task_chapter_three",
      locale: "en",
    });
    expect(plain.isError).toBe(false);
    const plainText = (plain.body.markdown as { text: string }).text;
    expect(plainText).not.toContain("APPROVED DEPENDENCY OUTPUTS");

    // Opt-in injects the ancestor output with the production-prompt heading.
    // The window must be wide enough to reach the section: the brief is
    // windowed from the top, and the section sits after the dependency tree.
    const enriched = await call(inline, "get_workflow_brief", {
      task_id: "task_chapter_three",
      locale: "en",
      include_approved_outputs: true,
      max_chars: 100_000,
    });
    expect(enriched.isError).toBe(false);
    const enrichedText = (enriched.body.markdown as { text: string }).text;
    expect(enrichedText).toContain("APPROVED DEPENDENCY OUTPUTS");
    expect(enrichedText).toContain("Tide rule finalized");
    expect(enrichedText).not.toContain("[…truncated]");

    // A budget slightly above the bare brief clips the output to an equal
    // share of the remaining window, so the assembled brief stays within
    // max_chars and the cut carries the same […truncated] marker as the
    // in-app production prompt. The bare length is derived from the full
    // read: the item body is the result text, or "—" when emptied.
    const bareLen =
      enrichedText.length -
      "Tide rule finalized: the tide advances eleven minutes each day, and the clock tower tolls at high tide."
        .length +
      1;
    const clipped = await call(inline, "get_workflow_brief", {
      task_id: "task_chapter_three",
      locale: "en",
      include_approved_outputs: true,
      max_chars: bareLen + 60,
    });
    expect(clipped.isError).toBe(false);
    const clippedText = (clipped.body.markdown as { text: string }).text;
    expect(clippedText.length).toBeLessThanOrEqual(bareLen + 60);
    expect(clippedText).toContain("[…truncated]");
    expect(clippedText).toContain("APPROVED DEPENDENCY OUTPUTS");

    // A window smaller than the bare brief leaves no share at all: the
    // output collapses to the "—" placeholder instead of a bare marker,
    // and the response still respects the requested window size.
    const tiny = await call(inline, "get_workflow_brief", {
      task_id: "task_chapter_three",
      locale: "en",
      include_approved_outputs: true,
      max_chars: 900,
    });
    expect(tiny.isError).toBe(false);
    expect(
      (tiny.body.markdown as { text: string }).text.length,
    ).toBeLessThanOrEqual(900);

    // A task with no approved ancestors never gets an empty section.
    const noDeps = await call(inline, "get_workflow_brief", {
      task_id: "task_world_rules",
      locale: "en",
      include_approved_outputs: true,
    });
    expect(noDeps.isError).toBe(false);
    expect((noDeps.body.markdown as { text: string }).text).not.toContain(
      "APPROVED DEPENDENCY OUTPUTS",
    );
  } finally {
    await inline.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rule-layer MCP read/write tools validate references, page sub-collections and audit consistency", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-inline-rules-"));
  const workspacePath = join(root, "workspace.json");
  await new WorkspaceStore(workspacePath).save(
    createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z"),
  );
  const inline = await connectInline(workspacePath);
  try {
    // 1. Create a structured rule system (defaults to draft)
    const created = await call(inline, "create_rule_system", {
      world_id: "uni_mist_harbor",
      title: { zh: "潮汐等级", en: "Tide ladder" },
      kind: "power",
      summary: "钟声强度分级",
      unit: "级",
      tiers: [
        {
          id: "tier_1",
          name: { zh: "初响", en: "First chime" },
          rank: 1,
          min_value: 1,
          max_value: 9,
        },
        {
          id: "tier_2",
          name: { zh: "深钟", en: "Deep bell" },
          rank: 2,
          min_value: 10,
          max_value: 20,
        },
      ],
      attributes: [
        {
          key: "resonance",
          label: { zh: "共鸣", en: "Resonance" },
          type: "integer",
          unit: "点",
          min: 0,
          max: 100,
          default_value: 10,
        },
      ],
    });
    expect(created.isError).toBe(false);
    const system = created.body.rule_system as {
      id: string;
      status: string;
      version: number;
    };
    expect(system.id.startsWith("rules_")).toBe(true);
    expect(system.status).toBe("draft");
    expect(system.version).toBe(1);

    // Invalid rule system (missing range on power tier) is rejected with issues
    const badSystem = await call(inline, "create_rule_system", {
      world_id: "uni_mist_harbor",
      title: { zh: "坏规则", en: "Broken" },
      kind: "power",
      tiers: [
        { name: { zh: "一阶", en: "One" }, rank: 1 },
        { name: { zh: "二阶", en: "Two" }, rank: 2 },
      ],
    });
    expect(badSystem.isError).toBe(true);
    expect((badSystem.body.error as { code: string }).code).toBe(
      "invalid_arguments",
    );

    // Status-only update does not bump version; content update bumps version
    const activated = await call(inline, "update_rule_system", {
      rule_system_id: system.id,
      status: "active",
    });
    expect(activated.isError).toBe(false);
    expect(activated.body.version_bumped).toBe(false);

    const revised = await call(inline, "update_rule_system", {
      rule_system_id: system.id,
      title: { en: "Tide Resonance Ladder" },
    });
    expect(revised.isError).toBe(false);
    expect(revised.body.version_bumped).toBe(true);
    expect((revised.body.rule_system as { version: number }).version).toBe(2);

    const missingSystem = await call(inline, "update_rule_system", {
      rule_system_id: "rules_missing",
      status: "active",
    });
    expect(missingSystem.isError).toBe(true);
    expect((missingSystem.body.error as { code: string }).code).toBe(
      "not_found",
    );

    // 2. Upsert ability template (create + update + error cases)
    const missingAbilitySys = await call(inline, "upsert_ability_template", {
      name: { zh: "缺体系", en: "No system" },
    });
    expect(missingAbilitySys.isError).toBe(true);

    const abilityCreated = await call(inline, "upsert_ability_template", {
      rule_system_id: system.id,
      name: { zh: "深钟共鸣", en: "Deep resonance" },
      summary: { zh: "提升共鸣", en: "Boosts resonance" },
      tier_id: "tier_2",
      effects: [{ attribute_key: "resonance", operation: "add", value: 15 }],
      cost: "一段记忆",
    });
    expect(abilityCreated.isError).toBe(false);
    expect(abilityCreated.body.created).toBe(true);
    const abilityId = (abilityCreated.body.ability_template as { id: string })
      .id;

    const abilityUpdated = await call(inline, "upsert_ability_template", {
      ability_id: abilityId,
      tier_id: null,
      cost: "两段记忆",
    });
    expect(abilityUpdated.isError).toBe(false);
    expect(abilityUpdated.body.created).toBe(false);
    expect(
      (abilityUpdated.body.ability_template as { tier_id: string | null })
        .tier_id,
    ).toBeNull();

    const badAbilityEffect = await call(inline, "upsert_ability_template", {
      rule_system_id: system.id,
      name: { zh: "无效技能", en: "Bad ability" },
      effects: [{ attribute_key: "unknown_attr", operation: "add", value: 1 }],
    });
    expect(badAbilityEffect.isError).toBe(true);

    const missingAbilityUpdate = await call(inline, "upsert_ability_template", {
      ability_id: "ability_missing",
      cost: "none",
    });
    expect(missingAbilityUpdate.isError).toBe(true);
    expect((missingAbilityUpdate.body.error as { code: string }).code).toBe(
      "not_found",
    );

    // 3. Upsert item stat template (create + update + error cases)
    const missingItemSys = await call(inline, "upsert_item_stat_template", {
      name: { zh: "缺体系", en: "No system" },
      category: { zh: "遗物", en: "Relic" },
    });
    expect(missingItemSys.isError).toBe(true);

    const itemCreated = await call(inline, "upsert_item_stat_template", {
      rule_system_id: system.id,
      name: { zh: "铜钥模版", en: "Brass key stats" },
      category: { zh: "遗物", en: "Relic" },
      tier_id: "tier_1",
      stats: [{ attribute_key: "resonance", operation: "add", value: 5 }],
    });
    expect(itemCreated.isError).toBe(false);
    expect(itemCreated.body.created).toBe(true);
    const itemTemplateId = (
      itemCreated.body.item_stat_template as { id: string }
    ).id;

    const itemUpdated = await call(inline, "upsert_item_stat_template", {
      item_template_id: itemTemplateId,
      name: { en: "Notched key template" },
      tier_id: "tier_2",
    });
    expect(itemUpdated.isError).toBe(false);
    expect(itemUpdated.body.created).toBe(false);

    const badItemStats = await call(inline, "upsert_item_stat_template", {
      rule_system_id: system.id,
      name: { zh: "坏物品", en: "Bad item" },
      category: { zh: "遗物", en: "Relic" },
      stats: [{ attribute_key: "resonance", operation: "set", value: 999 }],
    });
    expect(badItemStats.isError).toBe(true);

    const missingItemUpdate = await call(inline, "upsert_item_stat_template", {
      item_template_id: "item_missing",
    });
    expect(missingItemUpdate.isError).toBe(true);
    expect((missingItemUpdate.body.error as { code: string }).code).toBe(
      "not_found",
    );

    // 4. Bind character & story object, plus validation & clear
    const charBound = await call(inline, "set_entity_rule_binding", {
      entity_kind: "character",
      entity_id: "char_lin",
      rule_system_id: system.id,
      tier_id: "tier_2",
      attributes: { resonance: 60 },
      ability_ids: [abilityId],
    });
    expect(charBound.isError).toBe(false);
    expect((charBound.body.binding as { tier_id: string }).tier_id).toBe(
      "tier_2",
    );

    const charOutOfBounds = await call(inline, "set_entity_rule_binding", {
      entity_kind: "character",
      entity_id: "char_lin",
      rule_system_id: system.id,
      attributes: { resonance: 500 },
    });
    expect(charOutOfBounds.isError).toBe(true);
    expect((charOutOfBounds.body.error as { code: string }).code).toBe(
      "invalid_arguments",
    );

    const missingChar = await call(inline, "set_entity_rule_binding", {
      entity_kind: "character",
      entity_id: "char_missing",
      rule_system_id: system.id,
    });
    expect(missingChar.isError).toBe(true);
    expect((missingChar.body.error as { code: string }).code).toBe("not_found");

    const objBound = await call(inline, "set_entity_rule_binding", {
      entity_kind: "object",
      entity_id: "object_brass_key",
      rule_system_id: system.id,
      item_stat_template_id: itemTemplateId,
      tier_id: "tier_1",
      stats: [{ attribute_key: "resonance", operation: "add", value: 6 }],
    });
    expect(objBound.isError).toBe(false);
    expect(
      (objBound.body.binding as { item_stat_template_id: string })
        .item_stat_template_id,
    ).toBe(itemTemplateId);

    const badObjBinding = await call(inline, "set_entity_rule_binding", {
      entity_kind: "object",
      entity_id: "object_brass_key",
      rule_system_id: system.id,
      tier_id: "tier_missing",
    });
    expect(badObjBinding.isError).toBe(true);

    const missingObj = await call(inline, "set_entity_rule_binding", {
      entity_kind: "object",
      entity_id: "object_missing",
      rule_system_id: system.id,
    });
    expect(missingObj.isError).toBe(true);

    // Workspace-level validation blocks dropping a referenced tier via update_rule_system
    const breakingUpdate = await call(inline, "update_rule_system", {
      rule_system_id: system.id,
      tiers: [
        {
          id: "tier_1",
          name: { zh: "初响", en: "First chime" },
          rank: 1,
          min_value: 1,
          max_value: 9,
        },
        {
          id: "tier_replaced",
          name: { zh: "新二阶", en: "New tier 2" },
          rank: 2,
          min_value: 10,
          max_value: 20,
        },
      ],
    });
    expect(breakingUpdate.isError).toBe(true);
    expect((breakingUpdate.body.error as { code: string }).code).toBe(
      "invalid_arguments",
    );

    // 5. Read back with list_rule_systems, get_rule_system and check_rule_consistency
    const listedSystems = await call(inline, "list_rule_systems", {
      world_id: "uni_mist_harbor",
      include_details: true,
    });
    expect(listedSystems.isError).toBe(false);
    expect(listedSystems.body.active_applied).toBe(1);
    expect(pageOf(listedSystems.body, "rule_systems").total).toBe(1);

    const detail = await call(inline, "get_rule_system", {
      rule_system_id: system.id,
    });
    expect(detail.isError).toBe(false);
    expect(pageOf(detail.body, "ability_templates").total).toBe(1);
    expect(pageOf(detail.body, "item_stat_templates").total).toBe(1);
    expect(pageOf(detail.body, "bound_characters").total).toBe(1);
    expect(pageOf(detail.body, "bound_objects").total).toBe(1);

    const consistency = await call(inline, "check_rule_consistency", {
      world_id: "uni_mist_harbor",
      rule_system_id: system.id,
      text: "对方已经达到28级，共鸣高达150点。",
      locale: "zh-CN",
    });
    expect(consistency.isError).toBe(false);
    const findingsPage = pageOf<{ kind: string }>(consistency.body, "findings");
    expect(findingsPage.items.some((f) => f.kind === "above-ladder")).toBe(
      true,
    );
    expect(
      findingsPage.items.some((f) => f.kind === "attribute-above-max"),
    ).toBe(true);

    const wrongWorldConsistency = await call(inline, "check_rule_consistency", {
      world_id: "uni_ninth_station",
      rule_system_id: system.id,
    });
    expect(wrongWorldConsistency.isError).toBe(true);
    expect((wrongWorldConsistency.body.error as { code: string }).code).toBe(
      "invalid_arguments",
    );

    // 6. Clear bindings
    const clearedChar = await call(inline, "set_entity_rule_binding", {
      entity_kind: "character",
      entity_id: "char_lin",
      rule_system_id: system.id,
      clear: true,
    });
    expect(clearedChar.isError).toBe(false);
    expect(clearedChar.body.binding).toBeNull();

    const clearedObj = await call(inline, "set_entity_rule_binding", {
      entity_kind: "object",
      entity_id: "object_brass_key",
      rule_system_id: system.id,
      clear: true,
    });
    expect(clearedObj.isError).toBe(false);
    expect(clearedObj.body.binding).toBeNull();
  } finally {
    await inline.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("inline MCP server lists card types, card instances with edges, unknown behavior fallback and card search", async () => {
  const root = mkdtempSync(join(tmpdir(), "iploom-studio-inline-cards-mcp-"));
  const workspacePath = join(root, "workspace.json");
  const now = "2026-11-23T00:00:00.000Z";
  const workspace = createDemoWorkspace("zh-CN", now);
  applyConstruct(workspace, "novel-bible", "uni_mist_harbor", now);
  const game = quickBuildWork(
    workspace,
    "uni_mist_harbor",
    "game",
    "zh-CN",
    now,
  );
  workspace.cardTypes.push({
    id: "ctype_custom_plugin",
    universeId: "uni_ninth_station",
    name: { zh: "异象", en: "Anomaly" },
    summary: { zh: "未知行为键回退测试", en: "Fallback test" },
    icon: "unknown_icon",
    color: "#336655",
    behavior: "plugin_anomaly",
    fields: [
      {
        key: "detail",
        label: { zh: "详情", en: "Detail" },
        type: "text",
        unit: "",
        enumValues: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
  workspace.cards.push({
    id: "card_anomaly_long",
    typeId: "ctype_custom_plugin",
    title: { zh: "零点七分回响", en: "00:07 Echo" },
    values: { detail: "X".repeat(400) },
    notes: "N".repeat(400),
    createdAt: now,
    updatedAt: now,
  });
  await new WorkspaceStore(workspacePath).save(workspace);
  const inline = await connectInline(workspacePath);
  try {
    const allTypes = await call(inline, "list_card_types", { locale: "en" });
    expect(allTypes.isError).toBe(false);
    const typePage = pageOf<{
      id: string;
      behavior: string;
      resolved_behavior: string;
      resolved_icon: string;
      work_id: string | null;
      card_count: number;
    }>(allTypes.body, "card_types");
    // 5 novel-bible world types + 3 game looter types + 1 custom plugin type.
    expect(typePage.total).toBe(9);
    const custom = typePage.items.find(
      (item) => item.id === "ctype_custom_plugin",
    )!;
    expect(custom.behavior).toBe("plugin_anomaly");
    expect(custom.resolved_behavior).toBe("generic");
    expect(custom.resolved_icon).toBe("layers");
    expect(custom.card_count).toBe(1);

    const worldOnlyTypes = await call(inline, "list_card_types", {
      world_id: "uni_mist_harbor",
      scope: "world",
    });
    expect(pageOf(worldOnlyTypes.body, "card_types").total).toBe(5);

    const workOnlyTypes = await call(inline, "list_card_types", {
      work_id: game.id,
      scope: "work",
    });
    expect(pageOf(workOnlyTypes.body, "card_types").total).toBe(3);

    const byBehaviorTypes = await call(inline, "list_card_types", {
      behavior: "character",
    });
    expect(pageOf(byBehaviorTypes.body, "card_types").total).toBe(1);

    const cardsWithEdges = await call(inline, "list_cards", {
      world_id: "uni_mist_harbor",
      behavior: "character",
      include_edges: true,
    });
    expect(cardsWithEdges.isError).toBe(false);
    const characterCards = pageOf<{
      id: string;
      edge_count: number;
      edges?: Array<{ label: { zh: string; en: string } }>;
    }>(cardsWithEdges.body, "cards");
    expect(characterCards.total).toBe(1);
    expect(characterCards.items[0]!.edge_count).toBe(2);
    expect(characterCards.items[0]!.edges).toHaveLength(2);

    const compactLong = await call(inline, "list_cards", {
      type_id: "ctype_custom_plugin",
      include_details: false,
    });
    const compactCard = pageOf<{
      notes: string;
      truncated_fields?: string[];
    }>(compactLong.body, "cards").items[0]!;
    expect(compactCard.truncated_fields).toContain("notes");

    const fullLong = await call(inline, "list_cards", {
      type_id: "ctype_custom_plugin",
      include_details: true,
    });
    const fullCard = pageOf<{ notes: string }>(fullLong.body, "cards")
      .items[0]!;
    expect(fullCard.notes.length).toBe(400);

    const missingType = await call(inline, "list_cards", {
      type_id: "ctype_missing",
    });
    expect(missingType.isError).toBe(true);
    expect((missingType.body.error as { code: string }).code).toBe("not_found");

    const cardSearch = await call(inline, "search_ip", {
      query: "零点七分回响",
      kind: "card",
    });
    expect(cardSearch.isError).toBe(false);
    const hits = pageOf<{ kind: string; card_type_id?: string }>(
      cardSearch.body,
      "hits",
    );
    expect(hits.total).toBe(1);
    expect(hits.items[0]!.kind).toBe("card");
    expect(hits.items[0]!.card_type_id).toBe("ctype_custom_plugin");
  } finally {
    await inline.close();
    rmSync(root, { recursive: true, force: true });
  }
});
