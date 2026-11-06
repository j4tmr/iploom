import { z } from "zod";
import { WORKSPACE_SCHEMA_VERSION } from "./types.ts";

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
    zh: z.string().max(500).default(""),
    en: z.string().max(500).default(""),
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
    title: z.string().trim().min(1).max(300),
    titleEn: z.string().max(300).default(""),
    status: chapterStatusSchema,
    pov: z.string().max(300).default(""),
    summary: z.string().max(20_000).default(""),
    outline: z.string().max(200_000).default(""),
    content: z.string().max(2_000_000).default(""),
    beats: z.array(z.string().max(5_000)).max(100).default([]),
    characterIds: z.array(identifier).max(100).default([]),
    locationId: identifier.optional(),
    adaptationNotes: z.string().max(50_000).default(""),
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
    universes: z.array(universeSchema).max(1_000),
    characters: z.array(characterSchema).max(20_000),
    locations: z.array(locationSchema).max(20_000),
    factions: z.array(factionSchema).max(20_000),
    lore: z.array(loreSchema).max(20_000),
    relationships: z.array(relationshipSchema).max(100_000),
    works: z.array(workSchema).max(20_000),
    exports: z.array(exportRecordSchema).max(10_000),
  })
  .strict()
  .superRefine((workspace, ctx) => {
    const universes = new Set(workspace.universes.map((item) => item.id));
    const characters = new Set(workspace.characters.map((item) => item.id));
    const locations = new Set(workspace.locations.map((item) => item.id));

    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const unique = <T>(
      items: T[],
      path: string,
      read: (item: T) => string,
    ) => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        const id = read(item);
        if (seen.has(id)) issue([path, index, "id"], `duplicate id: ${id}`);
        seen.add(id);
      }
    };
    unique(workspace.universes, "universes", (item) => item.id);
    unique(workspace.characters, "characters", (item) => item.id);
    unique(workspace.locations, "locations", (item) => item.id);
    unique(workspace.factions, "factions", (item) => item.id);
    unique(workspace.lore, "lore", (item) => item.id);
    unique(workspace.relationships, "relationships", (item) => item.id);
    unique(workspace.works, "works", (item) => item.id);
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
          if (!characters.has(characterId))
            issue(
              [
                "works",
                workIndex,
                "chapters",
                chapterIndex,
                "characterIds",
              ],
              `unknown character: ${characterId}`,
            );
        }
        if (chapter.locationId && !locations.has(chapter.locationId))
          issue(
            ["works", workIndex, "chapters", chapterIndex, "locationId"],
            "unknown location",
          );
        for (const [sceneIndex, scene] of chapter.scenes.entries()) {
          if (scene.locationId && !locations.has(scene.locationId))
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
          for (const characterId of scene.characterIds) {
            if (!characters.has(characterId))
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
          }
        }
      }
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
    for (const [index, record] of workspace.exports.entries()) {
      if (!workspace.works.some((work) => work.id === record.workId))
        issue(["exports", index, "workId"], "unknown work");
    }
  });

export type ParsedWorkspace = z.infer<typeof workspaceSchema>;
