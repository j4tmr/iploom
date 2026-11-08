import { useState } from "react";
import { displayText } from "../core/factory.ts";
import type { Character, StudioWorkspace, UiLocale } from "../core/types.ts";
import { formatNumber, type Translate } from "../i18n.ts";
import { Icon } from "../components/icon.tsx";
import {
  Badge,
  Button,
  EmptyState,
  SectionTitle,
  Select,
  TagList,
  TextInput,
} from "../components/ui.tsx";

export function CastLibrary({
  workspace,
  locale,
  t,
  onNewCharacter,
  onEditCharacter,
  onOpenUniverse,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onNewCharacter: () => void;
  onEditCharacter: (character: Character) => void;
  onOpenUniverse: (universeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [universeId, setUniverseId] = useState("all");
  const [reusableOnly, setReusableOnly] = useState(false);
  const characters = workspace.characters
    .filter((character) =>
      universeId === "all" ? true : character.universeIds.includes(universeId),
    )
    .filter((character) => !reusableOnly || character.reusable)
    .filter((character) => {
      if (!query.trim()) return true;
      const needle = query.toLocaleLowerCase();
      return [
        character.name.zh,
        character.name.en,
        character.role.zh,
        character.role.en,
        character.summary.zh,
        character.summary.en,
        character.tags.join(" "),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });

  return (
    <div className="view cast-library-view">
      <header className="page-heading">
        <span className="eyebrow">CAST / 人物库</span>
        <h1>{t("cast")}</h1>
        <p>{t("characterLead")}</p>
      </header>
      <div className="library-toolbar">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: TextInput renders the control inside the label */}
        <label className="search-field">
          <Icon name="search" size={17} />
          <TextInput
            value={query}
            placeholder={t("search")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Select
          value={universeId}
          aria-label={t("filterWorld")}
          onChange={(event) => setUniverseId(event.target.value)}
        >
          <option value="all">{t("allWorlds")}</option>
          {workspace.universes.map((universe) => (
            <option value={universe.id} key={universe.id}>
              {displayText(universe.name, locale)}
            </option>
          ))}
        </Select>
        <label className="toggle-chip">
          <input
            type="checkbox"
            checked={reusableOnly}
            onChange={(event) => setReusableOnly(event.target.checked)}
          />
          {t("reusableBadge")}
        </label>
        <Button variant="primary" icon="plus" onClick={onNewCharacter}>
          {t("new")}
        </Button>
      </div>
      <SectionTitle
        eyebrow="REUSABLE CHARACTER SYSTEM"
        title={`${formatNumber(characters.length, locale)} ${t("characters")}`}
      />
      {characters.length ? (
        <div className="cast-library-grid">
          {characters.map((character) => (
            <article className="cast-library-card" key={character.id}>
              <div
                className="cast-library-color"
                style={{ background: character.color }}
              />
              <div className="cast-library-head">
                <span
                  className="avatar avatar-xl"
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
              <p className="cast-library-summary">
                {displayText(character.summary, locale)}
              </p>
              <TagList values={character.tags} max={5} />
              <div className="cast-world-links">
                <small>{t("linkedWorlds")}</small>
                {character.universeIds.map((id) => {
                  const universe = workspace.universes.find(
                    (item) => item.id === id,
                  );
                  return universe ? (
                    <button
                      type="button"
                      key={id}
                      onClick={() => onOpenUniverse(id)}
                    >
                      <span style={{ background: universe.accent }} />
                      {displayText(universe.name, locale)}
                    </button>
                  ) : null;
                })}
              </div>
              <div className="cast-library-foot">
                <span>
                  {character.personality.slice(0, 54) || t("worldDetails")}
                </span>
                <Button
                  variant="ghost"
                  icon="edit"
                  onClick={() => onEditCharacter(character)}
                >
                  {t("edit")}
                </Button>
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
        />
      )}
    </div>
  );
}
