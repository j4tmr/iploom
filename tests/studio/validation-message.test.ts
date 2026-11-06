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
});
