import { useEffect, useMemo, useRef, useState } from "react";
import type { AiConfigInfo } from "../core/ai.ts";
import { createId, displayText } from "../core/factory.ts";
import {
  buildStandardDraftPrompt,
  parseStandardCandidates,
  standardBody,
  standardKindLabel,
  standardRefLabel,
  standardStatusLabel,
  standardTitle,
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

function scopeText(
  workspace: StudioWorkspace,
  standard: WorkspaceStandard,
  locale: UiLocale,
  t: Translate,
): string {
  if (!standard.universeId) {
    return t("foundationProjectWide");
  }
  const universe = workspace.universes.find(
    (item) => item.id === standard.universeId,
  );
  return universe
    ? t("foundationScopeWorld", { world: displayText(universe.name, locale) })
    : t("foundationScopeUnknown");
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
  onStatusChange: (standard: WorkspaceStandard, status: StandardStatus) => void;
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
    const next = {
      total: workspace.standards.length,
      active: 0,
      draft: 0,
      disabled: 0,
    };
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
      label: t("foundationStatTotal"),
      value: counts.total,
      tone: "blue",
    },
    {
      key: "active",
      label: t("foundationStatActive"),
      value: counts.active,
      tone: "green",
    },
    {
      key: "draft",
      label: t("foundationStatDraft"),
      value: counts.draft,
      tone: "amber",
    },
    {
      key: "disabled",
      label: t("foundationStatDisabled"),
      value: counts.disabled,
      tone: "violet",
    },
    {
      key: "pinned",
      label: t("foundationStatPinned"),
      value: pinnedCount,
      tone: "green",
    },
  ];

  const filters: { id: StandardFilter; label: string; count: number }[] = [
    { id: "all", label: t("all"), count: counts.total },
    {
      id: "active",
      label: t("foundationStatActive"),
      count: counts.active,
    },
    { id: "draft", label: t("foundationStatDraft"), count: counts.draft },
    {
      id: "disabled",
      label: t("foundationStatDisabled"),
      count: counts.disabled,
    },
  ];

  const drafted = candidates.filter((_, index) =>
    selectedCandidates.has(index),
  );

  const draft = async () => {
    const info = await bridge.aiConfig().catch(() => null);
    if (!info?.configured) {
      setDraftMessage(t("foundationNeedModel"));
      return;
    }
    if (
      !window.confirm(
        t("foundationDraftConfirm", {
          endpoint: info.endpoint,
          model: info.model,
        }),
      )
    )
      return;
    const id = createId("ai");
    activeAi.current = id;
    setDrafting(true);
    setCandidates([]);
    setSelectedCandidates(new Set());
    setDraftMessage(t("foundationDraftingMessage"));
    try {
      const raw = (
        await bridge.runAi({
          id,
          prompt: buildStandardDraftPrompt(workspace, locale),
          label: t("foundationDraftLabel"),
        })
      ).text;
      const parsed = parseStandardCandidates(raw);
      if (!parsed.length) {
        setDraftMessage(t("foundationDraftEmpty"));
        return;
      }
      setCandidates(parsed);
      setSelectedCandidates(new Set(parsed.map((_, index) => index)));
      setDraftMessage(t("foundationDraftGenerated", { count: parsed.length }));
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
              ? t("foundationDraftingShort")
              : t("foundationDraftAction")}
          </Button>
          <Button variant="primary" icon="plus" onClick={onNewStandard}>
            {t("foundationNewStandardShort")}
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
              placeholder={t("foundationSearchPlaceholder")}
              aria-label={t("foundationSearchLabel")}
            />
          </div>
          <div className="workflow-filters" role="tablist">
            {filters.map((item) => (
              <button
                type="button"
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
                  type="button"
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
                      {scopeText(workspace, standard, locale, t)} · v
                      {standard.version}
                    </small>
                  </span>
                  <span className="foundation-row-id">{standard.id}</span>
                </button>
              ))
            ) : (
              <EmptyState
                icon="layers"
                title={t("foundationNoMatch")}
                action={
                  <Button variant="primary" icon="plus" onClick={onNewStandard}>
                    {t("foundationNewStandardShort")}
                  </Button>
                }
              >
                {t("foundationEmptyLead")}
              </EmptyState>
            )}
          </div>
        </section>

        <aside className="workflow-detail foundation-detail">
          {drafting && !candidates.length ? (
            <div className="foundation-drafting">
              <span className="boot-loader" />
              <h2>{t("foundationDraftingTitle")}</h2>
              <p>{t("foundationDraftingLead")}</p>
              <Button onClick={() => void bridge.cancelAi(activeAi.current)}>
                {t("cancel")}
              </Button>
            </div>
          ) : candidates.length ? (
            <>
              <div className="workflow-detail-head">
                <div>
                  <span className="eyebrow">AI DRAFT / 候选规则</span>
                  <h2>{t("foundationReviewCandidates")}</h2>
                </div>
                <Badge tone="amber">
                  {t("foundationCandidateCount", { count: candidates.length })}
                </Badge>
              </div>
              <p className="foundation-candidate-lead">
                {t("foundationCandidateLead")}
              </p>
              <div className="foundation-candidates">
                {candidates.map((candidate, index) => {
                  const checked = selectedCandidates.has(index);
                  return (
                    <label
                      key={`${candidate.kind}-${candidate.title.zh || candidate.title.en}`}
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
                      t("foundationRegisteredCount", { count: drafted.length }),
                    );
                  }}
                >
                  {t("foundationRegisterSelected", { count: drafted.length })}
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
                    ? t("foundationClearAll")
                    : t("foundationSelectAll")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCandidates([]);
                    setSelectedCandidates(new Set());
                    setDraftMessage("");
                  }}
                >
                  {t("foundationDiscard")}
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
                  {scopeText(workspace, selected, locale, t)}
                </span>
                <span>
                  <Icon name="check" size={14} />v{selected.version}
                </span>
                <span>
                  <Icon name="link" size={14} />
                  {t("foundationPinnedCount", {
                    count: workspace.workflowTasks.filter((task) =>
                      task.standardRefs.some((ref) => ref.id === selected.id),
                    ).length,
                  })}
                </span>
              </div>

              <section className="workflow-brief-block foundation-body">
                <span className="eyebrow">{t("foundationBodyLabel")}</span>
                <p>{standardBody(selected, locale) || "—"}</p>
              </section>

              <section className="workflow-brief-block">
                <span className="eyebrow">{t("foundationAppliedScope")}</span>
                <p>
                  {selected.status === "active"
                    ? t("foundationActiveScope")
                    : t("foundationInactiveScope")}
                </p>
              </section>

              <section className="foundation-pinned-tasks">
                <span className="eyebrow">{t("foundationPinnedByTasks")}</span>
                {workspace.workflowTasks.filter((task) =>
                  task.standardRefs.some((ref) => ref.id === selected.id),
                ).length ? (
                  <div className="foundation-pinned-list">
                    {workspace.workflowTasks
                      .filter((task) =>
                        task.standardRefs.some((ref) => ref.id === selected.id),
                      )
                      .slice(0, 6)
                      .map((task) => {
                        const ref = task.standardRefs.find(
                          (item) => item.id === selected.id,
                        )!;
                        return (
                          <button
                            type="button"
                            key={task.id}
                            onClick={onOpenWorkflow}
                          >
                            <Icon name="link" size={13} />
                            {displayText(task.title, locale)}
                            <code>{standardRefLabel(ref)}</code>
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <p>{t("foundationNoPins")}</p>
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
                    {t("foundationDisable")}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    icon="check"
                    onClick={() => onStatusChange(selected, "active")}
                  >
                    {t("foundationActivate")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  icon="copy"
                  onClick={() =>
                    void bridge.copyText(standardBody(selected, locale))
                  }
                >
                  {t("foundationCopyBody")}
                </Button>
              </div>
            </>
          ) : (
            <EmptyState icon="layers" title={t("foundationNoSelection")}>
              {t("foundationNoSelectionLead")}
            </EmptyState>
          )}
        </aside>
      </div>
    </div>
  );
}
