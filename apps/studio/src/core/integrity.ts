import type { StoryWork, StudioWorkspace, TimelineEvent } from "./types.ts";
import { validateWorkspace, WorkspaceValidationError } from "./validate.ts";

export interface WorkspaceChangeApplied {
  ok: true;
  workspace: StudioWorkspace;
}

export interface WorkspaceChangeRejected {
  ok: false;
  /** A human-readable summary of the first validation issues. */
  error: string;
  issues: string[];
}

export type WorkspaceChangeResult =
  | WorkspaceChangeApplied
  | WorkspaceChangeRejected;

function describeFailure(reason: unknown): WorkspaceChangeRejected {
  if (reason instanceof WorkspaceValidationError) {
    const issues = reason.issues;
    const shown = issues.slice(0, 3).join("; ");
    const remainder = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
    return { ok: false, error: `${shown}${remainder}`, issues };
  }
  return {
    ok: false,
    error: reason instanceof Error ? reason.message : String(reason),
    issues: [],
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
      const chapter = work.chapters.find(
        (item) => item.id === event.chapterId,
      );
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
      standardRefs: task.standardRefs.filter((ref) =>
        standardIds.has(ref.id),
      ),
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
    if (event.subjectKind === "character" && removedCharacters.has(event.subjectId))
      continue;
    if (event.subjectKind === "location" && removedLocations.has(event.subjectId))
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
