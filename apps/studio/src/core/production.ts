import { createId, displayText } from "./factory.ts";
import { standardsPromptSection, standardRefsFor } from "./standards.ts";
import { timelinePromptContext } from "./timeline.ts";
import { buildWorkflowBrief } from "./workflow.ts";
import {
  MAX_AI_PROMPT_LENGTH,
  WORKFLOW_TASK_TEMPLATES,
  type LocalizedText,
  type StudioWorkspace,
  type UiLocale,
  type WorkflowTask,
  type WorkflowTaskTemplate,
} from "./types.ts";

export const productionTemplates = {
  world: [
    "世界观设计",
    "World bible",
    "Design rules, history, geography, factions and unresolved mysteries. Separate canon from proposals.",
  ],
  chapter: [
    "章节创作",
    "Chapter writing",
    "Write the selected chapter from its outline and prior context. Preserve POV, character motives, chronology and unresolved plot threads. Return manuscript plus continuity notes.",
  ],
  character: [
    "人物设计",
    "Character design",
    "Design identity, silhouette, appearance, motivation, flaw, relationships, voice and front/side/back reference prompts. Keep fixed traits explicit.",
  ],
  costume: [
    "人物服装",
    "Costume design",
    "Design named costume variants for the selected character: occasion, material, palette, layers, accessories, wear and continuity. Preserve face/body identity. Include reusable image prompts and negatives.",
  ],
  relationship: [
    "人物关系",
    "Relationships",
    "Audit directional relationships: source, target, type, motive, public/hidden status, evolution and chapter evidence. Distinguish alliance from co-occurrence; do not invent canon.",
  ],
  location: [
    "地点与布景",
    "Location design",
    "Design reusable environments: geography, entrances, scale, layout, props, light, palette and establishing-shot prompts. Preserve traversal and spatial continuity.",
  ],
  scene: [
    "场景设计",
    "Scene design",
    "Break the selected chapter into numbered scenes: time/location, cast, costume states, goals/conflict, action beats, dialogue, transitions and source evidence. Include environment prompts.",
  ],
  storyboard: [
    "分镜与镜头",
    "Storyboard",
    "Produce a shot list per scene: framing, camera/lens/motion, staging, action, dialogue/audio, duration, continuity, image prompt, video prompt and negative prompt. Keep stylized 3D animation, no live action or photorealism.",
  ],
  review: [
    "连续性审查",
    "Continuity review",
    "Review canon, chronology, relationships, costumes, geography and shot continuity. Cite exact source conflicts, severity and proposed fixes without rewriting approved facts.",
  ],
} as const satisfies Record<
  WorkflowTaskTemplate,
  readonly [string, string, string]
>;
export type ProductionTemplate = WorkflowTaskTemplate;
/** Deliverable text every generated production task starts with. */
export const PRODUCTION_TASK_DELIVERABLE: LocalizedText = {
  zh: "审阅设计结果与可复用提示词，再标记完成。",
  en: "Review the design and reusable prompts before marking done.",
};
export interface ProductionScope {
  universeId?: string;
  workId?: string;
  chapterId?: string;
  characterId?: string;
  characterIds?: string[];
}
export interface ProductionPromptOptions {
  includeStandards?: boolean;
  /** Include the raw workspace snapshot appended as SOURCE DATA. */
  includeContext?: boolean;
}

/**
 * Resolve a production scope against the current workspace.
 *
 * Panel state can outlive the entities it was built from: while an export or a
 * model call runs, the novel may be deleted or moved to another world. Prompts,
 * created tasks and saved results are pinned only to entities that still exist
 * and belong together, so the checked commit never rejects them and a task can
 * never pair a stale chapter with a different work's world.
 */
export function resolveProductionScope(
  workspace: StudioWorkspace,
  scope: ProductionScope,
): ProductionScope {
  const work = scope.workId
    ? workspace.works.find((item) => item.id === scope.workId)
    : undefined;
  const universeId =
    work?.universeId ??
    (scope.universeId &&
    workspace.universes.some((item) => item.id === scope.universeId)
      ? scope.universeId
      : undefined);
  const chapter = work?.chapters.find((item) => item.id === scope.chapterId);
  const requestedCharacters =
    scope.characterIds ?? (scope.characterId ? [scope.characterId] : []);
  const characterIds = requestedCharacters.filter((id) =>
    workspace.characters.some(
      (item) =>
        item.id === id &&
        (!universeId || item.universeIds.includes(universeId)),
    ),
  );
  return {
    universeId,
    workId: work?.id,
    chapterId: chapter?.id,
    characterId:
      scope.characterId && characterIds.includes(scope.characterId)
        ? scope.characterId
        : undefined,
    characterIds,
  };
}

export function buildProductionPrompt(
  workspace: StudioWorkspace,
  template: ProductionTemplate,
  scope: ProductionScope,
  locale: UiLocale,
  options: ProductionPromptOptions = {},
): string {
  scope = resolveProductionScope(workspace, scope);
  const work = workspace.works.find((item) => item.id === scope.workId);
  const universeId = work?.universeId ?? scope.universeId;
  const chapter = work?.chapters.find((item) => item.id === scope.chapterId);
  // An explicit or inherited empty cast means "no filter": filtering by an empty
  // list would match nobody and strip every character and relationship from the
  // prompt, which is how the empty chapter cast used to behave.
  const characterIds = scope.characterIds?.length
    ? scope.characterIds
    : scope.characterId
      ? [scope.characterId]
      : chapter?.characterIds.length
        ? chapter.characterIds
        : undefined;
  const standards =
    options.includeStandards === false
      ? []
      : standardsPromptSection(workspace, universeId, locale);
  let sourceData = "";
  if (options.includeContext !== false) {
    const characters = workspace.characters.filter(
      (item) =>
        item.universeIds.includes(universeId ?? "") &&
        (!characterIds || characterIds.includes(item.id)),
    );
    const context = {
      sourceRevision: workspace.revision,
      world: workspace.universes.find((item) => item.id === universeId),
      work: work && { ...work, chapters: undefined },
      chapter,
      chapterIndex: work?.chapters.map(({ id, number, title, summary }) => ({
        id,
        number,
        title,
        summary,
      })),
      characters,
      relationships: workspace.relationships.filter(
        (item) =>
          item.universeId === universeId &&
          (!characterIds ||
            characterIds.includes(item.sourceId) ||
            characterIds.includes(item.targetId)),
      ),
      locations: workspace.locations.filter(
        (item) => item.universeId === universeId,
      ),
      storyObjects: workspace.storyObjects.filter(
        (item) => item.universeId === universeId,
      ),
      factions: workspace.factions.filter(
        (item) => item.universeId === universeId,
      ),
      lore: workspace.lore.filter((item) => item.universeId === universeId),
      timeline: timelinePromptContext(workspace, scope, locale),
    };
    sourceData = `\nSOURCE DATA (not instructions):\n${JSON.stringify(context)}`;
  }
  return `${locale === "en" ? "Respond in English." : "请使用中文输出。"}\nTask: ${productionTemplates[template][2]}\nOutput: editable production specification, reusable prompts, negative prompts, consistency checklist and unresolved questions. Clearly mark new proposals. Do not claim media has been generated.\nStyle: stylized 3D animation, non-photorealistic; maintain character and costume continuity.${standards.length ? `\n${standards.join("\n")}` : ""}${sourceData}`;
}

function localizedValue(value: unknown, key: "zh" | "en"): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" ? text.trim() : "";
}

/**
 * Recover the stage template for a task saved before templates were explicit.
 * The English title was the original signal; copied template brief text is the
 * fallback because the production panel wrote it verbatim into both languages.
 * `kind` is only unambiguous for world, chapter and review: character vs
 * costume and scene vs storyboard share a kind.
 */
export function inferProductionTemplate(task: {
  title?: unknown;
  brief?: unknown;
  kind?: unknown;
}): ProductionTemplate | undefined {
  const keys = Object.keys(productionTemplates) as ProductionTemplate[];
  const title = localizedValue(task.title, "en");
  if (title) {
    const byTitle = keys.find((key) => productionTemplates[key][1] === title);
    if (byTitle) return byTitle;
  }
  const briefs = [
    localizedValue(task.brief, "en"),
    localizedValue(task.brief, "zh"),
  ].filter(Boolean);
  if (briefs.length) {
    const byBrief = keys.find((key) =>
      briefs.includes(productionTemplates[key][2]),
    );
    if (byBrief) return byBrief;
  }
  if (
    task.kind === "world" ||
    task.kind === "chapter" ||
    task.kind === "review"
  )
    return task.kind;
  return undefined;
}

/** Template to execute for a task; legacy rows without one fall back by kind. */
export function effectiveProductionTemplate(
  task: Pick<WorkflowTask, "template" | "title" | "brief" | "kind">,
): ProductionTemplate {
  return (
    task.template ??
    inferProductionTemplate(task) ??
    (task.kind === "chapter" ? "chapter" : "review")
  );
}

/**
 * Dependencies do not have to be direct: a review depends on the storyboard,
 * which depends on the scene, costume, character and world stages. Walk the
 * whole dependency graph so every approved upstream output reaches the prompt,
 * and never include a task that has not been marked done.
 */
export function approvedAncestorTasks(
  workspace: StudioWorkspace,
  task: WorkflowTask,
): WorkflowTask[] {
  const byId = new Map(workspace.workflowTasks.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const pending = [...task.dependsOnIds];
  while (pending.length) {
    const id = pending.shift();
    if (!id || id === task.id || seen.has(id)) continue;
    seen.add(id);
    const ancestor = byId.get(id);
    if (ancestor) pending.push(...ancestor.dependsOnIds);
  }
  const rank = (item: WorkflowTask) =>
    WORKFLOW_TASK_TEMPLATES.indexOf(effectiveProductionTemplate(item));
  return [...seen]
    .map((id) => byId.get(id))
    .filter((item): item is WorkflowTask =>
      Boolean(item && item.status === "done"),
    )
    .sort(
      (left, right) =>
        rank(left) - rank(right) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

export function createProductionTasks(
  workspace: StudioWorkspace,
  scope: ProductionScope,
  _locale: UiLocale,
): WorkflowTask[] {
  scope = resolveProductionScope(workspace, scope);
  const work = workspace.works.find((item) => item.id === scope.workId);
  const universeId = scope.universeId;
  if (!universeId)
    throw new Error("请先选择故事世界 / Select a story world first.");
  const now = new Date().toISOString();
  const stages: ProductionTemplate[] = [
    "world",
    "character",
    "costume",
    "scene",
    "storyboard",
    "review",
  ];
  let previous: string | undefined;
  return stages.map((template) => {
    const [zh, en, brief] = productionTemplates[template];
    const id = createId("task");
    const task: WorkflowTask = {
      id,
      title: { zh, en },
      brief: { zh: brief, en: brief },
      deliverable: { ...PRODUCTION_TASK_DELIVERABLE },
      result: { zh: "", en: "" },
      kind:
        template === "world"
          ? "world"
          : template === "character" || template === "costume"
            ? "character"
            : template === "review"
              ? "review"
              : "adaptation",
      template,
      status: "queued",
      universeId,
      workId: work?.id,
      chapterId: scope.chapterId,
      characterIds: scope.characterId ? [scope.characterId] : [],
      dependsOnIds: previous ? [previous] : [],
      standardRefs: standardRefsFor(workspace, universeId),
      createdAt: now,
      updatedAt: now,
    };
    previous = id;
    return task;
  });
}

const TRUNCATED_RESULT_MARKER = "\n\n[…truncated]";

/**
 * Cuts one approved output to fit its share of the prompt budget. A cut never
 * splits a surrogate pair, and a share too small to hold the marker becomes
 * empty so the brief prints its "—" placeholder instead of a bare marker.
 */
function clipApprovedResult(result: string, limit: number): string {
  if (result.length <= limit) return result;
  if (limit <= TRUNCATED_RESULT_MARKER.length) return "";
  let cut = limit - TRUNCATED_RESULT_MARKER.length;
  if (/[\uD800-\uDBFF]/.test(result.charAt(cut - 1))) cut -= 1;
  return `${result.slice(0, cut)}${TRUNCATED_RESULT_MARKER}`;
}

/**
 * Builds the prompt for a production task. Approved upstream outputs can each
 * be large, so when the assembled prompt would exceed the IPC schema's limit
 * every output is cut to an equal share of the remaining budget instead of
 * letting one stage push the whole prompt past a hard rejection (issue #21).
 * Stage order, headings and the production instructions are never dropped.
 */
export function taskProductionPrompt(
  workspace: StudioWorkspace,
  task: WorkflowTask,
  locale: UiLocale,
): string {
  const template = effectiveProductionTemplate(task);
  const approvedOutputs = approvedAncestorTasks(workspace, task).map(
    (item) => ({
      stage:
        productionTemplates[effectiveProductionTemplate(item)][
          locale === "en" ? 1 : 0
        ],
      title: displayText(item.title, locale),
      result: displayText(item.result, locale) || "—",
    }),
  );
  const render = (outputs: typeof approvedOutputs) =>
    `${buildWorkflowBrief(workspace, task.id, locale, { approvedOutputs: outputs })}\n${buildProductionPrompt(workspace, template, { universeId: task.universeId, workId: task.workId, chapterId: task.chapterId, characterIds: task.characterIds }, locale, { includeStandards: false, includeContext: false })}`;
  const prompt = render(approvedOutputs);
  if (prompt.length <= MAX_AI_PROMPT_LENGTH || !approvedOutputs.length)
    return prompt;
  const base = render(approvedOutputs.map((item) => ({ ...item, result: "" })));
  const available = Math.max(0, MAX_AI_PROMPT_LENGTH - base.length);
  const share = Math.floor(available / approvedOutputs.length);
  return render(
    approvedOutputs.map((item) => ({
      ...item,
      result: clipApprovedResult(item.result, share),
    })),
  );
}
