import "./dom-setup";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WorkflowView } from "../../apps/studio/src/views/workflow-view.tsx";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type { StudioWorkspace } from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";

afterEach(cleanup);

const t = translator("en");

/**
 * Builds a workspace whose first task (the view's initial selection) has the
 * given saved result. The view only reads the active language, so the other
 * language stays empty.
 */
function workspaceWithResult(result: string): StudioWorkspace {
  const workspace = createDemoWorkspace("en");
  const task = workspace.workflowTasks[0]!;
  task.result = { zh: "", en: result };
  return workspace;
}

function workflowView(workspace: StudioWorkspace) {
  return (
    <WorkflowView
      workspace={workspace}
      locale="en"
      t={t}
      onNewTask={() => {}}
      onEditTask={() => {}}
      onAddSubtask={() => {}}
      onDeleteTask={() => {}}
      onStatusChange={() => {}}
      onSaveResult={() => true}
      onOpenWork={() => {}}
    />
  );
}

test("returning to the saved baseline clears a stale conflict candidate", () => {
  const view = render(workflowView(workspaceWithResult("X")));
  const result = view.getByTestId("workflow-result") as HTMLTextAreaElement;
  expect(result.value).toBe("X");

  // The user types an unsaved draft.
  fireEvent.change(result, { target: { value: "X2" } });

  // An external write lands while that draft is still unsaved.
  view.rerender(workflowView(workspaceWithResult("Y")));
  expect(view.getByText(t("workflowConflict"))).toBeDefined();
  expect(
    view.getByRole("button", { name: t("workflowLoadSavedVersion") }),
  ).toBeDefined();

  // The saved value reverts to the baseline the editor last synced with
  // (e.g. the edit modal writes back the result captured before the run).
  view.rerender(workflowView(workspaceWithResult("X")));

  // The pending "Y" candidate no longer exists in the workspace, so it must
  // not stay loadable; the local draft is still unsaved and stays untouched.
  expect(result.value).toBe("X2");
  expect(view.queryByText(t("workflowConflict"))).toBeNull();
  expect(
    view.queryByRole("button", { name: t("workflowLoadSavedVersion") }),
  ).toBeNull();
});

test("a newer saved value replaces the pending conflict candidate while dirty", () => {
  const view = render(workflowView(workspaceWithResult("X")));
  const result = view.getByTestId("workflow-result") as HTMLTextAreaElement;
  fireEvent.change(result, { target: { value: "X2" } });

  view.rerender(workflowView(workspaceWithResult("Y")));
  expect(view.getByText(t("workflowConflict"))).toBeDefined();

  // A second external write supersedes the first candidate: the banner stays
  // and offers the newest saved value, not the stale one.
  view.rerender(workflowView(workspaceWithResult("Z")));
  expect(view.getByText(t("workflowConflict"))).toBeDefined();

  fireEvent.click(
    view.getByRole("button", { name: t("workflowLoadSavedVersion") }),
  );
  expect(result.value).toBe("Z");
  expect(view.queryByText(t("workflowConflict"))).toBeNull();
});
