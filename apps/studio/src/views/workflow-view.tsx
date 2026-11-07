import { useEffect, useMemo, useRef, useState } from "react";
import { displayText } from "../core/factory.ts";
import { MAX_WORKFLOW_RESULT_LENGTH } from "../core/types.ts";
import type {
  StudioWorkspace,
  UiLocale,
  WorkflowTask,
  WorkflowTaskStatus,
} from "../core/types.ts";
import {
  buildWorkflowBrief,
  taskChildren,
  workflowSummary,
  workflowTaskReadiness,
} from "../core/workflow.ts";
import type { Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import { Icon } from "../components/icon.tsx";
import { Badge, Button, EmptyState, TextArea } from "../components/ui.tsx";

type WorkflowFilter = "all" | "ready" | "waiting" | "active" | "done";

const statusTone = {
  queued: "neutral",
  active: "blue",
  review: "amber",
  done: "green",
} as const;

function local(locale: UiLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function taskDepth(tasks: WorkflowTask[], task: WorkflowTask): number {
  let depth = 0;
  let parentId = task.parentId;
  const seen = new Set<string>([task.id]);
  while (parentId && !seen.has(parentId) && depth < 8) {
    seen.add(parentId);
    const parent = tasks.find((item) => item.id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

function statusText(t: Translate, status: WorkflowTaskStatus): string {
  return {
    queued: t("taskStatus_queued"),
    active: t("taskStatus_active"),
    review: t("taskStatus_review"),
    done: t("taskStatus_done"),
  }[status];
}

export function WorkflowView({
  workspace,
  locale,
  t,
  onNewTask,
  onEditTask,
  onAddSubtask,
  onDeleteTask,
  onStatusChange,
  onSaveResult,
  onOpenWork,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onNewTask: () => void;
  onEditTask: (task: WorkflowTask) => void;
  onAddSubtask: (task: WorkflowTask) => void;
  onDeleteTask: (task: WorkflowTask) => void;
  onStatusChange: (task: WorkflowTask, status: WorkflowTaskStatus) => void;
  onSaveResult: (task: WorkflowTask, result: string) => boolean;
  onOpenWork: (workId: string) => void;
}) {
  const summary = workflowSummary(workspace);
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    workspace.workflowTasks[0]?.id ?? null,
  );
  const selected =
    workspace.workflowTasks.find((task) => task.id === selectedId) ?? null;
  const [resultText, setResultText] = useState(
    selected ? displayText(selected.result, locale) : "",
  );
  const [briefCopied, setBriefCopied] = useState(false);
  const [conflictText, setConflictText] = useState<string | null>(null);
  // The workspace text this editor was last synced to, plus the text currently
  // in the textarea. Together they answer "did the user type something the
  // workspace does not have yet?" without treating a save round-trip as an
  // external edit.
  const baseRef = useRef({
    id: selected?.id ?? "",
    text: selected ? displayText(selected.result, locale) : "",
  });
  const textRef = useRef(resultText);

  useEffect(() => {
    textRef.current = resultText;
  }, [resultText]);

  useEffect(() => {
    if (
      selectedId &&
      !workspace.workflowTasks.some((task) => task.id === selectedId)
    ) {
      setSelectedId(workspace.workflowTasks[0]?.id ?? null);
    }
  }, [selectedId, workspace.workflowTasks]);

  useEffect(() => {
    const incoming = selected ? displayText(selected.result, locale) : "";
    const base = baseRef.current;
    const selectionChanged = (selected?.id ?? "") !== base.id;
    if (incoming === base.text && !selectionChanged) {
      setBriefCopied(false);
      return;
    }
    const dirty = textRef.current !== base.text;
    if (!dirty || selectionChanged) {
      // Nothing typed, or the user already confirmed a switch: follow the
      // workspace. A programmatic selection repair lands here too.
      setResultText(incoming);
      baseRef.current = { id: selected?.id ?? "", text: incoming };
      setConflictText(null);
    } else {
      // The same task's saved result changed underneath unsaved local edits
      // (an AI run, a snapshot restore, another window). Keep the local text
      // and offer the incoming version instead of overwriting it silently.
      setConflictText(incoming);
    }
    setBriefCopied(false);
  }, [locale, selected?.id, selected?.result.zh, selected?.result.en]);

  const isDirty = selected ? resultText !== baseRef.current.text : false;

  const switchTo = (taskId: string) => {
    if (taskId === selected?.id) return;
    if (isDirty) {
      const confirmed = window.confirm(
        local(
          locale,
          "当前任务的结果有未保存的修改，切换后这些修改会丢失。继续切换？",
          "This result has unsaved edits. Switching tasks will discard them. Continue?",
        ),
      );
      if (!confirmed) return;
    }
    setSelectedId(taskId);
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return workspace.workflowTasks.filter((task) => {
      const readiness = workflowTaskReadiness(workspace, task);
      if (filter === "ready" && !readiness.ready) return false;
      if (filter === "waiting" && (task.status !== "queued" || readiness.ready))
        return false;
      if (filter === "active" && task.status !== "active") return false;
      if (filter === "done" && task.status !== "done") return false;
      if (!needle) return true;
      return [
        displayText(task.title, locale),
        displayText(task.brief, locale),
        displayText(task.deliverable, locale),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [filter, locale, query, workspace]);

  const stats = [
    {
      key: "ready",
      label: local(locale, "可独立开始", "Ready"),
      value: summary.ready,
      tone: "green",
    },
    {
      key: "waiting",
      label: local(locale, "等待依赖", "Waiting"),
      value: summary.waiting,
      tone: "amber",
    },
    {
      key: "active",
      label: local(locale, "进行中", "Active"),
      value: summary.active,
      tone: "blue",
    },
    {
      key: "review",
      label: local(locale, "待审", "In review"),
      value: summary.review,
      tone: "violet",
    },
    {
      key: "done",
      label: local(locale, "已完成", "Done"),
      value: summary.done,
      tone: "green",
    },
  ];

  const world = selected?.universeId
    ? workspace.universes.find((item) => item.id === selected.universeId)
    : undefined;
  const work = selected?.workId
    ? workspace.works.find((item) => item.id === selected.workId)
    : undefined;
  const chapter = selected?.chapterId
    ? work?.chapters.find((item) => item.id === selected.chapterId)
    : undefined;
  const parent = selected?.parentId
    ? workspace.workflowTasks.find((item) => item.id === selected.parentId)
    : undefined;
  const children = selected ? taskChildren(workspace, selected) : [];
  const dependencies = selected
    ? selected.dependsOnIds
        .map((id) => workspace.workflowTasks.find((task) => task.id === id))
        .filter((task): task is WorkflowTask => Boolean(task))
    : [];
  const readiness = selected
    ? workflowTaskReadiness(workspace, selected)
    : null;

  const filters: { id: WorkflowFilter; label: string; count: number }[] = [
    { id: "all", label: t("all"), count: workspace.workflowTasks.length },
    { id: "ready", label: local(locale, "可开始", "Ready"), count: summary.ready },
    {
      id: "waiting",
      label: local(locale, "等待中", "Waiting"),
      count: summary.waiting,
    },
    {
      id: "active",
      label: local(locale, "进行中", "Active"),
      count: summary.active,
    },
    { id: "done", label: local(locale, "已完成", "Done"), count: summary.done },
  ];

  return (
    <div className="view workflow-view">
      <header className="page-heading workflow-heading">
        <div>
          <span className="eyebrow">AI WORKFLOW / 创作流水线</span>
          <h1>{t("workflowTitle")}</h1>
          <p>{t("workflowLead")}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={onNewTask}>
          {t("newTask")}
        </Button>
      </header>

      <section className="workflow-stats" aria-label={t("workflowTitle")}>
        {stats.map((stat) => (
          <article className="workflow-stat" key={stat.key}>
            <span className={"workflow-stat-mark " + stat.tone} />
            <strong>{stat.value}</strong>
            <small>{stat.label}</small>
          </article>
        ))}
      </section>

      <div className="workflow-layout">
        <section className="workflow-queue">
          <div className="workflow-tools">
            <input
              className="input workflow-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("workflowSearch")}
              aria-label={t("workflowSearch")}
            />
          </div>
          <div className="workflow-filters" role="tablist">
            {filters.map((item) => (
              <button
                key={item.id}
                className={filter === item.id ? "active" : ""}
                onClick={() => setFilter(item.id)}
                role="tab"
                aria-selected={filter === item.id}
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>

          <div className="workflow-list">
            {filtered.length ? (
              filtered.map((task) => {
                const taskReadiness = workflowTaskReadiness(workspace, task);
                const depth = taskDepth(workspace.workflowTasks, task);
                const taskWork = task.workId
                  ? workspace.works.find((item) => item.id === task.workId)
                  : undefined;
                const taskWorld = task.universeId
                  ? workspace.universes.find((item) => item.id === task.universeId)
                  : undefined;
                return (
                  <button
                    key={task.id}
                    className={
                      "workflow-row " +
                      (selected?.id === task.id ? "active" : "")
                    }
                    style={
                      {
                        "--task-depth": Math.min(depth, 4) * 15 + "px",
                      } as React.CSSProperties
                    }
                    onClick={() => switchTo(task.id)}
                  >
                    <span className="workflow-row-mark">
                      {depth ? <Icon name="link" size={14} /> : null}
                    </span>
                    <span className="workflow-row-copy">
                      <span className="workflow-row-top">
                        <strong>{displayText(task.title, locale)}</strong>
                        <Badge tone={statusTone[task.status]}>
                          {statusText(t, task.status)}
                        </Badge>
                        {task.resultSuperseded ? (
                          <Badge tone="amber">
                            {local(locale, "需复审", "Re-review")}
                          </Badge>
                        ) : null}
                      </span>
                      <small>
                        {taskWork
                          ? displayText(taskWork.title, locale)
                          : taskWorld
                            ? displayText(taskWorld.name, locale)
                            : t("workflowIndependent")}
                      </small>
                    </span>
                    {taskReadiness.ready ? (
                      <Badge tone="green" dot>
                        {local(locale, "可开始", "Ready")}
                      </Badge>
                    ) : task.status === "queued" ? (
                      <Badge tone="amber">
                        {taskReadiness.blockers.length}{" "}
                        {local(locale, "依赖", "blocker")}
                      </Badge>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <EmptyState
                icon="sparkles"
                title={t("workflowNoTasks")}
                action={
                  <Button variant="primary" icon="plus" onClick={onNewTask}>
                    {t("newTask")}
                  </Button>
                }
              >
                {t("workflowNoTasksLead")}
              </EmptyState>
            )}
          </div>
        </section>

        <aside className="workflow-detail">
          {selected && readiness ? (
            <>
              <div className="workflow-detail-head">
                <div>
                  <span className="eyebrow">
                    {selected.kind} / {selected.id}
                  </span>
                  <h2>{displayText(selected.title, locale)}</h2>
                </div>
                <Badge tone={statusTone[selected.status]} dot>
                  {statusText(t, selected.status)}
                </Badge>
              </div>

              {readiness.ready ? (
                <div className="workflow-readiness ready">
                  <Icon name="check" size={16} />
                  {t("workflowReadyNote")}
                </div>
              ) : selected.status === "queued" ? (
                <div className="workflow-readiness waiting">
                  <Icon name="link" size={16} />
                  {t("workflowWaitingNote")}: {readiness.blockers
                    .map((task) => displayText(task.title, locale))
                    .join(" / ")}
                </div>
              ) : null}

              {selected.resultSuperseded ? (
                <div className="workflow-readiness waiting">
                  <Icon name="link" size={16} />
                  {local(
                    locale,
                    "上游任务的结果已更新，本任务通过审阅时的产出可能过期；重新审阅并保存后标记完成即可清除。",
                    "An upstream result changed since this task was approved. Re-review it, save, then mark done to clear this flag.",
                  )}
                </div>
              ) : null}

              <div className="workflow-scope">
                {world ? (
                  <span>
                    <Icon name="world" size={14} />
                    {displayText(world.name, locale)}
                  </span>
                ) : null}
                {work ? (
                  <button onClick={() => onOpenWork(work.id)}>
                    <Icon name="book" size={14} />
                    {displayText(work.title, locale)}
                  </button>
                ) : null}
                {chapter ? (
                  <span>
                    <Icon name="file" size={14} />
                    {chapter.number}. {chapter.title}
                  </span>
                ) : null}
              </div>

              <section className="workflow-brief-block">
                <span className="eyebrow">{t("workflowObjective")}</span>
                <p>{displayText(selected.brief, locale) || "—"}</p>
              </section>

              <section className="workflow-brief-block">
                <span className="eyebrow">{t("workflowDeliverable")}</span>
                <p>{displayText(selected.deliverable, locale) || "—"}</p>
              </section>

              {parent || children.length || dependencies.length ? (
                <section className="workflow-links">
                  {parent ? (
                    <button onClick={() => switchTo(parent.id)}>
                      <Icon name="arrowLeft" size={14} />
                      {t("workflowParent")}: {displayText(parent.title, locale)}
                    </button>
                  ) : null}
                  {children.map((child) => (
                    <button key={child.id} onClick={() => switchTo(child.id)}>
                      <Icon name="arrow" size={14} />
                      {t("workflowSubtasks")}: {displayText(child.title, locale)}
                    </button>
                  ))}
                  {dependencies.map((dependency) => (
                    <button
                      key={dependency.id}
                      onClick={() => switchTo(dependency.id)}
                    >
                      <Icon name="link" size={14} />
                      {t("workflowDepends")}: {displayText(dependency.title, locale)}
                      {dependency.status !== "done" ? " · Open" : null}
                    </button>
                  ))}
                </section>
              ) : null}

              <section className="workflow-result">
                <label>
                  <span className="eyebrow">{t("workflowResult")}</span>
                  <TextArea
                    data-testid="workflow-result"
                    rows={4}
                    maxLength={MAX_WORKFLOW_RESULT_LENGTH}
                    value={resultText}
                    onChange={(event) => setResultText(event.target.value)}
                    placeholder={t("workflowResultPlaceholder")}
                  />
                </label>
                {conflictText !== null ? (
                  <div className="workflow-readiness waiting workflow-conflict">
                    <Icon name="link" size={16} />
                    <span>
                      {local(
                        locale,
                        "这个结果的已保存版本在别处被更新了。你的修改仍保留在这里，未被覆盖。",
                        "The saved version of this result changed elsewhere. Your edits are still here and were not overwritten.",
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setResultText(conflictText);
                        baseRef.current = {
                          id: selected.id,
                          text: conflictText,
                        };
                        setConflictText(null);
                      }}
                    >
                      {local(locale, "载入已保存版本", "Load saved version")}
                    </Button>
                  </div>
                ) : null}
                <div className="workflow-result-actions">
                  <select
                    className="input select"
                    value={selected.status}
                    onChange={(event) =>
                      onStatusChange(
                        selected,
                        event.target.value as WorkflowTaskStatus,
                      )
                    }
                    aria-label={t("status")}
                  >
                    {(["queued", "active", "review", "done"] as WorkflowTaskStatus[]).map(
                      (status) => (
                        <option value={status} key={status}>
                          {statusText(t, status)}
                        </option>
                      ),
                    )}
                  </select>
                  <Button
                    data-testid="workflow-save-result"
                    icon="check"
                    disabled={
                      resultText === displayText(selected.result, locale) ||
                      resultText.length > MAX_WORKFLOW_RESULT_LENGTH
                    }
                    onClick={() => {
                      if (onSaveResult(selected, resultText)) {
                        // The save round-trip is not an external edit: move
                        // the baseline forward so the sync effect stays quiet.
                        baseRef.current = { id: selected.id, text: resultText };
                        setConflictText(null);
                      }
                    }}
                  >
                    {t("save")}
                  </Button>
                </div>
              </section>

              {selected.previousResult &&
              (selected.previousResult.zh.trim() ||
                selected.previousResult.en.trim()) ? (
                <details className="workflow-previous-result">
                  <summary>
                    {local(locale, "上次运行前的结果", "Result before the last run")}
                  </summary>
                  <p>{displayText(selected.previousResult, locale)}</p>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setResultText(displayText(selected.previousResult!, locale))
                    }
                  >
                    {local(locale, "恢复此版本", "Restore this version")}
                  </Button>
                </details>
              ) : null}

              <div className="workflow-actions">
                <Button
                  variant="primary"
                  icon="sparkles"
                  onClick={async () => {
                    await bridge.copyText(
                      buildWorkflowBrief(workspace, selected.id, locale),
                    );
                    setBriefCopied(true);
                  }}
                >
                  {briefCopied ? t("workflowBriefCopied") : t("workflowCopyBrief")}
                </Button>
                <Button icon="plus" onClick={() => onAddSubtask(selected)}>
                  {t("workflowAddSubtask")}
                </Button>
                <Button icon="edit" onClick={() => onEditTask(selected)}>
                  {t("edit")}
                </Button>
                <Button
                  variant="danger"
                  icon="trash"
                  onClick={() => onDeleteTask(selected)}
                >
                  {t("delete")}
                </Button>
              </div>
            </>
          ) : (
            <EmptyState icon="sparkles" title={t("workflowNoSelection")}>
              {t("workflowNoTasksLead")}
            </EmptyState>
          )}
        </aside>
      </div>
    </div>
  );
}
