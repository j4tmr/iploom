import "./dom-setup";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  ChapterModal,
  NovelModal,
} from "../../apps/studio/src/components/forms.tsx";
import {
  FoundationChecklistCard,
  FoundationGateModal,
  FoundationHealthPanel,
  FoundationWarningBanner,
} from "../../apps/studio/src/components/foundation-checklist.tsx";
import {
  createEmptyWorkspace,
  createId,
  localized,
} from "../../apps/studio/src/core/factory.ts";
import {
  createFoundationBypass,
  evaluateUniverseFoundation,
  type FoundationCheckTarget,
} from "../../apps/studio/src/core/foundation-readiness.ts";
import {
  attachOverlayKeyboard,
  overlayStack,
} from "../../apps/studio/src/core/overlay-stack.ts";
import type {
  Chapter,
  RuleStatus,
  RuleSystem,
  StoryUniverse,
  StoryWork,
  StudioWorkspace,
} from "../../apps/studio/src/core/types.ts";
import { applyWorldTemplate } from "../../apps/studio/src/core/world-templates.ts";
import { translator } from "../../apps/studio/src/i18n.ts";

const NOW = "2026-11-23T12:00:00.000Z";
const t = translator("en");

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

function seededCultivationWorkspace(activateAll = false): {
  workspace: StudioWorkspace;
  universe: StoryUniverse;
} {
  const workspace = createEmptyWorkspace("Foundation UI", "en", NOW);
  const universe: StoryUniverse = {
    id: createId("uni"),
    name: localized("青岚界", "Azure Realm"),
    tagline: localized("", ""),
    summary: localized(
      "灵脉渐衰的修真世界。",
      "A fading-ley cultivation realm.",
    ),
    genres: ["修仙"],
    themes: ["境界"],
    accent: "#2d6a62",
    createdAt: NOW,
    updatedAt: NOW,
  };
  workspace.universes.push(universe);
  applyWorldTemplate(workspace, "cultivation", universe.id, NOW);
  if (activateAll) {
    for (const standard of workspace.standards) {
      if (standard.universeId === universe.id) standard.status = "active";
    }
    for (const system of workspace.ruleSystems) {
      if (system.universeId === universe.id) system.status = "active";
    }
  }
  return { workspace, universe };
}

describe("foundation checklist and health components", () => {
  test("FoundationChecklistCard renders all six items and routes clicks to targets", () => {
    const { workspace, universe } = seededCultivationWorkspace(false);
    const report = evaluateUniverseFoundation(workspace, universe.id);
    const onSelectTarget = mock((_target: FoundationCheckTarget) => {});

    const view = render(
      <FoundationChecklistCard
        report={report}
        t={t}
        onSelectTarget={onSelectTarget}
      />,
    );

    expect(view.getByText("4/6 complete")).toBeDefined();
    expect(view.getByText("Drafts to review")).toBeDefined();

    fireEvent.click(view.getByText("World summary").closest("button")!);
    fireEvent.click(view.getByText("Active rule set").closest("button")!);
    fireEvent.click(view.getByText("Cast").closest("button")!);
    fireEvent.click(view.getByText("Locations & factions").closest("button")!);
    fireEvent.click(view.getByText("Item designs").closest("button")!);

    expect(onSelectTarget.mock.calls.map((call) => call[0])).toEqual([
      "edit-world",
      "foundation",
      "cast",
      "atlas",
      "timeline",
    ]);

    cleanup();
    // Static mode without click handler still renders every item cleanly.
    const staticView = render(
      <FoundationChecklistCard report={report} t={t} compact />,
    );
    expect(staticView.queryAllByRole("button")).toHaveLength(0);
    expect(staticView.getByText("Canon vs. proposal status")).toBeDefined();
  });

  test("FoundationChecklistCard covers missing and complete states", () => {
    const workspace = createEmptyWorkspace("Blank", "en", NOW);
    const universe: StoryUniverse = {
      id: createId("uni"),
      name: localized("空世界", "Empty"),
      tagline: localized("", ""),
      summary: localized("", ""),
      genres: [],
      themes: [],
      accent: "#2f7567",
      createdAt: NOW,
      updatedAt: NOW,
    };
    workspace.universes.push(universe);
    const missingReport = evaluateUniverseFoundation(workspace, universe.id);
    const view = render(
      <FoundationChecklistCard report={missingReport} t={t} />,
    );
    expect(view.getByText("Foundation unfinished")).toBeDefined();
    expect(view.getByText("Add a short world summary")).toBeDefined();
    expect(
      view.getByText("No world-scoped standards or rule systems yet"),
    ).toBeDefined();
    expect(
      view.getByText("No active canon rules or reviewed timeline status yet"),
    ).toBeDefined();
    cleanup();

    const ready = seededCultivationWorkspace(true);
    const readyReport = evaluateUniverseFoundation(
      ready.workspace,
      ready.universe.id,
    );
    const readyView = render(
      <FoundationChecklistCard report={readyReport} t={t} />,
    );
    expect(readyView.getByText("Foundation ready")).toBeDefined();
    expect(readyView.getByText("6/6 complete")).toBeDefined();
  });

  test("FoundationHealthPanel shows structured vs prose-only axes and rule system actions", () => {
    const { workspace, universe } = seededCultivationWorkspace(false);
    const report = evaluateUniverseFoundation(workspace, universe.id);
    const onStatusChange = mock(
      (_system: RuleSystem, _status: RuleStatus) => {},
    );
    const onDelete = mock((_system: RuleSystem) => {});

    const view = render(
      <FoundationHealthPanel
        workspace={workspace}
        universeId={universe.id}
        report={report}
        locale="en"
        t={t}
        onRuleSystemStatusChange={onStatusChange}
        onDeleteRuleSystem={onDelete}
      />,
    );

    expect(view.getByText("Foundation health")).toBeDefined();
    expect(view.getAllByText("Structured").length).toBeGreaterThanOrEqual(3);
    expect(view.getByText("Prose-only")).toBeDefined();

    // Draft system offers Activate and Delete.
    fireEvent.click(view.getByRole("button", { name: "Activate" }));
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange.mock.calls[0]![1]).toBe("active");

    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    cleanup();
    // Active system offers Disable; empty world shows empty note.
    const active = seededCultivationWorkspace(true);
    const activeView = render(
      <FoundationHealthPanel
        workspace={active.workspace}
        universeId={active.universe.id}
        report={evaluateUniverseFoundation(
          active.workspace,
          active.universe.id,
        )}
        locale="en"
        t={t}
        onRuleSystemStatusChange={onStatusChange}
      />,
    );
    fireEvent.click(activeView.getByRole("button", { name: "Disable" }));
    expect(onStatusChange.mock.calls[1]![1]).toBe("disabled");
    cleanup();

    const empty = createEmptyWorkspace("Empty", "en", NOW);
    const emptyUniverse: StoryUniverse = {
      id: createId("uni"),
      name: localized("空", "Empty"),
      tagline: localized("", ""),
      summary: localized("", ""),
      genres: [],
      themes: [],
      accent: "#2f7567",
      createdAt: NOW,
      updatedAt: NOW,
    };
    empty.universes.push(emptyUniverse);
    const emptyView = render(
      <FoundationHealthPanel
        workspace={empty}
        universeId={emptyUniverse.id}
        report={evaluateUniverseFoundation(empty, emptyUniverse.id)}
        locale="en"
        t={t}
      />,
    );
    expect(emptyView.getByText(t("foundationRuleSystemsEmpty"))).toBeDefined();
  });

  test("FoundationGateModal lists unfinished checks and lets the author finish or proceed", () => {
    const { workspace, universe } = seededCultivationWorkspace(false);
    const report = evaluateUniverseFoundation(workspace, universe.id);
    const onClose = mock(() => {});
    const onFinish = mock(() => {});
    const onProceed = mock(() => {});

    const view = render(
      <FoundationGateModal
        open
        kind="novel"
        report={report}
        t={t}
        onClose={onClose}
        onFinishFoundation={onFinish}
        onProceedAnyway={onProceed}
      />,
    );

    expect(view.getByText("Active rule set")).toBeDefined();
    expect(view.getByText("Canon vs. proposal status")).toBeDefined();
    expect(view.queryByText("World summary")).toBeNull();

    fireEvent.click(
      view.getByRole("button", { name: "Finish foundation first" }),
    );
    expect(onFinish).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByTestId("foundation-gate-proceed"));
    expect(onProceed).toHaveBeenCalledTimes(1);

    cleanup();
    const gameView = render(
      <FoundationGateModal
        open
        kind="game"
        report={report}
        t={t}
        onClose={onClose}
        onFinishFoundation={onFinish}
        onProceedAnyway={onProceed}
      />,
    );
    expect(
      gameView.getByRole("button", { name: "Start game anyway" }),
    ).toBeDefined();
  });

  test("FoundationWarningBanner hides when complete with no bypass and displays recorded state", () => {
    const { workspace, universe } = seededCultivationWorkspace(true);
    const completeReport = evaluateUniverseFoundation(workspace, universe.id);
    const hidden = render(
      <FoundationWarningBanner
        report={completeReport}
        locale="en"
        t={t}
        mode="work"
      />,
    );
    expect(hidden.queryByTestId("foundation-warning-banner")).toBeNull();
    cleanup();

    const onOpenFoundation = mock(() => {});
    const shown = render(
      <FoundationWarningBanner
        report={completeReport}
        bypass={{ at: NOW, missingItems: ["activeRules", "items"] }}
        locale="en"
        t={t}
        mode="work"
        onOpenFoundation={onOpenFoundation}
      />,
    );
    const banner = shown.getByTestId("foundation-warning-banner");
    expect(banner.textContent).toContain("Active rule set");
    expect(banner.textContent).toContain("Item designs");
    fireEvent.click(shown.getByRole("button", { name: "Review foundation" }));
    expect(onOpenFoundation).toHaveBeenCalledTimes(1);
  });
});

describe("non-blocking writing gate on NovelModal and ChapterModal", () => {
  test("ChapterModal warns on incomplete foundation and records foundationBypass on deliberate proceed", () => {
    const { workspace, universe } = seededCultivationWorkspace(false);
    const report = evaluateUniverseFoundation(workspace, universe.id);
    const onSave = mock((_chapter: Chapter) => true);
    const onOpenFoundation = mock(() => {});

    const view = render(
      <ChapterModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        initialNumber={1}
        existingNumbers={[]}
        foundationReport={report}
        onOpenFoundation={onOpenFoundation}
        onSave={onSave}
      />,
    );

    expect(view.getByTestId("foundation-warning-banner")).toBeDefined();
    const titleInput = view.getByLabelText("Chapter title") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "First Step" } });

    const submit = view.getByRole("button", { name: "Add chapter anyway" });
    fireEvent.click(submit);

    expect(onSave).toHaveBeenCalledTimes(1);
    const created = onSave.mock.calls[0]![0];
    expect(created.foundationBypass?.missingItems).toEqual([
      "activeRules",
      "canonStatus",
    ]);
  });

  test("ChapterModal omits warning and foundationBypass when foundation is complete", () => {
    const { workspace, universe } = seededCultivationWorkspace(true);
    const report = evaluateUniverseFoundation(workspace, universe.id);
    const onSave = mock((_chapter: Chapter) => true);

    const view = render(
      <ChapterModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        initialNumber={1}
        existingNumbers={[]}
        foundationReport={report}
        onSave={onSave}
      />,
    );

    expect(view.queryByTestId("foundation-warning-banner")).toBeNull();
    fireEvent.change(view.getByLabelText("Chapter title"), {
      target: { value: "Ready Chapter" },
    });
    fireEvent.click(view.getByRole("button", { name: "Add" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0].foundationBypass).toBeUndefined();
  });

  test("NovelModal warns and records foundationBypass on create, and preserves it on edit", () => {
    const { workspace, universe } = seededCultivationWorkspace(false);
    const onSave = mock((_work: StoryWork) => true);

    const createView = render(
      <NovelModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        workspace={workspace}
        defaultUniverseId={universe.id}
        onSave={onSave}
      />,
    );

    expect(createView.getByTestId("foundation-warning-banner")).toBeDefined();
    fireEvent.change(createView.getByLabelText("Chinese title"), {
      target: { value: "青岚录" },
    });
    fireEvent.click(createView.getByRole("button", { name: "Create anyway" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const created = onSave.mock.calls[0]![0];
    expect(created.foundationBypass?.missingItems).toEqual([
      "activeRules",
      "canonStatus",
    ]);
    cleanup();

    // Editing the existing work hides the create warning and keeps the recorded bypass.
    const onEditSave = mock((_work: StoryWork) => true);
    const editView = render(
      <NovelModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        workspace={workspace}
        initial={created}
        onSave={onEditSave}
      />,
    );
    expect(editView.queryByTestId("foundation-warning-banner")).toBeNull();
    fireEvent.click(editView.getByRole("button", { name: "Save" }));
    expect(onEditSave).toHaveBeenCalledTimes(1);
    expect(onEditSave.mock.calls[0]![0].foundationBypass).toEqual(
      created.foundationBypass,
    );
    // Keep unused import check satisfied by verifying bypass helper output matches.
    expect(
      createFoundationBypass(evaluateUniverseFoundation(workspace, universe.id))
        ?.missingItems,
    ).toEqual(created.foundationBypass?.missingItems);
  });
});
