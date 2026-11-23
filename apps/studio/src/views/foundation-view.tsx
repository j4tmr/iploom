import { useEffect, useMemo, useRef, useState } from "react";
import type { AiConfigInfo } from "../core/ai.ts";
import { createId, displayText } from "../core/factory.ts";
import {
  evaluateUniverseFoundation,
  type FoundationCheckTarget,
} from "../core/foundation-readiness.ts";
import {
  checkRuleLayerConsistency,
  ruleAttributeTypeLabel,
  ruleEffectLabel,
  ruleStatusLabel,
  ruleSystemKindLabel,
} from "../core/rule-layer.ts";
import {
  buildStandardDraftPrompt,
  parseStandardCandidates,
  standardBody,
  standardKindLabel,
  standardRefDrift,
  standardRefLabel,
  standardStatusLabel,
  standardTitle,
  type StandardCandidate,
} from "../core/standards.ts";
import type {
  AbilityTemplate,
  ItemStatTemplate,
  RuleStatus,
  RuleSystem,
  StandardStatus,
  StudioWorkspace,
  UiLocale,
  WorkspaceStandard,
} from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import {
  FoundationChecklistCard,
  FoundationHealthPanel,
} from "../components/foundation-checklist.tsx";
import { Icon } from "../components/icon.tsx";
import { Badge, Button, EmptyState, IconButton } from "../components/ui.tsx";

type StandardFilter = "all" | StandardStatus;
type FoundationMode = "standards" | "rules";

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
  universeId,
  onNewStandard,
  onEditStandard,
  onStatusChange,
  onSelectChecklistTarget,
  onRegisterCandidates,
  onOpenWorkflow,
  onOpenSettings,
  onNewRuleSystem,
  onEditRuleSystem,
  onRuleSystemStatusChange,
  onDeleteRuleSystem,
  onNewAbility,
  onEditAbility,
  onDeleteAbility,
  onNewItemTemplate,
  onEditItemTemplate,
  onDeleteItemTemplate,
  onOpenFoundationSkill,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  aiInfo: AiConfigInfo | null;
  /**
   * Set when this view renders inside a world's detail tab. Only the
   * standards that actually govern that world are listed — project-wide ones
   * plus its own — and new drafts register against it.
   */
  universeId?: string;
  onNewStandard: () => void;
  onEditStandard: (standard: WorkspaceStandard) => void;
  onStatusChange: (standard: WorkspaceStandard, status: StandardStatus) => void;
  onSelectChecklistTarget?: (target: FoundationCheckTarget) => void;
  onRegisterCandidates: (
    candidates: StandardCandidate[],
    universeId?: string,
  ) => void;
  onOpenWorkflow: () => void;
  onOpenSettings: () => void;
  onNewRuleSystem?: () => void;
  onEditRuleSystem?: (system: RuleSystem) => void;
  onRuleSystemStatusChange?: (system: RuleSystem, status: RuleStatus) => void;
  onDeleteRuleSystem?: (system: RuleSystem) => void;
  onNewAbility?: (ruleSystemId: string) => void;
  onEditAbility?: (ability: AbilityTemplate) => void;
  onDeleteAbility?: (ability: AbilityTemplate) => void;
  onNewItemTemplate?: (ruleSystemId: string) => void;
  onEditItemTemplate?: (item: ItemStatTemplate) => void;
  onDeleteItemTemplate?: (item: ItemStatTemplate) => void;
  onOpenFoundationSkill?: () => void;
}) {
  const [mode, setMode] = useState<FoundationMode>("standards");
  const scopedStandards = useMemo(
    () =>
      universeId
        ? workspace.standards.filter(
            (standard) =>
              !standard.universeId || standard.universeId === universeId,
          )
        : workspace.standards,
    [universeId, workspace.standards],
  );
  const worldRuleSystems = useMemo(
    () =>
      universeId
        ? workspace.ruleSystems.filter(
            (system) => system.universeId === universeId,
          )
        : workspace.ruleSystems,
    [universeId, workspace.ruleSystems],
  );
  const [filter, setFilter] = useState<StandardFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    scopedStandards[0]?.id ?? null,
  );
  const [ruleFilter, setRuleFilter] = useState<StandardFilter>("all");
  const [ruleQuery, setRuleQuery] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(
    worldRuleSystems[0]?.id ?? null,
  );
  const [consistencyDraft, setConsistencyDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [candidates, setCandidates] = useState<StandardCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(
    new Set(),
  );
  const activeAi = useRef("");
  /**
   * The scope the current draft belongs to. Candidates were proposed from one
   * world's premise; registering them against another world would silently
   * scope rules to the wrong place, so a scope change cancels the run and
   * drops its candidates.
   */
  const draftScope = useRef(universeId);

  const selected =
    scopedStandards.find((standard) => standard.id === selectedId) ?? null;

  useEffect(() => {
    if (
      selectedId &&
      !scopedStandards.some((standard) => standard.id === selectedId)
    ) {
      setSelectedId(scopedStandards[0]?.id ?? null);
    }
  }, [selectedId, scopedStandards]);

  useEffect(() => {
    if (
      selectedRuleId &&
      !worldRuleSystems.some((system) => system.id === selectedRuleId)
    ) {
      setSelectedRuleId(worldRuleSystems[0]?.id ?? null);
    } else if (!selectedRuleId && worldRuleSystems.length > 0) {
      setSelectedRuleId(worldRuleSystems[0]!.id);
    }
  }, [selectedRuleId, worldRuleSystems]);

  useEffect(
    () => () => {
      if (activeAi.current) void bridge.cancelAi(activeAi.current);
    },
    [],
  );

  useEffect(() => {
    if (draftScope.current === universeId) return;
    draftScope.current = universeId;
    if (activeAi.current) {
      void bridge.cancelAi(activeAi.current);
      activeAi.current = "";
      setDrafting(false);
    }
    setCandidates([]);
    setSelectedCandidates(new Set());
    setDraftMessage("");
  }, [universeId]);

  const counts = useMemo(() => {
    const next = {
      total: scopedStandards.length,
      active: 0,
      draft: 0,
      disabled: 0,
    };
    for (const standard of scopedStandards) next[standard.status] += 1;
    return next;
  }, [scopedStandards]);

  const pinnedCount = useMemo(() => {
    const ids = new Set(scopedStandards.map((standard) => standard.id));
    return workspace.workflowTasks.filter((task) =>
      task.standardRefs.some((ref) => ids.has(ref.id)),
    ).length;
  }, [scopedStandards, workspace.workflowTasks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return scopedStandards.filter((standard) => {
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
  }, [filter, locale, query, scopedStandards]);

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
    const scope = universeId;
    if (
      !window.confirm(
        t(scope ? "foundationDraftConfirmWorld" : "foundationDraftConfirm", {
          endpoint: info.endpoint,
          model: info.model,
        }),
      )
    )
      return;
    const id = createId("ai");
    draftScope.current = scope;
    activeAi.current = id;
    setDrafting(true);
    setCandidates([]);
    setSelectedCandidates(new Set());
    setDraftMessage(
      t(scope ? "foundationDraftingMessageWorld" : "foundationDraftingMessage"),
    );
    try {
      const raw = (
        await bridge.runAi({
          id,
          prompt: buildStandardDraftPrompt(workspace, locale, scope),
          label: t(
            scope ? "foundationDraftLabelWorld" : "foundationDraftLabel",
          ),
        })
      ).text;
      // A scope change cancels the run; never deliver one world's candidates
      // into another world's review.
      if (draftScope.current !== scope) return;
      const parsed = parseStandardCandidates(raw);
      if (!parsed.length) {
        setDraftMessage(t("foundationDraftEmpty"));
        return;
      }
      setCandidates(parsed);
      setSelectedCandidates(new Set(parsed.map((_, index) => index)));
      setDraftMessage(t("foundationDraftGenerated", { count: parsed.length }));
    } catch (error) {
      if (draftScope.current === scope) setDraftMessage(String(error));
    } finally {
      if (draftScope.current === scope) {
        activeAi.current = "";
        setDrafting(false);
      }
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

  const selectedRuleSystem =
    worldRuleSystems.find((system) => system.id === selectedRuleId) ?? null;

  const ruleCounts = useMemo(() => {
    const next = {
      total: worldRuleSystems.length,
      active: 0,
      draft: 0,
      disabled: 0,
    };
    for (const system of worldRuleSystems) next[system.status] += 1;
    return next;
  }, [worldRuleSystems]);

  const filteredRuleSystems = useMemo(() => {
    const needle = ruleQuery.trim().toLocaleLowerCase();
    return worldRuleSystems.filter((system) => {
      if (ruleFilter !== "all" && system.status !== ruleFilter) return false;
      if (!needle) return true;
      return [
        displayText(system.title, locale),
        system.summary,
        system.unit,
        system.kind,
        system.id,
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [locale, ruleFilter, ruleQuery, worldRuleSystems]);

  const worldAbilities = useMemo(
    () =>
      universeId
        ? workspace.abilityTemplates.filter(
            (ability) => ability.universeId === universeId,
          )
        : workspace.abilityTemplates,
    [universeId, workspace.abilityTemplates],
  );

  const worldItems = useMemo(
    () =>
      universeId
        ? workspace.itemStatTemplates.filter(
            (item) => item.universeId === universeId,
          )
        : workspace.itemStatTemplates,
    [universeId, workspace.itemStatTemplates],
  );

  const selectedAbilities = useMemo(
    () =>
      selectedRuleSystem
        ? worldAbilities.filter(
            (ability) => ability.ruleSystemId === selectedRuleSystem.id,
          )
        : [],
    [selectedRuleSystem, worldAbilities],
  );

  const selectedItems = useMemo(
    () =>
      selectedRuleSystem
        ? worldItems.filter(
            (item) => item.ruleSystemId === selectedRuleSystem.id,
          )
        : [],
    [selectedRuleSystem, worldItems],
  );

  const boundCharacters = useMemo(
    () =>
      selectedRuleSystem
        ? workspace.characters.flatMap((character) => {
            const binding = (character.ruleBindings ?? []).find(
              (entry) => entry.ruleSystemId === selectedRuleSystem.id,
            );
            return binding ? [{ character, binding }] : [];
          })
        : [],
    [selectedRuleSystem, workspace.characters],
  );

  const boundObjects = useMemo(
    () =>
      selectedRuleSystem
        ? workspace.storyObjects.filter(
            (object) =>
              object.ruleBinding?.ruleSystemId === selectedRuleSystem.id,
          )
        : [],
    [selectedRuleSystem, workspace.storyObjects],
  );

  const consistencyReport = useMemo(
    () =>
      universeId
        ? checkRuleLayerConsistency(workspace, universeId, {
            locale,
            text: consistencyDraft.trim() ? consistencyDraft : undefined,
          })
        : null,
    [consistencyDraft, locale, universeId, workspace],
  );

  const ruleStats = [
    {
      key: "systems",
      label: t("rulesStatSystems"),
      value: ruleCounts.total,
      tone: "blue",
    },
    {
      key: "active",
      label: t("rulesStatActive"),
      value: ruleCounts.active,
      tone: "green",
    },
    {
      key: "abilities",
      label: t("rulesStatAbilities"),
      value: worldAbilities.length,
      tone: "violet",
    },
    {
      key: "items",
      label: t("rulesStatItems"),
      value: worldItems.length,
      tone: "amber",
    },
    {
      key: "findings",
      label: t("rulesStatFindings"),
      value: consistencyReport?.summary.totalFindings ?? 0,
      tone:
        (consistencyReport?.summary.totalFindings ?? 0) > 0 ? "amber" : "green",
    },
  ];

  const ruleFilters: { id: StandardFilter; label: string; count: number }[] = [
    { id: "all", label: t("all"), count: ruleCounts.total },
    {
      id: "active",
      label: t("foundationStatActive"),
      count: ruleCounts.active,
    },
    { id: "draft", label: t("foundationStatDraft"), count: ruleCounts.draft },
    {
      id: "disabled",
      label: t("foundationStatDisabled"),
      count: ruleCounts.disabled,
    },
  ];

  const headingActions =
    mode === "rules" ? (
      <div className="foundation-heading-actions">
        {onOpenFoundationSkill ? (
          <Button icon="sparkles" onClick={onOpenFoundationSkill}>
            {t("rulesSkillDraftAction")}
          </Button>
        ) : null}
        {onNewRuleSystem ? (
          <Button variant="primary" icon="plus" onClick={onNewRuleSystem}>
            {t("rulesNewSystem")}
          </Button>
        ) : null}
      </div>
    ) : (
      <div className="foundation-heading-actions">
        <Button
          icon="sparkles"
          disabled={drafting}
          onClick={() => void draft()}
        >
          {drafting ? t("foundationDraftingShort") : t("foundationDraftAction")}
        </Button>
        <Button variant="primary" icon="plus" onClick={onNewStandard}>
          {t("foundationNewStandardShort")}
        </Button>
      </div>
    );

  const foundationReport = useMemo(
    () =>
      universeId ? evaluateUniverseFoundation(workspace, universeId) : null,
    [universeId, workspace],
  );

  return (
    <div
      className={
        universeId
          ? "workflow-view foundation-view embedded"
          : "view workflow-view foundation-view"
      }
    >
      {universeId ? (
        <div className="foundation-embedded-head">
          <div className="foundation-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "standards"}
              className={mode === "standards" ? "active" : ""}
              onClick={() => setMode("standards")}
            >
              {t("rulesTabProse")}
              <span>{scopedStandards.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "rules"}
              className={mode === "rules" ? "active" : ""}
              onClick={() => setMode("rules")}
            >
              {t("rulesTabStructured")}
              <span>{worldRuleSystems.length}</span>
            </button>
          </div>
          {headingActions}
        </div>
      ) : (
        <header className="page-heading workflow-heading">
          <div>
            <span className="eyebrow">FOUNDATION / 基础规则</span>
            <h1>{t("foundationTitle")}</h1>
            <p>{t("foundationLead")}</p>
          </div>
          {headingActions}
        </header>
      )}

      {foundationReport && universeId ? (
        <div className="foundation-world-panels">
          <FoundationChecklistCard
            report={foundationReport}
            t={t}
            onSelectTarget={onSelectChecklistTarget}
            compact
          />
          <FoundationHealthPanel
            workspace={workspace}
            universeId={universeId}
            report={foundationReport}
            locale={locale}
            t={t}
            onRuleSystemStatusChange={onRuleSystemStatusChange}
            onDeleteRuleSystem={onDeleteRuleSystem}
          />
        </div>
      ) : null}

      {!aiInfo?.configured ? (
        <div className="foundation-model-note">
          <Icon name="sparkles" size={16} />
          <span>{t("modelSetupBody")}</span>
          <Button variant="ghost" onClick={onOpenSettings}>
            {t("openModelSettings")}
          </Button>
        </div>
      ) : null}

      {mode === "rules" ? (
        <>
          <section
            className="workflow-stats"
            aria-label={t("rulesTabStructured")}
          >
            {ruleStats.map((stat) => (
              <article className="workflow-stat" key={stat.key}>
                <span className={`workflow-stat-mark ${stat.tone}`} />
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
                  value={ruleQuery}
                  onChange={(event) => setRuleQuery(event.target.value)}
                  placeholder={t("rulesSearchPlaceholder")}
                  aria-label={t("rulesSearchLabel")}
                />
              </div>
              <div className="workflow-filters" role="tablist">
                {ruleFilters.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={ruleFilter === item.id ? "active" : ""}
                    onClick={() => setRuleFilter(item.id)}
                    role="tab"
                    aria-selected={ruleFilter === item.id}
                  >
                    {item.label}
                    <span>{item.count}</span>
                  </button>
                ))}
              </div>
              <div className="workflow-list">
                {filteredRuleSystems.length ? (
                  filteredRuleSystems.map((system) => (
                    <button
                      type="button"
                      key={system.id}
                      className={
                        "workflow-row " +
                        (selectedRuleSystem?.id === system.id ? "active" : "")
                      }
                      onClick={() => setSelectedRuleId(system.id)}
                    >
                      <span className="workflow-row-mark">
                        <Icon name="layers" size={14} />
                      </span>
                      <span className="workflow-row-copy">
                        <span className="workflow-row-top">
                          <strong>{displayText(system.title, locale)}</strong>
                          <Badge tone={statusTone[system.status]}>
                            {ruleStatusLabel(system.status, locale)}
                          </Badge>
                        </span>
                        <small>
                          {ruleSystemKindLabel(system.kind, locale)} ·{" "}
                          {system.tiers.length} {t("rulesFieldTiers")} ·{" "}
                          {system.attributes.length} {t("rulesFieldAttributes")}{" "}
                          · v{system.version}
                        </small>
                      </span>
                      <span className="foundation-row-id">{system.id}</span>
                    </button>
                  ))
                ) : (
                  <EmptyState
                    icon="layers"
                    title={t("rulesEmptyTitle")}
                    action={
                      onNewRuleSystem ? (
                        <Button
                          variant="primary"
                          icon="plus"
                          onClick={onNewRuleSystem}
                        >
                          {t("rulesNewSystem")}
                        </Button>
                      ) : undefined
                    }
                  >
                    {t("rulesEmptyLead")}
                  </EmptyState>
                )}
              </div>
            </section>

            <aside className="workflow-detail foundation-detail">
              {selectedRuleSystem ? (
                <>
                  <div className="workflow-detail-head">
                    <div>
                      <span className="eyebrow">
                        {ruleSystemKindLabel(selectedRuleSystem.kind, locale)} /{" "}
                        {selectedRuleSystem.id}
                      </span>
                      <h2>{displayText(selectedRuleSystem.title, locale)}</h2>
                    </div>
                    <Badge tone={statusTone[selectedRuleSystem.status]} dot>
                      {ruleStatusLabel(selectedRuleSystem.status, locale)}
                    </Badge>
                  </div>

                  <div className="workflow-scope">
                    <span>
                      <Icon name="check" size={14} />v
                      {selectedRuleSystem.version}
                    </span>
                    {selectedRuleSystem.unit ? (
                      <span>
                        {t("rulesUnit")}: {selectedRuleSystem.unit}
                      </span>
                    ) : null}
                  </div>

                  {selectedRuleSystem.summary ? (
                    <section className="workflow-brief-block foundation-body">
                      <span className="eyebrow">{t("rulesSummary")}</span>
                      <p>{selectedRuleSystem.summary}</p>
                    </section>
                  ) : null}

                  <section className="workflow-brief-block">
                    <span className="eyebrow">
                      {t("foundationAppliedScope")}
                    </span>
                    <p>
                      {selectedRuleSystem.status === "active"
                        ? t("rulesActiveScopeNote")
                        : t("rulesInactiveScopeNote")}
                    </p>
                  </section>

                  <section className="rule-section">
                    <span className="eyebrow">{t("rulesTiersTitle")}</span>
                    {selectedRuleSystem.tiers.length ? (
                      <div className="rule-table">
                        {[...selectedRuleSystem.tiers]
                          .sort((a, b) => a.rank - b.rank)
                          .map((tier) => (
                            <div className="rule-table-row" key={tier.id}>
                              <strong>
                                #{tier.rank} {displayText(tier.name, locale)}
                              </strong>
                              <span>
                                {tier.minValue !== undefined ||
                                tier.maxValue !== undefined
                                  ? `${tier.minValue ?? "−∞"}–${tier.maxValue ?? "+∞"}${selectedRuleSystem.unit ? ` ${selectedRuleSystem.unit}` : ""}`
                                  : "—"}
                              </span>
                              {tier.summary ? (
                                <small>{tier.summary}</small>
                              ) : null}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="hint">{t("rulesNoTiers")}</p>
                    )}
                  </section>

                  <section className="rule-section">
                    <span className="eyebrow">{t("rulesAttributesTitle")}</span>
                    {selectedRuleSystem.attributes.length ? (
                      <div className="rule-table">
                        {selectedRuleSystem.attributes.map((attribute) => (
                          <div className="rule-table-row" key={attribute.key}>
                            <strong>
                              {displayText(attribute.label, locale)}{" "}
                              <code>{attribute.key}</code>
                            </strong>
                            <Badge tone="neutral">
                              {ruleAttributeTypeLabel(attribute.type, locale)}
                            </Badge>
                            <span>
                              {attribute.type === "enum"
                                ? attribute.enumValues.join(" / ")
                                : attribute.min !== undefined ||
                                    attribute.max !== undefined
                                  ? `${attribute.min ?? "−∞"}–${attribute.max ?? "+∞"}${attribute.unit ? ` ${attribute.unit}` : ""}`
                                  : attribute.unit || "—"}
                            </span>
                            {attribute.description ? (
                              <small>{attribute.description}</small>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="hint">{t("rulesNoAttributes")}</p>
                    )}
                  </section>

                  <section className="rule-section">
                    <div className="rule-section-head">
                      <span className="eyebrow">
                        {t("rulesAbilitiesTitle")} ({selectedAbilities.length})
                      </span>
                      {onNewAbility ? (
                        <Button
                          variant="ghost"
                          icon="plus"
                          onClick={() => onNewAbility(selectedRuleSystem.id)}
                        >
                          {t("rulesAddAbility")}
                        </Button>
                      ) : null}
                    </div>
                    {selectedAbilities.length ? (
                      <div className="rule-table">
                        {selectedAbilities.map((ability) => {
                          const tier = selectedRuleSystem.tiers.find(
                            (item) => item.id === ability.tierId,
                          );
                          return (
                            <div className="rule-table-row" key={ability.id}>
                              <div className="rule-row-copy">
                                <strong>
                                  {displayText(ability.name, locale)}
                                </strong>
                                {tier ? (
                                  <Badge tone="blue">
                                    #{tier.rank}{" "}
                                    {displayText(tier.name, locale)}
                                  </Badge>
                                ) : null}
                                {ability.cost ? (
                                  <Badge tone="neutral">{ability.cost}</Badge>
                                ) : null}
                                {ability.effects.length ? (
                                  <span className="rule-chip-list">
                                    {ability.effects.map((effect) => (
                                      <code
                                        key={`${effect.attributeKey}-${effect.operation}-${effect.value}`}
                                      >
                                        {ruleEffectLabel(
                                          effect,
                                          selectedRuleSystem,
                                          locale,
                                        )}
                                      </code>
                                    ))}
                                  </span>
                                ) : null}
                              </div>
                              <div className="rule-row-actions">
                                {onEditAbility ? (
                                  <IconButton
                                    label={t("rulesEditAbility")}
                                    icon="edit"
                                    onClick={() => onEditAbility(ability)}
                                  />
                                ) : null}
                                {onDeleteAbility ? (
                                  <IconButton
                                    label={t("rulesDeleteAbility")}
                                    icon="trash"
                                    onClick={() => onDeleteAbility(ability)}
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="hint">{t("rulesNoAbilities")}</p>
                    )}
                  </section>

                  <section className="rule-section">
                    <div className="rule-section-head">
                      <span className="eyebrow">
                        {t("rulesItemsTitle")} ({selectedItems.length})
                      </span>
                      {onNewItemTemplate ? (
                        <Button
                          variant="ghost"
                          icon="plus"
                          onClick={() =>
                            onNewItemTemplate(selectedRuleSystem.id)
                          }
                        >
                          {t("rulesAddItem")}
                        </Button>
                      ) : null}
                    </div>
                    {selectedItems.length ? (
                      <div className="rule-table">
                        {selectedItems.map((item) => {
                          const tier = selectedRuleSystem.tiers.find(
                            (entry) => entry.id === item.tierId,
                          );
                          return (
                            <div className="rule-table-row" key={item.id}>
                              <div className="rule-row-copy">
                                <strong>
                                  {displayText(item.name, locale)}
                                </strong>
                                <Badge tone="amber">
                                  {displayText(item.category, locale)}
                                </Badge>
                                {tier ? (
                                  <Badge tone="blue">
                                    #{tier.rank}{" "}
                                    {displayText(tier.name, locale)}
                                  </Badge>
                                ) : null}
                                {item.stats.length ? (
                                  <span className="rule-chip-list">
                                    {item.stats.map((stat) => (
                                      <code
                                        key={`${stat.attributeKey}-${stat.operation}-${stat.value}`}
                                      >
                                        {ruleEffectLabel(
                                          stat,
                                          selectedRuleSystem,
                                          locale,
                                        )}
                                      </code>
                                    ))}
                                  </span>
                                ) : null}
                              </div>
                              <div className="rule-row-actions">
                                {onEditItemTemplate ? (
                                  <IconButton
                                    label={t("rulesEditItem")}
                                    icon="edit"
                                    onClick={() => onEditItemTemplate(item)}
                                  />
                                ) : null}
                                {onDeleteItemTemplate ? (
                                  <IconButton
                                    label={t("rulesDeleteItem")}
                                    icon="trash"
                                    onClick={() => onDeleteItemTemplate(item)}
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="hint">{t("rulesNoItems")}</p>
                    )}
                  </section>

                  <section className="rule-section">
                    <span className="eyebrow">
                      {t("rulesBoundEntitiesTitle")}
                    </span>
                    {boundCharacters.length + boundObjects.length > 0 ? (
                      <div className="rule-table">
                        {boundCharacters.map(({ character, binding }) => {
                          const tier = selectedRuleSystem.tiers.find(
                            (item) => item.id === binding.tierId,
                          );
                          return (
                            <div className="rule-table-row" key={character.id}>
                              <strong>
                                {displayText(character.name, locale)}
                              </strong>
                              <Badge tone="blue">{t("entityCharacter")}</Badge>
                              {tier ? (
                                <span>
                                  #{tier.rank} {displayText(tier.name, locale)}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                        {boundObjects.map((object) => {
                          const tier = selectedRuleSystem.tiers.find(
                            (item) => item.id === object.ruleBinding?.tierId,
                          );
                          return (
                            <div className="rule-table-row" key={object.id}>
                              <strong>
                                {displayText(object.name, locale)}
                              </strong>
                              <Badge tone="amber">
                                {t("entityStoryObject")}
                              </Badge>
                              {tier ? (
                                <span>
                                  #{tier.rank} {displayText(tier.name, locale)}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="hint">{t("rulesNoBoundEntities")}</p>
                    )}
                  </section>

                  <div className="workflow-actions">
                    {onEditRuleSystem ? (
                      <Button
                        icon="edit"
                        onClick={() => onEditRuleSystem(selectedRuleSystem)}
                      >
                        {t("edit")}
                      </Button>
                    ) : null}
                    {onRuleSystemStatusChange ? (
                      selectedRuleSystem.status === "active" ? (
                        <Button
                          variant="danger"
                          icon="close"
                          onClick={() =>
                            onRuleSystemStatusChange(
                              selectedRuleSystem,
                              "disabled",
                            )
                          }
                        >
                          {t("foundationDisable")}
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          icon="check"
                          onClick={() =>
                            onRuleSystemStatusChange(
                              selectedRuleSystem,
                              "active",
                            )
                          }
                        >
                          {t("foundationActivate")}
                        </Button>
                      )
                    ) : null}
                    {onDeleteRuleSystem ? (
                      <Button
                        variant="ghost"
                        icon="trash"
                        onClick={() => onDeleteRuleSystem(selectedRuleSystem)}
                      >
                        {t("delete")}
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyState icon="layers" title={t("rulesNoSelection")}>
                  {t("rulesNoSelectionLead")}
                </EmptyState>
              )}
            </aside>
          </div>

          {consistencyReport ? (
            <section className="rule-consistency-panel">
              <div className="rule-section-head">
                <div>
                  <span className="eyebrow">
                    CONSISTENCY / {t("rulesConsistencyTitle")}
                  </span>
                  <h3>{t("rulesConsistencyTitle")}</h3>
                  <p className="hint">{t("rulesConsistencyLead")}</p>
                </div>
                <Badge
                  tone={
                    consistencyReport.findings.length > 0 ? "amber" : "green"
                  }
                >
                  {t("rulesConsistencyStats", {
                    systems: consistencyReport.summary.checkedRuleSystems,
                    chapters: consistencyReport.summary.chaptersScanned,
                    tasks: consistencyReport.summary.workflowTasksScanned,
                    boundChars: consistencyReport.summary.boundCharacters,
                    totalChars: consistencyReport.summary.totalCharacters,
                    boundObjs: consistencyReport.summary.boundObjects,
                    totalObjs: consistencyReport.summary.totalObjects,
                  })}
                </Badge>
              </div>
              <div className="rule-consistency-input">
                <label>
                  <span>{t("rulesConsistencyDraftLabel")}</span>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={consistencyDraft}
                    placeholder={t("rulesConsistencyDraftPlaceholder")}
                    onChange={(event) =>
                      setConsistencyDraft(event.target.value)
                    }
                  />
                </label>
                {consistencyDraft.trim() ? (
                  <Button
                    variant="ghost"
                    onClick={() => setConsistencyDraft("")}
                  >
                    {t("rulesConsistencyClearDraft")}
                  </Button>
                ) : null}
              </div>
              {consistencyReport.findings.length ? (
                <div className="rule-table">
                  {consistencyReport.findings.map((finding) => (
                    <div
                      className="rule-table-row"
                      key={`${finding.sourceKind}-${finding.sourceId}-${finding.ruleSystemId}-${finding.kind}-${finding.attributeKey ?? ""}-${finding.value ?? ""}-${finding.excerpt}`}
                    >
                      <Badge
                        tone={
                          finding.severity === "warning" ? "amber" : "neutral"
                        }
                      >
                        {finding.severity === "warning"
                          ? t("rulesSeverityWarning")
                          : t("rulesSeverityInfo")}
                      </Badge>
                      <div className="rule-row-copy">
                        <strong>{finding.sourceLabel}</strong>
                        <span>{finding.message}</span>
                        <code>{finding.excerpt}</code>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint">{t("rulesConsistencyClean")}</p>
              )}
            </section>
          ) : null}
        </>
      ) : (
        <>
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
                <span className={`workflow-stat-mark ${stat.tone}`} />
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
                      <Button
                        variant="primary"
                        icon="plus"
                        onClick={onNewStandard}
                      >
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
                  <Button
                    onClick={() => void bridge.cancelAi(activeAi.current)}
                  >
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
                      {t("foundationCandidateCount", {
                        count: candidates.length,
                      })}
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
                          className={`foundation-candidate ${checked ? "selected" : ""}`}
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
                                {standardTitle(
                                  { title: candidate.title },
                                  locale,
                                )}
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
                        onRegisterCandidates(drafted, universeId);
                        setCandidates([]);
                        setSelectedCandidates(new Set());
                        setDraftMessage(
                          t("foundationRegisteredCount", {
                            count: drafted.length,
                          }),
                        );
                      }}
                    >
                      {t("foundationRegisterSelected", {
                        count: drafted.length,
                      })}
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
                        {standardKindLabel(selected.kind, locale)} /{" "}
                        {selected.id}
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
                      {t("foundationReferencedCount", {
                        count: workspace.workflowTasks.filter((task) =>
                          task.standardRefs.some(
                            (ref) => ref.id === selected.id,
                          ),
                        ).length,
                      })}
                    </span>
                  </div>

                  <section className="workflow-brief-block foundation-body">
                    <span className="eyebrow">{t("foundationBodyLabel")}</span>
                    <p>{standardBody(selected, locale) || "—"}</p>
                  </section>

                  <section className="workflow-brief-block">
                    <span className="eyebrow">
                      {t("foundationAppliedScope")}
                    </span>
                    <p>
                      {selected.status === "active"
                        ? t("foundationActiveScope")
                        : t("foundationInactiveScope")}
                    </p>
                  </section>

                  <section className="foundation-pinned-tasks">
                    <span className="eyebrow">
                      {t("foundationReferencedByTasks")}
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
                            const drift = standardRefDrift(
                              workspace,
                              task,
                            ).find((item) => item.ref.id === selected.id);
                            return (
                              <button
                                type="button"
                                key={task.id}
                                onClick={onOpenWorkflow}
                              >
                                <Icon name="link" size={13} />
                                {displayText(task.title, locale)}
                                <code>{standardRefLabel(ref)}</code>
                                {drift ? (
                                  <Badge tone="amber">
                                    {t("foundationStaleRef")}
                                  </Badge>
                                ) : null}
                              </button>
                            );
                          })}
                      </div>
                    ) : (
                      <p>{t("foundationNoReferences")}</p>
                    )}
                  </section>

                  <div className="workflow-actions">
                    <Button
                      icon="edit"
                      onClick={() => onEditStandard(selected)}
                    >
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
        </>
      )}
    </div>
  );
}
