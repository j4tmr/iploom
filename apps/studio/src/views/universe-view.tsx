import { useEffect, useState } from "react";
import { buildRelationshipGraph } from "../core/graph.ts";
import { displayText, workWords } from "../core/factory.ts";
import type {
  Character,
  LoreEntry,
  StoryFaction,
  StoryLocation,
  StoryUniverse,
  StudioWorkspace,
  UiLocale,
} from "../core/types.ts";
import {
  formatNumber,
  loreLabels,
  relationshipLabels,
  relationStatusLabels,
  statusLabels,
  type Translate,
} from "../i18n.ts";
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

type UniverseTab = "overview" | "cast" | "atlas" | "graph" | "stories";

export function UniverseView({
  workspace,
  universe,
  initialTab,
  locale,
  t,
  onBack,
  onEditUniverse,
  onDeleteUniverse,
  onOpenWork,
  onNewNovel,
  onNewCharacter,
  onEditCharacter,
  onDeleteCharacter,
  onRemoveCharacterFromWorld,
  onAddAtlas,
  onEditAtlas,
  onDeleteAtlas,
  onAddRelationship,
  onDeleteRelationship,
}: {
  workspace: StudioWorkspace;
  universe: StoryUniverse;
  initialTab?: UniverseTab;
  locale: UiLocale;
  t: Translate;
  onBack: () => void;
  onEditUniverse: () => void;
  onDeleteUniverse: () => void;
  onOpenWork: (workId: string) => void;
  onNewNovel: () => void;
  onNewCharacter: () => void;
  onEditCharacter: (character: Character) => void;
  onDeleteCharacter: (character: Character) => void;
  onRemoveCharacterFromWorld: (character: Character) => void;
  onAddAtlas: (kind: "location" | "faction" | "lore") => void;
  onEditAtlas: (kind: "location" | "faction" | "lore", value: StoryLocation | StoryFaction | LoreEntry) => void;
  onDeleteAtlas: (kind: "location" | "faction" | "lore", id: string) => void;
  onAddRelationship: () => void;
  onDeleteRelationship: (id: string) => void;
}) {
  const [tab, setTab] = useState<UniverseTab>(initialTab ?? "overview");
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const characters = workspace.characters.filter((character) =>
    character.universeIds.includes(universe.id),
  );
  const locations = workspace.locations.filter(
    (location) => location.universeId === universe.id,
  );
  const factions = workspace.factions.filter(
    (faction) => faction.universeId === universe.id,
  );
  const lore = workspace.lore.filter((entry) => entry.universeId === universe.id);
  const works = workspace.works.filter((work) => work.universeId === universe.id);
  const graph = buildRelationshipGraph(workspace, universe.id, locale);
  const tabs: Array<{ id: UniverseTab; label: string; count?: number }> = [
    { id: "overview", label: t("overview") },
    { id: "cast", label: t("cast"), count: characters.length },
    { id: "atlas", label: t("atlas"), count: locations.length + factions.length + lore.length },
    { id: "graph", label: t("graph"), count: graph.edges.length },
    { id: "stories", label: t("stories"), count: works.length },
  ];

  return (
    <div className="view universe-view">
      <button className="back-link" onClick={onBack}>
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
          <p className="universe-tagline">{displayText(universe.tagline, locale)}</p>
          <TagList values={[...universe.genres, ...universe.themes]} max={6} />
          <div className="universe-hero-actions">
            <Button variant="ghost" icon="edit" onClick={onEditUniverse}>{t("edit")}</Button>
            <Button variant="danger" icon="trash" onClick={onDeleteUniverse}>{t("deleteWorld")}</Button>
          </div>
        </div>
        <div className="universe-hero-stats">
          <span><strong>{works.length}</strong>{t("novels")}</span>
          <span><strong>{characters.length}</strong>{t("characters")}</span>
          <span><strong>{graph.edges.length}</strong>{t("relationshipsCount")}</span>
        </div>
      </header>

      <nav className="tab-bar" aria-label={t("overview")}>
        {tabs.map((item) => (
          <button
            key={item.id}
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
              <Button variant="ghost" icon="plus" onClick={() => onAddAtlas("lore")}>{t("add")}</Button>
            </SectionTitle>
            {lore.length ? lore.slice(0, 4).map((entry) => (
              <article className="rule-card" key={entry.id}>
                <span className={`rule-number ${entry.category}`}>{loreLabels[locale][entry.category]}</span>
                <div>
                  <h3>{displayText(entry.title, locale)}</h3>
                  <p>{entry.body}</p>
                </div>
                <IconButton label={t("edit")} icon="edit" onClick={() => onEditAtlas("lore", entry)} />
              </article>
            )) : (
              <EmptyState icon="sparkles" title={t("noLore")} />
            )}
          </section>
          <section className="overview-columns">
            <div className="mini-panel">
              <div className="mini-panel-head">
                <h3>{t("locations")}</h3>
                <IconButton label={t("add")} icon="plus" onClick={() => onAddAtlas("location")} />
              </div>
              {locations.slice(0, 4).map((location) => (
                <button className="atlas-row" key={location.id} onClick={() => onEditAtlas("location", location)}>
                  <span className="atlas-icon"><Icon name="world" size={15} /></span>
                  <span><strong>{displayText(location.name, locale)}</strong><small>{displayText(location.summary, locale)}</small></span>
                </button>
              ))}
            </div>
            <div className="mini-panel">
              <div className="mini-panel-head">
                <h3>{t("factions")}</h3>
                <IconButton label={t("add")} icon="plus" onClick={() => onAddAtlas("faction")} />
              </div>
              {factions.slice(0, 4).map((faction) => (
                <button className="atlas-row" key={faction.id} onClick={() => onEditAtlas("faction", faction)}>
                  <span className="atlas-icon"><Icon name="users" size={15} /></span>
                  <span><strong>{displayText(faction.name, locale)}</strong><small>{faction.goal}</small></span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <SectionTitle eyebrow="CAST / 人物" title={t("cast")}>
              <Button variant="ghost" onClick={() => setTab("cast")}>{t("viewAll")}</Button>
            </SectionTitle>
            <div className="cast-preview-row">
              {characters.slice(0, 5).map((character) => (
                <button className="cast-preview" key={character.id} onClick={() => onEditCharacter(character)}>
                  <span className="avatar" style={{ background: character.color }}>
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
            <Button variant="primary" icon="plus" onClick={onNewCharacter}>{t("new")}</Button>
          </SectionTitle>
          {characters.length ? (
            <div className="cast-grid">
              {characters.map((character) => (
                <article className="cast-card" key={character.id}>
                  <div className="cast-card-head">
                    <span className="avatar avatar-large" style={{ background: character.color }}>
                      {displayText(character.name, locale).slice(0, 1)}
                    </span>
                    <div>
                      <h3>{displayText(character.name, locale)}</h3>
                      <p>{displayText(character.role, locale)}</p>
                    </div>
                    {character.reusable ? <Badge tone="amber">{t("reusableBadge")}</Badge> : null}
                  </div>
                  <p className="cast-summary">{displayText(character.summary, locale)}</p>
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
                    <Button variant="ghost" icon="edit" onClick={() => onEditCharacter(character)}>{t("edit")}</Button>
                    {character.universeIds.length > 1 ? (
                      <>
                        <Button variant="ghost" onClick={() => onRemoveCharacterFromWorld(character)}>
                          {t("removeFromThisWorld")}
                        </Button>
                        <IconButton
                          label={t("deleteEverywhere")}
                          icon="trash"
                          onClick={() => onDeleteCharacter(character)}
                        />
                      </>
                    ) : (
                      <IconButton label={t("delete")} icon="trash" onClick={() => onDeleteCharacter(character)} />
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="users"
              title={t("noCharacters")}
              action={<Button variant="primary" icon="plus" onClick={onNewCharacter}>{t("new")}</Button>}
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
              <Button variant="ghost" icon="plus" onClick={() => onAddAtlas("lore")}>{t("add")}</Button>
            </SectionTitle>
            <div className="atlas-list">
              {lore.map((entry) => (
                <article className="atlas-card" key={entry.id}>
                  <span className={`rule-number ${entry.category}`}>{loreLabels[locale][entry.category]}</span>
                  <div className="atlas-card-copy">
                    <h3>{displayText(entry.title, locale)}</h3>
                    <p>{entry.body}</p>
                  </div>
                  <div className="card-actions">
                    <IconButton label={t("edit")} icon="edit" onClick={() => onEditAtlas("lore", entry)} />
                    <IconButton label={t("delete")} icon="trash" onClick={() => onDeleteAtlas("lore", entry.id)} />
                  </div>
                </article>
              ))}
            </div>
          </section>
          <div className="atlas-split">
            <section>
              <SectionTitle title={t("locations")}>
                <IconButton label={t("add")} icon="plus" onClick={() => onAddAtlas("location")} />
              </SectionTitle>
              {locations.map((location) => (
                <article className="atlas-compact" key={location.id}>
                  <span className="atlas-icon"><Icon name="world" size={17} /></span>
                  <div>
                    <h3>{displayText(location.name, locale)}</h3>
                    <p>{displayText(location.summary, locale)}</p>
                    <small>{location.atmosphere}</small>
                  </div>
                  <div className="card-actions">
                    <IconButton label={t("edit")} icon="edit" onClick={() => onEditAtlas("location", location)} />
                    <IconButton label={t("delete")} icon="trash" onClick={() => onDeleteAtlas("location", location.id)} />
                  </div>
                </article>
              ))}
            </section>
            <section>
              <SectionTitle title={t("factions")}>
                <IconButton label={t("add")} icon="plus" onClick={() => onAddAtlas("faction")} />
              </SectionTitle>
              {factions.map((faction) => (
                <article className="atlas-compact" key={faction.id}>
                  <span className="atlas-icon"><Icon name="users" size={17} /></span>
                  <div>
                    <h3>{displayText(faction.name, locale)}</h3>
                    <p>{displayText(faction.summary, locale)}</p>
                    <small>{faction.goal}</small>
                  </div>
                  <div className="card-actions">
                    <IconButton label={t("edit")} icon="edit" onClick={() => onEditAtlas("faction", faction)} />
                    <IconButton label={t("delete")} icon="trash" onClick={() => onDeleteAtlas("faction", faction.id)} />
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
              <Button variant="primary" icon="plus" onClick={onAddRelationship}>{t("addRelationship")}</Button>
            </SectionTitle>
            <p className="graph-hint">{t("clickNode")}</p>
            <RelationshipCanvas graph={graph} locale={locale} onNodeClick={(node) => {
              const character = characters.find((item) => item.id === node.id);
              if (character) onEditCharacter(character);
            }} />
          </div>
          <aside className="relation-sidebar">
            <h3>{t("relationships")}</h3>
            {graph.edges.length ? graph.edges.map((edge) => {
              const source = characters.find((item) => item.id === edge.source);
              const target = characters.find((item) => item.id === edge.target);
              return (
                <article className="relation-row" key={edge.id}>
                  <span className={`relation-dot ${edge.status}`} />
                  <div>
                    <strong>{source ? displayText(source.name, locale) : edge.source} ↔ {target ? displayText(target.name, locale) : edge.target}</strong>
                    <p>{relationshipLabels[locale][edge.type]} · {edge.label}</p>
                    <small>{relationStatusLabels[locale][edge.status]} · {t("relationStrength")} {edge.strength}/5</small>
                  </div>
                  <IconButton label={t("delete")} icon="trash" onClick={() => onDeleteRelationship(edge.id)} />
                </article>
              );
            }) : (
              <EmptyState icon="graph" title={t("noRelationships")}>{t("noRelationshipsLead")}</EmptyState>
            )}
          </aside>
        </section>
      ) : null}

      {tab === "stories" ? (
        <section>
          <SectionTitle eyebrow="STORIES / 故事" title={t("stories")}>
            <Button variant="primary" icon="plus" onClick={onNewNovel}>{t("writeNovel")}</Button>
          </SectionTitle>
          <div className="story-card-grid">
            {works.map((work) => {
              const words = workWords(work);
              return (
                <button className="story-card" key={work.id} onClick={() => onOpenWork(work.id)}>
                  <Cover title={displayText(work.title, locale)} accent={work.coverColor} />
                  <span className="story-card-copy">
                    <span className="eyebrow">{work.genre || t("novel")}</span>
                    <h3>{displayText(work.title, locale)}</h3>
                    <p>{displayText(work.logline, locale)}</p>
                    <span className="story-meta">
                      <Badge tone={work.status === "complete" ? "green" : "neutral"}>{statusLabels[locale][work.status]}</Badge>
                      <small>{work.chapters.length} {t("chapters")} · {formatNumber(words, locale)} {t("words")}</small>
                    </span>
                    <ProgressBar value={words} max={work.targetWords} color={work.coverColor} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
