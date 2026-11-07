import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type { WorkspaceIssueDetail } from "../../apps/studio/src/core/validate.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { describeWorkspaceProblem } from "../../apps/studio/src/validation-message.ts";

const NOW = "2026-11-06T00:00:00.000Z";
const workspace = createDemoWorkspace("zh-CN", NOW);

function detail(
  overrides: Partial<WorkspaceIssueDetail>,
): WorkspaceIssueDetail {
  return { path: "", code: "custom", message: "", ...overrides };
}

describe("validation messages", () => {
  test("names the chapter, field and reason of a rejected save in Chinese", () => {
    const workIndex = workspace.works.findIndex(
      (item) => item.id === "work_tide_clock",
    );
    const chapter = workspace.works[workIndex]?.chapters[0];
    const path = `works.${workIndex}.chapters.0.title`;
    const text = describeWorkspaceProblem(
      [detail({ path, code: "too_big", origin: "string", maximum: 300 })],
      workspace,
      "zh-CN",
      translator("zh-CN"),
    );
    expect(text).toContain("章节");
    expect(text).toContain(chapter?.title ?? "");
    expect(text).toContain("标题");
    expect(text).toContain("最多允许 300 个字符");
    expect(text).toContain(path);
  });

  test("localizes the same failure into English with the entity name", () => {
    const universe = workspace.universes[0];
    const path = "universes.0.name.en";
    const text = describeWorkspaceProblem(
      [detail({ path, code: "too_small", origin: "string", minimum: 1 })],
      workspace,
      "en",
      translator("en"),
    );
    expect(text).toContain("World");
    expect(text).toContain(universe?.name.en ?? "");
    expect(text).toContain("English name");
    expect(text).toContain("Must be at least 1 characters");
    expect(text).toContain(path);
    expect(text).not.toContain("Invalid input");
  });

  test("keeps the technical path last and counts the remaining issues", () => {
    const path = "works.0.logline.zh";
    const text = describeWorkspaceProblem(
      [
        detail({ path, code: "too_small", origin: "string", minimum: 1 }),
        detail({ path: "works.0.title.zh", code: "too_small", origin: "string", minimum: 1 }),
        detail({ path: "works.0.genre", code: "too_big", origin: "string", maximum: 200 }),
      ],
      workspace,
      "zh-CN",
      translator("zh-CN"),
    );
    expect(text).toContain(path);
    expect(text).toContain("另有 2 项问题");
  });

  test("translates every cross-entity rule the editors can surface", () => {
    const cases: Array<[string, string]> = [
      ["duplicate chapter number", "章节序号重复"],
      ["self relation", "人物不能与自身建立关系"],
      ["chapter is required for a scene", "场景需要先绑定章节"],
      ["scene subject requires a chapter", "场景主体需要先绑定章节"],
    ];
    for (const [message, expected] of cases) {
      const text = describeWorkspaceProblem(
        [detail({ path: "timelineEvents.0", code: "custom", message })],
        workspace,
        "zh-CN",
        translator("zh-CN"),
      );
      expect(text).toContain(expected);
    }
    const named = describeWorkspaceProblem(
      [
        detail({
          path: "timelineEvents.0",
          code: "custom",
          message: "unknown character: char_missing",
        }),
      ],
      workspace,
      "zh-CN",
      translator("zh-CN"),
    );
    expect(named).toContain("char_missing");
  });

  test("inserts names literally even when they contain replacement patterns", () => {
    const t = translator("zh-CN");
    const text = t("validationWhere", {
      entity: t("entityNovel"),
      name: "A$&B$'C",
      field: t("title"),
    });
    expect(text).toContain("A$&B$'C");
  });

  test("falls back to cross-entity rule text it cannot translate", () => {
    const text = describeWorkspaceProblem(
      [
        detail({
          path: "workflowTasks.0",
          code: "custom",
          message: "a brand new rule failed",
        }),
      ],
      workspace,
      "zh-CN",
      translator("zh-CN"),
    );
    expect(text).toContain("a brand new rule failed");
    expect(text).toContain("workflowTasks.0");
  });

  test("resolves entity labels for every collection the validator can point at", () => {
    const edited = structuredClone(workspace);
    const workIndex = edited.works.findIndex(
      (item) => item.id === "work_tide_clock",
    );
    edited.works[workIndex]!.chapters[0]!.title = "";
    const t = translator("zh-CN");
    const cases: Array<[string, string]> = [
      ["universes.0.name.zh", "世界"],
      [`works.${workIndex}.chapters.0.title.zh`, "第"],
      ["characters.0.name.zh", "人物"],
      ["relationships.0.label.zh", "人物关系"],
      ["standards.0.title.zh", "基础规则"],
      ["workflowTasks.0.title.zh", "AI 任务"],
      ["timelineEvents.0.title.zh", "时间线事件"],
      ["storyObjects.0.name.zh", "故事物件"],
      ["locations.0.name.zh", "地点"],
      ["factions.0.name.zh", "势力"],
      ["lore.0.title.zh", "世界设定"],
      ["exports.0.workTitle", "导出记录"],
      ["meta.elsewhere", "工作区"],
    ];
    for (const [path, label] of cases) {
      const text = describeWorkspaceProblem(
        [detail({ path, code: "invalid_type" })],
        edited,
        "zh-CN",
        t,
      );
      expect(text).toContain(label);
      expect(text).toContain(path);
    }
  });

  test("translates reason codes for every origin and keeps unknown codes verbatim", () => {
    const t = translator("zh-CN");
    const reasons: Array<[Partial<WorkspaceIssueDetail>, string]> = [
      [{ code: "too_small", origin: "array", minimum: 2 }, "至少需要 2 项"],
      [{ code: "too_big", origin: "array", maximum: 8 }, "最多允许 8 项"],
      [{ code: "invalid_value" }, "取值格式不正确"],
      [{ code: "invalid_format" }, "取值格式不正确"],
      [{ code: "not_multiple_of" }, "取值格式不正确"],
      [{ code: "unrecognized_keys" }, "取值格式不正确"],
      [{ code: "invalid_key" }, "取值格式不正确"],
      [{ code: "invalid_element" }, "取值格式不正确"],
      [{ code: "invalid_union" }, "取值格式不正确"],
      [{ code: "mystery_code", message: "mystery" }, "mystery"],
    ];
    for (const [overrides, expected] of reasons) {
      const text = describeWorkspaceProblem(
        [detail({ path: "universes.0.name.zh", ...overrides })],
        workspace,
        "zh-CN",
        t,
      );
      expect(text).toContain(expected);
    }
  });
});
