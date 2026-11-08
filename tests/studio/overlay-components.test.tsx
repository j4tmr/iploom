import "./dom-setup";
import { useState } from "react";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
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
let restoreConfirm: (() => void) | null = null;

beforeEach(() => {
  overlayStack.clear();
  detachKeyboard = attachOverlayKeyboard(overlayStack, window);
});

afterEach(() => {
  cleanup();
  detachKeyboard();
  overlayStack.clear();
  // Restore whatever this file replaced: window is shared by every test file
  // in the bun test process, so a leftover stub silently changes the next
  // file's dialogs.
  restoreConfirm?.();
  restoreConfirm = null;
});

function stubConfirm(answer: boolean) {
  // Keep the value from before the first stub of this test: a second stub
  // must not record the first fake as the thing to restore.
  if (!restoreConfirm) {
    const previous = window.confirm;
    restoreConfirm = () => {
      window.confirm = previous;
    };
  }
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
      onImport={() => true}
    />,
  );

  const text = view.getByTestId("import-text");
  fireEvent.change(text, {
    target: { value: "Chapter One\n\nThe bell rang." },
  });
  fireEvent.keyDown(window, { key: "Escape" });

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(0);
  expect((text as HTMLTextAreaElement).value).toBe(
    "Chapter One\n\nThe bell rang.",
  );
});

const IMPORT_TEXT = "Chapter One\n\nThe bell rang.";

function fillImport(view: ReturnType<typeof render>) {
  fireEvent.change(view.getByTestId("import-title"), {
    target: { value: "The Bell" },
  });
  fireEvent.change(view.getByTestId("import-text"), {
    target: { value: IMPORT_TEXT },
  });
  return view.getByTestId("import-text") as HTMLTextAreaElement;
}

test("a failed import keeps the dialog and the pasted manuscript", async () => {
  const onClose = mock(() => {});
  const onImport = mock(async () => false);
  const view = render(
    <ManuscriptImport
      locale="en"
      t={translator("en")}
      onClose={onClose}
      onImport={onImport}
    />,
  );
  const text = fillImport(view);

  fireEvent.click(view.getByTestId("import-confirm"));

  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  expect(onClose).toHaveBeenCalledTimes(0);
  expect(text.value).toBe(IMPORT_TEXT);
  expect(view.getByRole("status").textContent).toContain("did not finish");
});

test("a rejected import keeps the dialog and shows the error", async () => {
  const onClose = mock(() => {});
  const onImport = mock(async () => {
    throw new Error("snapshot directory is not writable");
  });
  const view = render(
    <ManuscriptImport
      locale="en"
      t={translator("en")}
      onClose={onClose}
      onImport={onImport}
    />,
  );
  const text = fillImport(view);

  fireEvent.click(view.getByTestId("import-confirm"));

  // The handler catches the rejection and renders it; nothing escapes unhandled.
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toContain(
      "snapshot directory is not writable",
    ),
  );
  expect(onClose).toHaveBeenCalledTimes(0);
  expect(text.value).toBe(IMPORT_TEXT);
});

test("a successful import closes the dialog", async () => {
  const onClose = mock(() => {});
  const onImport = mock(async () => true);
  const view = render(
    <ManuscriptImport
      locale="en"
      t={translator("en")}
      onClose={onClose}
      onImport={onImport}
    />,
  );
  fillImport(view);

  fireEvent.click(view.getByTestId("import-confirm"));

  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(onImport).toHaveBeenCalledTimes(1);
});

test("the import button is disabled while the import is pending", async () => {
  let finishImport: (accepted: boolean) => void = () => {};
  const onClose = mock(() => {});
  const onImport = mock(
    () =>
      new Promise<boolean>((resolve) => {
        finishImport = resolve;
      }),
  );
  const view = render(
    <ManuscriptImport
      locale="en"
      t={translator("en")}
      onClose={onClose}
      onImport={onImport}
    />,
  );
  fillImport(view);

  const confirm = view.getByTestId("import-confirm") as HTMLButtonElement;
  fireEvent.click(confirm);

  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  expect(confirm.disabled).toBe(true);
  // Closing is blocked while the commit is pending, without a discard prompt.
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(0);

  finishImport(false);
  await waitFor(() => expect(confirm.disabled).toBe(false));
  expect(onClose).toHaveBeenCalledTimes(0);
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
        {/* biome-ignore lint/a11y/noAutofocus: this test deliberately checks that Modal preserves autoFocus */}
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
  Element.prototype.scrollIntoView =
    scrollIntoView as typeof Element.prototype.scrollIntoView;

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

function PaletteToDialogHarness({
  onDialogClose,
}: {
  onDialogClose: () => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPaletteOpen(true);
        }}
      >
        open palette
      </button>
      <SearchOverlay
        open={paletteOpen}
        workspace={createDemoWorkspace("en")}
        locale="en"
        t={translator("en")}
        onClose={() => setPaletteOpen(false)}
        onSelect={() => setDialogOpen(true)}
      />
      <Modal
        open={dialogOpen}
        title="Search result"
        onClose={() => {
          setDialogOpen(false);
          onDialogClose();
        }}
      >
        <p>result details</p>
      </Modal>
    </>
  );
}

test("a palette result that opens a dialog restores focus to the palette opener", () => {
  const onDialogClose = mock(() => {});
  const view = render(<PaletteToDialogHarness onDialogClose={onDialogClose} />);
  const trigger = view.getByRole("button", { name: "open palette" });
  trigger.focus();
  fireEvent.click(trigger);

  const input = view.getByRole("combobox") as HTMLInputElement;
  // The palette focuses its input while open, and selecting a result opens the
  // dialog in the same batched commit that unmounts the palette.
  input.focus();
  fireEvent.change(input, { target: { value: "the" } });
  fireEvent.keyDown(input, { key: "Enter" });

  expect(document.querySelector(".command-palette")).toBeNull();
  expect(document.querySelector(".modal")).not.toBeNull();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onDialogClose).toHaveBeenCalledTimes(1);
  // The dialog's opener must be the palette trigger, not the search input that
  // was unmounted by the handoff.
  expect(document.activeElement).toBe(trigger);
});

function SvgOpenerHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <svg role="img" aria-label="relationship graph">
        {/* biome-ignore-start lint/a11y/useSemanticElements: an SVG graph node is a <g>, which cannot become a <button>; the fixture exercises its ARIA/keyboard contract */}
        <g
          role="button"
          tabIndex={0}
          aria-label="graph node"
          onClick={() => {
            setOpen(true);
          }}
        />
        {/* biome-ignore-end lint/a11y/useSemanticElements: end of graph-node fixture */}
      </svg>
      <Modal
        open={open}
        title="Graph node"
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      >
        <p>node details</p>
      </Modal>
    </>
  );
}

test("a dialog restores focus to a keyboard-focusable SVG opener", () => {
  const onClose = mock(() => {});
  const view = render(<SvgOpenerHarness onClose={onClose} />);
  const node = view.container.querySelector<SVGElement>("g")!;
  expect(node).toBeInstanceOf(SVGElement);
  node.focus();
  expect(document.activeElement).toBe(node);

  fireEvent.click(node);
  expect(document.querySelector(".modal")).not.toBeNull();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(node);
});

test("Tab keeps focus inside the palette's search input", () => {
  const view = render(
    <SearchOverlay
      open
      workspace={createDemoWorkspace("en")}
      locale="en"
      t={translator("en")}
      onClose={() => {}}
      onSelect={() => {}}
    />,
  );

  const input = view.getByRole("combobox") as HTMLInputElement;
  input.focus();

  const tab = createEvent.keyDown(input, { key: "Tab" });
  fireEvent(input, tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
});

test("a new query scrolls the highlighted result back into view", () => {
  const scrollIntoView = mock(() => {});
  const previous = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView =
    scrollIntoView as typeof Element.prototype.scrollIntoView;

  try {
    const view = render(
      <SearchOverlay
        open
        workspace={createDemoWorkspace("en")}
        locale="en"
        t={translator("en")}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );

    // An empty query renders only the hint, so opening by itself cannot scroll.
    expect(scrollIntoView).toHaveBeenCalledTimes(0);

    const input = view.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "the" } });

    const options = view.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    // The highlight stays at the first result; the new result set alone must
    // bring it back after the list was scrolled by the previous query.
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
  } finally {
    Element.prototype.scrollIntoView = previous;
  }
});
