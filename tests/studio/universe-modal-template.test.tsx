import "./dom-setup";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { UniverseModal } from "../../apps/studio/src/components/forms.tsx";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type { StoryUniverse } from "../../apps/studio/src/core/types.ts";
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

const t = translator("en");

function renderModal(
  props: { templateId?: string; initial?: StoryUniverse } = {},
) {
  const onSave = mock((_universe: StoryUniverse, _templateId?: string) => true);
  const view = render(
    <UniverseModal
      open
      onClose={() => {}}
      t={t}
      locale="en"
      templateId={props.templateId}
      initial={props.initial}
      onSave={onSave}
    />,
  );
  return { view, onSave };
}

function nameInput(view: ReturnType<typeof render>) {
  return view.getByLabelText("Chinese name") as HTMLInputElement;
}

function save(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: "Save" }));
}

test("a template chosen before opening is preselected and seeds the new world", () => {
  const { view, onSave } = renderModal({ templateId: "wuxia-jianghu" });

  const chip = view.getByRole("radio", {
    name: "Wuxia jianghu",
  }) as HTMLInputElement;
  expect(chip.checked).toBe(true);
  expect((view.getByLabelText(/^Genre/) as HTMLInputElement).value).toBe(
    "武侠, 古风",
  );

  fireEvent.change(nameInput(view), { target: { value: "听雨楼" } });
  save(view);

  expect(onSave).toHaveBeenCalledTimes(1);
  const [universe, templateId] = onSave.mock.calls[0]!;
  expect(templateId).toBe("wuxia-jianghu");
  expect(universe.name.zh).toBe("听雨楼");
  expect(universe.genres).toEqual(["武侠", "古风"]);
});

test("a template picked after opening counts, even from a blank start", () => {
  const { view, onSave } = renderModal();

  // Nothing preselected: the dialog opened from the plain create button.
  expect(
    (
      view.getByRole("radio", {
        name: "Blank world",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect((view.getByLabelText(/^Genre/) as HTMLInputElement).value).toBe("");

  fireEvent.click(view.getByRole("radio", { name: "Starfarer" }));
  fireEvent.change(nameInput(view), { target: { value: "环带" } });
  save(view);

  const [, templateId] = onSave.mock.calls[0]!;
  expect(templateId).toBe("starfarer");
});

test("switching back to blank clears the template prefill and saves no template", () => {
  const { view, onSave } = renderModal({ templateId: "mystery-city" });

  expect((view.getByLabelText(/^Genre/) as HTMLInputElement).value).toBe(
    "悬疑, 都市",
  );

  fireEvent.click(view.getByRole("radio", { name: "Blank world" }));

  // The hint promises a blank start, so template metadata must not linger.
  expect((view.getByLabelText(/^Genre/) as HTMLInputElement).value).toBe("");
  expect((view.getByLabelText(/^Themes/) as HTMLInputElement).value).toBe("");
  expect((view.getByLabelText("Cover color") as HTMLInputElement).value).toBe(
    "#2f7567",
  );

  fireEvent.change(nameInput(view), { target: { value: "空白" } });
  save(view);

  const [, templateId] = onSave.mock.calls[0]!;
  expect(templateId).toBeUndefined();
});

test("editing an existing world hides the picker and never seeds a template", () => {
  const existing = createDemoWorkspace("en").universes[0]!;
  const { view, onSave } = renderModal({ initial: existing });

  expect(view.queryByRole("radiogroup")).toBeNull();

  save(view);

  const [universe, templateId] = onSave.mock.calls[0]!;
  expect(templateId).toBeUndefined();
  expect(universe.id).toBe(existing.id);
});
