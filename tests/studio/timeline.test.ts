import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { buildProductionPrompt } from "../../apps/studio/src/core/production.ts";
import {
  relevantTimelineEvents,
  removeSceneReferences,
  sortTimelineEvents,
  timelineAnchorLabel,
  timelineSubjectLabel,
} from "../../apps/studio/src/core/timeline.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { buildWorkflowBrief } from "../../apps/studio/src/core/workflow.ts";

describe("story timeline", () => {
  test("orders chapter anchors and in-world time deterministically", () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const sorted = sortTimelineEvents(workspace, workspace.timelineEvents);
    expect(sorted.map((event) => event.id)).toEqual([
      "timeline_rain_key_handoff",
      "timeline_lin_rain_costume",
      "timeline_key_notch_reveal",
      "timeline_tower_interior",
    ]);
    const handoff = sorted[0]!;
    expect(timelineAnchorLabel(workspace, handoff, "en")).toContain(
      "Chapter 1",
    );
    expect(timelineSubjectLabel(workspace, handoff, "en")).toBe(
      "Notched Brass Key",
    );
  });

  test("scopes canon and proposed states before a selected chapter", () => {
    const workspace = createDemoWorkspace("en");
    const chapterTwo = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
      characterId: "char_lin",
    });
    expect(chapterTwo.canon.map((event) => event.id)).toEqual([
      "timeline_rain_key_handoff",
      "timeline_lin_rain_costume",
      "timeline_key_notch_reveal",
    ]);
    expect(chapterTwo.proposed).toEqual([]);
  });

  test("adds prop and state continuity to production prompts", () => {
    const workspace = createDemoWorkspace("zh-CN");
    const prompt = buildProductionPrompt(
      workspace,
      "costume",
      {
        workId: "work_tide_clock",
        chapterId: "chapter_tide_001",
        characterId: "char_lin",
      },
      "zh-CN",
    );
    expect(prompt).toContain("缺口铜钥匙");
    expect(prompt).toContain("斗篷肩部与发梢被雾雨打湿");
    expect(prompt).toContain("timeline_rain_key_handoff");
    expect(prompt).not.toContain("旧塔内部展开十三钟摆空间");
  });

  test("workflow briefs expose timeline evidence and distinguish proposals", () => {
    const workspace = createDemoWorkspace("en");
    const brief = buildWorkflowBrief(workspace, "task_review_first", "en");
    expect(brief).toContain("Timeline and state constraints");
    expect(brief).toContain("Lin hands the brass key to Shen");
    expect(brief).toContain("Production constraint");
    expect(brief).not.toContain("thirteen-pendulum space");
  });

  test("keeps prop-subject events anchored to the selected chapter", () => {
    const workspace = createDemoWorkspace("en");
    const propState = structuredClone(workspace.timelineEvents[0]!);
    propState.id = "timeline_prop_chapter_state";
    propState.chapterId = "chapter_tide_001";
    propState.subjectKind = "object";
    propState.subjectId = "object_brass_key";
    propState.relatedCharacterIds = [];
    propState.relatedLocationIds = [];
    propState.relatedObjectIds = [];
    workspace.timelineEvents.push(propState);

    const events = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_001",
    });
    expect(events.canon.map((event) => event.id)).toContain(propState.id);
  });

  test("keeps time-only events relevant to the selected chapter cast", () => {
    const workspace = createDemoWorkspace("en");
    const timed = structuredClone(workspace.timelineEvents[0]!);
    timed.id = "timeline_time_only_costume";
    timed.chapterId = undefined;
    timed.storyTime = "Rainy night 22:45";
    timed.subjectKind = "character";
    timed.subjectId = "char_lin";
    timed.relatedCharacterIds = [];
    timed.relatedLocationIds = [];
    timed.relatedObjectIds = [];
    workspace.timelineEvents.push(timed);

    const events = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
    });
    expect(events.canon.map((event) => event.id)).toContain(timed.id);
  });

  test("scopes timeline facts to every character assigned to a task", () => {
    const workspace = createDemoWorkspace("en");
    const shenOnly = structuredClone(workspace.timelineEvents[0]!);
    shenOnly.id = "timeline_shen_only";
    shenOnly.subjectKind = "character";
    shenOnly.subjectId = "char_shen";
    shenOnly.relatedCharacterIds = [];
    shenOnly.relatedLocationIds = [];
    shenOnly.relatedObjectIds = [];
    shenOnly.title = {
      zh: "沈雁独自确认怀表",
      en: "Shen checks the watch alone",
    };
    workspace.timelineEvents.push(shenOnly);

    const brief = buildWorkflowBrief(workspace, "task_review_first", "en");
    expect(brief).toContain("Shen checks the watch alone");

    const linOnly = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_001",
      characterId: "char_lin",
    });
    expect(linOnly.canon.map((event) => event.id)).not.toContain(shenOnly.id);
  });

  test("cast-only chapters keep unrelated location-free events out of scope", () => {
    const workspace = createDemoWorkspace("en");
    const chapter = workspace.works[0]!.chapters.find(
      (item) => item.id === "chapter_tide_002",
    )!;
    chapter.locationId = undefined;
    const outsider = structuredClone(workspace.timelineEvents[0]!);
    outsider.id = "timeline_echo_earlier";
    outsider.chapterId = "chapter_tide_001";
    outsider.subjectKind = "character";
    outsider.subjectId = "char_echo";
    outsider.relatedCharacterIds = ["char_echo"];
    outsider.relatedLocationIds = [];
    outsider.relatedObjectIds = [];
    workspace.timelineEvents.push(outsider);

    const events = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
    });
    expect(events.canon.map((event) => event.id)).not.toContain(outsider.id);
    expect(events.canon.map((event) => event.id)).toContain(
      "timeline_rain_key_handoff",
    );
  });

  test("restoring the chapter location leaves cast-scoped results unchanged", () => {
    const workspace = createDemoWorkspace("en");
    const chapter = workspace.works[0]!.chapters.find(
      (item) => item.id === "chapter_tide_002",
    )!;
    const outsider = structuredClone(workspace.timelineEvents[0]!);
    outsider.id = "timeline_echo_earlier";
    outsider.chapterId = "chapter_tide_001";
    outsider.subjectKind = "character";
    outsider.subjectId = "char_echo";
    outsider.relatedCharacterIds = ["char_echo"];
    outsider.relatedLocationIds = [];
    outsider.relatedObjectIds = [];
    workspace.timelineEvents.push(outsider);
    const scope = {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
    };

    chapter.locationId = undefined;
    const castOnly = relevantTimelineEvents(workspace, scope).canon.map(
      (event) => event.id,
    );
    chapter.locationId = "loc_old_tower";
    const withLocation = relevantTimelineEvents(workspace, scope).canon.map(
      (event) => event.id,
    );

    expect(withLocation).toEqual(castOnly);
    expect(withLocation).not.toContain(outsider.id);
    expect(withLocation).toContain("timeline_rain_key_handoff");
  });

  test("chapters without any scope information return every event in range", () => {
    const workspace = createDemoWorkspace("en");
    const chapter = workspace.works[0]!.chapters.find(
      (item) => item.id === "chapter_tide_002",
    )!;
    chapter.characterIds = [];
    chapter.locationId = undefined;
    const outsider = structuredClone(workspace.timelineEvents[0]!);
    outsider.id = "timeline_echo_earlier";
    outsider.chapterId = "chapter_tide_001";
    outsider.subjectKind = "character";
    outsider.subjectId = "char_echo";
    outsider.relatedCharacterIds = [];
    outsider.relatedLocationIds = [];
    outsider.relatedObjectIds = [];
    workspace.timelineEvents.push(outsider);

    const events = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
    });
    expect(new Set(events.canon.map((event) => event.id))).toEqual(
      new Set([
        "timeline_rain_key_handoff",
        "timeline_lin_rain_costume",
        "timeline_key_notch_reveal",
        outsider.id,
      ]),
    );
    expect(events.proposed).toEqual([]);
  });

  test("an empty scene does not narrow a chapter without cast or location", () => {
    const workspace = createDemoWorkspace("en");
    const chapter = workspace.works[0]!.chapters.find(
      (item) => item.id === "chapter_tide_002",
    )!;
    chapter.characterIds = [];
    chapter.locationId = undefined;
    chapter.scenes = [];
    const scope = {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
    };
    const withoutScenes = relevantTimelineEvents(workspace, scope);
    chapter.scenes = [
      {
        id: "scene_blank",
        title: "Blank",
        summary: "",
        characterIds: [],
        shots: [],
      },
    ];
    const withBlankScene = relevantTimelineEvents(workspace, scope);

    expect(withBlankScene.canon.map((event) => event.id)).toEqual(
      withoutScenes.canon.map((event) => event.id),
    );
    expect(new Set(withBlankScene.canon.map((event) => event.id))).toEqual(
      new Set([
        "timeline_rain_key_handoff",
        "timeline_lin_rain_costume",
        "timeline_key_notch_reveal",
      ]),
    );
  });

  test("keeps character and location facts anchored to the selected chapter", () => {
    const workspace = createDemoWorkspace("en");
    const dock = structuredClone(
      workspace.locations.find((item) => item.id === "loc_old_tower")!,
    );
    dock.id = "loc_rain_dock";
    workspace.locations.push(dock);

    const characterFact = structuredClone(workspace.timelineEvents[0]!);
    characterFact.id = "timeline_gu_chapter_anchor";
    characterFact.chapterId = "chapter_tide_002";
    characterFact.subjectKind = "character";
    characterFact.subjectId = "char_gu";
    characterFact.relatedCharacterIds = [];
    characterFact.relatedLocationIds = [];
    characterFact.relatedObjectIds = [];

    const locationFact = structuredClone(workspace.timelineEvents[0]!);
    locationFact.id = "timeline_dock_chapter_anchor";
    locationFact.chapterId = "chapter_tide_002";
    locationFact.subjectKind = "location";
    locationFact.subjectId = "loc_rain_dock";
    locationFact.relatedCharacterIds = [];
    locationFact.relatedLocationIds = [];
    locationFact.relatedObjectIds = [];

    workspace.timelineEvents.push(characterFact, locationFact);

    const events = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
    });
    const ids = events.canon.map((event) => event.id);
    expect(ids).toContain(characterFact.id);
    expect(ids).toContain(locationFact.id);
  });

  test("treats a scene cast as chapter scope", () => {
    const workspace = createDemoWorkspace("en");
    const chapter = workspace.works[0]!.chapters.find(
      (item) => item.id === "chapter_tide_002",
    )!;
    chapter.characterIds = [];
    chapter.locationId = undefined;
    chapter.scenes = [
      {
        id: "scene_notch",
        title: "Notch",
        summary: "",
        characterIds: ["char_gu"],
        shots: [],
      },
    ];
    const sceneCastFact = structuredClone(workspace.timelineEvents[0]!);
    sceneCastFact.id = "timeline_gu_earlier";
    sceneCastFact.chapterId = "chapter_tide_001";
    sceneCastFact.subjectKind = "character";
    sceneCastFact.subjectId = "char_gu";
    sceneCastFact.relatedCharacterIds = [];
    sceneCastFact.relatedLocationIds = [];
    sceneCastFact.relatedObjectIds = [];
    workspace.timelineEvents.push(sceneCastFact);

    const events = relevantTimelineEvents(workspace, {
      workId: "work_tide_clock",
      chapterId: "chapter_tide_002",
    });
    const ids = events.canon.map((event) => event.id);
    expect(ids).toContain(sceneCastFact.id);
    expect(ids).not.toContain("timeline_lin_rain_costume");
  });

  test("drops scene subjects and clears scene anchors when a scene is removed", () => {
    const workspace = createDemoWorkspace("en");
    const chapter = workspace.works[0]!.chapters[0]!;
    chapter.scenes.push({
      id: "scene_rain_counter",
      title: "Rain counter",
      summary: "",
      characterIds: [],
      shots: [],
    });
    const sceneSubject = structuredClone(workspace.timelineEvents[0]!);
    sceneSubject.id = "timeline_scene_state";
    sceneSubject.chapterId = chapter.id;
    sceneSubject.sceneId = "scene_rain_counter";
    sceneSubject.subjectKind = "scene";
    sceneSubject.subjectId = "scene_rain_counter";
    const anchored = structuredClone(workspace.timelineEvents[1]!);
    anchored.id = "timeline_scene_anchor";
    anchored.chapterId = chapter.id;
    anchored.sceneId = "scene_rain_counter";
    const kept = removeSceneReferences(
      [sceneSubject, anchored],
      workspace.works[0]!.id,
      chapter.id,
      new Set(["scene_rain_counter"]),
    );
    expect(kept.map((event) => event.id)).toEqual(["timeline_scene_anchor"]);
    expect(kept[0]!.sceneId).toBeUndefined();
  });

  test("scene removal is scoped by novel so equal chapter and scene ids elsewhere survive", () => {
    const workspace = createDemoWorkspace("en");
    const work = workspace.works[0]!;
    const otherWork = workspace.works[1]!;
    const sharedChapterId = work.chapters[0]!.id;
    work.chapters[0]!.scenes.push({
      id: "scene_shared",
      title: "Shared",
      summary: "",
      characterIds: [],
      shots: [],
    });
    const collisionChapter = structuredClone(otherWork.chapters[0]!);
    collisionChapter.id = sharedChapterId;
    collisionChapter.number = 2;
    collisionChapter.scenes.push({
      id: "scene_shared",
      title: "Shared",
      summary: "",
      characterIds: [],
      shots: [],
    });
    otherWork.chapters.push(collisionChapter);

    const tideEvent = structuredClone(workspace.timelineEvents[0]!);
    tideEvent.id = "timeline_tide_scene";
    tideEvent.workId = work.id;
    tideEvent.chapterId = sharedChapterId;
    tideEvent.sceneId = "scene_shared";
    tideEvent.subjectKind = "scene";
    tideEvent.subjectId = "scene_shared";
    const trainEvent = {
      ...structuredClone(workspace.timelineEvents[0]!),
      id: "timeline_train_scene",
      universeId: otherWork.universeId,
      workId: otherWork.id,
      chapterId: sharedChapterId,
      sceneId: "scene_shared",
      subjectKind: "location" as const,
      subjectId: "loc_platform_seven",
      relatedCharacterIds: ["char_echo"],
      relatedLocationIds: [],
      relatedObjectIds: [],
    };
    workspace.timelineEvents.push(tideEvent, trainEvent);
    expect(() => validateWorkspace(workspace)).not.toThrow();

    const kept = removeSceneReferences(
      workspace.timelineEvents,
      work.id,
      sharedChapterId,
      new Set(["scene_shared"]),
    );
    expect(kept.some((event) => event.id === "timeline_tide_scene")).toBe(
      false,
    );
    const survivor = kept.find((event) => event.id === "timeline_train_scene");
    expect(survivor?.sceneId).toBe("scene_shared");
    expect(survivor?.workId).toBe(otherWork.id);
  });

  test("rejects scene subjects without a chapter and cross-universe links", () => {
    const missingSceneChapter = createDemoWorkspace("en");
    missingSceneChapter.timelineEvents[0]!.subjectKind = "scene";
    missingSceneChapter.timelineEvents[0]!.subjectId = "scene_missing";
    missingSceneChapter.timelineEvents[0]!.chapterId = undefined;
    expect(() => validateWorkspace(missingSceneChapter)).toThrow(
      /scene subject requires a chapter/,
    );

    const crossUniverse = createDemoWorkspace("en");
    crossUniverse.timelineEvents[0]!.relatedLocationIds.push(
      "loc_platform_seven",
    );
    expect(() => validateWorkspace(crossUniverse)).toThrow(
      /location belongs to another universe/,
    );
  });
});
