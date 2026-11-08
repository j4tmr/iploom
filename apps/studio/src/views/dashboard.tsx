import { displayText, workWords, workspaceStats } from "../core/factory.ts";
import type {
  StoryUniverse,
  StudioWorkspace,
  UiLocale,
} from "../core/types.ts";
import { formatNumber, statusLabels, type Translate } from "../i18n.ts";
import { Icon } from "../components/icon.tsx";
import {
  Badge,
  Button,
  Cover,
  EmptyState,
  ProgressBar,
  SectionTitle,
  TagList,
} from "../components/ui.tsx";

export function Dashboard({
  workspace,
  locale,
  t,
  onOpenUniverse,
  onOpenWork,
  onNewWorld,
  onNewNovel,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onOpenUniverse: (universe: StoryUniverse) => void;
  onOpenWork: (workId: string) => void;
  onNewWorld: () => void;
  onNewNovel: () => void;
}) {
  const stats = workspaceStats(workspace);
  const recentWorks = [...workspace.works]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  const statCards = [
    {
      label: t("statUniverses"),
      value: stats.universes,
      icon: "world" as const,
    },
    { label: t("statNovels"), value: stats.works, icon: "book" as const },
    {
      label: t("statChapters"),
      value: stats.chapters,
      icon: "layers" as const,
    },
    { label: t("statWords"), value: stats.words, icon: "file" as const },
    {
      label: t("statRelationships"),
      value: stats.relationships,
      icon: "graph" as const,
    },
  ];

  return (
    <div className="view dashboard-view">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">IPLOOM STUDIO / 造界工坊</span>
          <h1>{t("dashboardTitle")}</h1>
          <p>{t("dashboardLead")}</p>
          <div className="hero-actions">
            <Button variant="primary" icon="plus" onClick={onNewWorld}>
              {t("buildWorld")}
            </Button>
            <Button icon="book" onClick={onNewNovel}>
              {t("writeNovel")}
            </Button>
          </div>
          <div className="hero-trust">
            <span>
              <Icon name="check" size={14} />
              {t("localOnly")}
            </span>
            <span>
              <Icon name="package" size={14} />
              ArcReel handoff
            </span>
            <span>
              <Icon name="terminal" size={14} />
              MCP ready
            </span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="hero-world hero-world-a">
            <span>雾</span>
            <small>WORLD / 01</small>
          </div>
          <div className="hero-world hero-world-b">
            <span>故</span>
            <small>STORY / 02</small>
          </div>
          <div className="hero-world hero-world-c">
            <span>镜</span>
            <small>SCREEN / 03</small>
          </div>
          <svg
            className="hero-connector"
            viewBox="0 0 400 320"
            aria-hidden="true"
          >
            <path d="M55 210 C120 150, 160 120, 210 155 S300 205, 355 110" />
            <circle cx="55" cy="210" r="4" />
            <circle cx="210" cy="155" r="4" />
            <circle cx="355" cy="110" r="4" />
          </svg>
        </div>
      </section>

      <section className="stat-strip">
        {statCards.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <span className="stat-icon">
              <Icon name={stat.icon} size={18} />
            </span>
            <span>
              <strong>{formatNumber(stat.value, locale)}</strong>
              <small>{stat.label}</small>
            </span>
          </article>
        ))}
      </section>

      {!workspace.universes.length ? (
        <EmptyState
          icon="world"
          title={t("emptyDashboard")}
          action={
            <Button variant="primary" icon="plus" onClick={onNewWorld}>
              {t("buildWorld")}
            </Button>
          }
        >
          {t("emptyDashboardLead")}
        </EmptyState>
      ) : (
        <section>
          <SectionTitle eyebrow="WORLDS / 宇宙" title={t("universes")}>
            <Button variant="ghost" onClick={onNewWorld} icon="plus">
              {t("new")}
            </Button>
          </SectionTitle>
          <div className="world-grid">
            {workspace.universes.map((universe, index) => {
              const works = workspace.works.filter(
                (work) => work.universeId === universe.id,
              );
              const cast = workspace.characters.filter((character) =>
                character.universeIds.includes(universe.id),
              );
              const rules = workspace.lore.filter(
                (entry) => entry.universeId === universe.id,
              );
              return (
                <button
                  type="button"
                  className="world-card"
                  key={universe.id}
                  onClick={() => onOpenUniverse(universe)}
                  style={
                    { "--accent-card": universe.accent } as React.CSSProperties
                  }
                >
                  <div className="world-card-top">
                    <span className="world-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="world-glyph">
                      {displayText(universe.name, locale).slice(0, 1)}
                    </span>
                  </div>
                  <div className="world-card-copy">
                    <span className="eyebrow">IP UNIVERSE</span>
                    <h3>{displayText(universe.name, locale)}</h3>
                    <p>{displayText(universe.tagline, locale)}</p>
                  </div>
                  <TagList values={universe.genres} max={3} />
                  <div className="world-card-foot">
                    <span>
                      <strong>{works.length}</strong> {t("novels")}
                    </span>
                    <span>
                      <strong>{cast.length}</strong> {t("characters")}
                    </span>
                    <span>
                      <strong>{rules.length}</strong> {t("worldRules")}
                    </span>
                    <Icon name="arrow" size={17} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="dashboard-lower">
        <div>
          <SectionTitle eyebrow="RECENT / 最近" title={t("recentNovels")} />
          <div className="novel-list">
            {recentWorks.map((work) => {
              const universe = workspace.universes.find(
                (item) => item.id === work.universeId,
              );
              const words = workWords(work);
              return (
                <button
                  type="button"
                  className="novel-row"
                  key={work.id}
                  onClick={() => onOpenWork(work.id)}
                >
                  <Cover
                    title={displayText(work.title, locale)}
                    accent={work.coverColor}
                    size="small"
                  />
                  <span className="novel-row-copy">
                    <span className="novel-row-world">
                      {universe
                        ? displayText(universe.name, locale)
                        : t("novel")}
                    </span>
                    <strong>{displayText(work.title, locale)}</strong>
                    <small>{displayText(work.logline, locale)}</small>
                  </span>
                  <span className="novel-row-progress">
                    <span>
                      <b>{formatNumber(words, locale)}</b>
                      <small>{t("words")}</small>
                    </span>
                    <ProgressBar
                      value={words}
                      max={work.targetWords}
                      color={work.coverColor}
                    />
                  </span>
                  <Icon name="chevron" size={17} />
                </button>
              );
            })}
          </div>
        </div>
        <aside className="pipeline-card">
          <span className="eyebrow">PIPELINE / 流水线</span>
          <h3>{t("pipeline")}</h3>
          <div className="pipeline-flow">
            <span className="pipeline-node">
              <i>
                <Icon name="world" />
              </i>
              <b>{t("pipelineWorld")}</b>
              <small>{t("pipelineWorldCopy")}</small>
            </span>
            <span className="pipeline-arrow">
              <Icon name="arrow" size={16} />
            </span>
            <span className="pipeline-node">
              <i>
                <Icon name="book" />
              </i>
              <b>{t("pipelineNovel")}</b>
              <small>{t("pipelineNovelCopy")}</small>
            </span>
            <span className="pipeline-arrow">
              <Icon name="arrow" size={16} />
            </span>
            <span className="pipeline-node">
              <i>
                <Icon name="package" />
              </i>
              <b>{t("pipelineScreen")}</b>
              <small>{t("pipelineScreenCopy")}</small>
            </span>
          </div>
          <div className="pipeline-note">
            <Icon name="sparkles" size={16} />
            <span>{t("draftNote")}</span>
          </div>
        </aside>
      </section>

      <section className="recent-status">
        <div className="section-title compact">
          <h2>{t("allNovels")}</h2>
        </div>
        <div className="mini-novel-grid">
          {workspace.works.map((work) => (
            <button
              type="button"
              key={work.id}
              className="mini-novel"
              onClick={() => onOpenWork(work.id)}
            >
              <span
                className="mini-cover"
                style={{ background: work.coverColor }}
              >
                {displayText(work.title, locale).slice(0, 1)}
              </span>
              <span>
                <strong>{displayText(work.title, locale)}</strong>
                <small>
                  {work.chapters.length} {t("chapters")} ·{" "}
                  {formatNumber(workWords(work), locale)} {t("words")}
                </small>
              </span>
              <Badge tone={work.status === "complete" ? "green" : "neutral"}>
                {statusLabels[locale][work.status]}
              </Badge>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
