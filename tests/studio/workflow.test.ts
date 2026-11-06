import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  setWorkflowTaskResult,
  taskDependentIds,
  workflowResultReplaceConfirm,
} from "../../apps/studio/src/core/workflow.ts";

const runMeta = {
  model: "test-model",
  promptSha256: "a".repeat(64),
  sourceRevision: 7,
  at: "2026-11-07T00:00:00.000Z",
};

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

  test("records run metadata and keeps the pre-run result retrievable", () => {
    const workspace = createDemoWorkspace("en");
    const task = workspace.workflowTasks[0]!;
    task.status = "done";
    task.result.en = "Approved world rules.";
    expect(
      setWorkflowTaskResult(workspace, task.id, "Rewritten rules.", "en", runMeta),
    ).toBe(true);
    expect(task.lastRun).toEqual(runMeta);
    expect(task.previousResult?.en).toBe("Approved world rules.");
    expect(task.result.en).toBe("Rewritten rules.");
    expect(
      setWorkflowTaskResult(workspace, task.id, "Re-reviewed.", "en"),
    ).toBe(true);
    expect(task.resultSuperseded).toBeUndefined();
  });

  test("repeated runs keep the first snapshot, not the latest", () => {
    const workspace = createDemoWorkspace("en");
    const task = workspace.workflowTasks[0]!;
    task.result.en = "First approved draft.";
    setWorkflowTaskResult(workspace, task.id, "Second draft.", "en");
    setWorkflowTaskResult(workspace, task.id, "Third draft.", "en");
    expect(task.previousResult?.en).toBe("First approved draft.");
    expect(task.result.en).toBe("Third draft.");
  });

  test("replacing a done result flags done dependents for re-review", () => {
    const workspace = createDemoWorkspace("en");
    const source = workspace.workflowTasks.find(
      (item) => item.id === "task_world_rules",
    )!;
    const dependent = workspace.workflowTasks.find(
      (item) => item.id === "task_chapter_three",
    )!;
    source.status = "done";
    dependent.status = "done";
    source.result.en = "Approved world rules.";
    expect(
      setWorkflowTaskResult(workspace, source.id, "Rewritten rules.", "en"),
    ).toBe(true);
    expect(dependent.resultSuperseded).toBe(true);
    // Re-approving the dependent clears the flag; an untouched sibling stays clean.
    expect(
      setWorkflowTaskResult(workspace, dependent.id, "Re-checked.", "en"),
    ).toBe(true);
    expect(dependent.resultSuperseded).toBeUndefined();
  });

  test("writing an identical result changes nothing structural", () => {
    const workspace = createDemoWorkspace("en");
    const task = workspace.workflowTasks[0]!;
    task.status = "done";
    task.result.en = "Approved.";
    expect(setWorkflowTaskResult(workspace, task.id, "Approved.", "en")).toBe(
      true,
    );
    expect(task.previousResult).toBeUndefined();
    expect(task.resultSuperseded).toBeUndefined();
  });

  test("dependency closure follows dependsOnIds edges only", () => {
    const workspace = createDemoWorkspace("en");
    const chapter = workspace.workflowTasks.find(
      (item) => item.id === "task_chapter_three",
    )!;
    const adaptation = workspace.workflowTasks.find(
      (item) => item.id === "task_adaptation_pass",
    )!;
    adaptation.dependsOnIds = ["task_chapter_three"];
    expect(taskDependentIds(workspace.workflowTasks, "task_world_rules")).toEqual([
      "task_chapter_three",
      "task_adaptation_pass",
    ]);
    expect(taskDependentIds(workspace.workflowTasks, "task_review_first")).toEqual(
      [],
    );
    expect(taskDependentIds(workspace.workflowTasks, "task_missing")).toEqual([]);
  });
});

describe("workflow replace confirmation", () => {
  test("done tasks always confirm; review tasks only when a result exists", () => {
    const workspace = createDemoWorkspace("en");
    const task = workspace.workflowTasks[0]!;
    task.result.en = "";
    task.status = "done";
    expect(workflowResultReplaceConfirm(task)).toBe(true);
    task.status = "review";
    expect(workflowResultReplaceConfirm(task)).toBe(false);
    task.result.en = "Draft awaiting review.";
    expect(workflowResultReplaceConfirm(task)).toBe(true);
    task.result.zh = "待审草稿。";
    task.result.en = "";
    expect(workflowResultReplaceConfirm(task)).toBe(true);
    task.result.zh = "";
    task.status = "active";
    expect(workflowResultReplaceConfirm(task)).toBe(false);
    task.status = "queued";
    expect(workflowResultReplaceConfirm(task)).toBe(false);
  });
});
