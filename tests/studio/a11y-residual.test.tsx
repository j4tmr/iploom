import "./dom-setup";
import { afterEach, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { Field } from "../../apps/studio/src/components/ui.tsx";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type {
  Chapter,
  StoryWork,
  StudioWorkspace,
} from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { CastLibrary } from "../../apps/studio/src/views/cast-library.tsx";
import { WorkView } from "../../apps/studio/src/views/work-view.tsx";
import { WorkflowView } from "../../apps/studio/src/views/workflow-view.tsx";

afterEach(cleanup);

const t = translator("en");

const noop = () => {};

function renderCastLibrary(workspace: StudioWorkspace) {
  return render(
    <CastLibrary
      workspace={workspace}
      locale="en"
      t={t}
      onNewCharacter={noop}
      onEditCharacter={noop}
      onOpenUniverse={noop}
    />,
  );
}

function renderWorkflowView(workspace: StudioWorkspace) {
  return render(
    <WorkflowView
      workspace={workspace}
      locale="en"
      t={t}
      onNewTask={noop}
      onEditTask={noop}
      onAddSubtask={noop}
      onDeleteTask={noop}
      onStatusChange={noop}
      onSaveResult={() => true}
      onOpenWork={noop}
    />,
  );
}

function renderWorkView(work: StoryWork, workspace?: StudioWorkspace) {
  return render(
    <WorkView
      workspace={workspace ?? createDemoWorkspace("en")}
      work={work}
      locale="en"
      t={t}
      onBack={noop}
      onOpenUniverse={noop}
      onEditWork={noop}
      onDeleteWork={noop}
      onAddChapter={noop}
      onOpenTimeline={noop}
      onDeleteChapter={noop}
      onChangeChapter={noop}
      onRecordExport={noop}
    />,
  );
}

/** The demo novel's chapters, reordered as if they had been created 1, 3, 2. */
function workWithChaptersStored132(
  workspace: StudioWorkspace,
): { work: StoryWork; one: Chapter; two: Chapter; three: Chapter } {
  const tide = workspace.works.find((item) => item.id === "work_tide_clock")!;
  const [one, two, three] = tide.chapters;
  return { work: { ...tide, chapters: [one!, three!, two!] }, one: one!, two: two!, three: three! };
}

test("Field renders a group whose text labels no checkbox", () => {
  const view = render(
    <Field label="Scene cast" group>
      <div className="cast-check-list">
        <label className="cast-check">
          <input type="checkbox" aria-label="Lin" />
          {"Lin"}
        </label>
        <label className="cast-check">
          <input type="checkbox" aria-label="Shen" />
          Shen
        </label>
      </div>
    </Field>,
  );
  const group = view.getByRole("group", { name: "Scene cast" });
  expect(group.tagName).toBe("DIV");
  const [lin, shen] = within(group).getAllByRole("checkbox") as HTMLInputElement[];
  expect(lin!.checked).toBe(false);
  expect(shen!.checked).toBe(false);

  // Clicking the visible group text must not activate any row.
  fireEvent.click(within(group).getByText("Scene cast"));
  expect(lin!.checked).toBe(false);
  expect(shen!.checked).toBe(false);

  // A row label still toggles exactly its own checkbox.
  fireEvent.click(lin!.closest("label")!);
  expect(lin!.checked).toBe(true);
  expect(shen!.checked).toBe(false);
});

test("Field keeps its label-wrapped single-control form by default", () => {
  const view = render(
    <Field label="Summary">
      <textarea aria-label="summary-body" />
    </Field>,
  );
  expect(view.container.querySelector("label.field")).not.toBeNull();
  expect(view.queryByRole("group")).toBeNull();
  const label = view.getByText("Summary").closest("label")!;
  expect(label.htmlFor).toBe("");
  // A bare control inside the label is its labeled control.
  expect(label.contains(view.getByLabelText("summary-body"))).toBe(true);
});

test("clicking the chapter cast group text autosaves nothing; rows still toggle", () => {
  const workspace = createDemoWorkspace("en");
  const { work } = workWithChaptersStored132(workspace);
  // Mirror the real parent: apply the change to a clone synchronously inside
  // the event, the way the workspace state update would.
  let applied: Chapter | null = null;
  const onChangeChapter = mock(
    (chapterId: string, change: (chapter: Chapter) => void) => {
      const chapter = work.chapters.find((item) => item.id === chapterId)!;
      const draft = { ...chapter, characterIds: [...chapter.characterIds] };
      change(draft);
      applied = draft;
    },
  );
  const view = render(
    <WorkView
      workspace={workspace}
      work={work}
      locale="en"
      t={t}
      onBack={noop}
      onOpenUniverse={noop}
      onEditWork={noop}
      onDeleteChapter={noop}
      onDeleteWork={noop}
      onAddChapter={noop}
      onOpenTimeline={noop}
      onChangeChapter={onChangeChapter}
      onRecordExport={noop}
    />,
  );
  const group = view.getByRole("group", { name: t("sceneCast") });
  const checkboxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
  const before = checkboxes.map((box) => box.checked);

  fireEvent.click(within(group).getByText(t("sceneCast")));
  expect(onChangeChapter).not.toHaveBeenCalled();
  expect(checkboxes.map((box) => box.checked)).toEqual(before);

  // The chapter's own checkbox is the only control a row toggle may touch,
  // through the normal onChangeChapter path. (The group text itself was just
  // proven inert above.)
  const rowIndex = workspace.characters.findIndex(
    (character) => character.id === "char_gu",
  );
  expect(rowIndex).toBeGreaterThan(1);
  const row = checkboxes[rowIndex] as HTMLInputElement;
  fireEvent.click(row);
  expect(onChangeChapter).toHaveBeenCalledTimes(1);
  expect(applied!.characterIds).toContain("char_gu");
  // The untouched rows keep their state in the applied draft.
  expect(applied!.characterIds).toEqual(["char_lin", "char_shen", "char_echo", "char_gu"]);
});

test("the world filter select exposes an accessible name and the all-worlds option", () => {
  const workspace = createDemoWorkspace("en");
  const view = renderCastLibrary(workspace);
  const filter = view.getByRole("combobox", {
    name: t("filterWorld"),
  }) as HTMLSelectElement;
  expect(filter.value).toBe("all");
  expect(filter.options[0]!.textContent).toBe(t("allWorlds"));
  expect(filter.options.length).toBe(workspace.universes.length + 1);
});

test("the workflow detail eyebrow localizes the task kind", () => {
  const workspace = createDemoWorkspace("en");
  const task = workspace.workflowTasks[0]!;
  expect(task.kind).toBe("world");
  const view = renderWorkflowView(workspace);
  expect(view.getByText(`${t("taskKind_world")} / ${task.id}`)).toBeDefined();
  expect(view.queryByText(`${task.kind} / ${task.id}`)).toBeNull();
});

test("the prose editor label is associated with the prose textarea", () => {
  const workspace = createDemoWorkspace("en");
  const { work } = workWithChaptersStored132(workspace);
  const view = renderWorkView(work, workspace);
  const label = view.container.querySelector(
    "label.prose-editor-label",
  ) as HTMLLabelElement;
  const prose = view.container.querySelector(
    "textarea.prose-editor",
  ) as HTMLTextAreaElement;
  expect(label).not.toBeNull();
  expect(prose).not.toBeNull();
  expect(label.htmlFor).toBe(prose.id);
  expect(prose.id).not.toBe("");
  // The association resolves as an accessible name for the editor.
  expect(view.getByLabelText(new RegExp(t("chapterBody")))).toBe(prose);
});

test("chapter list and default selection follow story order, not storage order", () => {
  const workspace = createDemoWorkspace("en");
  const { work, one, two, three } = workWithChaptersStored132(workspace);
  expect(work.chapters.map((chapter) => chapter.number)).toEqual([1, 3, 2]);
  const view = renderWorkView(work, workspace);

  const numbers = [
    ...view.container.querySelectorAll(".chapter-list-item .chapter-number"),
  ].map((node) => node.textContent);
  expect(numbers).toEqual(["01", "02", "03"]);
  const items = [
    ...view.container.querySelectorAll(".chapter-list-item strong"),
  ].map((node) => node.textContent);
  // Stored [1, 3, 2] must display as story order 1, 2, 3.
  expect(items).toEqual([one.title, two.title, three.title]);

  // The editor opens on chapter 1, the first chapter in story order.
  const titleInput = view.container.querySelector(
    ".chapter-title-input",
  ) as HTMLInputElement;
  expect(titleInput.value).toBe(one.title);
  const prose = view.container.querySelector(
    "textarea.prose-editor",
  ) as HTMLTextAreaElement;
  expect(prose.value).toBe(one.content);
});

test("the export chapter selection list follows story order", () => {
  const workspace = createDemoWorkspace("en");
  const { work } = workWithChaptersStored132(workspace);
  const view = renderWorkView(work, workspace);
  const adaptationTab = [
    ...view.container.querySelectorAll("button.tab-button"),
  ].find((button) => button.textContent?.startsWith(t("adaptation")));
  expect(adaptationTab).toBeDefined();
  fireEvent.click(adaptationTab!);
  const numbers = [
    ...view.container.querySelectorAll(".chapter-select-row .chapter-number"),
  ].map((node) => node.textContent);
  expect(numbers).toEqual(["01", "02", "03"]);
});
