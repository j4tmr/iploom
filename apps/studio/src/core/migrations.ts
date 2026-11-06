import { WORKSPACE_SCHEMA_VERSION } from "./types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Upgrade known workspace versions before strict validation. */
export function migrateWorkspace(value: unknown): unknown {
  if (!record(value)) return value;
  if (value.schema_version === 1) {
    return migrateWorkspace({
      ...value,
      schema_version: 2,
      workflowTasks: [],
      revision:
        typeof value.revision === "number" ? value.revision + 1 : value.revision,
    });
  }
  if (value.schema_version === 2) {
    return migrateWorkspace({
      ...value,
      schema_version: 3,
      storyObjects: Array.isArray(value.storyObjects) ? value.storyObjects : [],
      timelineEvents: Array.isArray(value.timelineEvents)
        ? value.timelineEvents
        : [],
      revision:
        typeof value.revision === "number" ? value.revision + 1 : value.revision,
    });
  }
  if (value.schema_version === 3) {
    return migrateWorkspace({
      ...value,
      schema_version: 4,
      standards: Array.isArray(value.standards) ? value.standards : [],
      revision:
        typeof value.revision === "number" ? value.revision + 1 : value.revision,
    });
  }
  if (value.schema_version === 4) {
    const repaired = repairExportHistory(value);
    return {
      ...value,
      schema_version: WORKSPACE_SCHEMA_VERSION,
      lastOpenedWorkId: repaired.lastOpenedWorkId,
      exports: repaired.exports,
      revision:
        typeof value.revision === "number" ? value.revision + 1 : value.revision,
    };
  }
  return value;
}

function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Older builds could record an export for a novel that was deleted while the
 * export ran, and they matched chapter references by id alone even though
 * chapter ids are only unique inside their work. Drop records whose novel is
 * gone, de-duplicate ids, and keep only chapters that still exist in that
 * novel so the strict v5 schema can accept the workspace.
 */
function repairExportHistory(value: Record<string, unknown>): {
  exports: unknown;
  lastOpenedWorkId: unknown;
} {
  if (!Array.isArray(value.exports))
    return { exports: value.exports, lastOpenedWorkId: value.lastOpenedWorkId };
  const chaptersByWork = new Map<string, Set<string>>();
  for (const work of Array.isArray(value.works) ? value.works : []) {
    if (!record(work) || typeof work.id !== "string") continue;
    chaptersByWork.set(
      work.id,
      new Set(
        (Array.isArray(work.chapters) ? work.chapters : [])
          .filter(record)
          .map((chapter) => chapter.id)
          .filter((id): id is string => typeof id === "string"),
      ),
    );
  }
  const usedIds = new Set<string>();
  const exports: unknown[] = [];
  for (const item of value.exports) {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      typeof item.workId !== "string"
    )
      continue;
    const chapterIds = chaptersByWork.get(item.workId);
    if (!chapterIds) continue;
    let id = item.id;
    for (let suffix = 2; usedIds.has(id); suffix += 1)
      id = `${item.id.slice(0, 70)}-${suffix}`;
    usedIds.add(id);
    exports.push({
      ...item,
      id,
      chapterIds: [
        ...new Set(idList(item.chapterIds).filter((id) => chapterIds.has(id))),
      ],
    });
  }
  const lastOpenedWorkId =
    typeof value.lastOpenedWorkId === "string" &&
    !chaptersByWork.has(value.lastOpenedWorkId)
      ? undefined
      : value.lastOpenedWorkId;
  return { exports, lastOpenedWorkId };
}
