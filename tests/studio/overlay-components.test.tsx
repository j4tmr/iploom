import "./dom-setup";
import { useState } from "react";
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
    <ManuscriptImport
      locale="en"
      t={translator("en")}
      onClose={onClose}
      onImport={() => {}}
    />,
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

function ModalHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        open dialog
      </button>
      <Modal
        open={open}
        title="Focus"
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      >
        <button type="button">first</button>
        <button type="button">last</button>
      </Modal>
    </>
  );
}

function AutoFocusModalHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        open form
      </button>
      <Modal
        open={open}
        title="Auto"
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      >
        <input aria-label="name" autoFocus />
        <button type="button">save</button>
      </Modal>
    </>
  );
}

test("a dialog with an autoFocus field keeps it and still restores the opener", () => {
  const onClose = mock(() => {});
  const view = render(<AutoFocusModalHarness onClose={onClose} />);
  const trigger = view.getByRole("button", { name: "open form" });
  trigger.focus();
  fireEvent.click(trigger);

  // React moves focus to the field during commit; the dialog must not steal it.
  const field = view.getByRole("textbox", { name: "name" });
  expect(document.activeElement).toBe(field);

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  // The opener, not the unmounted field, receives focus back.
  expect(document.activeElement).toBe(trigger);
});

test("a dialog moves focus inside, traps Tab and restores it on close", () => {
  const onClose = mock(() => {});
  const view = render(<ModalHarness onClose={onClose} />);
  const trigger = view.getByRole("button", { name: "open dialog" });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = document.querySelector<HTMLElement>(".modal")!;
  expect(dialog).not.toBeNull();
  // The dialog itself takes focus so the title is announced first.
  expect(document.activeElement).toBe(dialog);

  const close = view.getByRole("button", { name: "Close" });
  const last = view.getByRole("button", { name: "last" });

  // Shift-Tab from the dialog chrome wraps to the last control.
  fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);

  // Tab from the last control wraps back to the first (the header close).
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(close);

  // And Shift-Tab from that first control goes back to the last.
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(trigger);
});

function PaletteHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        open palette
      </button>
      <SearchOverlay
        open={open}
        workspace={createDemoWorkspace("en")}
        locale="en"
        t={translator("en")}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        onSelect={() => {}}
      />
    </>
  );
}

test("closing the palette returns focus to the control that opened it", () => {
  const onClose = mock(() => {});
  const view = render(<PaletteHarness onClose={onClose} />);
  const trigger = view.getByRole("button", { name: "open palette" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.querySelector(".command-palette")).not.toBeNull();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".command-palette")).toBeNull();
  // Restoring the opener keeps a dialog underneath in charge of Tab again.
  expect(document.activeElement).toBe(trigger);
});

test("the palette exposes its results and keeps the active one in view", () => {
  const scrollIntoView = mock(() => {});
  const previous = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scrollIntoView as typeof Element.prototype.scrollIntoView;

  try {
    const onClose = mock(() => {});
    const onSelect = mock(() => {});
    const view = render(
      <SearchOverlay
        open
        workspace={createDemoWorkspace("en")}
        locale="en"
        t={translator("en")}
        onClose={onClose}
        onSelect={onSelect}
      />,
    );

    const input = view.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "the" } });

    const options = view.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    const list = view.getByRole("listbox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    // Enter while an IME candidate window is open must not open a result.
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onSelect).toHaveBeenCalledTimes(0);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    Element.prototype.scrollIntoView = previous;
  }
});
