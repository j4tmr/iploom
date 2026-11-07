import { useState } from "react";
import { displayText, workWords } from "../core/factory.ts";
import type {
  StudioWorkspace,
  UiLocale,
  WorkStatus,
} from "../core/types.ts";
import {
  formatDate,
  formatNumber,
  intlLocale,
  statusLabels,
  type Translate,
} from "../i18n.ts";
import { Icon } from "../components/icon.tsx";
import {
  Badge,
  Button,
  Cover,
  EmptyState,
  ProgressBar,
  Select,
  TextInput,
} from "../components/ui.tsx";

type SortMode = "updated" | "words" | "title";

const workStatuses: WorkStatus[] = [
  "concept",
  "outlining",
  "drafting",
  "complete",
  "archived",
];

export function LibraryView({
  workspace,
  locale,
  t,
  onOpenWork,
  onNewNovel,
  onImportNovel,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onOpenWork: (workId: string) => void;
  onNewNovel: () => void;
  onImportNovel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [universeId, setUniverseId] = useState("all");
  const [status, setStatus] = useState<WorkStatus | "all">("all");
  const [sort, setSort] = useState<SortMode>("updated");

  const works = workspace.works
    .filter((work) => universeId === "all" || work.universeId === universeId)
    .filter((work) => status === "all" || work.status === status)
    .filter((work) => {
      const needle = query.trim().toLocaleLowerCase();
      if (!needle) return true;
      return [
        work.title.zh,
        work.title.en,
        work.logline.zh,
        work.logline.en,
        work.synopsis,
        work.genre,
        work.themes.join(" "),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    })
    .sort((left, right) => {
      if (sort === "words") return workWords(right) - workWords(left);
      if (sort === "title") {
        return displayText(left.title, locale).localeCompare(
          displayText(right.title, locale),
          intlLocale(locale),
        );
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  return (
    <div className="view library-view">
      <header className="page-heading split">
        <div>
          <span className="eyebrow">LIBRARY / 小说书架</span>
          <h1>{t("library")}</h1>
          <p>{t("libraryLead")}</p>
        </div>
        <div className="page-heading-actions">
          <Button data-testid="import-open" icon="file" onClick={onImportNovel}>{t("importNovel")}</Button>
          <Button variant="primary" icon="plus" onClick={onNewNovel}>
            {t("writeNovel")}
          </Button>
        </div>
      </header>

      <div className="library-toolbar library-toolbar-wide">
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
          onChange={(event) => setUniverseId(event.target.value)}
          aria-label={t("filterWorld")}
        >
          <option value="all">{t("allWorlds")}</option>
          {workspace.universes.map((universe) => (
            <option key={universe.id} value={universe.id}>
              {displayText(universe.name, locale)}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as WorkStatus | "all")}
          aria-label={t("status")}
        >
          <option value="all">{t("all")}</option>
          {workStatuses.map((value) => (
            <option key={value} value={value}>
              {statusLabels[locale][value]}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as SortMode)}
          aria-label={t("sortUpdated")}
        >
          <option value="updated">{t("sortUpdated")}</option>
          <option value="words">{t("sortWords")}</option>
          <option value="title">{t("sortTitle")}</option>
        </Select>
        <span className="library-result-count">
          {formatNumber(works.length, locale)} {t("novels")}
        </span>
      </div>

      {works.length ? (
        <div className="story-card-grid library-story-grid">
          {works.map((work) => {
            const universe = workspace.universes.find(
              (item) => item.id === work.universeId,
            );
            const words = workWords(work);
            return (
              <button
                className="story-card"
                key={work.id}
                onClick={() => onOpenWork(work.id)}
              >
                <Cover title={displayText(work.title, locale)} accent={work.coverColor} />
                <span className="story-card-copy">
                  <span className="eyebrow">
                    {universe ? displayText(universe.name, locale) : work.genre || t("novel")}
                  </span>
                  <h3>{displayText(work.title, locale)}</h3>
                  <p>{displayText(work.logline, locale)}</p>
                  <span className="story-meta">
                    <Badge tone={work.status === "complete" ? "green" : "neutral"}>
                      {statusLabels[locale][work.status]}
                    </Badge>
                    <small>
                      {work.chapters.length} {t("chapters")} ·{" "}
                      {formatNumber(words, locale)} {t("words")}
                    </small>
                  </span>
                  <ProgressBar value={words} max={work.targetWords} color={work.coverColor} />
                  <span className="library-card-foot">
                    <span>{work.genre || t("novel")}</span>
                    <span>{formatDate(work.updatedAt, locale)}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="book"
          title={t("noWorks")}
          action={
            <Button variant="primary" icon="plus" onClick={onNewNovel}>
              {t("writeNovel")}
            </Button>
          }
        >
          {t("noWorksLead")}
        </EmptyState>
      )}
    </div>
  );
}
