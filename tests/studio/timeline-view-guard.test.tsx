import "./dom-setup";
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type { StudioWorkspace } from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { TimelineView } from "../../apps/studio/src/views/timeline-view.tsx";

afterEach(cleanup);

const t = translator("en");

function renderTimeline(workspace: StudioWorkspace) {
  const onNewObject = mock((_universeId: string) => {});
  const view = render(
    <TimelineView
      workspace={workspace}
      locale="en"
      t={t}
      onNewEvent={() => {}}
      onEditEvent={() => {}}
      onDeleteEvent={() => {}}
      onNewObject={onNewObject}
      onEditObject={() => {}}
      onDeleteObject={() => {}}
      onOpenWork={() => {}}
    />,
  );
  const button = view.getByRole("button", {
    name: t("timelineAddFirstProp"),
  }) as HTMLButtonElement;
  return { button, onNewObject };
}

test("the empty-state prop button is disabled when the workspace has no universe", () => {
  const workspace: StudioWorkspace = {
    ...createDemoWorkspace("en"),
    universes: [],
    storyObjects: [],
    timelineEvents: [],
  };
  const { button } = renderTimeline(workspace);

  expect(button.disabled).toBe(true);
});

test("the empty-state prop button stays enabled when a universe exists", () => {
  const workspace: StudioWorkspace = {
    ...createDemoWorkspace("en"),
    storyObjects: [],
  };
  const { button, onNewObject } = renderTimeline(workspace);

  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(onNewObject).toHaveBeenCalledTimes(1);
  expect(onNewObject.mock.calls[0]?.[0]).toBe("uni_mist_harbor");
});
