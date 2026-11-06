import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  applyWorkspaceChange,
  deleteChapterFromDraft,
  deleteCharacterFromDraft,
  deleteUniverseFromDraft,
  deleteWorkFromDraft,
  reassignStandardUniverse,
  reassignWorkUniverse,
  saveWorkFromEditor,
  unlinkCharacterFromUniverse,
} from "../../apps/studio/src/core/integrity.ts";
import { MAX_WORKFLOW_RESULT_LENGTH } from "../../apps/studio/src/core/types.ts";
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
    workById(workspace, "work_tide_clock").chapters[0]?.scenes.push({
      id: "scene_tide_rain_shop",
      title: "雨夜修表铺",
      summary: "",
      locationId: "loc_old_tower",
      characterIds: ["char_lin", "char_gu"],
      shots: [],
    });
    workspace.timelineEvents.push({
      id: "timeline_echo_courier",
      universeId: "uni_mist_harbor",
      workId: "work_tide_clock",
      chapterId: "chapter_tide_001",
      storyTime: "雨夜 22:45",
      order: 30,
      subjectKind: "character",
      subjectId: "char_echo",
      eventKind: "state-change",
      title: { zh: "回声换班", en: "Echo changes shifts" },
      stateBefore: "回声在修表铺外等候。",
      stateAfter: "回声接过铜钥匙，消失在同一场雨里。",
      canonStatus: "proposed",
      relatedCharacterIds: ["char_lin", "char_gu"],
      relatedLocationIds: ["loc_old_tower"],
      relatedObjectIds: [],
      evidence: "",
      productionPrompt: "",
      createdAt: NOW,
      updatedAt: NOW,
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

    const movedScene = moved.chapters[0]?.scenes[0];
    expect(movedScene?.characterIds).toEqual(["char_gu"]);
    expect(movedScene?.locationId).toBeUndefined();

    const movedEvents = next.timelineEvents.filter(
      (event) => event.workId === "work_tide_clock",
    );
    expect(movedEvents).toHaveLength(1);
    expect(movedEvents[0]?.id).toBe("timeline_echo_courier");
    expect(movedEvents[0]?.universeId).toBe("uni_ninth_station");
    expect(movedEvents[0]?.relatedCharacterIds).toEqual(["char_gu"]);
    expect(movedEvents[0]?.relatedLocationIds).toEqual([]);

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
    const workspace = demo();
    workById(workspace, "work_tide_clock").chapters[2]?.scenes.push({
      id: "scene_tide_pendulums",
      title: "十三钟摆",
      summary: "",
      characterIds: ["char_gu", "char_lin"],
      shots: [],
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
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
    expect(
      workById(next, "work_tide_clock").chapters[2]?.scenes[0]?.characterIds,
    ).toEqual(["char_lin"]);
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
    workById(workspace, "work_last_train").chapters[0]?.scenes.push({
      id: "scene_train_blank_ticket",
      title: "空白车票",
      summary: "",
      locationId: "loc_old_tower",
      characterIds: ["char_lin", "char_echo"],
      shots: [],
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
    const survivorScene =
      workById(next, "work_last_train").chapters[0]?.scenes[0];
    expect(survivorScene?.characterIds).toEqual(["char_echo"]);
    expect(survivorScene?.locationId).toBeUndefined();

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

  test("a rejected novel save cannot mutate the live workspace through form state", () => {
    const before = demo();
    const snapshot = structuredClone(before);
    const live = workById(before, "work_tide_clock");

    // The novel form builds its result from the stored work, so the chapters
    // array it hands to the save handler is the one still held by the live
    // workspace. The invalid word target makes validation reject the save
    // after the universe cascade has already run.
    const rejected = applyWorkspaceChange(before, (draft) => {
      saveWorkFromEditor(draft, {
        ...live,
        universeId: "uni_ninth_station",
        targetWords: 1.5,
        chapters: live.chapters,
      });
    });

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toContain("targetWords");

    const untouched = workById(before, "work_tide_clock");
    expect(untouched.universeId).toBe("uni_mist_harbor");
    expect(untouched.chapters[0]?.characterIds).toEqual([
      "char_lin",
      "char_shen",
      "char_echo",
    ]);
    expect(untouched.chapters[0]?.locationId).toBe("loc_old_tower");
    expect(before).toEqual(snapshot);
  });

  test("deleting a novel removes its events, tasks and exports", () => {
    const workspace = demo();
    workspace.lastOpenedWorkId = "work_tide_clock";
    workspace.exports.push({
      id: "export_tide",
      workId: "work_tide_clock",
      workTitle: "The Tide Clock",
      createdAt: NOW,
      chapterIds: ["chapter_tide_001"],
      fileCount: 2,
      bytes: 100,
      manifestSha256: "a".repeat(64),
    });
    workspace.workflowTasks.push({
      ...unscopedTask(),
      id: "task_train_after_tide",
      universeId: "uni_ninth_station",
      workId: "work_last_train",
      chapterId: "chapter_train_001",
      parentId: "task_chapter_three",
      dependsOnIds: ["task_review_first"],
      characterIds: ["char_echo"],
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
      deleteWorkFromDraft(draft, "work_tide_clock");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    expect(next.works.map((item) => item.id)).toEqual(["work_last_train"]);
    expect(next.timelineEvents.some((event) => event.workId === "work_tide_clock")).toBe(false);
    expect(next.workflowTasks.some((task) => task.workId === "work_tide_clock")).toBe(false);
    const dependent = taskById(next, "task_train_after_tide");
    expect(dependent.parentId).toBeUndefined();
    expect(dependent.dependsOnIds).toEqual([]);
    expect(dependent.characterIds).toEqual(["char_echo"]);
    expect(next.exports).toEqual([]);
    expect(next.lastOpenedWorkId).toBeUndefined();
    expect(workspace.works).toHaveLength(2);
    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("deleting a character clears relationships, cast, events and tasks", () => {
    const workspace = demo();
    workById(workspace, "work_tide_clock").chapters[2]?.scenes.push({
      id: "scene_tide_pendulums",
      title: "十三钟摆",
      summary: "",
      characterIds: ["char_gu", "char_lin"],
      shots: [],
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
      deleteCharacterFromDraft(draft, "char_gu");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    expect(next.characters.some((item) => item.id === "char_gu")).toBe(false);
    expect(
      next.relationships.some(
        (item) => item.sourceId === "char_gu" || item.targetId === "char_gu",
      ),
    ).toBe(false);
    expect(
      next.timelineEvents.some(
        (event) =>
          (event.subjectKind === "character" && event.subjectId === "char_gu") ||
          event.relatedCharacterIds.includes("char_gu"),
      ),
    ).toBe(false);
    for (const work of next.works) {
      for (const chapter of work.chapters) {
        expect(chapter.characterIds).not.toContain("char_gu");
        for (const scene of chapter.scenes)
          expect(scene.characterIds).not.toContain("char_gu");
      }
    }
    expect(
      next.workflowTasks.every((task) => !task.characterIds.includes("char_gu")),
    ).toBe(true);
    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("deleting a chapter keeps same-id chapters and events in other novels", () => {
    const workspace = demo();
    const tide = workById(workspace, "work_tide_clock");
    const train = workById(workspace, "work_last_train");
    const sharedChapterId = tide.chapters[0]!.id;
    tide.chapters[0]!.scenes.push({
      id: "scene_rain",
      title: "Rain",
      summary: "",
      characterIds: [],
      shots: [],
    });
    train.chapters.push({
      ...structuredClone(train.chapters[0]!),
      id: sharedChapterId,
      number: 2,
      title: "Collision",
      scenes: [
        {
          id: "scene_rain",
          title: "Rain",
          summary: "",
          characterIds: [],
          shots: [],
        },
      ],
    });
    workspace.timelineEvents.push({
      ...structuredClone(workspace.timelineEvents[0]!),
      id: "timeline_train_collision",
      universeId: "uni_ninth_station",
      workId: "work_last_train",
      chapterId: sharedChapterId,
      sceneId: "scene_rain",
      subjectKind: "location",
      subjectId: "loc_platform_seven",
      relatedCharacterIds: ["char_echo"],
      relatedLocationIds: [],
      relatedObjectIds: [],
    });
    workspace.exports.push(
      {
        id: "export_tide",
        workId: "work_tide_clock",
        workTitle: "The Tide Clock",
        createdAt: NOW,
        chapterIds: ["chapter_tide_001", "chapter_tide_002"],
        fileCount: 2,
        bytes: 100,
        manifestSha256: "a".repeat(64),
      },
      {
        id: "export_train",
        workId: "work_last_train",
        workTitle: "The Last Train",
        createdAt: NOW,
        chapterIds: ["chapter_train_001"],
        fileCount: 1,
        bytes: 10,
        manifestSha256: "b".repeat(64),
      },
    );
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
      deleteChapterFromDraft(draft, "work_tide_clock", sharedChapterId);
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    expect(workById(next, "work_tide_clock").chapters.map((item) => item.id)).toEqual([
      "chapter_tide_002",
      "chapter_tide_003",
    ]);
    const keptTrainChapter = workById(next, "work_last_train").chapters.find(
      (item) => item.id === sharedChapterId,
    );
    expect(keptTrainChapter?.scenes[0]?.id).toBe("scene_rain");
    expect(
      next.timelineEvents.some(
        (event) =>
          event.workId === "work_tide_clock" && event.chapterId === sharedChapterId,
      ),
    ).toBe(false);
    const keptEvent = next.timelineEvents.find(
      (event) => event.id === "timeline_train_collision",
    );
    expect(keptEvent?.sceneId).toBe("scene_rain");
    expect(next.workflowTasks.some((task) => task.id === "task_review_first")).toBe(false);
    expect(taskById(next, "task_adaptation_pass").dependsOnIds).toEqual([]);
    expect(taskById(next, "task_chapter_three").parentId).toBe("task_world_rules");
    expect(
      next.exports.find((record) => record.id === "export_tide")?.chapterIds,
    ).toEqual(["chapter_tide_002"]);
    expect(
      next.exports.find((record) => record.id === "export_train")?.chapterIds,
    ).toEqual(["chapter_train_001"]);
    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("retargeting a standard drops references that no longer match its world", () => {
    const workspace = demo();
    const standard: WorkspaceStandard = {
      ...scopedStandard("std_shared", "uni_mist_harbor"),
      universeId: undefined,
    };
    workspace.standards.push(standard);
    taskById(workspace, "task_chapter_three").standardRefs.push({
      id: standard.id,
      version: standard.version,
    });
    workspace.workflowTasks.push({
      ...unscopedTask(),
      id: "task_train_rules",
      universeId: "uni_ninth_station",
      workId: "work_last_train",
      chapterId: "chapter_train_001",
      characterIds: ["char_echo"],
      standardRefs: [{ id: standard.id, version: standard.version }],
    });
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const outcome = applyWorkspaceChange(workspace, (draft) => {
      reassignStandardUniverse(draft, standard.id, "uni_ninth_station");
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = outcome.workspace;

    expect(
      next.standards.find((item) => item.id === standard.id)?.universeId,
    ).toBe("uni_ninth_station");
    expect(
      taskById(next, "task_chapter_three").standardRefs.some(
        (ref) => ref.id === standard.id,
      ),
    ).toBe(false);
    expect(
      taskById(next, "task_train_rules").standardRefs.some(
        (ref) => ref.id === standard.id,
      ),
    ).toBe(true);
    expect(() => validateWorkspace(next)).not.toThrow();
  });

  test("an oversized workflow result is rejected without changing the live workspace", () => {
    const before = demo();
    const snapshot = structuredClone(before);
    const rejected = applyWorkspaceChange(before, (draft) => {
      const task = draft.workflowTasks.find(
        (item) => item.id === "task_world_rules",
      );
      if (task) task.result.en = "x".repeat(MAX_WORKFLOW_RESULT_LENGTH + 1);
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.issues.join(" ")).toContain("result");
    expect(before).toEqual(snapshot);

    const accepted = applyWorkspaceChange(before, (draft) => {
      const task = draft.workflowTasks.find(
        (item) => item.id === "task_world_rules",
      );
      if (task) task.result.en = "x".repeat(MAX_WORKFLOW_RESULT_LENGTH);
    });
    expect(accepted.ok).toBe(true);
  });
});
