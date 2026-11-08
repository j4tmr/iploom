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
