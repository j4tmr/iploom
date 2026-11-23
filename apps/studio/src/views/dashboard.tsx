import { displayText } from "../core/factory.ts";
import type {
  StoryUniverse,
  StudioWorkspace,
  UiLocale,
} from "../core/types.ts";
import { WORLD_TEMPLATES } from "../core/world-templates.ts";
import { Icon } from "../components/icon.tsx";
import type { Translate } from "../i18n.ts";
import {
  Button,
  EmptyState,
  SectionTitle,
  TagList,
} from "../components/ui.tsx";

/**
 * The worlds home. It answers one question — which world do I open next, or
 * which starting point do I create one from — and nothing else: cast,
 * relationships, timeline and rules all live inside the world they describe.
 */
export function Dashboard({
  workspace,
  locale,
  t,
  onOpenUniverse,
  onNewWorld,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onOpenUniverse: (universe: StoryUniverse) => void;
  onNewWorld: (templateId?: string) => void;
}) {
  return (
    <div className="view dashboard-view">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">IPLOOM STUDIO / 造界工坊</span>
          <h1>{t("dashboardTitle")}</h1>
          <p>{t("dashboardLead")}</p>
          <div className="hero-actions">
            <Button variant="primary" icon="plus" onClick={() => onNewWorld()}>
              {t("buildWorld")}
            </Button>
          </div>
          <div className="hero-trust">
            <span>
              <Icon name="check" size={14} />
              {t("localOnly")}
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

      <section>
        <SectionTitle eyebrow="TEMPLATES / 起点" title={t("templates")} />
        <p className="template-gallery-lead">{t("templateLead")}</p>
        <div className="template-gallery">
          <button
            type="button"
            className="template-card blank"
            onClick={() => onNewWorld()}
          >
            <span className="template-card-glyph">
              <Icon name="plus" size={20} />
            </span>
            <span className="template-card-copy">
              <strong>{t("templateBlank")}</strong>
              <small>{t("templateBlankLead")}</small>
            </span>
            <span className="template-card-go">
              {t("buildWorld")}
              <Icon name="arrow" size={15} />
            </span>
          </button>
          {WORLD_TEMPLATES.map((template) => (
            <button
              type="button"
              className="template-card"
              key={template.id}
              data-template-id={template.id}
              style={
                { "--accent-card": template.accent } as React.CSSProperties
              }
              onClick={() => onNewWorld(template.id)}
            >
              <span className="template-card-glyph">
                {displayText(template.name, locale).slice(0, 1)}
              </span>
              <span className="template-card-copy">
                <strong>{displayText(template.name, locale)}</strong>
                <small>{displayText(template.summary, locale)}</small>
              </span>
              <span className="template-card-tags">
                <TagList values={template.genres} max={3} />
              </span>
              <span className="template-card-go">
                {t("templateUse")}
                <Icon name="arrow" size={15} />
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="WORLDS / 世界" title={t("universes")}>
          <Button variant="ghost" onClick={() => onNewWorld()} icon="plus">
            {t("new")}
          </Button>
        </SectionTitle>
        {!workspace.universes.length ? (
          <EmptyState
            icon="world"
            title={t("emptyDashboard")}
            action={
              <Button
                variant="primary"
                icon="plus"
                onClick={() => onNewWorld()}
              >
                {t("buildWorld")}
              </Button>
            }
          >
            {t("emptyDashboardLead")}
          </EmptyState>
        ) : (
          <div className="world-grid">
            {workspace.universes.map((universe, index) => {
              const works = workspace.works.filter(
                (work) => work.universeId === universe.id,
              );
              const cast = workspace.characters.filter((character) =>
                character.universeIds.includes(universe.id),
              );
              const typeIds = new Set(
                workspace.cardTypes
                  .filter((type) => type.universeId === universe.id)
                  .map((type) => type.id),
              );
              const nodeCount = workspace.cards.filter((card) =>
                typeIds.has(card.typeId),
              ).length;
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
                      <strong>{works.length}</strong> {t("works")}
                    </span>
                    <span>
                      <strong>{cast.length}</strong> {t("characters")}
                    </span>
                    <span>
                      <strong>{nodeCount}</strong> {t("cards")}
                    </span>
                    <Icon name="arrow" size={17} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
