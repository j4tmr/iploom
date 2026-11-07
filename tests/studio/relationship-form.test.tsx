import "./dom-setup";
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RelationshipModal } from "../../apps/studio/src/components/forms.tsx";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type { Relationship, StudioWorkspace } from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";

afterEach(cleanup);

const t = translator("en");
const universeId = "uni_mist_harbor";

function openModal(workspace?: StudioWorkspace, initial?: Relationship) {
  const onSave = mock((_relationship: Relationship) => true);
  const view = render(
    <RelationshipModal
      open
      onClose={() => {}}
      t={t}
      locale="en"
      workspace={workspace ?? createDemoWorkspace("en")}
      universeId={universeId}
      initial={initial}
      onSave={onSave}
    />,
  );
  const [source, target] = view.getAllByRole("combobox") as HTMLSelectElement[];
  const save = view.getByRole("button", {
    name: initial ? t("save") : t("add"),
  }) as HTMLButtonElement;
  return { view, onSave, source: source!, target: target!, save };
}

test("changing the source to the current target moves the target to a valid character", () => {
  const { onSave, source, target, save } = openModal();
  expect(source.value).toBe("char_lin");
  expect(target.value).toBe("char_shen");

  fireEvent.change(source, { target: { value: "char_shen" } });

  // The visible selection and the state must agree, and the pair must stay
  // saveable — the previous code left the select showing Character A while
  // the state still held char_shen.
  expect(source.value).toBe("char_shen");
  expect(target.value).toBe("char_lin");
  expect(save.disabled).toBe(false);

  fireEvent.click(save);
  expect(onSave).toHaveBeenCalledTimes(1);
  const saved = onSave.mock.calls[0]?.[0];
  expect(saved?.sourceId).toBe("char_shen");
  expect(saved?.targetId).toBe("char_lin");
});

test("a saved self-relationship opens as a valid pair", () => {
  const { target, save } = openModal(undefined, {
    id: "rel_broken",
    universeId,
    sourceId: "char_lin",
    targetId: "char_lin",
    type: "ally",
    label: { zh: "", en: "" },
    strength: 3,
    status: "active",
    mutual: true,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(target.value).not.toBe("char_lin");
  expect(target.value).not.toBe("");
  expect(save.disabled).toBe(false);
});

test("a saved relationship whose source was deleted opens on a live character", () => {
  const { source, target, save } = openModal(undefined, {
    id: "rel_orphan",
    universeId,
    sourceId: "char_deleted",
    targetId: "char_shen",
    type: "ally",
    label: { zh: "", en: "" },
    strength: 3,
    status: "active",
    mutual: true,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(source.value).toBe("char_lin");
  expect(target.value).toBe("char_shen");
  expect(save.disabled).toBe(false);
});

test("a world with one character explains why no target can be chosen", () => {
  const demo = createDemoWorkspace("en");
  const workspace: StudioWorkspace = {
    ...demo,
    characters: demo.characters.filter(
      (character) => character.id === "char_lin",
    ),
  };
  const { view, target, save } = openModal(workspace);

  expect(target.disabled).toBe(true);
  expect(target.value).toBe("");
  expect(save.disabled).toBe(true);
  expect(view.getByText(t("relationshipNeedsTwoCharacters"))).toBeDefined();
});
