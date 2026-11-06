import { displayText } from "./factory.ts";
import { relevantTimelineEvents, timelineAnchorLabel, timelineSubjectLabel } from "./timeline.ts";
import type {
  StudioWorkspace,
  UiLocale,
  WorkflowTask,
  WorkflowTaskStatus,
} from "./types.ts";

export interface WorkflowTaskReadiness {
  ready: boolean;
  complete: boolean;
  blockers: WorkflowTask[];
}

export interface WorkflowSummary {
  total: number;
  done: number;
  active: number;
  review: number;
  ready: number;
  waiting: number;
}

export function workflowTaskReadiness(
  workspace: StudioWorkspace,
  task: WorkflowTask,
): WorkflowTaskReadiness {
  const blockers = task.dependsOnIds
    .map((id) => workspace.workflowTasks.find((item) => item.id === id))
    .filter((item): item is WorkflowTask => Boolean(item))
    .filter((item) => item.status !== "done");
  return {
    ready: task.status === "queued" && blockers.length === 0,
    complete: task.status === "done",
    blockers,
  };
}

export function workflowSummary(workspace: StudioWorkspace): WorkflowSummary {
  const summary: WorkflowSummary = {
    total: workspace.workflowTasks.length,
    done: 0,
    active: 0,
    review: 0,
    ready: 0,
    waiting: 0,
  };
  for (const task of workspace.workflowTasks) {
    if (task.status === "done") summary.done += 1;
    if (task.status === "active") summary.active += 1;
    if (task.status === "review") summary.review += 1;
    const readiness = workflowTaskReadiness(workspace, task);
    if (readiness.ready) summary.ready += 1;
    if (task.status === "queued" && !readiness.ready) summary.waiting += 1;
  }
  return summary;
}

export function taskDescendantIds(
  tasks: WorkflowTask[],
  taskId: string,
): string[] {
  const found = new Set<string>();
  const visit = (parentId: string) => {
    for (const task of tasks) {
      if (task.parentId !== parentId || found.has(task.id)) continue;
      found.add(task.id);
      visit(task.id);
    }
  };
  visit(taskId);
  return [...found];
}

/**
 * Returns the task and every task that can already reach it through a parent
 * or dependency edge. Adding an outgoing edge to any of these would form a
 * workflow cycle, so editors should omit them from parent/dependency pickers.
 */
export function taskCycleRiskIds(
  tasks: WorkflowTask[],
  taskId: string,
): string[] {
  const incoming = new Map<string, string[]>();
  const addIncoming = (fromId: string, toId: string) => {
    const current = incoming.get(toId);
    if (current) current.push(fromId);
    else incoming.set(toId, [fromId]);
  };
  for (const task of tasks) {
    if (task.parentId) addIncoming(task.id, task.parentId);
    for (const dependencyId of task.dependsOnIds) {
      addIncoming(task.id, dependencyId);
    }
  }

  const found = new Set<string>([taskId]);
  const queue = [taskId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const sourceId of incoming.get(current) ?? []) {
      if (found.has(sourceId)) continue;
      found.add(sourceId);
      queue.push(sourceId);
    }
  }
  return [...found];
}

export function taskChildren(
  workspace: StudioWorkspace,
  task: WorkflowTask,
): WorkflowTask[] {
  return workspace.workflowTasks.filter((item) => item.parentId === task.id);
}

function statusLabel(status: WorkflowTaskStatus, locale: UiLocale): string {
  const labels = {
    queued: { zh: "待开始", en: "Queued" },
    active: { zh: "进行中", en: "Active" },
    review: { zh: "待审", en: "In review" },
    done: { zh: "已完成", en: "Done" },
  } as const;
  return labels[status][locale === "en" ? "en" : "zh"];
}

function kindLabel(task: WorkflowTask, locale: UiLocale): string {
  const labels = {
    world: { zh: "世界观", en: "World" },
    novel: { zh: "小说", en: "Novel" },
    chapter: { zh: "章节", en: "Chapter" },
    character: { zh: "人物", en: "Character" },
    review: { zh: "审校", en: "Review" },
    adaptation: { zh: "漫剧改编", en: "3D comic adaptation" },
  } as const;
  return labels[task.kind][locale === "en" ? "en" : "zh"];
}

function paragraph(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function section(title: string, body: string[]): string[] {
  const visible = body.filter((line) => line.trim());
  return visible.length ? ["", `## ${title}`, "", ...visible] : [];
}

/**
 * Produces deterministic task context an AI client can consume without
 * receiving unrelated novels or private worlds from the rest of the library.
 */
export function buildWorkflowBrief(
  workspace: StudioWorkspace,
  taskId: string,
  locale: UiLocale = workspace.settings.locale,
): string {
  const task = workspace.workflowTasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown workflow task: ${taskId}`);
  const zh = locale === "zh-CN";
  const world = task.universeId
    ? workspace.universes.find((item) => item.id === task.universeId)
    : undefined;
  const work = task.workId
    ? workspace.works.find((item) => item.id === task.workId)
    : undefined;
  const chapter = task.chapterId
    ? work?.chapters.find((item) => item.id === task.chapterId)
    : undefined;
  const parent = task.parentId
    ? workspace.workflowTasks.find((item) => item.id === task.parentId)
    : undefined;
  const dependencies = task.dependsOnIds
    .map((id) => workspace.workflowTasks.find((item) => item.id === id))
    .filter((item): item is WorkflowTask => Boolean(item));
  const children = taskChildren(workspace, task);
  const cast = workspace.characters.filter((character) =>
    task.characterIds.includes(character.id),
  );
  const relationships = workspace.relationships.filter(
    (relationship) =>
      (!task.universeId || relationship.universeId === task.universeId) &&
      (task.characterIds.includes(relationship.sourceId) ||
        task.characterIds.includes(relationship.targetId)),
  );
  const timeline = relevantTimelineEvents(workspace, {
    universeId: task.universeId,
    workId: task.workId,
    chapterId: task.chapterId,
    characterIds: task.characterIds,
  });
  const readiness = workflowTaskReadiness(workspace, task);
  const lines = [
    `# ${zh ? "AI 任务简报" : "AI task brief"}: ${displayText(task.title, locale)}`,
    "",
    `- ${zh ? "任务 ID" : "Task ID"}: ${task.id}`,
    `- ${zh ? "类型" : "Kind"}: ${kindLabel(task, locale)}`,
    `- ${zh ? "状态" : "Status"}: ${statusLabel(task.status, locale)}`,
    `- ${zh ? "可独立开始" : "Ready to start"}: ${readiness.ready ? (zh ? "是" : "yes") : zh ? "否" : "no"}`,
    `- ${zh ? "工作区版本" : "Workspace revision"}: ${workspace.revision}`,
  ];
  if (parent) {
    lines.push(
      `- ${zh ? "父任务" : "Parent task"}: ${displayText(parent.title, locale)} (${parent.id})`,
    );
  }
  if (children.length) {
    lines.push(
      `- ${zh ? "子任务" : "Subtasks"}: ${children
        .map((item) => `${displayText(item.title, locale)} (${item.id})`)
        .join("; ")}`,
    );
  }

  lines.push(
    ...section(zh ? "目标" : "Objective", [
      paragraph(
        displayText(task.brief, locale),
        zh ? "按任务标题完成可验收的创作工作。" : "Complete the task with a reviewable result.",
      ),
    ]),
    ...section(zh ? "交付物" : "Deliverable", [
      paragraph(
        displayText(task.deliverable, locale),
        zh ? "一份可直接进入下一道审校的成果。" : "A result ready for the next review step.",
      ),
    ]),
  );

  if (world) {
    lines.push(
      ...section(zh ? "世界观上下文" : "World context", [
        `### ${displayText(world.name, locale)}`,
        "",
        displayText(world.summary, locale),
        "",
        `- ${zh ? "类型" : "Genres"}: ${world.genres.join(" / ") || "—"}`,
        `- ${zh ? "主题" : "Themes"}: ${world.themes.join(" / ") || "—"}`,
        ...workspace.lore
          .filter((item) => item.universeId === world.id)
          .map(
            (item) =>
              `- **${displayText(item.title, locale)}** (${item.category}): ${item.body}`,
          ),
        ...workspace.locations
          .filter((item) => item.universeId === world.id)
          .map(
            (item) =>
              `- **${displayText(item.name, locale)}**: ${displayText(item.summary, locale)}`,
          ),
        ...workspace.storyObjects
          .filter((item) => item.universeId === world.id)
          .map(
            (item) =>
              `- **${displayText(item.name, locale)}** (${displayText(item.category, locale)}): ${displayText(item.summary, locale)}`,
          ),
        ...workspace.factions
          .filter((item) => item.universeId === world.id)
          .map(
            (item) =>
              `- **${displayText(item.name, locale)}**: ${displayText(item.summary, locale)} — ${item.goal}`,
          ),
      ]),
    );
  }

  if (work) {
    lines.push(
      ...section(zh ? "小说上下文" : "Novel context", [
        `### ${displayText(work.title, locale)}`,
        "",
        `**${zh ? "一句话" : "Logline"}**: ${displayText(work.logline, locale)}`,
        "",
        `**${zh ? "梗概" : "Synopsis"}**: ${paragraph(work.synopsis, "—")}`,
        "",
        `- ${zh ? "目标字数" : "Target words"}: ${work.targetWords}`,
        `- ${zh ? "创作语言" : "Writing language"}: ${work.language}`,
      ]),
    );
  }

  if (chapter) {
    const prose = chapter.content.trim();
    const excerpt =
      prose.length > 6_000
        ? `${prose.slice(0, 2_000)}\n\n[…\n\n${prose.slice(-4_000)}`
        : prose;
    lines.push(
      ...section(zh ? "章节上下文" : "Chapter context", [
        `### ${chapter.number}. ${chapter.title}${chapter.titleEn ? ` / ${chapter.titleEn}` : ""}`,
        "",
        `**${zh ? "摘要" : "Summary"}**: ${paragraph(chapter.summary, "—")}`,
        "",
        `**${zh ? "大纲" : "Outline"}**: ${paragraph(chapter.outline, "—")}`,
        "",
        `**${zh ? "节拍" : "Beats"}**:`,
        ...chapter.beats.map((beat) => `- ${beat}`),
        "",
        `**${zh ? "正文片段" : "Prose excerpt"}**:`,
        "",
        excerpt || (zh ? "尚无正文。" : "No prose yet."),
      ]),
    );
  }

  if (cast.length) {
    lines.push(
      ...section(zh ? "人物锚点" : "Cast anchors", [
        ...cast.map(
          (character) =>
            `- **${displayText(character.name, locale)}** (${displayText(character.role, locale)}): ${displayText(character.summary, locale)}\n  - ${zh ? "外形" : "Look"}: ${character.appearance || "—"}\n  - ${zh ? "视觉锚点" : "Visual anchor"}: ${character.visualPrompt || "—"}\n  - ${zh ? "动机/缺陷" : "Motivation / flaw"}: ${character.motivation || "—"} / ${character.flaw || "—"}`,
        ),
      ]),
    );
  }

  if (relationships.length) {
    lines.push(
      ...section(zh ? "关系约束" : "Relationship constraints", [
        ...relationships.map((relationship) => {
          const source = workspace.characters.find(
            (item) => item.id === relationship.sourceId,
          );
          const target = workspace.characters.find(
            (item) => item.id === relationship.targetId,
          );
          return `- ${source ? displayText(source.name, locale) : relationship.sourceId} → ${target ? displayText(target.name, locale) : relationship.targetId}: ${displayText(relationship.label, locale)} [${relationship.type}, ${relationship.status}, ${relationship.strength}/5]`;
        }),
      ]),
    );
  }

  if (timeline.canon.length || timeline.proposed.length) {
    lines.push(
      ...section(zh ? "时间线与状态约束" : "Timeline and state constraints", [
        ...(zh
          ? ["以下按章节或故事内时间排序。标为“提出”的内容只是制作提案，不能改写已定稿正文。"]
          : ["Events are ordered by chapter or in-world time. Items marked proposed are production hypotheses and cannot rewrite approved prose."]),
        ...timeline.canon.map((event) => {
          return `- **${timelineAnchorLabel(workspace, event, locale)} · ${displayText(event.title, locale)}** (${timelineSubjectLabel(workspace, event, locale)}): ${event.stateBefore || "—"} → ${event.stateAfter || "—"}${event.productionPrompt ? `\n  - ${zh ? "制作约束" : "Production constraint"}: ${event.productionPrompt}` : ""}${event.evidence ? `\n  - ${zh ? "证据" : "Evidence"}: ${event.evidence}` : ""}`;
        }),
        ...timeline.proposed.map((event) => {
          return `- [${zh ? "提出" : "PROPOSED"}] **${timelineAnchorLabel(workspace, event, locale)} · ${displayText(event.title, locale)}** (${timelineSubjectLabel(workspace, event, locale)}): ${event.stateBefore || "—"} → ${event.stateAfter || "—"}${event.productionPrompt ? `\n  - ${zh ? "提案约束" : "Proposed constraint"}: ${event.productionPrompt}` : ""}`;
        }),
      ]),
    );
  }

  const blockers = readiness.blockers;
  if (dependencies.length) {
    lines.push(
      ...section(zh ? "依赖与独立性" : "Dependencies and independence", [
        ...dependencies.map(
          (dependency) =>
            `- ${displayText(dependency.title, locale)} (${dependency.id}): ${statusLabel(dependency.status, locale)}`,
        ),
        readiness.ready
          ? zh
            ? "- 本任务没有未完成依赖，可以作为独立子任务开始。"
            : "- This task has no open dependency and can run as an independent subtask."
          : zh
            ? `- 尚有 ${blockers.length} 个依赖未完成；不得把下游结果标记为已验收。`
            : `- ${blockers.length} dependency task(s) remain open; do not mark downstream work as accepted.`,
      ]),
    );
  } else {
    lines.push(
      ...section(zh ? "依赖与独立性" : "Dependencies and independence", [
        zh
          ? "- 本任务没有前置依赖，可以独立开始。"
          : "- This task has no prerequisites and can start independently.",
      ]),
    );
  }

  lines.push(
    ...section(zh ? "执行约束" : "Operating constraints", [
      zh
        ? "- 只使用本简报和相关 MCP 查询结果；不要从其他宇宙或未列出的作品补造事实。"
        : "- Use only this brief and related MCP queries; do not invent facts from other worlds or unlisted novels.",
      zh
        ? "- 引用章节时保留章节 ID；不确定的事实标成待核验，不得当作已确立事实。"
        : "- Preserve chapter IDs when citing sources; mark uncertain facts as needing verification.",
      zh
        ? "- 返回逐项可审查的交付物，并说明修改了哪些层、依据在哪里、还剩什么风险。"
        : "- Return a reviewable deliverable and state the layers changed, evidence used and remaining risks.",
      zh
        ? "- 漫剧相关内容统一为风格化 3D 动画；不要转成真人或写实路线。"
        : "- Adaptation work stays stylized 3D animation; do not switch to live-action or photorealism.",
    ]),
  );

  return `${lines.join("\n").trim()}\n`;
}

