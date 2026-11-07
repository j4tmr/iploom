import "./dom-setup";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CharacterModal } from "../../apps/studio/src/components/forms.tsx";
import { ManuscriptImport } from "../../apps/studio/src/components/manuscript-import.tsx";
import { SearchOverlay } from "../../apps/studio/src/components/search-overlay.tsx";
import { Modal } from "../../apps/studio/src/components/ui.tsx";
import { WorkflowView } from "../../apps/studio/src/views/workflow-view.tsx";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  attachOverlayKeyboard,
  overlayStack,
} from "../../apps/studio/src/core/overlay-stack.ts";
import { translator } from "../../apps/studio/src/i18n.ts";

let detachKeyboard: () => void;

beforeEach(() => {
  overlayStack.clear();
  detachKeyboard = attachOverlayKeyboard(overlayStack, window);
});

afterEach(() => {
  cleanup();
  detachKeyboard();
  overlayStack.clear();
});

function stubConfirm(answer: boolean) {
  const confirm = mock(() => answer);
  window.confirm = confirm as unknown as typeof window.confirm;
  return confirm;
}

test("Escape closes only the palette when it opened over a dialog", () => {
  const closeModal = mock(() => {});
  const closeSearch = mock(() => {});
  const workspace = createDemoWorkspace("en");

  render(
    <>
      <Modal open title="Character" onClose={closeModal}>
        <p>form</p>
      </Modal>
      <SearchOverlay
        open
        workspace={workspace}
        locale="en"
        t={translator("en")}
        onClose={closeSearch}
        onSelect={() => {}}
      />
    </>,
  );

  fireEvent.keyDown(window, { key: "Escape" });

  // The dialog stays mounted underneath; only the top layer may react, and the
  // event must not reach the dialog's own handling either.
  expect(closeSearch).toHaveBeenCalledTimes(1);
  expect(closeModal).toHaveBeenCalledTimes(0);
});

test("closing the palette hands Escape back to the dialog below", () => {
  const closeModal = mock(() => {});
  const workspace = createDemoWorkspace("en");

  render(
    <>
      <Modal open title="Character" onClose={closeModal}>
        <p>form</p>
      </Modal>
      <SearchOverlay
        open
        workspace={workspace}
        locale="en"
        t={translator("en")}
        onClose={() => {}}
        onSelect={() => {}}
      />
    </>,
  );

  // The palette is closed (re-rendered without `open`), so only the dialog's
  // layer remains and Escape belongs to it again.
  cleanup();
  overlayStack.clear();
  render(
    <Modal open title="Character" onClose={closeModal}>
      <p>form</p>
    </Modal>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(closeModal).toHaveBeenCalledTimes(1);
});

test("a backdrop click closes the dialog while clicks inside do not", () => {
  const onClose = mock(() => {});
  render(
    <Modal open title="Character" onClose={onClose}>
      <p>form</p>
    </Modal>,
  );

  const dialog = document.querySelector(".modal");
  const backdrop = document.querySelector(".modal-backdrop");
  expect(dialog).not.toBeNull();
  expect(backdrop).not.toBeNull();

  fireEvent.mouseDown(dialog!);
  expect(onClose).toHaveBeenCalledTimes(0);

  fireEvent.mouseDown(backdrop!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("an untouched character dialog closes on Escape without asking", () => {
  const onClose = mock(() => {});
  const confirm = stubConfirm(false);

  render(
    <CharacterModal
      open
      onClose={onClose}
      t={translator("en")}
      locale="en"
      workspace={createDemoWorkspace("en")}
      onSave={() => true}
    />,
  );

  fireEvent.keyDown(window, { key: "Escape" });
  expect(confirm).toHaveBeenCalledTimes(0);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a character dialog with unsaved edits asks before closing", () => {
  const onClose = mock(() => {});
  const confirm = stubConfirm(false);

  const view = render(
    <CharacterModal
      open
      onClose={onClose}
      t={translator("en")}
      locale="en"
      workspace={createDemoWorkspace("en")}
      onSave={() => true}
    />,
  );

  const nameInput = view.getAllByRole("textbox")[0]!;
  fireEvent.change(nameInput, { target: { value: "Lin" } });
  fireEvent.keyDown(window, { key: "Escape" });

  // Declining the prompt keeps the dialog and the typed value in place.
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(0);
  expect((nameInput as HTMLInputElement).value).toBe("Lin");

  stubConfirm(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the import dialog asks before discarding pasted manuscript text", () => {
  const onClose = mock(() => {});
  const confirm = stubConfirm(false);

  const view = render(
    <ManuscriptImport locale="en" onClose={onClose} onImport={() => {}} />,
  );

  const text = view.getByTestId("import-text");
  fireEvent.change(text, { target: { value: "Chapter One\n\nThe bell rang." } });
  fireEvent.keyDown(window, { key: "Escape" });

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(0);
  expect((text as HTMLTextAreaElement).value).toBe(
    "Chapter One\n\nThe bell rang.",
  );
});

test("switching workflow tasks with an unsaved result asks first", () => {
  const workspace = createDemoWorkspace("en");
  const confirm = stubConfirm(false);

  const view = render(
    <WorkflowView
      workspace={workspace}
      locale="en"
      t={translator("en")}
      onNewTask={() => {}}
      onEditTask={() => {}}
      onAddSubtask={() => {}}
      onDeleteTask={() => {}}
      onStatusChange={() => {}}
      onSaveResult={() => true}
      onOpenWork={() => {}}
    />,
  );

  const result = view.getByTestId("workflow-result") as HTMLTextAreaElement;
  fireEvent.change(result, { target: { value: "local draft" } });

  const rows = view.container.querySelectorAll(".workflow-row");
  expect(rows.length).toBeGreaterThan(1);
  fireEvent.click(rows[1]!);

  // Declining keeps the current task selected and the draft intact.
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(result.value).toBe("local draft");
  expect(rows[0]!.className).toContain("active");
});
