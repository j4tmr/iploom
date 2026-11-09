import { migrateWorkspace } from "./migrations.ts";
import type { StoryWork, StudioWorkspace, TimelineEvent } from "./types.ts";
import {
  validateWorkspace,
  WorkspaceValidationError,
  type WorkspaceIssueDetail,
} from "./validate.ts";

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep string ids that resolve inside the work's universe, drop duplicates and
 * ids that cannot resolve, and leave malformed entries for validation to
 * report. Returns undefined when there is no array to repair.
 */
function pruneCharacterRefs(
  ids: unknown,
  belongsToUniverse: (id: string) => boolean,
): { ids: unknown[]; changed: boolean } | undefined {
  if (!Array.isArray(ids)) return undefined;
  const seen = new Set<string>();
  const kept = ids.filter((id) => {
    if (typeof id !== "string") return true;
    if (!belongsToUniverse(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { ids: kept, changed: kept.length !== ids.length };
}

/**
 * Drop chapter and scene references that cannot resolve inside their work's
 * universe.
 *
 * Workspaces written before universe ownership was validated can still contain
 * cast members or locations from another universe. The editor scopes its
 * pickers to the work universe, so those references are invisible there, and
 * exporters silently drop them. A strict validator alone would make such a
 * workspace impossible to save, so loading prunes them first: character ids
 * that do not exist or do not belong to the work universe are removed (first
 * occurrence kept), and location ids owned by another universe are cleared.
 * A location id that does not exist at all is left for validation to report
 * instead of silently dropping a likely typo.
 *
 * The input is never mutated and `revision` is untouched, so loading a legacy
 * workspace does not look like an edit. Applying the function to its own
 * output changes nothing (idempotent).
 */
export function repairCrossUniverseReferences(
  workspace: StudioWorkspace,
): StudioWorkspace;
export function repairCrossUniverseReferences(value: unknown): unknown;
export function repairCrossUniverseReferences(value: unknown): unknown {
  if (!isUnknownRecord(value)) return value;

  const characterUniverses = new Map<string, Set<string>>();
  if (Array.isArray(value.characters)) {
    for (const character of value.characters) {
      if (!isUnknownRecord(character)) continue;
      const { id, universeIds } = character;
      if (typeof id !== "string" || !Array.isArray(universeIds)) continue;
      characterUniverses.set(
        id,
        new Set(
          universeIds.filter(
            (item): item is string => typeof item === "string",
          ),
        ),
      );
    }
  }
  const locationUniverses = new Map<string, string>();
  if (Array.isArray(value.locations)) {
    for (const location of value.locations) {
      if (!isUnknownRecord(location)) continue;
      const { id, universeId } = location;
      if (typeof id === "string" && typeof universeId === "string")
        locationUniverses.set(id, universeId);
    }
  }
  if (!Array.isArray(value.works)) return value;

  let workspaceChanged = false;
  const works = value.works.map((work) => {
    if (!isUnknownRecord(work) || typeof work.universeId !== "string")
      return work;
    if (!Array.isArray(work.chapters)) return work;
    const universeId = work.universeId;
    const memberOfUniverse = (characterId: string) =>
      characterUniverses.get(characterId)?.has(universeId) === true;
    const foreignLocation = (locationId: string) => {
      const owner = locationUniverses.get(locationId);
      return owner !== undefined && owner !== universeId;
    };

    let workChanged = false;
    const chapters = work.chapters.map((chapter) => {
      if (!isUnknownRecord(chapter)) return chapter;
      let chapterChanged = false;

      let chapterCharacterIds = chapter.characterIds;
      const cast = pruneCharacterRefs(chapter.characterIds, memberOfUniverse);
      if (cast?.changed) {
        chapterCharacterIds = cast.ids;
        chapterChanged = true;
      }

      let scenesChanged = false;
      const scenes = Array.isArray(chapter.scenes)
        ? chapter.scenes.map((scene) => {
            if (!isUnknownRecord(scene)) return scene;
            let sceneChanged = false;
            let sceneCharacterIds = scene.characterIds;
            const sceneCast = pruneCharacterRefs(
              scene.characterIds,
              memberOfUniverse,
            );
            if (sceneCast?.changed) {
              sceneCharacterIds = sceneCast.ids;
              sceneChanged = true;
            }
            let sceneLocationId = scene.locationId;
            if (
              typeof sceneLocationId === "string" &&
              foreignLocation(sceneLocationId)
            ) {
              sceneLocationId = undefined;
              sceneChanged = true;
            }
            if (!sceneChanged) return scene;
            scenesChanged = true;
            const repairedScene: Record<string, unknown> = {
              ...scene,
              characterIds: sceneCharacterIds,
            };
            if (sceneLocationId === undefined) delete repairedScene.locationId;
            else repairedScene.locationId = sceneLocationId;
            return repairedScene;
          })
        : chapter.scenes;
      if (scenesChanged) chapterChanged = true;

      const clearLocation =
        typeof chapter.locationId === "string" &&
        foreignLocation(chapter.locationId);
      if (clearLocation) chapterChanged = true;

      if (!chapterChanged) return chapter;
      workChanged = true;
      const repairedChapter: Record<string, unknown> = {
        ...chapter,
        characterIds: chapterCharacterIds,
        scenes,
      };
      if (clearLocation) delete repairedChapter.locationId;
      return repairedChapter;
    });

    if (!workChanged) return work;
    workspaceChanged = true;
    return { ...work, chapters };
  });

  return workspaceChanged ? { ...value, works } : value;
}

/**
 * Decode a persisted workspace: migrate old schema versions, prune legacy
 * cross-universe chapter and scene references, then validate strictly.
 *
 * Every read from disk, localStorage, a snapshot or a backup goes through
 * this function. `validateWorkspace` itself stays strict so a new invalid
 * edit is still rejected instead of being repaired behind the user's back.
 */
export function loadWorkspace(value: unknown): StudioWorkspace {
  return validateWorkspace(
    repairCrossUniverseReferences(migrateWorkspace(value)),
  );
}

export interface WorkspaceChangeApplied {
  ok: true;
  workspace: StudioWorkspace;
}

export interface WorkspaceChangeRejected {
  ok: false;
  /** A human-readable summary of the first validation issues. */
  error: string;
  issues: string[];
  /** Structured locations for the same failures, in validator order. */
  details: WorkspaceIssueDetail[];
}

export type WorkspaceChangeResult =
  | WorkspaceChangeApplied
  | WorkspaceChangeRejected;

function describeFailure(reason: unknown): WorkspaceChangeRejected {
  if (reason instanceof WorkspaceValidationError) {
    const issues = reason.issues;
    const shown = issues.slice(0, 3).join("; ");
    const remainder = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
    return {
      ok: false,
      error: `${shown}${remainder}`,
      issues,
      details: reason.details,
    };
  }
  return {
    ok: false,
    error: reason instanceof Error ? reason.message : String(reason),
    issues: [],
    details: [],
  };
}

/**
 * Apply a change to a clone of the workspace and accept it only when the
 * resulting workspace still satisfies every cross-entity reference rule.
 * The previous workspace is never mutated, so a rejected change can never
 * leave the editor in a state the storage layer refuses to save.
 */
export function applyWorkspaceChange(
  workspace: StudioWorkspace,
  change: (draft: StudioWorkspace) => void,
  now = new Date().toISOString(),
): WorkspaceChangeResult {
  const draft = structuredClone(workspace);
  try {
    change(draft);
  } catch (reason) {
    return {
      ok: false,
      error: `change could not be applied: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
      issues: [],
      details: [],
    };
  }
  draft.revision = workspace.revision + 1;
  draft.updatedAt = now;
  try {
    return { ok: true, workspace: validateWorkspace(draft) };
  } catch (reason) {
    return describeFailure(reason);
  }
}

/**
 * Save a work built by an editor form.
 *
 * The incoming object is copied before it enters the draft because forms build
 * it from live workspace data (the novel form reuses the stored chapter array),
 * and a universe change below rewrites cast and location references on those
 * chapters. Without the copy, a rejected save would mutate the previous
 * workspace through the shared array even though the draft is discarded.
 */
export function saveWorkFromEditor(
  draft: StudioWorkspace,
  next: StoryWork,
): void {
  const saved = structuredClone(next);
  const index = draft.works.findIndex((item) => item.id === saved.id);
  const previous = index >= 0 ? draft.works[index] : undefined;
  if (index >= 0) draft.works[index] = saved;
  else draft.works.push(saved);
  draft.lastOpenedWorkId = saved.id;
  if (previous && previous.universeId !== saved.universeId)
    reassignWorkUniverse(draft, saved.id, saved.universeId);
}

/**
 * Rebuild the references of a work after `work.universeId` changed.
 *
 * The work keeps its chapters and scenes, but chapter/scene cast and location
 * references that do not exist in the destination universe are cleared.
 * Timeline events pinned to the work are retargeted; events whose subject
 * cannot exist in the destination universe are dropped and related entity
 * lists are pruned. Tasks that were scoped to a universe and pinned to this
 * work follow the work into the destination universe, losing cast members and
 * world-scoped standards that no longer apply.
 */
export function reassignWorkUniverse(
  draft: StudioWorkspace,
  workId: string,
  universeId: string,
): void {
  const work = draft.works.find((item) => item.id === workId);
  if (!work) return;
  work.universeId = universeId;

  const characterIds = new Set(
    draft.characters
      .filter((item) => item.universeIds.includes(universeId))
      .map((item) => item.id),
  );
  const locationIds = new Set(
    draft.locations
      .filter((item) => item.universeId === universeId)
      .map((item) => item.id),
  );
  const objectIds = new Set(
    draft.storyObjects
      .filter((item) => item.universeId === universeId)
      .map((item) => item.id),
  );

  for (const chapter of work.chapters) {
    chapter.characterIds = chapter.characterIds.filter((id) =>
      characterIds.has(id),
    );
    if (chapter.locationId && !locationIds.has(chapter.locationId))
      chapter.locationId = undefined;
    for (const scene of chapter.scenes) {
      scene.characterIds = scene.characterIds.filter((id) =>
        characterIds.has(id),
      );
      if (scene.locationId && !locationIds.has(scene.locationId))
        scene.locationId = undefined;
    }
  }

  const events: TimelineEvent[] = [];
  for (const event of draft.timelineEvents) {
    if (event.workId !== workId) {
      events.push(event);
      continue;
    }
    let subjectExists = true;
    if (event.subjectKind === "character")
      subjectExists = characterIds.has(event.subjectId);
    else if (event.subjectKind === "location")
      subjectExists = locationIds.has(event.subjectId);
    else if (event.subjectKind === "object")
      subjectExists = objectIds.has(event.subjectId);
    else {
      const chapter = work.chapters.find((item) => item.id === event.chapterId);
      subjectExists = Boolean(
        chapter?.scenes.some((scene) => scene.id === event.subjectId),
      );
    }
    if (!subjectExists) continue;
    events.push({
      ...event,
      universeId,
      relatedCharacterIds: event.relatedCharacterIds.filter((id) =>
        characterIds.has(id),
      ),
      relatedLocationIds: event.relatedLocationIds.filter((id) =>
        locationIds.has(id),
      ),
      relatedObjectIds: event.relatedObjectIds.filter((id) =>
        objectIds.has(id),
      ),
    });
  }
  draft.timelineEvents = events;

  const standardIds = new Set(
    draft.standards
      .filter((item) => !item.universeId || item.universeId === universeId)
      .map((item) => item.id),
  );
  draft.workflowTasks = draft.workflowTasks.map((task) => {
    if (task.workId !== workId || task.universeId === undefined) return task;
    return {
      ...task,
      universeId,
      characterIds: task.characterIds.filter((id) => characterIds.has(id)),
      standardRefs: task.standardRefs.filter((ref) => standardIds.has(ref.id)),
    };
  });
}

/**
 * Remove one universe membership from a character and every reference that
 * depended on the character belonging to that universe.
 *
 * Call this only for a universe that was actually removed from the character.
 * Universe-less tasks stay untouched because they may still cast the character
 * in another world; tasks pinned to a work in the removed universe lose the
 * cast member.
 */
export function unlinkCharacterFromUniverse(
  draft: StudioWorkspace,
  characterId: string,
  universeId: string,
): void {
  const character = draft.characters.find((item) => item.id === characterId);
  if (!character) return;
  character.universeIds = character.universeIds.filter(
    (id) => id !== universeId,
  );
  // A character must belong to at least one universe. Removing the last
  // membership (possible through MCP or an import) deletes the character and
  // all of its references instead of leaving a workspace the schema rejects.
  if (character.universeIds.length === 0) {
    deleteCharacterFromDraft(draft, characterId);
    return;
  }

  draft.relationships = draft.relationships.filter(
    (relationship) =>
      !(
        relationship.universeId === universeId &&
        (relationship.sourceId === characterId ||
          relationship.targetId === characterId)
      ),
  );

  const events: TimelineEvent[] = [];
  for (const event of draft.timelineEvents) {
    if (
      event.universeId === universeId &&
      event.subjectKind === "character" &&
      event.subjectId === characterId
    )
      continue;
    events.push(
      event.universeId === universeId
        ? {
            ...event,
            relatedCharacterIds: event.relatedCharacterIds.filter(
              (id) => id !== characterId,
            ),
          }
        : event,
    );
  }
  draft.timelineEvents = events;

  const workIdsInUniverse = new Set(
    draft.works
      .filter((work) => work.universeId === universeId)
      .map((work) => work.id),
  );
  for (const work of draft.works) {
    if (work.universeId !== universeId) continue;
    for (const chapter of work.chapters) {
      chapter.characterIds = chapter.characterIds.filter(
        (id) => id !== characterId,
      );
      for (const scene of chapter.scenes)
        scene.characterIds = scene.characterIds.filter(
          (id) => id !== characterId,
        );
    }
  }

  draft.workflowTasks = draft.workflowTasks.map((task) => {
    const inUniverse =
      task.universeId === universeId ||
      (task.workId !== undefined && workIdsInUniverse.has(task.workId));
    if (!inUniverse) return task;
    return {
      ...task,
      characterIds: task.characterIds.filter((id) => id !== characterId),
    };
  });
}

/**
 * Delete a universe together with everything that only existed inside it.
 *
 * Characters shared with other universes survive with the membership removed.
 * Their references are removed from every remaining work, task and timeline
 * event — including universe-less tasks, which may cast any character.
 * Locations and objects are removed from remaining chapter/scene and event
 * references as well.
 */
export function deleteUniverseFromDraft(
  draft: StudioWorkspace,
  universeId: string,
): void {
  const deletedWorks = new Set(
    draft.works
      .filter((work) => work.universeId === universeId)
      .map((work) => work.id),
  );
  const removedCharacters = new Set(
    draft.characters
      .filter(
        (character) =>
          character.universeIds.length > 0 &&
          character.universeIds.every((id) => id === universeId),
      )
      .map((character) => character.id),
  );
  const removedLocations = new Set(
    draft.locations
      .filter((location) => location.universeId === universeId)
      .map((location) => location.id),
  );
  const removedObjects = new Set(
    draft.storyObjects
      .filter((object) => object.universeId === universeId)
      .map((object) => object.id),
  );

  draft.universes = draft.universes.filter((item) => item.id !== universeId);
  draft.works = draft.works.filter((item) => item.universeId !== universeId);
  draft.locations = draft.locations.filter(
    (item) => item.universeId !== universeId,
  );
  draft.storyObjects = draft.storyObjects.filter(
    (item) => item.universeId !== universeId,
  );
  draft.factions = draft.factions.filter(
    (item) => item.universeId !== universeId,
  );
  draft.lore = draft.lore.filter((item) => item.universeId !== universeId);
  draft.relationships = draft.relationships.filter(
    (item) =>
      item.universeId !== universeId &&
      !removedCharacters.has(item.sourceId) &&
      !removedCharacters.has(item.targetId),
  );
  draft.timelineEvents = draft.timelineEvents.filter(
    (item) => item.universeId !== universeId,
  );
  draft.characters = draft.characters
    .map((character) => ({
      ...character,
      universeIds: character.universeIds.filter((id) => id !== universeId),
    }))
    .filter((character) => character.universeIds.length > 0);

  for (const work of draft.works) {
    for (const chapter of work.chapters) {
      chapter.characterIds = chapter.characterIds.filter(
        (id) => !removedCharacters.has(id),
      );
      if (chapter.locationId && removedLocations.has(chapter.locationId))
        chapter.locationId = undefined;
      for (const scene of chapter.scenes) {
        scene.characterIds = scene.characterIds.filter(
          (id) => !removedCharacters.has(id),
        );
        if (scene.locationId && removedLocations.has(scene.locationId))
          scene.locationId = undefined;
      }
    }
  }

  const events: TimelineEvent[] = [];
  for (const event of draft.timelineEvents) {
    if (
      event.subjectKind === "character" &&
      removedCharacters.has(event.subjectId)
    )
      continue;
    if (
      event.subjectKind === "location" &&
      removedLocations.has(event.subjectId)
    )
      continue;
    if (event.subjectKind === "object" && removedObjects.has(event.subjectId))
      continue;
    events.push({
      ...event,
      relatedCharacterIds: event.relatedCharacterIds.filter(
        (id) => !removedCharacters.has(id),
      ),
      relatedLocationIds: event.relatedLocationIds.filter(
        (id) => !removedLocations.has(id),
      ),
      relatedObjectIds: event.relatedObjectIds.filter(
        (id) => !removedObjects.has(id),
      ),
    });
  }
  draft.timelineEvents = events;

  draft.exports = draft.exports.filter(
    (record) => !deletedWorks.has(record.workId),
  );

  const removedStandards = new Set(
    draft.standards
      .filter((item) => item.universeId === universeId)
      .map((item) => item.id),
  );
  draft.standards = draft.standards.filter(
    (item) => !removedStandards.has(item.id),
  );
  draft.ruleSystems = draft.ruleSystems.filter(
    (item) => item.universeId !== universeId,
  );
  draft.abilityTemplates = draft.abilityTemplates.filter(
    (item) => item.universeId !== universeId,
  );
  draft.itemStatTemplates = draft.itemStatTemplates.filter(
    (item) => item.universeId !== universeId,
  );

  const removedTasks = new Set(
    draft.workflowTasks
      .filter(
        (task) =>
          task.universeId === universeId ||
          (task.workId !== undefined && deletedWorks.has(task.workId)),
      )
      .map((task) => task.id),
  );
  draft.workflowTasks = draft.workflowTasks
    .filter((task) => !removedTasks.has(task.id))
    .map((task) => ({
      ...task,
      parentId:
        task.parentId && removedTasks.has(task.parentId)
          ? undefined
          : task.parentId,
      dependsOnIds: task.dependsOnIds.filter((id) => !removedTasks.has(id)),
      characterIds: task.characterIds.filter(
        (id) => !removedCharacters.has(id),
      ),
      standardRefs: task.standardRefs.filter(
        (ref) => !removedStandards.has(ref.id),
      ),
    }));

  if (draft.lastOpenedWorkId && deletedWorks.has(draft.lastOpenedWorkId))
    draft.lastOpenedWorkId = undefined;
}

/**
 * Delete a work and everything that only existed for it: its timeline events,
 * its workflow tasks (repairing parent and dependency links of survivors) and
 * its export history. World-scoped tasks without a work survive.
 */
export function deleteWorkFromDraft(
  draft: StudioWorkspace,
  workId: string,
): void {
  const removedTasks = new Set(
    draft.workflowTasks
      .filter((task) => task.workId === workId)
      .map((task) => task.id),
  );
  draft.works = draft.works.filter((item) => item.id !== workId);
  draft.timelineEvents = draft.timelineEvents.filter(
    (event) => event.workId !== workId,
  );
  draft.workflowTasks = draft.workflowTasks
    .filter((task) => !removedTasks.has(task.id))
    .map((task) => ({
      ...task,
      parentId:
        task.parentId && removedTasks.has(task.parentId)
          ? undefined
          : task.parentId,
      dependsOnIds: task.dependsOnIds.filter((id) => !removedTasks.has(id)),
    }));
  draft.exports = draft.exports.filter((record) => record.workId !== workId);
  if (draft.lastOpenedWorkId === workId) draft.lastOpenedWorkId = undefined;
}

/**
 * Delete a character together with every reference to it: relationships,
 * timeline subjects and related entries, work casts and workflow tasks.
 */
export function deleteCharacterFromDraft(
  draft: StudioWorkspace,
  characterId: string,
): void {
  draft.characters = draft.characters.filter(
    (character) => character.id !== characterId,
  );
  draft.relationships = draft.relationships.filter(
    (relationship) =>
      relationship.sourceId !== characterId &&
      relationship.targetId !== characterId,
  );
  draft.timelineEvents = draft.timelineEvents
    .filter(
      (event) =>
        event.subjectKind !== "character" || event.subjectId !== characterId,
    )
    .map((event) => ({
      ...event,
      relatedCharacterIds: event.relatedCharacterIds.filter(
        (id) => id !== characterId,
      ),
    }));
  for (const work of draft.works) {
    for (const chapter of work.chapters) {
      chapter.characterIds = chapter.characterIds.filter(
        (id) => id !== characterId,
      );
      for (const scene of chapter.scenes)
        scene.characterIds = scene.characterIds.filter(
          (id) => id !== characterId,
        );
    }
  }
  draft.workflowTasks = draft.workflowTasks.map((task) => ({
    ...task,
    characterIds: task.characterIds.filter((id) => id !== characterId),
  }));
}

/**
 * Delete a chapter and the events and tasks pinned to it.
 *
 * Chapter ids are only unique inside their work, so every cascade matches on
 * `workId` as well: a chapter that happens to share the id in another work
 * keeps its events and tasks. Export history for the work drops the removed
 * chapter from its chapter list.
 */
export function deleteChapterFromDraft(
  draft: StudioWorkspace,
  workId: string,
  chapterId: string,
): void {
  const work = draft.works.find((item) => item.id === workId);
  if (!work) return;
  work.chapters = work.chapters.filter((item) => item.id !== chapterId);
  draft.timelineEvents = draft.timelineEvents.filter(
    (event) => !(event.workId === workId && event.chapterId === chapterId),
  );
  const removedTasks = new Set(
    draft.workflowTasks
      .filter((task) => task.workId === workId && task.chapterId === chapterId)
      .map((task) => task.id),
  );
  draft.workflowTasks = draft.workflowTasks
    .filter((task) => !removedTasks.has(task.id))
    .map((task) => ({
      ...task,
      parentId:
        task.parentId && removedTasks.has(task.parentId)
          ? undefined
          : task.parentId,
      dependsOnIds: task.dependsOnIds.filter((id) => !removedTasks.has(id)),
    }));
  draft.exports = draft.exports.map((record) =>
    record.workId === workId
      ? {
          ...record,
          chapterIds: record.chapterIds.filter((id) => id !== chapterId),
        }
      : record,
  );
}

/**
 * Move a standard to a new scope (or make it project-wide with `undefined`)
 * and drop it from tasks whose universe the new scope excludes. Without this
 * repair the schema rejects the move whenever a task pinned the standard in
 * the old universe.
 */
export function reassignStandardUniverse(
  draft: StudioWorkspace,
  standardId: string,
  universeId: string | undefined,
): void {
  const standard = draft.standards.find((item) => item.id === standardId);
  if (!standard) return;
  standard.universeId = universeId;
  if (!universeId) return;
  draft.workflowTasks = draft.workflowTasks.map((task) => {
    if (task.universeId === undefined || task.universeId === universeId)
      return task;
    if (!task.standardRefs.some((ref) => ref.id === standardId)) return task;
    return {
      ...task,
      standardRefs: task.standardRefs.filter((ref) => ref.id !== standardId),
    };
  });
}
