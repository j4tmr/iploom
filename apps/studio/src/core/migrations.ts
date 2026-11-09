import {
  inferProductionTemplate,
  PRODUCTION_TASK_DELIVERABLE,
  productionTemplates,
  type ProductionTemplate,
} from "./production.ts";
import {
  WORKFLOW_TASK_TEMPLATES,
  WORKSPACE_SCHEMA_VERSION,
  type WorkflowTaskTemplate,
} from "./types.ts";

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
        typeof value.revision === "number"
          ? value.revision + 1
          : value.revision,
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
        typeof value.revision === "number"
          ? value.revision + 1
          : value.revision,
    });
  }
  if (value.schema_version === 3) {
    return migrateWorkspace({
      ...value,
      schema_version: 4,
      standards: Array.isArray(value.standards) ? value.standards : [],
      revision:
        typeof value.revision === "number"
          ? value.revision + 1
          : value.revision,
    });
  }
  if (value.schema_version === 4) {
    const repaired = repairExportHistory(value);
    return migrateWorkspace({
      ...value,
      schema_version: 5,
      lastOpenedWorkId: repaired.lastOpenedWorkId,
      exports: repaired.exports,
      revision:
        typeof value.revision === "number"
          ? value.revision + 1
          : value.revision,
    });
  }
  if (value.schema_version === 5) {
    const repaired = repairWorkflowTaskTexts(value);
    return migrateWorkspace({
      ...repaired,
      schema_version: 6,
      revision:
        typeof repaired.revision === "number"
          ? repaired.revision + 1
          : repaired.revision,
    });
  }
  if (value.schema_version === 6) {
    const repaired = inferWorkflowTaskTemplates(value);
    return migrateWorkspace({
      ...repaired,
      schema_version: 7,
      revision:
        typeof repaired.revision === "number"
          ? repaired.revision + 1
          : repaired.revision,
    });
  }
  if (value.schema_version === 7) {
    return {
      ...value,
      schema_version: WORKSPACE_SCHEMA_VERSION,
      ruleSystems: [],
      abilityTemplates: [],
      itemStatTemplates: [],
      revision:
        typeof value.revision === "number"
          ? value.revision + 1
          : value.revision,
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
 * novel so the strict schema can accept the workspace.
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

const COMPOSED_PROMPT_MARKER = "SOURCE DATA (not instructions):";
const STALE_DELIVERABLE_PATTERN = /^Model: .+; source revision: \d+\./;

/** Template description a task's English title maps back to, or undefined. */
function templateBriefFor(title: unknown): string | undefined {
  if (!record(title) || typeof title.en !== "string") return undefined;
  const key = (Object.keys(productionTemplates) as ProductionTemplate[]).find(
    (item) => productionTemplates[item][1] === title.en,
  );
  return key ? productionTemplates[key][2] : undefined;
}

/**
 * Older builds let the production panel write the composed model prompt back
 * into the task's brief and deliverable, so every run nested another copy of
 * the brief into itself and a cancelled run lost the author's text. A brief
 * that embeds prompt markers is replaced with its template description (empty
 * when the title no longer matches one); deliverables carrying run metadata
 * return to the standard review instructions.
 */
function repairWorkflowTaskTexts(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(value.workflowTasks)) return value;
  const tasks = value.workflowTasks.map((task) => {
    if (!record(task)) return task;
    const brief = record(task.brief) ? task.brief : {};
    const deliverable = record(task.deliverable) ? task.deliverable : {};
    const briefZh = typeof brief.zh === "string" ? brief.zh : "";
    const briefEn = typeof brief.en === "string" ? brief.en : "";
    const pollutedZh =
      (briefZh.startsWith("# AI 任务简报") ||
        briefZh.startsWith("请使用中文输出。")) &&
      briefZh.includes(COMPOSED_PROMPT_MARKER);
    const pollutedEn =
      (briefEn.startsWith("# AI task brief") ||
        briefEn.startsWith("Respond in English.")) &&
      briefEn.includes(COMPOSED_PROMPT_MARKER);
    const staleDeliverable =
      STALE_DELIVERABLE_PATTERN.test(
        typeof deliverable.zh === "string" ? deliverable.zh : "",
      ) ||
      STALE_DELIVERABLE_PATTERN.test(
        typeof deliverable.en === "string" ? deliverable.en : "",
      );
    if (!pollutedZh && !pollutedEn && !staleDeliverable) return task;
    const fallbackBrief = templateBriefFor(task.title) ?? "";
    const nextBrief = { ...brief };
    if (pollutedZh) nextBrief.zh = fallbackBrief;
    if (pollutedEn) nextBrief.en = fallbackBrief;
    const next: Record<string, unknown> = { ...task, brief: nextBrief };
    if (staleDeliverable) next.deliverable = { ...PRODUCTION_TASK_DELIVERABLE };
    return next;
  });
  return { ...value, workflowTasks: tasks };
}

function isWorkflowTaskTemplate(value: unknown): value is WorkflowTaskTemplate {
  return (
    typeof value === "string" &&
    (WORKFLOW_TASK_TEMPLATES as readonly string[]).includes(value)
  );
}

/**
 * v6 stored stage instructions only in the task's English title. Pin the
 * template explicitly so later title edits cannot switch instructions. Keep a
 * template that is already valid; infer one for legacy tasks, and drop invalid
 * values that the strict schema would reject.
 */
function inferWorkflowTaskTemplates(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(value.workflowTasks)) return value;
  const tasks = value.workflowTasks.map((task) => {
    if (!record(task)) return task;
    if (isWorkflowTaskTemplate(task.template)) return task;
    const template = inferProductionTemplate({
      title: task.title,
      brief: task.brief,
      kind: task.kind,
    });
    if (template) return { ...task, template };
    if (!("template" in task)) return task;
    const next = { ...task };
    delete next.template;
    return next;
  });
  return { ...value, workflowTasks: tasks };
}
