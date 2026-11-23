import { useMemo } from "react";
import { FoundationChecklistCard } from "../components/foundation-checklist.tsx";
import { Icon } from "../components/icon.tsx";
import { RelationshipCanvas } from "../components/relationship-graph.tsx";
import {
  Badge,
  Button,
  Cover,
  EmptyState,
  IconButton,
  ProgressBar,
  SectionTitle,
  TagList,
} from "../components/ui.tsx";
import type { AiConfigInfo } from "../core/ai.ts";
import { displayText, workWords } from "../core/factory.ts";
import {
  evaluateUniverseFoundation,
  type FoundationCheckTarget,
} from "../core/foundation-readiness.ts";
import { buildRelationshipGraph } from "../core/graph.ts";
import type { StandardCandidate } from "../core/standards.ts";
import type {
  Card,
  CardEdge,
  CardType,
  Character,
  LoreEntry,
  Relationship,
  RuleStatus,
  RuleSystem,
  StandardStatus,
  StoryFaction,
  StoryLocation,
  StoryObject,
  StoryUniverse,
  StudioWorkspace,
  TimelineEvent,
  UiLocale,
  WorkKind,
  WorkflowTask,
  WorkflowTaskStatus,
  WorkspaceStandard,
} from "../core/types.ts";
import {
  formatNumber,
  loreLabels,
  relationStatusLabels,
  relationshipLabels,
  statusLabels,
  type Translate,
} from "../i18n.ts";
import type { UniverseTab } from "../routes.ts";
import { CardsView } from "./cards-view.tsx";
import { FoundationView } from "./foundation-view.tsx";
import { TimelineView } from "./timeline-view.tsx";
import { WorkflowView } from "./workflow-view.tsx";

export function UniverseView({
  workspace,
  universe,
  tab,
  onTabChange,
  locale,
  t,
  aiInfo,
  onBack,
  onEditUniverse,
  onDeleteUniverse,
  onOpenWork,
  onQuickBuild,
  onImportNovel,
  onNewCharacter,
  onEditCharacter,
  onDeleteCharacter,
  onRemoveCharacterFromWorld,
  onAddAtlas,
  onEditAtlas,
  onDeleteAtlas,
  onAddRelationship,
  onEditRelationship,
  onDeleteRelationship,
  onNewEvent,
  onEditEvent,
  onDeleteEvent,
  onNewObject,
  onEditObject,
  onDeleteObject,
  onNewStandard,
  onEditStandard,
  onStatusChange,
  onRuleSystemStatusChange,
  onDeleteRuleSystem,
  onRegisterCandidates,
  onOpenWorkflow,
  onOpenSettings,
  onNewTask,
  onEditTask,
  onAddSubtask,
  onDeleteTask,
  onStatusChangeTask,
  onSaveResult,
  onNewCardType,
  onEditCardType,
  onDuplicateCardType,
  onDeleteCardType,
  onNewCard,
  onEditCard,
  onSaveCards,
  onBatchCards,
  onAiBatchCards,
  onNewCardEdge,
  onDeleteCard,
  onDeleteCardEdge,
  onApplyConstruct,
}: {
  workspace: StudioWorkspace;
  universe: StoryUniverse;
  /**
   * The active tab lives in the route, not in this component, so navigating
   * to the same world and tab again (a search hit, for example) re-selects
   * that tab instead of keeping whatever tab the user last clicked.
   */
  tab: UniverseTab;
  onTabChange: (tab: UniverseTab) => void;
  locale: UiLocale;
  t: Translate;
  aiInfo: AiConfigInfo | null;
  onBack: () => void;
  onEditUniverse: () => void;
  onDeleteUniverse: () => void;
  onOpenWork: (workId: string) => void;
  onQuickBuild: (kind: WorkKind) => void;
  onImportNovel: () => void;
  onNewCharacter: () => void;
  onEditCharacter: (character: Character) => void;
  onDeleteCharacter: (character: Character) => void;
  onRemoveCharacterFromWorld: (character: Character) => void;
  onAddAtlas: (kind: "location" | "faction" | "lore") => void;
  onEditAtlas: (
    kind: "location" | "faction" | "lore",
    value: StoryLocation | StoryFaction | LoreEntry,
  ) => void;
  onDeleteAtlas: (kind: "location" | "faction" | "lore", id: string) => void;
  onAddRelationship: () => void;
  onEditRelationship: (relationship: Relationship) => void;
  onDeleteRelationship: (id: string) => void;
  onNewEvent: (universeId: string, workId?: string) => void;
  onEditEvent: (event: TimelineEvent) => void;
  onDeleteEvent: (event: TimelineEvent) => void;
  onNewObject: () => void;
  onEditObject: (object: StoryObject) => void;
  onDeleteObject: (object: StoryObject) => void;
  onNewStandard: () => void;
  onEditStandard: (standard: WorkspaceStandard) => void;
  onStatusChange: (standard: WorkspaceStandard, status: StandardStatus) => void;
  onRuleSystemStatusChange?: (system: RuleSystem, status: RuleStatus) => void;
  onDeleteRuleSystem?: (system: RuleSystem) => void;
  onRegisterCandidates: (candidates: StandardCandidate[]) => void;
  onOpenWorkflow: () => void;
  onOpenSettings: () => void;
  onNewTask: () => void;
  onEditTask: (task: WorkflowTask) => void;
  onAddSubtask: (task: WorkflowTask) => void;
  onDeleteTask: (task: WorkflowTask) => void;
  onStatusChangeTask: (task: WorkflowTask, status: WorkflowTaskStatus) => void;
  onSaveResult: (task: WorkflowTask, result: string) => boolean;
  onNewCardType: () => void;
  onEditCardType: (type: CardType) => void;
  onDuplicateCardType: (type: CardType) => void;
  onDeleteCardType: (type: CardType) => void;
  onNewCard: (typeId: string) => void;
  onEditCard: (card: Card) => void;
  onSaveCards: (cards: Card[]) => boolean;
  onBatchCards: (typeId: string) => void;
  onAiBatchCards: (typeId: string) => void;
  onNewCardEdge: (defaultSourceId?: string) => void;
  onDeleteCard: (card: Card) => void;
  onDeleteCardEdge: (edge: CardEdge) => void;
  onApplyConstruct: (constructId: string) => void;
}) {
  const setTab = onTabChange;
  const characters = workspace.characters.filter((character) =>
    character.universeIds.includes(universe.id),
  );
  const locations = workspace.locations.filter(
    (location) => location.universeId === universe.id,
  );
  const factions = workspace.factions.filter(
    (faction) => faction.universeId === universe.id,
  );
  const lore = workspace.lore.filter(
    (entry) => entry.universeId === universe.id,
  );
  const works = workspace.works.filter(
    (work) => work.universeId === universe.id,
  );
  const worldTasks = workspace.workflowTasks.filter(
    (task) => task.universeId === universe.id,
  );
  const graph = buildRelationshipGraph(workspace, universe.id, locale);
  const timelineCount = workspace.timelineEvents.filter(
    (event) => event.universeId === universe.id,
  ).length;
  const standardCount = workspace.standards.filter(
    (standard) => !standard.universeId || standard.universeId === universe.id,
  ).length;
  const foundationReport = useMemo(
    () => evaluateUniverseFoundation(workspace, universe.id),
    [workspace, universe.id],
  );
  const handleChecklistTarget = (target: FoundationCheckTarget) => {
    if (target === "edit-world") {
      onEditUniverse();
      return;
    }
    setTab(target);
  };
  const nodeTypes = useMemo(
    () => workspace.cardTypes.filter((type) => type.universeId === universe.id),
    [workspace.cardTypes, universe.id],
  );
  const nodeCards = useMemo(() => {
    const typeIds = new Set(nodeTypes.map((type) => type.id));
    return workspace.cards.filter((card) => typeIds.has(card.typeId));
  }, [workspace.cards, nodeTypes]);
  const nodeCardIds = useMemo(
    () => new Set(nodeCards.map((card) => card.id)),
    [nodeCards],
  );
  const nodeEdges = useMemo(
    () =>
      workspace.cardEdges.filter(
        (edge) =>
          nodeCardIds.has(edge.sourceId) && nodeCardIds.has(edge.targetId),
      ),
    [workspace.cardEdges, nodeCardIds],
  );
  const recentNodes = [...nodeCards]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4);
  const tabs: Array<{ id: UniverseTab; label: string; count?: number }> = [
    { id: "overview", label: t("overview") },
    { id: "nodes", label: t("cards"), count: nodeCards.length },
    { id: "cast", label: t("cast"), count: characters.length },
    {
      id: "atlas",
      label: t("atlas"),
      count: locations.length + factions.length + lore.length,
    },
    { id: "graph", label: t("graph"), count: graph.edges.length },
    { id: "timeline", label: t("timeline"), count: timelineCount },
    { id: "foundation", label: t("foundation"), count: standardCount },
    { id: "stories", label: t("stories"), count: works.length },
    { id: "workflow", label: t("workflow"), count: worldTasks.length },
  ];

  return (
    <div className="view universe-view">
      <button type="button" className="back-link" onClick={onBack}>
        <Icon name="arrowLeft" size={16} />
        {t("dashboard")}
      </button>
      <header
        className="universe-hero"
        style={{ "--world-accent": universe.accent } as React.CSSProperties}
      >
        <div className="universe-hero-mark">
          {displayText(universe.name, locale).slice(0, 1)}
        </div>
        <div className="universe-hero-copy">
          <span className="eyebrow">IP UNIVERSE / {universe.id}</span>
          <h1>{displayText(universe.name, locale)}</h1>
          <p className="universe-tagline">
            {displayText(universe.tagline, locale)}
          </p>
          <TagList values={[...universe.genres, ...universe.themes]} max={6} />
          <div className="universe-hero-actions">
            <Button variant="ghost" icon="edit" onClick={onEditUniverse}>
              {t("edit")}
            </Button>
            <Button variant="danger" icon="trash" onClick={onDeleteUniverse}>
              {t("deleteWorld")}
            </Button>
          </div>
        </div>
        <div className="universe-hero-stats">
          <span>
            <strong>{works.length}</strong>
            {t("works")}
          </span>
          <span>
            <strong>{characters.length}</strong>
            {t("characters")}
          </span>
          <span>
            <strong>{graph.edges.length}</strong>
            {t("relationshipsCount")}
          </span>
          <span>
            <strong>{nodeCards.length}</strong>
            {t("cards")}
          </span>
        </div>
      </header>

      <nav className="tab-bar" aria-label={t("overview")}>
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            data-tab={item.id}
            className={`tab-button ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count !== undefined ? <span>{item.count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="universe-overview">
          <FoundationChecklistCard
            report={foundationReport}
            t={t}
            onSelectTarget={handleChecklistTarget}
          />
          <section className="prose-card world-summary-card">
            <span className="eyebrow">WORLD BIBLE / 世界圣经</span>
            <h2>{t("worldDetails")}</h2>
            <p>{displayText(universe.summary, locale)}</p>
            <div className="world-topic-row">
              <div>
                <small>{t("genre")}</small>
                <TagList values={universe.genres} max={8} />
              </div>
              <div>
                <small>{t("themes")}</small>
                <TagList values={universe.themes} max={8} />
              </div>
            </div>
          </section>
          <section className="overview-rules">
            <SectionTitle eyebrow="RULES / 规则" title={t("worldRules")}>
              <Button
                variant="ghost"
                icon="plus"
                onClick={() => onAddAtlas("lore")}
              >
                {t("add")}
              </Button>
            </SectionTitle>
            {lore.length ? (
              lore.slice(0, 4).map((entry) => (
                <article className="rule-card" key={entry.id}>
                  <span className={`rule-number ${entry.category}`}>
                    {loreLabels[locale][entry.category]}
                  </span>
                  <div>
                    <h3>{displayText(entry.title, locale)}</h3>
                    <p>{entry.body}</p>
                  </div>
                  <IconButton
                    label={t("edit")}
                    icon="edit"
                    onClick={() => onEditAtlas("lore", entry)}
                  />
                </article>
              ))
            ) : (
              <EmptyState icon="sparkles" title={t("noLore")} />
            )}
          </section>
          <section className="overview-columns">
            <div className="mini-panel">
              <div className="mini-panel-head">
                <h3>{t("locations")}</h3>
                <IconButton
                  label={t("add")}
                  icon="plus"
                  onClick={() => onAddAtlas("location")}
                />
              </div>
              {locations.slice(0, 4).map((location) => (
                <button
                  type="button"
                  className="atlas-row"
                  key={location.id}
                  onClick={() => onEditAtlas("location", location)}
                >
                  <span className="atlas-icon">
                    <Icon name="world" size={15} />
                  </span>
                  <span>
                    <strong>{displayText(location.name, locale)}</strong>
                    <small>{displayText(location.summary, locale)}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="mini-panel">
              <div className="mini-panel-head">
                <h3>{t("factions")}</h3>
                <IconButton
                  label={t("add")}
                  icon="plus"
                  onClick={() => onAddAtlas("faction")}
                />
              </div>
              {factions.slice(0, 4).map((faction) => (
                <button
                  type="button"
                  className="atlas-row"
                  key={faction.id}
                  onClick={() => onEditAtlas("faction", faction)}
                >
                  <span className="atlas-icon">
                    <Icon name="users" size={15} />
                  </span>
                  <span>
                    <strong>{displayText(faction.name, locale)}</strong>
                    <small>{faction.goal}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="overview-nodes">
            <SectionTitle eyebrow="NODES / 节点" title={t("cards")}>
              <Button variant="ghost" onClick={() => setTab("nodes")}>
                {t("viewAll")}
              </Button>
            </SectionTitle>
            <ul className="world-node-summary">
              <li>
                <strong>{nodeTypes.length}</strong>
                <small>{t("cardsTypes")}</small>
              </li>
              <li>
                <strong>{nodeCards.length}</strong>
                <small>{t("cards")}</small>
              </li>
              <li>
                <strong>{nodeEdges.length}</strong>
                <small>{t("cardsEdges")}</small>
              </li>
            </ul>
            {recentNodes.length ? (
              <div className="world-node-preview">
                {recentNodes.map((card) => {
                  const type = nodeTypes.find(
                    (item) => item.id === card.typeId,
                  );
                  return (
                    <button
                      type="button"
                      className="world-node-row"
                      key={card.id}
                      onClick={() => {
                        setTab("nodes");
                        onEditCard(card);
                      }}
                    >
                      <i style={{ background: type?.color ?? "var(--line)" }} />
                      <span>
                        <strong>{displayText(card.title, locale)}</strong>
                        <small>
                          {type ? displayText(type.name, locale) : ""}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon="layers"
                title={t("cardsEmptyTitle")}
                action={
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() => setTab("nodes")}
                  >
                    {t("cards")}
                  </Button>
                }
              >
                {t("cardsEmptyLead")}
              </EmptyState>
            )}
          </section>
          <section>
            <SectionTitle eyebrow="CAST / 人物" title={t("cast")}>
              <Button variant="ghost" onClick={() => setTab("cast")}>
                {t("viewAll")}
              </Button>
            </SectionTitle>
            <div className="cast-preview-row">
              {characters.slice(0, 5).map((character) => (
                <button
                  type="button"
                  className="cast-preview"
                  key={character.id}
                  onClick={() => onEditCharacter(character)}
                >
                  <span
                    className="avatar"
                    style={{ background: character.color }}
                  >
                    {displayText(character.name, locale).slice(0, 1)}
                  </span>
                  <strong>{displayText(character.name, locale)}</strong>
                  <small>{displayText(character.role, locale)}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "cast" ? (
        <section>
          <SectionTitle eyebrow="CAST / 人物库" title={t("cast")}>
            <Button variant="primary" icon="plus" onClick={onNewCharacter}>
              {t("new")}
            </Button>
          </SectionTitle>
          {characters.length ? (
            <div className="cast-grid">
              {characters.map((character) => (
                <article className="cast-card" key={character.id}>
                  <div className="cast-card-head">
                    <span
                      className="avatar avatar-large"
                      style={{ background: character.color }}
                    >
                      {displayText(character.name, locale).slice(0, 1)}
                    </span>
                    <div>
                      <h3>{displayText(character.name, locale)}</h3>
                      <p>{displayText(character.role, locale)}</p>
                    </div>
                    {character.reusable ? (
                      <Badge tone="amber">{t("reusableBadge")}</Badge>
                    ) : null}
                  </div>
                  <p className="cast-summary">
                    {displayText(character.summary, locale)}
                  </p>
                  <TagList values={character.tags} max={4} />
                  <div className="cast-links">
                    <Icon name="link" size={14} />
                    <span>
                      {character.universeIds
                        .map((id) =>
                          workspace.universes.find((item) => item.id === id),
                        )
                        .filter(Boolean)
                        .map((item) => displayText(item!.name, locale))
                        .join(" · ")}
                    </span>
                  </div>
                  <div className="card-actions">
                    <Button
                      variant="ghost"
                      icon="edit"
                      onClick={() => onEditCharacter(character)}
                    >
                      {t("edit")}
                    </Button>
                    {character.universeIds.length > 1 ? (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() => onRemoveCharacterFromWorld(character)}
                        >
                          {t("removeFromThisWorld")}
                        </Button>
                        <IconButton
                          label={t("deleteEverywhere")}
                          icon="trash"
                          onClick={() => onDeleteCharacter(character)}
                        />
                      </>
                    ) : (
                      <IconButton
                        label={t("delete")}
                        icon="trash"
                        onClick={() => onDeleteCharacter(character)}
                      />
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="users"
              title={t("noCharacters")}
              action={
                <Button variant="primary" icon="plus" onClick={onNewCharacter}>
                  {t("new")}
                </Button>
              }
            >
              {t("characterLead")}
            </EmptyState>
          )}
        </section>
      ) : null}

      {tab === "atlas" ? (
        <div className="atlas-layout">
          <section>
            <SectionTitle eyebrow="LORE / 设定" title={t("worldRules")}>
              <Button
                variant="ghost"
                icon="plus"
                onClick={() => onAddAtlas("lore")}
              >
                {t("add")}
              </Button>
            </SectionTitle>
            <div className="atlas-list">
              {lore.map((entry) => (
                <article className="atlas-card" key={entry.id}>
                  <span className={`rule-number ${entry.category}`}>
                    {loreLabels[locale][entry.category]}
                  </span>
                  <div className="atlas-card-copy">
                    <h3>{displayText(entry.title, locale)}</h3>
                    <p>{entry.body}</p>
                  </div>
                  <div className="card-actions">
                    <IconButton
                      label={t("edit")}
                      icon="edit"
                      onClick={() => onEditAtlas("lore", entry)}
                    />
                    <IconButton
                      label={t("delete")}
                      icon="trash"
                      onClick={() => onDeleteAtlas("lore", entry.id)}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>
          <div className="atlas-split">
            <section>
              <SectionTitle title={t("locations")}>
                <IconButton
                  label={t("add")}
                  icon="plus"
                  onClick={() => onAddAtlas("location")}
                />
              </SectionTitle>
              {locations.map((location) => (
                <article className="atlas-compact" key={location.id}>
                  <span className="atlas-icon">
                    <Icon name="world" size={17} />
                  </span>
                  <div>
                    <h3>{displayText(location.name, locale)}</h3>
                    <p>{displayText(location.summary, locale)}</p>
                    <small>{location.atmosphere}</small>
                  </div>
                  <div className="card-actions">
                    <IconButton
                      label={t("edit")}
                      icon="edit"
                      onClick={() => onEditAtlas("location", location)}
                    />
                    <IconButton
                      label={t("delete")}
                      icon="trash"
                      onClick={() => onDeleteAtlas("location", location.id)}
                    />
                  </div>
                </article>
              ))}
            </section>
            <section>
              <SectionTitle title={t("factions")}>
                <IconButton
                  label={t("add")}
                  icon="plus"
                  onClick={() => onAddAtlas("faction")}
                />
              </SectionTitle>
              {factions.map((faction) => (
                <article className="atlas-compact" key={faction.id}>
                  <span className="atlas-icon">
                    <Icon name="users" size={17} />
                  </span>
                  <div>
                    <h3>{displayText(faction.name, locale)}</h3>
                    <p>{displayText(faction.summary, locale)}</p>
                    <small>{faction.goal}</small>
                  </div>
                  <div className="card-actions">
                    <IconButton
                      label={t("edit")}
                      icon="edit"
                      onClick={() => onEditAtlas("faction", faction)}
                    />
                    <IconButton
                      label={t("delete")}
                      icon="trash"
                      onClick={() => onDeleteAtlas("faction", faction.id)}
                    />
                  </div>
                </article>
              ))}
            </section>
          </div>
        </div>
      ) : null}

      {tab === "graph" ? (
        <section className="graph-layout">
          <div className="graph-main">
            <SectionTitle eyebrow="RELATIONS / 关系" title={t("graph")}>
              <Button variant="primary" icon="plus" onClick={onAddRelationship}>
                {t("addRelationship")}
              </Button>
            </SectionTitle>
            <p className="graph-hint">{t("clickNode")}</p>
            <RelationshipCanvas
              graph={graph}
              locale={locale}
              t={t}
              onNodeClick={(node) => {
                const character = characters.find(
                  (item) => item.id === node.id,
                );
                if (character) onEditCharacter(character);
              }}
            />
          </div>
          <aside className="relation-sidebar">
            <h3>{t("relationships")}</h3>
            {graph.edges.length ? (
              graph.edges.map((edge) => {
                const source = characters.find(
                  (item) => item.id === edge.source,
                );
                const target = characters.find(
                  (item) => item.id === edge.target,
                );
                return (
                  <article className="relation-row" key={edge.id}>
                    <span className={`relation-dot ${edge.status}`} />
                    <div>
                      <strong>
                        {source
                          ? displayText(source.name, locale)
                          : edge.source}
                        <span className="relation-arrow">
                          {edge.mutual ? "↔" : "→"}
                        </span>
                        {target
                          ? displayText(target.name, locale)
                          : edge.target}
                      </strong>
                      <p>
                        {relationshipLabels[locale][edge.type]} · {edge.label}
                      </p>
                      <small>
                        {relationStatusLabels[locale][edge.status]} ·{" "}
                        {t("relationStrength")} {edge.strength}/5
                      </small>
                      {edge.notes ? (
                        <details>
                          <summary>{t("notesSourceEvidence")}</summary>
                          <p>{edge.notes}</p>
                        </details>
                      ) : null}
                    </div>
                    <span className="relation-row-actions">
                      <IconButton
                        label={t("edit")}
                        icon="edit"
                        onClick={() => {
                          const relationship = workspace.relationships.find(
                            (item) => item.id === edge.id,
                          );
                          if (relationship) onEditRelationship(relationship);
                        }}
                      />
                      <IconButton
                        label={t("delete")}
                        icon="trash"
                        onClick={() => onDeleteRelationship(edge.id)}
                      />
                    </span>
                  </article>
                );
              })
            ) : (
              <EmptyState icon="graph" title={t("noRelationships")}>
                {t("noRelationshipsLead")}
              </EmptyState>
            )}
          </aside>
        </section>
      ) : null}

      {tab === "nodes" ? (
        <CardsView
          workspace={workspace}
          universeId={universe.id}
          locale={locale}
          t={t}
          onNewType={onNewCardType}
          onEditType={onEditCardType}
          onDuplicateType={onDuplicateCardType}
          onDeleteType={onDeleteCardType}
          onNewCard={onNewCard}
          onEditCard={onEditCard}
          onSaveCards={onSaveCards}
          onBatch={onBatchCards}
          onAiBatch={onAiBatchCards}
          onNewEdge={onNewCardEdge}
          onDeleteCard={onDeleteCard}
          onDeleteEdge={onDeleteCardEdge}
          onApplyConstruct={onApplyConstruct}
        />
      ) : null}

      {tab === "timeline" ? (
        <TimelineView
          workspace={workspace}
          locale={locale}
          t={t}
          lockedUniverseId={universe.id}
          onNewEvent={onNewEvent}
          onEditEvent={onEditEvent}
          onDeleteEvent={onDeleteEvent}
          onNewObject={() => onNewObject()}
          onEditObject={onEditObject}
          onDeleteObject={onDeleteObject}
          onOpenWork={onOpenWork}
        />
      ) : null}

      {tab === "foundation" ? (
        <FoundationView
          workspace={workspace}
          locale={locale}
          t={t}
          aiInfo={aiInfo}
          universeId={universe.id}
          onNewStandard={onNewStandard}
          onEditStandard={onEditStandard}
          onStatusChange={onStatusChange}
          onRuleSystemStatusChange={onRuleSystemStatusChange}
          onDeleteRuleSystem={onDeleteRuleSystem}
          onSelectChecklistTarget={handleChecklistTarget}
          onRegisterCandidates={(candidates) =>
            onRegisterCandidates(candidates)
          }
          onOpenWorkflow={onOpenWorkflow}
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {tab === "stories" ? (
        <section>
          <SectionTitle eyebrow="WORKS / 作品" title={t("stories")}>
            <div className="story-quick-build">
              <Button
                variant="primary"
                icon="book"
                onClick={() => onQuickBuild("novel")}
              >
                {t("writeNovel")}
              </Button>
              <Button icon="layers" onClick={() => onQuickBuild("game")}>
                {t("makeGame")}
              </Button>
              <Button
                variant="ghost"
                icon="download"
                data-testid="import-open"
                onClick={onImportNovel}
              >
                {t("importNovel")}
              </Button>
            </div>
          </SectionTitle>
          {!works.length ? (
            <EmptyState
              icon="book"
              title={t("storiesEmptyTitle")}
              action={
                <Button
                  variant="primary"
                  icon="book"
                  onClick={() => onQuickBuild("novel")}
                >
                  {t("writeNovel")}
                </Button>
              }
            >
              {t("storiesEmptyLead")}
            </EmptyState>
          ) : (
            <div className="story-card-grid">
              {works.map((work) => {
                const words = workWords(work);
                return (
                  <button
                    type="button"
                    className="story-card"
                    key={work.id}
                    onClick={() => onOpenWork(work.id)}
                  >
                    <Cover
                      title={displayText(work.title, locale)}
                      accent={work.coverColor}
                    />
                    <span className="story-card-copy">
                      <span className="eyebrow">
                        {work.genre ||
                          (work.kind === "game" ? t("game") : t("novel"))}
                      </span>
                      <h3>{displayText(work.title, locale)}</h3>
                      <p>{displayText(work.logline, locale)}</p>
                      <span className="story-meta">
                        <Badge
                          tone={
                            work.status === "complete" ? "green" : "neutral"
                          }
                        >
                          {statusLabels[locale][work.status]}
                        </Badge>
                        <small>
                          {work.kind === "game"
                            ? t("nodeBoard")
                            : `${work.chapters.length} ${t("chapters")}`}{" "}
                          · {formatNumber(words, locale)} {t("words")}
                        </small>
                      </span>
                      <ProgressBar
                        value={words}
                        max={work.targetWords}
                        color={work.coverColor}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === "workflow" ? (
        <WorkflowView
          workspace={workspace}
          universeId={universe.id}
          locale={locale}
          t={t}
          onNewTask={onNewTask}
          onEditTask={onEditTask}
          onAddSubtask={onAddSubtask}
          onDeleteTask={onDeleteTask}
          onStatusChange={onStatusChangeTask}
          onSaveResult={onSaveResult}
          onOpenWork={onOpenWork}
        />
      ) : null}
    </div>
  );
}
