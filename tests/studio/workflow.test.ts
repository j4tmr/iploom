import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { setWorkflowTaskResult } from "../../apps/studio/src/core/workflow.ts";

describe("workflow task results", () => {
  test("reports a missing task instead of pretending to write", () => {
    const workspace = createDemoWorkspace("en");
    const before = structuredClone(workspace);
    expect(
      setWorkflowTaskResult(workspace, "task_missing", "draft", "en"),
    ).toBe(false);
    expect(workspace).toEqual(before);
  });

  test("writes only the active language and keeps the other language", () => {
    const workspace = createDemoWorkspace("en");
    const task = workspace.workflowTasks[0]!;
    const previousZh = task.result.zh;
    expect(
      setWorkflowTaskResult(workspace, task.id, "reviewed draft", "en"),
    ).toBe(true);
    expect(workspace.workflowTasks[0]!.result.en).toBe("reviewed draft");
    expect(workspace.workflowTasks[0]!.result.zh).toBe(previousZh);
  });
});
