import { useEffect, useMemo, useRef, useState } from "react";
import type { AiConfigInfo } from "../core/ai.ts";
import { createId } from "../core/factory.ts";
import {
  buildStandardDraftPrompt,
  parseStandardCandidates,
  standardBody,
  standardKindLabel,
  standardRefLabel,
  standardStatusLabel,
  standardTitle,
  STANDARD_KINDS,
  type StandardCandidate,
} from "../core/standards.ts";
import type {
  StandardStatus,
  StudioWorkspace,
  UiLocale,
  WorkspaceStandard,
} from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import { Icon } from "../components/icon.tsx";
import { Badge, Button, EmptyState } from "../components/ui.tsx";

type StandardFilter = "all" | StandardStatus;

const statusTone = {
  draft: "amber",
  active: "green",
  disabled: "neutral",
} as const;

function local(locale: UiLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function scopeText(
  workspace: StudioWorkspace,
  standard: WorkspaceStandard,
  locale: UiLocale,
): string {
  if (!standard.universeId) {
    return local(locale, "项目通用", "Project-wide");
  }
  const universe = workspace.universes.find(
    (item) => item.id === standard.universeId,
  );
  return universe
    ? local(locale, `限「${displayUniverseName(universe.name, locale)}」`, `Only ${displayUniverseName(universe.name, locale)}`)
    : local(locale, "限未知宇宙", "Unknown world");
}

function displayUniverseName(
  name: { zh: string; en: string },
  locale: UiLocale,
): string {
  return locale === "en"
    ? name.en.trim() || name.zh.trim()
    : name.zh.trim() || name.en.trim();
}

export function FoundationView({
  workspace,
  locale,
  t,
  aiInfo,
  onNewStandard,
  onEditStandard,
  onStatusChange,
  onRegisterCandidates,
  onOpenWorkflow,
  onOpenSettings,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  aiInfo: AiConfigInfo | null;
  onNewStandard: () => void;
  onEditStandard: (standard: WorkspaceStandard) => void;
  onStatusChange: (
    standard: WorkspaceStandard,
    status: StandardStatus,
  ) => void;
  onRegisterCandidates: (candidates: StandardCandidate[]) => void;
  onOpenWorkflow: () => void;
  onOpenSettings: () => void;
}) {
  const [filter, setFilter] = useState<StandardFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    workspace.standards[0]?.id ?? null,
  );
  const [drafting, setDrafting] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [candidates, setCandidates] = useState<StandardCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(
    new Set(),
  );
  const activeAi = useRef("");

  const selected =
    workspace.standards.find((standard) => standard.id === selectedId) ?? null;

  useEffect(() => {
    if (
      selectedId &&
      !workspace.standards.some((standard) => standard.id === selectedId)
    ) {
      setSelectedId(workspace.standards[0]?.id ?? null);
    }
  }, [selectedId, workspace.standards]);

  useEffect(
    () => () => {
      if (activeAi.current) void bridge.cancelAi(activeAi.current);
    },
    [],
  );

  const counts = useMemo(() => {
    const next = { total: workspace.standards.length, active: 0, draft: 0, disabled: 0 };
    for (const standard of workspace.standards) next[standard.status] += 1;
    return next;
  }, [workspace.standards]);

  const pinnedCount = useMemo(
    () =>
      workspace.workflowTasks.filter((task) => task.standardRefs.length > 0)
        .length,
    [workspace.workflowTasks],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return workspace.standards.filter((standard) => {
      if (filter !== "all" && standard.status !== filter) return false;
      if (!needle) return true;
      return [
        standardTitle(standard, locale),
        standardBody(standard, locale),
        standard.kind,
        standard.id,
        standardStatusLabel(standard.status, locale),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [filter, locale, query, workspace.standards]);

  const stats = [
    {
      key: "total",
      label: local(locale, "规则总数", "Total"),
      value: counts.total,
      tone: "blue",
    },
    {
      key: "active",
      label: local(locale, "生效", "Active"),
      value: counts.active,
      tone: "green",
    },
    {
      key: "draft",
      label: local(locale, "草稿", "Draft"),
      value: counts.draft,
      tone: "amber",
    },
    {
      key: "disabled",
      label: local(locale, "停用", "Disabled"),
      value: counts.disabled,
      tone: "violet",
    },
    {
      key: "pinned",
      label: local(locale, "已引用任务", "Pinned tasks"),
      value: pinnedCount,
      tone: "green",
    },
  ];

  const filters: { id: StandardFilter; label: string; count: number }[] = [
    { id: "all", label: t("all"), count: counts.total },
    {
      id: "active",
      label: local(locale, "生效", "Active"),
      count: counts.active,
    },
    { id: "draft", label: local(locale, "草稿", "Draft"), count: counts.draft },
    {
      id: "disabled",
      label: local(locale, "停用", "Disabled"),
      count: counts.disabled,
    },
  ];

  const drafted = candidates.filter((_, index) =>
    selectedCandidates.has(index),
  );

  const draft = async () => {
    const info = await bridge.aiConfig().catch(() => null);
    if (!info?.configured) {
      setDraftMessage(
        local(
          locale,
          "请先在设置中配置模型（仅桌面版），再让 AI 起草规则。",
          "Configure a model in Settings first (desktop only), then let AI draft standards.",
        ),
      );
      return;
    }
    if (
      !window.confirm(
        local(
          locale,
          `根据当前项目前提起草基础规则，并发送至 ${info.endpoint}（${info.model}）？服务商可能计费。`,
          `Draft foundation standards from the current premise and send them to ${info.endpoint} (${info.model})? Provider charges may apply.`,
        ),
      )
    )
      return;
    const id = createId("ai");
    activeAi.current = id;
    setDrafting(true);
    setCandidates([]);
    setSelectedCandidates(new Set());
    setDraftMessage(
      local(
        locale,
        "正在根据已登记的项目前提起草候选规则…",
        "Drafting candidate standards from the registered premise…",
      ),
    );
    try {
      const raw = (await bridge.runAi({
        id,
        prompt: buildStandardDraftPrompt(workspace, locale),
        label: local(
          locale,
          "起草项目基础规则",
          "Draft project foundation standards",
        ),
      })).text;
      const parsed = parseStandardCandidates(raw);
      if (!parsed.length) {
        setDraftMessage(
          local(
            locale,
            "模型没有返回可登记的规则，请重试或手动新建。原有规则未改动。",
            "The model returned no registrable standards. Retry or add one manually; existing standards were not changed.",
          ),
        );
        return;
      }
      setCandidates(parsed);
      setSelectedCandidates(new Set(parsed.map((_, index) => index)));
      setDraftMessage(
        local(
          locale,
          `已生成 ${parsed.length} 条候选规则。勾选并登记后才会写入项目，且默认仍为草稿。`,
          `${parsed.length} candidate standards generated. Nothing is written until you select and register them; they register as drafts.`,
        ),
      );
    } catch (error) {
      setDraftMessage(String(error));
    } finally {
      activeAi.current = "";
      setDrafting(false);
    }
  };

  const toggleCandidate = (index: number) => {
    setSelectedCandidates((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const allCandidatesSelected =
    candidates.length > 0 && selectedCandidates.size === candidates.length;

  return (
    <div className="view workflow-view foundation-view">
      <header className="page-heading workflow-heading">
        <div>
          <span className="eyebrow">FOUNDATION / 基础规则</span>
          <h1>{t("foundationTitle")}</h1>
          <p>{t("foundationLead")}</p>
        </div>
        <div className="foundation-heading-actions">
          <Button
            icon="sparkles"
            disabled={drafting}
            onClick={() => void draft()}
          >
            {drafting
              ? local(locale, "AI 起草中…", "Drafting…")
              : local(locale, "AI 起草规则", "AI draft")}
          </Button>
          <Button variant="primary" icon="plus" onClick={onNewStandard}>
            {local(locale, "新建规则", "New standard")}
          </Button>
        </div>
      </header>

      {!aiInfo?.configured ? (
        <div className="foundation-model-note">
          <Icon name="sparkles" size={16} />
          <span>{t("modelSetupBody")}</span>
          <Button variant="ghost" onClick={onOpenSettings}>
            {t("openModelSettings")}
          </Button>
        </div>
      ) : null}

      {draftMessage ? (
        <p className="foundation-status" role="status" aria-live="polite">
          {draftMessage}
          {drafting ? (
            <Button onClick={() => void bridge.cancelAi(activeAi.current)}>
              {t("cancel")}
            </Button>
          ) : null}
        </p>
      ) : null}

      <section className="workflow-stats" aria-label={t("foundationTitle")}>
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
              placeholder={local(
                locale,
                "搜索规则、正文或 ID…",
                "Search standards, bodies or IDs…",
              )}
              aria-label={local(locale, "搜索规则", "Search standards")}
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
              filtered.map((standard) => (
                <button
                  key={standard.id}
                  className={
                    "workflow-row " +
                    (selected?.id === standard.id ? "active" : "")
                  }
                  onClick={() => {
                    setSelectedId(standard.id);
                    setCandidates([]);
                    setDraftMessage("");
                  }}
                >
                  <span className="workflow-row-mark">
                    <Icon name="layers" size={14} />
                  </span>
                  <span className="workflow-row-copy">
                    <span className="workflow-row-top">
                      <strong>{standardTitle(standard, locale)}</strong>
                      <Badge tone={statusTone[standard.status]}>
                        {standardStatusLabel(standard.status, locale)}
                      </Badge>
                    </span>
                    <small>
                      {standardKindLabel(standard.kind, locale)} ·{" "}
                      {scopeText(workspace, standard, locale)} · v
                      {standard.version}
                    </small>
                  </span>
                  <span className="foundation-row-id">{standard.id}</span>
                </button>
              ))
            ) : (
              <EmptyState
                icon="layers"
                title={local(locale, "没有匹配的规则。", "No standards match.")}
                action={
                  <Button variant="primary" icon="plus" onClick={onNewStandard}>
                    {local(locale, "新建规则", "New standard")}
                  </Button>
                }
              >
                {local(
                  locale,
                  "基础规则约束所有 AI 产出；小说、游戏与设定集共用同一套规则。",
                  "Foundation standards constrain every AI deliverable; novels, games and setting bibles share the same rules.",
                )}
              </EmptyState>
            )}
          </div>
        </section>

        <aside className="workflow-detail foundation-detail">
          {drafting && !candidates.length ? (
            <div className="foundation-drafting">
              <span className="boot-loader" />
              <h2>{local(locale, "正在起草候选规则", "Drafting candidates")}</h2>
              <p>
                {local(
                  locale,
                  "模型会读取已登记的世界与作品前提，返回 3 到 6 条可执行的规则候选。不会直接写入项目。",
                  "The model reads the registered worlds and works, then returns 3–6 executable candidates. Nothing is written to the project directly.",
                )}
              </p>
              <Button onClick={() => void bridge.cancelAi(activeAi.current)}>
                {t("cancel")}
              </Button>
            </div>
          ) : candidates.length ? (
            <>
              <div className="workflow-detail-head">
                <div>
                  <span className="eyebrow">AI DRAFT / 候选规则</span>
                  <h2>{local(locale, "审阅候选规则", "Review candidates")}</h2>
                </div>
                <Badge tone="amber">
                  {candidates.length} {local(locale, "条", "drafts")}
                </Badge>
              </div>
              <p className="foundation-candidate-lead">
                {local(
                  locale,
                  "只登记确认过的条目；登记后为草稿，启用后才会注入 AI 提示词与工作简报。",
                  "Register only what you have reviewed. Entries are saved as drafts and join prompts only after activation.",
                )}
              </p>
              <div className="foundation-candidates">
                {candidates.map((candidate, index) => {
                  const checked = selectedCandidates.has(index);
                  return (
                    <label
                      key={`${candidate.kind}-${index}`}
                      className={
                        "foundation-candidate " + (checked ? "selected" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCandidate(index)}
                      />
                      <span>
                        <span className="foundation-candidate-top">
                          <Badge tone="violet">
                            {standardKindLabel(candidate.kind, locale)}
                          </Badge>
                          <strong>
                            {standardTitle({ title: candidate.title }, locale)}
                          </strong>
                        </span>
                        <span className="foundation-candidate-body">
                          {standardBody({ body: candidate.body }, locale)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="workflow-actions">
                <Button
                  variant="primary"
                  icon="check"
                  disabled={!drafted.length}
                  onClick={() => {
                    onRegisterCandidates(drafted);
                    setCandidates([]);
                    setSelectedCandidates(new Set());
                    setDraftMessage(
                      local(
                        locale,
                        `已登记 ${drafted.length} 条草稿规则。启用后才会影响 AI 产出。`,
                        `${drafted.length} draft standards registered. They affect AI output once activated.`,
                      ),
                    );
                  }}
                >
                  {local(
                    locale,
                    `登记选中（${drafted.length}）`,
                    `Register selected (${drafted.length})`,
                  )}
                </Button>
                <Button
                  onClick={() =>
                    setSelectedCandidates(
                      allCandidatesSelected
                        ? new Set()
                        : new Set(candidates.map((_, index) => index)),
                    )
                  }
                >
                  {allCandidatesSelected
                    ? local(locale, "取消全选", "Clear all")
                    : local(locale, "全选", "Select all")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCandidates([]);
                    setSelectedCandidates(new Set());
                    setDraftMessage("");
                  }}
                >
                  {local(locale, "丢弃候选", "Discard")}
                </Button>
              </div>
            </>
          ) : selected ? (
            <>
              <div className="workflow-detail-head">
                <div>
                  <span className="eyebrow">
                    {standardKindLabel(selected.kind, locale)} / {selected.id}
                  </span>
                  <h2>{standardTitle(selected, locale)}</h2>
                </div>
                <Badge tone={statusTone[selected.status]} dot>
                  {standardStatusLabel(selected.status, locale)}
                </Badge>
              </div>

              <div className="workflow-scope">
                <span>
                  <Icon name="layers" size={14} />
                  {scopeText(workspace, selected, locale)}
                </span>
                <span>
                  <Icon name="check" size={14} />v{selected.version}
                </span>
                <span>
                  <Icon name="link" size={14} />
                  {
                    workspace.workflowTasks.filter((task) =>
                      task.standardRefs.some((ref) => ref.id === selected.id),
                    ).length
                  }{" "}
                  {local(locale, "个任务引用", "tasks pinned")}
                </span>
              </div>

              <section className="workflow-brief-block foundation-body">
                <span className="eyebrow">
                  {local(locale, "规则正文", "Standard body")}
                </span>
                <p>{standardBody(selected, locale) || "—"}</p>
              </section>

              <section className="workflow-brief-block">
                <span className="eyebrow">
                  {local(locale, "生效范围", "Applied scope")}
                </span>
                <p>
                  {selected.status === "active"
                    ? local(
                        locale,
                        "此规则会注入项目内所有匹配范围的 AI 提示词与工作简报。",
                        "This standard is injected into every matching AI prompt and workflow brief in the project.",
                      )
                    : local(
                        locale,
                        "草稿与停用规则不会注入提示词；启用后才参与 AI 工作。",
                        "Draft and disabled standards are not injected. Activate one to include it in AI work.",
                      )}
                </p>
              </section>

              <section className="foundation-pinned-tasks">
                <span className="eyebrow">
                  {local(locale, "任务固定引用", "Pinned by tasks")}
                </span>
                {workspace.workflowTasks.filter((task) =>
                  task.standardRefs.some((ref) => ref.id === selected.id),
                ).length ? (
                  <div className="foundation-pinned-list">
                    {workspace.workflowTasks
                      .filter((task) =>
                        task.standardRefs.some(
                          (ref) => ref.id === selected.id,
                        ),
                      )
                      .slice(0, 6)
                      .map((task) => {
                        const ref = task.standardRefs.find(
                          (item) => item.id === selected.id,
                        )!;
                        return (
                          <button key={task.id} onClick={onOpenWorkflow}>
                            <Icon name="link" size={13} />
                            {displayUniverseName(task.title, locale)}
                            <code>{standardRefLabel(ref)}</code>
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <p>
                    {local(
                      locale,
                      "还没有任务固定引用此规则；新建任务时会自动固定当时生效的版本。",
                      "No task pins this standard yet. New tasks pin the active version automatically.",
                    )}
                  </p>
                )}
              </section>

              <div className="workflow-actions">
                <Button icon="edit" onClick={() => onEditStandard(selected)}>
                  {t("edit")}
                </Button>
                {selected.status === "active" ? (
                  <Button
                    variant="danger"
                    icon="close"
                    onClick={() => onStatusChange(selected, "disabled")}
                  >
                    {local(locale, "停用", "Disable")}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    icon="check"
                    onClick={() => onStatusChange(selected, "active")}
                  >
                    {local(locale, "启用", "Activate")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  icon="copy"
                  onClick={() =>
                    void bridge.copyText(standardBody(selected, locale))
                  }
                >
                  {local(locale, "复制正文", "Copy body")}
                </Button>
              </div>
            </>
          ) : (
            <EmptyState icon="layers" title={t("foundationNoSelection")}>
              {local(
                locale,
                "选择一条规则查看正文、适用范围和被任务固定的版本。",
                "Select a standard to see its body, scope and pinned versions.",
              )}
            </EmptyState>
          )}
        </aside>
      </div>
    </div>
  );
}
