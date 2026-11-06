import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  applyWorkspaceChange,
  deleteUniverseFromDraft,
  reassignWorkUniverse,
  unlinkCharacterFromUniverse,
} from "../../apps/studio/src/core/integrity.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import type {
  Character,
  StoryWork,
  TimelineEvent,
  WorkflowTask,
  WorkspaceStandard,
} from "../../apps/studio/src/core/types.ts";

const NOW = "2026-11-06T00:00:00.000Z";

function demo() {
  return createDemoWorkspace("en", NOW);
}

function workById(workspace: ReturnType<typeof demo>, id: string): StoryWork {
  const work = workspace.works.find((item) => item.id === id);
  if (!work) throw new Error(`missing work ${id}`);
  return work;
}

function characterById(
  workspace: ReturnType<typeof demo>,
  id: string,
): Character {
  const character = workspace.characters.find((item) => item.id === id);
  if (!character) throw new Error(`missing character ${id}`);
  return character;
}

function taskById(workspace: ReturnType<typeof demo>, id: string): WorkflowTask {
  const task = workspace.workflowTasks.find((item) => item.id === id);
  if (!task) throw new Error(`missing task ${id}`);
  return task;
}

function eventById(
  workspace: ReturnType<typeof demo>,
  id: string,
): TimelineEvent {
  const event = workspace.timelineEvents.find((item) => item.id === id);
  if (!event) throw new Error(`missing event ${id}`);
  return event;
}

function scopedStandard(id: string, universeId: string): WorkspaceStandard {
  return {
    id,
    kind: "format",
    title: { zh: id, en: id },
    body: { zh: id, en: id },
    universeId,
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function unscopedTask(): WorkflowTask {
  return {
    id: "task_orphan",
    title: { zh: "无世界任务", en: "Unscoped task" },
    brief: { zh: "", en: "" },
    deliverable: { zh: "", en: "" },
    result: { zh: "", en: "" },
    kind: "world",
    status: "active",
    characterIds: ["char_lin"],
    dependsOnIds: [],
    standardRefs: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("workspace integrity", () => {
  test("moving a novel to another world repairs cast, places, events and tasks", () => {
    const workspace = demo();
    const scoped = scopedStandard("std_mist_scope", "uni_mist_harbor");
    workspace.standards.push(scoped);
    taskById(workspace, "task_chapter_three").standardRefs.push({
      id: scoped.id,
      version: scoped.version,
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
      reassignWorkUniverse(draft, "work_tide_clock", "uni_ninth_station");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    const moved = workById(next, "work_tide_clock");
    expect(moved.universeId).toBe("uni_ninth_station");
    expect(moved.chapters[0]?.characterIds).toEqual(["char_echo"]);
    expect(moved.chapters[0]?.locationId).toBeUndefined();
    expect(moved.chapters[1]?.characterIds).toEqual([]);
    expect(moved.chapters[1]?.locationId).toBeUndefined();
    expect(moved.chapters[2]?.characterIds).toEqual(["char_gu"]);
    expect(moved.chapters[2]?.locationId).toBeUndefined();

    expect(
      next.timelineEvents.filter((event) => event.workId === "work_tide_clock"),
    ).toHaveLength(0);

    const chapterTask = taskById(next, "task_chapter_three");
    expect(chapterTask.universeId).toBe("uni_ninth_station");
    expect(chapterTask.characterIds).toEqual(["char_gu"]);
    expect(chapterTask.standardRefs.some((ref) => ref.id === scoped.id)).toBe(
      false,
    );
    expect(taskById(next, "task_review_first").characterIds).toEqual([]);
    expect(taskById(next, "task_adaptation_pass").characterIds).toEqual([]);
    expect(taskById(next, "task_world_rules").universeId).toBe(
      "uni_mist_harbor",
    );

    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("unlinking a character from a world clears its references in that world", () => {
    const outcome = applyWorkspaceChange(demo(), (draft) => {
      unlinkCharacterFromUniverse(draft, "char_gu", "uni_mist_harbor");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    expect(characterById(next, "char_gu").universeIds).toEqual([
      "uni_ninth_station",
    ]);
    expect(next.relationships.some((item) => item.id === "rel_shen_gu")).toBe(
      false,
    );
    expect(next.relationships.some((item) => item.id === "rel_lin_gu")).toBe(
      false,
    );
    expect(next.relationships.some((item) => item.id === "rel_lin_shen")).toBe(
      true,
    );
    expect(workById(next, "work_tide_clock").chapters[2]?.characterIds).toEqual(
      ["char_lin", "char_shen"],
    );
    expect(taskById(next, "task_chapter_three").characterIds).toEqual([
      "char_lin",
      "char_shen",
    ]);
    expect(eventById(next, "timeline_tower_interior").relatedCharacterIds).toEqual(
      ["char_lin", "char_shen"],
    );

    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("deleting a world keeps a task without a world valid", () => {
    const workspace = demo();
    const scoped = scopedStandard("std_mist_scope", "uni_mist_harbor");
    workspace.standards.push(scoped);
    workspace.workflowTasks.push({
      ...unscopedTask(),
      standardRefs: [{ id: scoped.id, version: scoped.version }],
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
      deleteUniverseFromDraft(draft, "uni_mist_harbor");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    const survivor = taskById(next, "task_orphan");
    expect(survivor.universeId).toBeUndefined();
    expect(survivor.characterIds).toEqual([]);
    expect(survivor.standardRefs).toEqual([]);
    expect(next.characters.some((item) => item.id === "char_lin")).toBe(false);
    expect(next.standards.some((item) => item.id === scoped.id)).toBe(false);

    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("deleting a world drops relationships elsewhere that pointed at its characters", () => {
    const workspace = demo();
    workspace.relationships.push({
      id: "rel_cross_world",
      universeId: "uni_ninth_station",
      sourceId: "char_lin",
      targetId: "char_echo",
      type: "ally",
      label: { zh: "跨世界盟友", en: "Cross-world ally" },
      strength: 1,
      status: "active",
      mutual: false,
      notes: "",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
      deleteUniverseFromDraft(draft, "uni_mist_harbor");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(
      outcome.workspace.relationships.some(
        (item) => item.id === "rel_cross_world",
      ),
    ).toBe(false);
    expect(() => validateWorkspace(outcome.workspace)).not.toThrow();
  });

  test("a novel moved out of a world survives deleting the old world", () => {
    const outcome = applyWorkspaceChange(demo(), (draft) => {
      reassignWorkUniverse(draft, "work_tide_clock", "uni_ninth_station");
      deleteUniverseFromDraft(draft, "uni_mist_harbor");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    const moved = workById(next, "work_tide_clock");
    expect(moved.universeId).toBe("uni_ninth_station");
    expect(next.universes.some((item) => item.id === "uni_mist_harbor")).toBe(
      false,
    );
    expect(next.characters.some((item) => item.id === "char_lin")).toBe(false);
    expect(characterById(next, "char_gu").universeIds).toEqual([
      "uni_ninth_station",
    ]);
    expect(taskById(next, "task_chapter_three").universeId).toBe(
      "uni_ninth_station",
    );

    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("an invalid structural change is rejected and the previous state stays saveable", () => {
    const before = demo();
    const revision = before.revision;

    const rejected = applyWorkspaceChange(before, (draft) => {
      const work = draft.works.find((item) => item.id === "work_tide_clock");
      if (work) work.universeId = "uni_missing";
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.issues.length).toBeGreaterThan(0);
    expect(rejected.error).toContain("unknown universe");
    expect(rejected.error).toContain("universeId");
    expect(before.revision).toBe(revision);
    expect(() => validateWorkspace(before)).not.toThrow();

    const emitted = applyWorkspaceChange(before, (draft) => {
      const character = draft.characters.find(
        (item) => item.id === "char_lin",
      );
      if (character) character.universeIds = [];
    });
    expect(emitted.ok).toBe(false);
    if (emitted.ok) return;
    expect(emitted.issues.join(" ")).toContain("at least one is required");

    const recovered = applyWorkspaceChange(before, (draft) => {
      const work = draft.works.find((item) => item.id === "work_tide_clock");
      if (work) work.status = "complete";
    });
    expect(recovered.ok).toBe(true);
  });
});
