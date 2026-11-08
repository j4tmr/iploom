import "./dom-setup";
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type {
  StoryObject,
  StudioWorkspace,
  TimelineEvent,
} from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { TimelineView } from "../../apps/studio/src/views/timeline-view.tsx";

afterEach(cleanup);

const t = translator("en");

type TimelineProps = ComponentProps<typeof TimelineView>;

function renderTimeline(
  workspace: StudioWorkspace,
  overrides: Partial<TimelineProps> = {},
) {
  const onNewEvent = mock((_universeId: string, _workId?: string) => {});
  const onEditEvent = mock((_event: TimelineEvent) => {});
  const onDeleteEvent = mock((_event: TimelineEvent) => {});
  const onNewObject = mock((_universeId: string) => {});
  const onEditObject = mock((_object: StoryObject) => {});
  const onDeleteObject = mock((_object: StoryObject) => {});
  const onOpenWork = mock((_workId: string) => {});

  const element = (extra: Partial<TimelineProps> = {}) => (
    <TimelineView
      workspace={workspace}
      locale="en"
      t={t}
      onNewEvent={onNewEvent}
      onEditEvent={onEditEvent}
      onDeleteEvent={onDeleteEvent}
      onNewObject={onNewObject}
      onEditObject={onEditObject}
      onDeleteObject={onDeleteObject}
      onOpenWork={onOpenWork}
      {...overrides}
      {...extra}
    />
  );

  const view = render(element());
  const button = view.queryByRole("button", {
    name: t("timelineAddFirstProp"),
  }) as HTMLButtonElement | null;
  return {
    view,
    button,
    onNewEvent,
    onEditEvent,
    onDeleteEvent,
    onNewObject,
    onEditObject,
    onDeleteObject,
    onOpenWork,
    rerender: (extra: Partial<TimelineProps> = {}) =>
      view.rerender(element(extra)),
  };
}

test("the empty-state prop button is disabled when the workspace has no universe", () => {
  const workspace: StudioWorkspace = {
    ...createDemoWorkspace("en"),
    universes: [],
    storyObjects: [],
    timelineEvents: [],
  };
  const { button } = renderTimeline(workspace);

  expect(button).not.toBeNull();
  expect(button!.disabled).toBe(true);
});

test("the empty-state prop button stays enabled when a universe exists", () => {
  const workspace: StudioWorkspace = {
    ...createDemoWorkspace("en"),
    storyObjects: [],
  };
  const { button, onNewObject } = renderTimeline(workspace);

  expect(button).not.toBeNull();
  expect(button!.disabled).toBe(false);
  fireEvent.click(button!);
  expect(onNewObject).toHaveBeenCalledTimes(1);
  expect(onNewObject.mock.calls[0]?.[0]).toBe("uni_mist_harbor");
});

test("the search box filters events by their text, ignoring case and blank input", () => {
  const { view } = renderTimeline(createDemoWorkspace("en"));
  const search = view.getByPlaceholderText(
    t("timelineSearchPlaceholder"),
  ) as HTMLInputElement;
  expect(view.container.querySelectorAll(".timeline-event").length).toBe(4);

  fireEvent.change(search, { target: { value: "INTENTIONAL" } });
  let events = view.container.querySelectorAll(".timeline-event");
  expect(events.length).toBe(1);
  expect(
    within(events[0] as HTMLElement).getByRole("heading", { level: 2 })
      .textContent,
  ).toBe("The notch is confirmed as intentional");

  fireEvent.change(search, { target: { value: "   " } });
  events = view.container.querySelectorAll(".timeline-event");
  expect(events.length).toBe(4);
});

test("subject and canon filters narrow the stream; an impossible pair shows the empty state", () => {
  const { view } = renderTimeline(createDemoWorkspace("en"));
  const subject = view.getByRole("combobox", {
    name: t("timelineStateOwner"),
  }) as HTMLSelectElement;
  const canon = view.getByRole("combobox", {
    name: t("timelineCanonStatus"),
  }) as HTMLSelectElement;

  fireEvent.change(subject, { target: { value: "character" } });
  let events = view.container.querySelectorAll(".timeline-event");
  expect(events.length).toBe(1);
  expect(
    within(events[0] as HTMLElement).getByText(
      "Lin enters a rain-soaked state",
    ),
  ).toBeDefined();

  fireEvent.change(canon, { target: { value: "proposed" } });
  expect(view.container.querySelectorAll(".timeline-event").length).toBe(0);
  expect(view.getByText(t("timelineNoEvents"))).toBeDefined();

  fireEvent.change(subject, { target: { value: "all" } });
  events = view.container.querySelectorAll(".timeline-event");
  expect(events.length).toBe(1);
  expect(
    within(events[0] as HTMLElement).getByText(
      "The tower reveals thirteen-pendulum space",
    ),
  ).toBeDefined();
});

test("switching universe clears the novel filter and scopes the empty state", () => {
  const { view, onNewEvent } = renderTimeline(createDemoWorkspace("en"));
  const novel = view.getByRole("combobox", {
    name: t("novel"),
  }) as HTMLSelectElement;
  fireEvent.change(novel, { target: { value: "work_tide_clock" } });
  expect(view.container.querySelectorAll(".timeline-event").length).toBe(4);

  const universe = view.getByRole("combobox", {
    name: t("timelineUniverseLabel"),
  }) as HTMLSelectElement;
  fireEvent.change(universe, { target: { value: "uni_ninth_station" } });
  expect(universe.value).toBe("uni_ninth_station");
  expect(novel.value).toBe("");
  expect(view.container.querySelectorAll(".timeline-event").length).toBe(0);
  expect(view.getByText(t("timelineNoEvents"))).toBeDefined();

  const addEvent = view.getByRole("button", {
    name: t("timelineAddEvent"),
  }) as HTMLButtonElement;
  fireEvent.click(addEvent);
  expect(onNewEvent).toHaveBeenCalledWith("uni_ninth_station", undefined);
});

test("a changed initialUniverseId re-selects the universe and clears the novel filter", () => {
  const { view, rerender } = renderTimeline(createDemoWorkspace("en"), {
    initialUniverseId: "uni_mist_harbor",
  });
  expect(
    (
      view.getByRole("combobox", {
        name: t("timelineUniverseLabel"),
      }) as HTMLSelectElement
    ).value,
  ).toBe("uni_mist_harbor");
  const novel = view.getByRole("combobox", {
    name: t("novel"),
  }) as HTMLSelectElement;
  fireEvent.change(novel, { target: { value: "work_tide_clock" } });
  expect(novel.value).toBe("work_tide_clock");

  rerender({ initialUniverseId: "uni_ninth_station" });
  expect(
    (
      view.getByRole("combobox", {
        name: t("timelineUniverseLabel"),
      }) as HTMLSelectElement
    ).value,
  ).toBe("uni_ninth_station");
  expect(
    (
      view.getByRole("combobox", {
        name: t("novel"),
      }) as HTMLSelectElement
    ).value,
  ).toBe("");
});

test("event cards wire edit, delete and work anchors", () => {
  const { view, onEditEvent, onDeleteEvent, onOpenWork } = renderTimeline(
    createDemoWorkspace("en"),
  );
  const first = view.container.querySelector(".timeline-event") as HTMLElement;
  const headline = within(first).getByRole("heading", { level: 2 }).textContent;

  fireEvent.click(
    within(first).getByRole("button", { name: t("timelineEditEvent") }),
  );
  expect(onEditEvent).toHaveBeenCalledTimes(1);
  expect(onEditEvent.mock.calls[0]?.[0]?.title.en).toBe(headline);

  fireEvent.click(
    within(first).getByRole("button", { name: t("timelineDeleteEvent") }),
  );
  expect(onDeleteEvent).toHaveBeenCalledTimes(1);
  expect(onDeleteEvent.mock.calls[0]?.[0]?.title.en).toBe(headline);

  // The anchor button's accessible name is the localized work/time label, so
  // target it by its class rather than by a fixed label.
  fireEvent.click(first.querySelector(".timeline-anchor") as HTMLButtonElement);
  expect(onOpenWork).toHaveBeenCalledTimes(1);
  expect(onOpenWork.mock.calls[0]?.[0]).toBe("work_tide_clock");
});

test("the prop ledger wires new, edit and delete", () => {
  const { view, onNewObject, onEditObject, onDeleteObject } = renderTimeline(
    createDemoWorkspace("en"),
  );

  fireEvent.click(view.getByRole("button", { name: t("timelineNewProp") }));
  expect(onNewObject).toHaveBeenCalledWith("uni_mist_harbor");

  const ledger = view.container.querySelector(
    ".timeline-objects",
  ) as HTMLElement;
  const row = within(ledger)
    .getByRole("button", { name: "Notched Brass Key" })
    .closest("article") as HTMLElement;
  fireEvent.click(
    within(row).getByRole("button", { name: "Notched Brass Key" }),
  );
  expect(onEditObject).toHaveBeenCalledTimes(1);
  expect(onEditObject.mock.calls[0]?.[0]?.id).toBe("object_brass_key");

  fireEvent.click(
    within(row).getByRole("button", { name: t("timelineDeleteProp") }),
  );
  expect(onDeleteObject).toHaveBeenCalledTimes(1);
  expect(onDeleteObject.mock.calls[0]?.[0]?.id).toBe("object_brass_key");
});
