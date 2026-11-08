import { z } from "zod";
import {
  CHAPTER_LIMITS,
  MAX_LOCALIZED_LENGTH,
  MAX_WORKFLOW_RESULT_LENGTH,
  WORKFLOW_TASK_TEMPLATES,
  WORKSPACE_SCHEMA_VERSION,
} from "./types.ts";

const identifier = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/, "invalid identifier");
const isoDate = z.string().datetime({ offset: true });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const nonNegativeInt = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

export const localizedSchema = z
  .object({
    zh: z.string().max(MAX_LOCALIZED_LENGTH).default(""),
    en: z.string().max(MAX_LOCALIZED_LENGTH).default(""),
  })
  .strict();

const uiLocaleSchema = z.enum(["zh-CN", "en"]);
const workStatusSchema = z.enum([
  "concept",
  "outlining",
  "drafting",
  "complete",
  "archived",
]);
const chapterStatusSchema = z.enum([
  "idea",
  "outline",
  "draft",
  "revised",
  "approved",
]);
const relationshipTypeSchema = z.enum([
  "family",
  "ally",
  "friend",
  "rival",
  "enemy",
  "mentor",
  "romance",
  "debt",
  "other",
]);
const relationshipStatusSchema = z.enum(["active", "broken", "hidden"]);
const loreCategorySchema = z.enum([
  "rule",
  "history",
  "culture",
  "technology",
  "power",
  "mystery",
]);
const workflowTaskKindSchema = z.enum([
  "world",
  "novel",
  "chapter",
  "character",
  "review",
  "adaptation",
]);
const workflowTaskStatusSchema = z.enum(["queued", "active", "review", "done"]);
const standardKindSchema = z.enum([
  "style",
  "format",
  "naming",
  "numeric",
  "entity-prompt",
  "continuity",
]);
const standardStatusSchema = z.enum(["draft", "active", "disabled"]);
const timelineSubjectKindSchema = z.enum([
  "character",
  "scene",
  "location",
  "object",
]);
const timelineEventKindSchema = z.enum([
  "introduction",
  "state-change",
  "transfer",
  "reveal",
  "loss",
  "recovery",
  "other",
]);

export const storyShotSchema = z
  .object({
    id: identifier,
    shotType: z.string().max(100),
    description: z.string().max(20_000),
    dialogue: z.string().max(20_000).default(""),
    camera: z.string().max(2_000).default(""),
    durationMs: z.number().int().min(400).max(120_000),
    visualPrompt: z.string().max(20_000).default(""),
  })
  .strict();

export const storySceneSchema = z
  .object({
    id: identifier,
    title: z.string().max(300),
    summary: z.string().max(20_000).default(""),
    locationId: identifier.optional(),
    characterIds: z.array(identifier).max(100).default([]),
    shots: z.array(storyShotSchema).max(80).default([]),
  })
  .strict();

export const chapterSchema = z
  .object({
    id: identifier,
    number: positiveInt,
    title: z.string().trim().min(1).max(CHAPTER_LIMITS.title),
    titleEn: z.string().max(CHAPTER_LIMITS.title).default(""),
    status: chapterStatusSchema,
    pov: z.string().max(CHAPTER_LIMITS.pov).default(""),
    summary: z.string().max(CHAPTER_LIMITS.summary).default(""),
    outline: z.string().max(CHAPTER_LIMITS.outline).default(""),
    content: z.string().max(CHAPTER_LIMITS.content).default(""),
    beats: z
      .array(z.string().max(CHAPTER_LIMITS.beatLength))
      .max(CHAPTER_LIMITS.beats)
      .default([]),
    characterIds: z.array(identifier).max(100).default([]),
    locationId: identifier.optional(),
    adaptationNotes: z.string().max(CHAPTER_LIMITS.adaptationNotes).default(""),
    scenes: z.array(storySceneSchema).max(100).default([]),
    revision: nonNegativeInt,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const workSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    title: localizedSchema,
    logline: localizedSchema,
    synopsis: z.string().max(100_000).default(""),
    status: workStatusSchema,
    language: uiLocaleSchema,
    genre: z.string().max(200).default(""),
    themes: z.array(z.string().max(100)).max(50).default([]),
    targetWords: positiveInt,
    coverColor: color,
    chapters: z.array(chapterSchema).max(1_000).default([]),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const universeSchema = z
  .object({
    id: identifier,
    name: localizedSchema,
    tagline: localizedSchema,
    summary: localizedSchema,
    genres: z.array(z.string().max(100)).max(50).default([]),
    themes: z.array(z.string().max(100)).max(50).default([]),
    accent: color,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const characterSchema = z
  .object({
    id: identifier,
    universeIds: z.array(identifier).min(1).max(50),
    name: localizedSchema,
    role: localizedSchema,
    summary: localizedSchema,
    appearance: z.string().max(20_000).default(""),
    visualPrompt: z.string().max(20_000).default(""),
    personality: z.string().max(20_000).default(""),
    motivation: z.string().max(20_000).default(""),
    flaw: z.string().max(20_000).default(""),
    secret: z.string().max(20_000).default(""),
    voice: z.string().max(10_000).default(""),
    tags: z.array(z.string().max(100)).max(50).default([]),
    color: color,
    reusable: z.boolean().default(false),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const locationSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    name: localizedSchema,
    summary: localizedSchema,
    atmosphere: z.string().max(20_000).default(""),
    visualPrompt: z.string().max(20_000).default(""),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const storyObjectSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    name: localizedSchema,
    category: localizedSchema,
    summary: localizedSchema,
    visualPrompt: z.string().max(20_000).default(""),
    sourceNotes: z.string().max(100_000).default(""),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const factionSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    name: localizedSchema,
    summary: localizedSchema,
    goal: z.string().max(20_000).default(""),
    visualMotif: z.string().max(20_000).default(""),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const loreSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    category: loreCategorySchema,
    title: localizedSchema,
    body: z.string().max(100_000).default(""),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const relationshipSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    sourceId: identifier,
    targetId: identifier,
    type: relationshipTypeSchema,
    label: localizedSchema,
    strength: z.number().int().min(1).max(5),
    status: relationshipStatusSchema,
    mutual: z.boolean(),
    notes: z.string().max(20_000).default(""),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const timelineEventSchema = z
  .object({
    id: identifier,
    universeId: identifier,
    workId: identifier,
    chapterId: identifier.optional(),
    sceneId: identifier.optional(),
    storyTime: z.string().max(500).default(""),
    order: nonNegativeInt,
    subjectKind: timelineSubjectKindSchema,
    subjectId: identifier,
    eventKind: timelineEventKindSchema,
    title: localizedSchema,
    stateBefore: z.string().max(20_000).default(""),
    stateAfter: z.string().max(20_000).default(""),
    canonStatus: z.enum(["proposed", "canon"]),
    relatedCharacterIds: z.array(identifier).max(100).default([]),
    relatedLocationIds: z.array(identifier).max(100).default([]),
    relatedObjectIds: z.array(identifier).max(100).default([]),
    evidence: z.string().max(100_000).default(""),
    productionPrompt: z.string().max(20_000).default(""),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()
  .superRefine((event, ctx) => {
    if (!event.chapterId && !event.storyTime.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["storyTime"],
        message: "chapter or story time is required",
      });
    }
    if (!event.title.zh.trim() && !event.title.en.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "event title is required",
      });
    }
    if (!event.stateBefore.trim() && !event.stateAfter.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["stateAfter"],
        message: "at least one state is required",
      });
    }
  });

export const exportRecordSchema = z
  .object({
    id: identifier,
    workId: identifier,
    workTitle: z.string().max(500),
    createdAt: isoDate,
    chapterIds: z.array(identifier).max(1_000),
    fileCount: nonNegativeInt,
    bytes: nonNegativeInt,
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputPath: z.string().max(10_000).optional(),
  })
  .strict();

export const standardRefSchema = z
  .object({
    id: identifier,
    version: positiveInt,
  })
  .strict();

export const standardSchema = z
  .object({
    id: identifier,
    title: localizedSchema,
    kind: standardKindSchema,
    universeId: identifier.optional(),
    body: z
      .object({
        zh: z.string().max(20_000).default(""),
        en: z.string().max(20_000).default(""),
      })
      .strict(),
    status: standardStatusSchema,
    version: positiveInt,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()
  .superRefine((standard, ctx) => {
    if (!standard.title.zh.trim() && !standard.title.en.trim())
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "standard title is required",
      });
    if (!standard.body.zh.trim() && !standard.body.en.trim())
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "standard body is required",
      });
  });

export const workflowTaskRunMetaSchema = z
  .object({
    model: z.string().trim().min(1).max(300),
    promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: nonNegativeInt,
    at: isoDate,
  })
  .strict();

export const workflowTaskSchema = z
  .object({
    id: identifier,
    title: localizedSchema,
    brief: localizedSchema.extend({
      zh: z.string().max(100_000).default(""),
      en: z.string().max(100_000).default(""),
    }),
    deliverable: localizedSchema.extend({
      zh: z.string().max(100_000).default(""),
      en: z.string().max(100_000).default(""),
    }),
    result: localizedSchema.extend({
      zh: z.string().max(MAX_WORKFLOW_RESULT_LENGTH).default(""),
      en: z.string().max(MAX_WORKFLOW_RESULT_LENGTH).default(""),
    }),
    previousResult: localizedSchema
      .extend({
        zh: z.string().max(MAX_WORKFLOW_RESULT_LENGTH).default(""),
        en: z.string().max(MAX_WORKFLOW_RESULT_LENGTH).default(""),
      })
      .optional(),
    lastRun: workflowTaskRunMetaSchema.optional(),
    resultSuperseded: z.boolean().optional(),
    kind: workflowTaskKindSchema,
    template: z.enum(WORKFLOW_TASK_TEMPLATES).optional(),
    status: workflowTaskStatusSchema,
    universeId: identifier.optional(),
    workId: identifier.optional(),
    chapterId: identifier.optional(),
    parentId: identifier.optional(),
    characterIds: z.array(identifier).max(100).default([]),
    dependsOnIds: z.array(identifier).max(100).default([]),
    standardRefs: z.array(standardRefSchema).max(100).default([]),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export const settingsSchema = z
  .object({
    locale: uiLocaleSchema,
    theme: z.enum(["system", "light", "dark"]),
    defaultAspectRatio: z.enum(["9:16", "16:9", "1:1"]),
    exportApprovedOnly: z.boolean(),
  })
  .strict();

export const workspaceSchema = z
  .object({
    schema_version: z.literal(WORKSPACE_SCHEMA_VERSION),
    id: identifier,
    name: z.string().trim().min(1).max(300),
    revision: nonNegativeInt,
    createdAt: isoDate,
    updatedAt: isoDate,
    lastOpenedWorkId: identifier.optional(),
    settings: settingsSchema,
    standards: z.array(standardSchema).max(1_000),
    universes: z.array(universeSchema).max(1_000),
    characters: z.array(characterSchema).max(20_000),
    locations: z.array(locationSchema).max(20_000),
    storyObjects: z.array(storyObjectSchema).max(20_000),
    factions: z.array(factionSchema).max(20_000),
    lore: z.array(loreSchema).max(20_000),
    relationships: z.array(relationshipSchema).max(100_000),
    timelineEvents: z.array(timelineEventSchema).max(100_000),
    workflowTasks: z.array(workflowTaskSchema).max(20_000),
    works: z.array(workSchema).max(20_000),
    exports: z.array(exportRecordSchema).max(10_000),
  })
  .strict()
  .superRefine((workspace, ctx) => {
    const universes = new Set(workspace.universes.map((item) => item.id));
    const standards = new Map(
      workspace.standards.map((item) => [item.id, item]),
    );
    const characters = new Set(workspace.characters.map((item) => item.id));
    const charactersById = new Map(
      workspace.characters.map((item) => [item.id, item]),
    );
    const locationsById = new Map(
      workspace.locations.map((item) => [item.id, item]),
    );
    const storyObjectsById = new Map(
      workspace.storyObjects.map((item) => [item.id, item]),
    );

    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const unique = <T>(items: T[], path: string, read: (item: T) => string) => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        const id = read(item);
        if (seen.has(id)) issue([path, index, "id"], `duplicate id: ${id}`);
        seen.add(id);
      }
    };
    unique(workspace.universes, "universes", (item) => item.id);
    unique(workspace.standards, "standards", (item) => item.id);
    unique(workspace.characters, "characters", (item) => item.id);
    unique(workspace.locations, "locations", (item) => item.id);
    unique(workspace.storyObjects, "storyObjects", (item) => item.id);
    unique(workspace.factions, "factions", (item) => item.id);
    unique(workspace.lore, "lore", (item) => item.id);
    unique(workspace.relationships, "relationships", (item) => item.id);
    unique(workspace.timelineEvents, "timelineEvents", (item) => item.id);
    unique(workspace.workflowTasks, "workflowTasks", (item) => item.id);
    unique(workspace.works, "works", (item) => item.id);
    unique(workspace.exports, "exports", (item) => item.id);
    const worksById = new Map(workspace.works.map((work) => [work.id, work]));
    if (
      workspace.lastOpenedWorkId &&
      !worksById.has(workspace.lastOpenedWorkId)
    )
      issue(["lastOpenedWorkId"], "unknown work");
    const chaptersById = new Map(
      workspace.works.flatMap((work) =>
        work.chapters.map(
          (chapter) => [`${work.id}:${chapter.id}`, chapter] as const,
        ),
      ),
    );
    for (const [workIndex, work] of workspace.works.entries()) {
      unique(work.chapters, `works.${workIndex}.chapters`, (item) => item.id);
      if (!universes.has(work.universeId))
        issue(["works", workIndex, "universeId"], "unknown universe");
      const chapterNumbers = new Set<number>();
      for (const [chapterIndex, chapter] of work.chapters.entries()) {
        if (chapterNumbers.has(chapter.number))
          issue(
            ["works", workIndex, "chapters", chapterIndex, "number"],
            "duplicate chapter number",
          );
        chapterNumbers.add(chapter.number);
        for (const characterId of chapter.characterIds) {
          const character = charactersById.get(characterId);
          if (!character)
            issue(
              ["works", workIndex, "chapters", chapterIndex, "characterIds"],
              `unknown character: ${characterId}`,
            );
          else if (!character.universeIds.includes(work.universeId))
            issue(
              ["works", workIndex, "chapters", chapterIndex, "characterIds"],
              "character belongs to another universe",
            );
        }
        if (chapter.locationId) {
          const location = locationsById.get(chapter.locationId);
          if (!location)
            issue(
              ["works", workIndex, "chapters", chapterIndex, "locationId"],
              "unknown location",
            );
          else if (location.universeId !== work.universeId)
            issue(
              ["works", workIndex, "chapters", chapterIndex, "locationId"],
              "location belongs to another universe",
            );
        }
        for (const [sceneIndex, scene] of chapter.scenes.entries()) {
          if (scene.locationId) {
            const location = locationsById.get(scene.locationId);
            if (!location)
              issue(
                [
                  "works",
                  workIndex,
                  "chapters",
                  chapterIndex,
                  "scenes",
                  sceneIndex,
                  "locationId",
                ],
                "unknown location",
              );
            else if (location.universeId !== work.universeId)
              issue(
                [
                  "works",
                  workIndex,
                  "chapters",
                  chapterIndex,
                  "scenes",
                  sceneIndex,
                  "locationId",
                ],
                "location belongs to another universe",
              );
          }
          for (const characterId of scene.characterIds) {
            const character = charactersById.get(characterId);
            if (!character)
              issue(
                [
                  "works",
                  workIndex,
                  "chapters",
                  chapterIndex,
                  "scenes",
                  sceneIndex,
                  "characterIds",
                ],
                `unknown character: ${characterId}`,
              );
            else if (!character.universeIds.includes(work.universeId))
              issue(
                [
                  "works",
                  workIndex,
                  "chapters",
                  chapterIndex,
                  "scenes",
                  sceneIndex,
                  "characterIds",
                ],
                "character belongs to another universe",
              );
          }
        }
      }
    }
    for (const [index, standard] of workspace.standards.entries()) {
      if (standard.universeId && !universes.has(standard.universeId))
        issue(["standards", index, "universeId"], "unknown universe");
    }
    for (const [index, character] of workspace.characters.entries()) {
      if (!character.universeIds.length)
        issue(["characters", index, "universeIds"], "at least one is required");
      for (const universeId of character.universeIds) {
        if (!universes.has(universeId))
          issue(
            ["characters", index, "universeIds"],
            `unknown universe: ${universeId}`,
          );
      }
    }
    for (const [path, items] of [
      ["locations", workspace.locations],
      ["storyObjects", workspace.storyObjects],
      ["factions", workspace.factions],
      ["lore", workspace.lore],
    ] as const) {
      for (const [index, item] of items.entries()) {
        if (!universes.has(item.universeId))
          issue([path, index, "universeId"], "unknown universe");
      }
    }
    for (const [index, relationship] of workspace.relationships.entries()) {
      if (!universes.has(relationship.universeId))
        issue(["relationships", index, "universeId"], "unknown universe");
      if (!characters.has(relationship.sourceId))
        issue(["relationships", index, "sourceId"], "unknown character");
      if (!characters.has(relationship.targetId))
        issue(["relationships", index, "targetId"], "unknown character");
      if (relationship.sourceId === relationship.targetId)
        issue(["relationships", index, "targetId"], "self relation");
    }
    for (const [index, event] of workspace.timelineEvents.entries()) {
      if (!universes.has(event.universeId))
        issue(["timelineEvents", index, "universeId"], "unknown universe");
      const work = worksById.get(event.workId);
      if (!work) issue(["timelineEvents", index, "workId"], "unknown work");
      else if (work.universeId !== event.universeId)
        issue(
          ["timelineEvents", index, "workId"],
          "work belongs to another universe",
        );
      const chapter = event.chapterId
        ? work?.chapters.find((item) => item.id === event.chapterId)
        : undefined;
      if (event.chapterId && !chapter)
        issue(["timelineEvents", index, "chapterId"], "unknown chapter");
      if (event.sceneId) {
        if (!event.chapterId)
          issue(
            ["timelineEvents", index, "chapterId"],
            "chapter is required for a scene",
          );
        else if (
          chapter &&
          !chapter.scenes.some((item) => item.id === event.sceneId)
        )
          issue(["timelineEvents", index, "sceneId"], "unknown scene");
      }
      if (event.subjectKind === "character") {
        const subject = charactersById.get(event.subjectId);
        if (!subject)
          issue(["timelineEvents", index, "subjectId"], "unknown character");
        else if (!subject.universeIds.includes(event.universeId))
          issue(
            ["timelineEvents", index, "subjectId"],
            "character belongs to another universe",
          );
      } else if (event.subjectKind === "location") {
        const subject = locationsById.get(event.subjectId);
        if (!subject)
          issue(["timelineEvents", index, "subjectId"], "unknown location");
        else if (subject.universeId !== event.universeId)
          issue(
            ["timelineEvents", index, "subjectId"],
            "location belongs to another universe",
          );
      } else if (event.subjectKind === "object") {
        const subject = storyObjectsById.get(event.subjectId);
        if (!subject)
          issue(["timelineEvents", index, "subjectId"], "unknown object");
        else if (subject.universeId !== event.universeId)
          issue(
            ["timelineEvents", index, "subjectId"],
            "object belongs to another universe",
          );
      } else {
        if (!event.chapterId)
          issue(
            ["timelineEvents", index, "subjectId"],
            "scene subject requires a chapter",
          );
        else if (
          chapter &&
          !chapter.scenes.some((item) => item.id === event.subjectId)
        )
          issue(
            ["timelineEvents", index, "subjectId"],
            "unknown scene subject",
          );
      }
      for (const characterId of event.relatedCharacterIds) {
        const character = charactersById.get(characterId);
        if (!character)
          issue(
            ["timelineEvents", index, "relatedCharacterIds"],
            "unknown character",
          );
        else if (!character.universeIds.includes(event.universeId))
          issue(
            ["timelineEvents", index, "relatedCharacterIds"],
            "character belongs to another universe",
          );
      }
      for (const locationId of event.relatedLocationIds) {
        const location = locationsById.get(locationId);
        if (!location)
          issue(
            ["timelineEvents", index, "relatedLocationIds"],
            "unknown location",
          );
        else if (location.universeId !== event.universeId)
          issue(
            ["timelineEvents", index, "relatedLocationIds"],
            "location belongs to another universe",
          );
      }
      for (const objectId of event.relatedObjectIds) {
        const object = storyObjectsById.get(objectId);
        if (!object)
          issue(
            ["timelineEvents", index, "relatedObjectIds"],
            "unknown object",
          );
        else if (object.universeId !== event.universeId)
          issue(
            ["timelineEvents", index, "relatedObjectIds"],
            "object belongs to another universe",
          );
      }
    }
    for (const [index, record] of workspace.exports.entries()) {
      const work = worksById.get(record.workId);
      if (!work) issue(["exports", index, "workId"], "unknown work");
      else {
        const chapterIds = new Set(work.chapters.map((chapter) => chapter.id));
        const seenChapterIds = new Set<string>();
        for (const chapterId of record.chapterIds) {
          if (seenChapterIds.has(chapterId))
            issue(
              ["exports", index, "chapterIds"],
              `duplicate chapter: ${chapterId}`,
            );
          seenChapterIds.add(chapterId);
          if (!chapterIds.has(chapterId))
            issue(
              ["exports", index, "chapterIds"],
              `unknown chapter: ${chapterId}`,
            );
        }
      }
    }

    const workflowTasks = new Map(
      workspace.workflowTasks.map((task) => [task.id, task]),
    );
    for (const [index, task] of workspace.workflowTasks.entries()) {
      if (!task.title.zh.trim() && !task.title.en.trim())
        issue(["workflowTasks", index, "title"], "task title is required");
      if (task.universeId && !universes.has(task.universeId))
        issue(["workflowTasks", index, "universeId"], "unknown universe");
      const work = task.workId ? worksById.get(task.workId) : undefined;
      if (task.workId && !work)
        issue(["workflowTasks", index, "workId"], "unknown work");
      if (task.universeId && work && work.universeId !== task.universeId)
        issue(
          ["workflowTasks", index, "workId"],
          "work belongs to another universe",
        );
      if (task.chapterId && !task.workId)
        issue(
          ["workflowTasks", index, "workId"],
          "work is required for a chapter task",
        );
      if (
        task.chapterId &&
        task.workId &&
        !chaptersById.has(`${task.workId}:${task.chapterId}`)
      )
        issue(["workflowTasks", index, "chapterId"], "unknown chapter");
      if (task.parentId) {
        if (task.parentId === task.id)
          issue(
            ["workflowTasks", index, "parentId"],
            "task cannot parent itself",
          );
        else if (!workflowTasks.has(task.parentId))
          issue(["workflowTasks", index, "parentId"], "unknown parent task");
      }
      for (const dependencyId of task.dependsOnIds) {
        if (dependencyId === task.id)
          issue(
            ["workflowTasks", index, "dependsOnIds"],
            "task cannot depend on itself",
          );
        else if (!workflowTasks.has(dependencyId))
          issue(
            ["workflowTasks", index, "dependsOnIds"],
            `unknown task: ${dependencyId}`,
          );
      }
      for (const characterId of task.characterIds) {
        const character = workspace.characters.find(
          (item) => item.id === characterId,
        );
        if (!character)
          issue(["workflowTasks", index, "characterIds"], "unknown character");
        else if (
          task.universeId &&
          !character.universeIds.includes(task.universeId)
        )
          issue(
            ["workflowTasks", index, "characterIds"],
            "character belongs to another universe",
          );
      }
      const standardIds = new Set<string>();
      for (const ref of task.standardRefs) {
        if (standardIds.has(ref.id))
          issue(
            ["workflowTasks", index, "standardRefs"],
            `duplicate standard: ${ref.id}`,
          );
        standardIds.add(ref.id);
        const standard = standards.get(ref.id);
        if (!standard)
          issue(
            ["workflowTasks", index, "standardRefs"],
            `unknown standard: ${ref.id}`,
          );
        else if (
          standard.universeId &&
          task.universeId &&
          standard.universeId !== task.universeId
        )
          issue(
            ["workflowTasks", index, "standardRefs"],
            "standard belongs to another universe",
          );
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string, trail: string[]) => {
      if (visiting.has(id)) {
        const cycleStart = trail.indexOf(id);
        const cycle = [...trail.slice(Math.max(0, cycleStart)), id];
        const taskIndex = workspace.workflowTasks.findIndex(
          (item) => item.id === id,
        );
        issue(
          ["workflowTasks", Math.max(0, taskIndex), "dependsOnIds"],
          `workflow cycle: ${cycle.join(" -> ")}`,
        );
        return;
      }
      if (visited.has(id)) return;
      const task = workflowTasks.get(id);
      if (!task) return;
      visiting.add(id);
      trail.push(id);
      const next = [
        ...(task.parentId ? [task.parentId] : []),
        ...task.dependsOnIds,
      ];
      for (const dependencyId of next) visit(dependencyId, trail);
      trail.pop();
      visiting.delete(id);
      visited.add(id);
    };
    for (const task of workspace.workflowTasks) visit(task.id, []);
  });

export type ParsedWorkspace = z.infer<typeof workspaceSchema>;
