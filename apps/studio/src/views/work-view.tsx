import { useEffect, useId, useMemo, useState } from "react";
import { countChapterWords, displayText, workWords } from "../core/factory.ts";
import { evaluateUniverseFoundation } from "../core/foundation-readiness.ts";
import { CHAPTER_LIMITS } from "../core/types.ts";
import type {
  Chapter,
  ChapterStatus,
  StoryWork,
  StudioWorkspace,
  UiLocale,
} from "../core/types.ts";
import {
  formatDate,
  formatNumber,
  loreLabels,
  statusLabels,
  type Translate,
} from "../i18n.ts";
import { BeatsInput } from "../components/beats-input.tsx";
import {
  formatMissingItems,
  FoundationWarningBanner,
} from "../components/foundation-checklist.tsx";
import { Icon } from "../components/icon.tsx";
import { SceneEditor } from "../components/scene-editor.tsx";
import {
  Badge,
  Button,
  Cover,
  EmptyState,
  Field,
  IconButton,
  ProgressBar,
  Select,
  SectionTitle,
  TagList,
  TextArea,
  TextInput,
} from "../components/ui.tsx";

/** A novel works in its manuscript; a game works on its own node board. */
type WorkTab = "manuscript" | "bible" | "nodes";

export function WorkView({
  workspace,
  work,
  locale,
  t,
  onBack,
  onOpenUniverse,
  onOpenFoundation,
  onEditWork,
  onDeleteWork,
  onAddChapter,
  onOpenTimeline,
  onDeleteChapter,
  onChangeChapter,
  nodeBoard,
}: {
  workspace: StudioWorkspace;
  work: StoryWork;
  locale: UiLocale;
  t: Translate;
  onBack: () => void;
  onOpenUniverse: () => void;
  onOpenFoundation?: () => void;
  onEditWork: () => void;
  onDeleteWork: () => void;
  onAddChapter: () => void;
  onOpenTimeline: (chapterId?: string) => void;
  onDeleteChapter: (chapter: Chapter) => void;
  onChangeChapter: (
    chapterId: string,
    change: (chapter: Chapter) => void,
  ) => void;
  /** Built by the app with this work's node-board actions bound. */
  nodeBoard: React.ReactNode;
}) {
  const isGame = work.kind === "game";
  const [tab, setTab] = useState<WorkTab>(isGame ? "nodes" : "manuscript");
  // Chapters render in story order; the stored array follows creation order,
  // which drifts when chapters are added out of sequence.
  const chapters = useMemo(
    () => [...work.chapters].sort((a, b) => a.number - b.number),
    [work.chapters],
  );
  const [selectedId, setSelectedId] = useState(chapters[0]?.id ?? "");
  const [titleDraft, setTitleDraft] = useState(chapters[0]?.title ?? "");
  const proseEditorId = useId();
  const universe = workspace.universes.find(
    (item) => item.id === work.universeId,
  );
  const characters = workspace.characters.filter((character) =>
    character.universeIds.includes(work.universeId),
  );
  const locations = workspace.locations.filter(
    (location) => location.universeId === work.universeId,
  );
  const lore = workspace.lore.filter(
    (entry) => entry.universeId === work.universeId,
  );
  const selected = chapters.find((chapter) => chapter.id === selectedId);
  const words = workWords(work);
  const foundationReport = useMemo(
    () => evaluateUniverseFoundation(workspace, work.universeId),
    [workspace, work.universeId],
  );

  useEffect(() => {
    if (!chapters.some((chapter) => chapter.id === selectedId))
      setSelectedId(chapters[0]?.id ?? "");
  }, [selectedId, chapters]);

  useEffect(() => {
    setTitleDraft(selected?.title ?? "");
  }, [selected?.title]);

  const commitTitle = () => {
    if (!selected) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(selected.title);
      return;
    }
    setTitleDraft(trimmed);
    if (trimmed !== selected.title) {
      onChangeChapter(selected.id, (chapter) => {
        chapter.title = trimmed;
      });
    }
  };

  const chapterCast = useMemo(
    () => new Set(chapters.flatMap((chapter) => chapter.characterIds)),
    [chapters],
  );

  return (
    <div className="view work-view">
      <button type="button" className="back-link" onClick={onBack}>
        <Icon name="arrowLeft" size={16} />
        {universe ? displayText(universe.name, locale) : t("dashboard")}
      </button>
      <header className="work-hero">
        <Cover
          title={displayText(work.title, locale)}
          accent={work.coverColor}
          size="large"
        />
        <div className="work-hero-copy">
          <button type="button" className="world-link" onClick={onOpenUniverse}>
            <span style={{ background: universe?.accent ?? work.coverColor }} />
            {universe ? displayText(universe.name, locale) : t("storyWorld")}
            <Icon name="external" size={13} />
          </button>
          <h1>{displayText(work.title, locale)}</h1>
          <p>{displayText(work.logline, locale)}</p>
          <div className="work-meta">
            <Badge tone={work.status === "complete" ? "green" : "neutral"}>
              {statusLabels[locale][work.status]}
            </Badge>
            {isGame ? (
              <span>{t("game")}</span>
            ) : (
              <span>
                {chapters.length} {t("chapters")}
              </span>
            )}
            <span>
              {formatNumber(words, locale)} {t("words")}
            </span>
            <span>{formatDate(work.updatedAt, locale)}</span>
          </div>
          <ProgressBar
            value={words}
            max={work.targetWords}
            color={work.coverColor}
          />
          <div className="work-hero-actions">
            <Button variant="ghost" icon="edit" onClick={onEditWork}>
              {t("edit")}
            </Button>
            <Button variant="danger" icon="trash" onClick={onDeleteWork}>
              {isGame ? t("deleteWork") : t("deleteNovel")}
            </Button>
          </div>
        </div>
        <div className="work-hero-aside">
          <span className="eyebrow">{t("progress")}</span>
          <strong>
            {Math.round((words / Math.max(1, work.targetWords)) * 100)}%
          </strong>
          <small>
            {formatNumber(work.targetWords, locale)} {t("words")}
          </small>
        </div>
      </header>

      <FoundationWarningBanner
        report={foundationReport}
        bypass={work.foundationBypass}
        locale={locale}
        t={t}
        mode="work"
        onOpenFoundation={onOpenFoundation ?? onOpenUniverse}
      />

      <nav className="tab-bar">
        {isGame ? (
          <button
            type="button"
            className={`tab-button ${tab === "nodes" ? "active" : ""}`}
            onClick={() => setTab("nodes")}
          >
            {t("nodeBoard")}
          </button>
        ) : (
          <button
            type="button"
            className={`tab-button ${tab === "manuscript" ? "active" : ""}`}
            onClick={() => setTab("manuscript")}
          >
            {t("manuscript")}
            <span>{chapters.length}</span>
          </button>
        )}
        <button
          type="button"
          className={`tab-button ${tab === "bible" ? "active" : ""}`}
          onClick={() => setTab("bible")}
        >
          {t("storyBible")}
          <span>{characters.length}</span>
        </button>
      </nav>

      {tab === "manuscript" ? (
        <div className="manuscript-layout">
          <aside className="chapter-list-panel">
            <div className="chapter-list-head">
              <span className="eyebrow">CHAPTERS / 章节</span>
              <IconButton
                label={t("addChapterTitle")}
                icon="plus"
                onClick={onAddChapter}
              />
            </div>
            <div className="chapter-list">
              {chapters.map((chapter) => (
                <button
                  type="button"
                  key={chapter.id}
                  className={`chapter-list-item ${selectedId === chapter.id ? "active" : ""}`}
                  onClick={() => setSelectedId(chapter.id)}
                >
                  <span className="chapter-number">
                    {String(chapter.number).padStart(2, "0")}
                  </span>
                  <span className="chapter-list-copy">
                    <strong>{chapter.title}</strong>
                    <small>
                      {statusLabels[locale][chapter.status]} ·{" "}
                      {formatNumber(countChapterWords(chapter), locale)}{" "}
                      {t("words")}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {!chapters.length ? (
              <div className="chapter-list-empty">
                <p>{t("noChapters")}</p>
                <Button variant="primary" icon="plus" onClick={onAddChapter}>
                  {t("createFirstChapter")}
                </Button>
              </div>
            ) : null}
            <div className="autosave-note">
              <Icon name="check" size={14} />
              {t("autosaveNote")}
            </div>
          </aside>

          {selected ? (
            <section className="chapter-editor">
              <div className="chapter-editor-head">
                <div className="chapter-title-edit">
                  <span className="chapter-kicker">
                    {t("chapterLabel", { n: selected.number })}
                    {selected.foundationBypass ? (
                      <Badge tone="amber">
                        {t("foundationBypassRecordedChapter", {
                          missing: formatMissingItems(
                            selected.foundationBypass.missingItems,
                            t,
                          ),
                        })}
                      </Badge>
                    ) : null}
                  </span>
                  <input
                    className="chapter-title-input"
                    value={titleDraft}
                    maxLength={CHAPTER_LIMITS.title}
                    aria-label={t("chapterTitle")}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={commitTitle}
                  />
                  <input
                    className="chapter-subtitle-input"
                    value={selected.titleEn}
                    maxLength={CHAPTER_LIMITS.title}
                    placeholder={t("titleEn")}
                    aria-label={t("titleEn")}
                    onChange={(event) =>
                      onChangeChapter(selected.id, (chapter) => {
                        chapter.titleEn = event.target.value;
                      })
                    }
                  />
                </div>
                <div className="chapter-editor-tools">
                  <IconButton
                    label={t("timeline")}
                    icon="timeline"
                    onClick={() => onOpenTimeline(selected.id)}
                  />
                  <Select
                    value={selected.status}
                    aria-label={t("chapterStatus")}
                    onChange={(event) =>
                      onChangeChapter(selected.id, (chapter) => {
                        chapter.status = event.target.value as ChapterStatus;
                      })
                    }
                  >
                    {(
                      Object.keys(statusLabels[locale]) as Array<
                        keyof (typeof statusLabels)["en"]
                      >
                    )
                      .filter((key) =>
                        [
                          "idea",
                          "outline",
                          "draft",
                          "revised",
                          "approved",
                        ].includes(key),
                      )
                      .map((key) => (
                        <option key={key} value={key}>
                          {statusLabels[locale][key]}
                        </option>
                      ))}
                  </Select>
                  <IconButton
                    label={t("delete")}
                    icon="trash"
                    onClick={() => onDeleteChapter(selected)}
                  />
                </div>
              </div>

              <div className="chapter-split">
                <div className="chapter-prose-column">
                  <label className="prose-editor-label" htmlFor={proseEditorId}>
                    <span>{t("chapterBody")}</span>
                    <small>
                      {formatNumber(countChapterWords(selected), locale)}{" "}
                      {t("words")}
                    </small>
                  </label>
                  <textarea
                    id={proseEditorId}
                    className="prose-editor"
                    value={selected.content}
                    maxLength={CHAPTER_LIMITS.content}
                    placeholder={t("chapterBody")}
                    onChange={(event) =>
                      onChangeChapter(selected.id, (chapter) => {
                        chapter.content = event.target.value;
                      })
                    }
                  />
                </div>
                <aside className="chapter-side-panel">
                  <Field label={t("chapterSummary")}>
                    <TextArea
                      rows={5}
                      maxLength={CHAPTER_LIMITS.summary}
                      value={selected.summary}
                      onChange={(event) =>
                        onChangeChapter(selected.id, (chapter) => {
                          chapter.summary = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label={t("chapterOutline")}>
                    <TextArea
                      rows={7}
                      maxLength={CHAPTER_LIMITS.outline}
                      value={selected.outline}
                      onChange={(event) =>
                        onChangeChapter(selected.id, (chapter) => {
                          chapter.outline = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label={t("beats")} hint={t("beatsHint")}>
                    <BeatsInput
                      key={selected.id}
                      rows={5}
                      value={selected.beats}
                      onChange={(beats) =>
                        onChangeChapter(selected.id, (chapter) => {
                          chapter.beats = beats;
                        })
                      }
                    />
                  </Field>
                  <Field label={t("chapterPov")}>
                    <TextInput
                      value={selected.pov}
                      maxLength={CHAPTER_LIMITS.pov}
                      onChange={(event) =>
                        onChangeChapter(selected.id, (chapter) => {
                          chapter.pov = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label={t("sceneLocation")}>
                    <Select
                      value={selected.locationId ?? ""}
                      onChange={(event) =>
                        onChangeChapter(selected.id, (chapter) => {
                          chapter.locationId = event.target.value || undefined;
                        })
                      }
                    >
                      <option value="">—</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {displayText(location.name, locale)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("sceneCast")} group>
                    <div className="cast-check-list">
                      {characters.map((character) => (
                        <label key={character.id} className="cast-check">
                          <input
                            type="checkbox"
                            checked={selected.characterIds.includes(
                              character.id,
                            )}
                            onChange={(event) =>
                              onChangeChapter(selected.id, (chapter) => {
                                chapter.characterIds = event.target.checked
                                  ? [...chapter.characterIds, character.id]
                                  : chapter.characterIds.filter(
                                      (id) => id !== character.id,
                                    );
                              })
                            }
                          />
                          <span
                            className="avatar avatar-tiny"
                            style={{ background: character.color }}
                          >
                            {displayText(character.name, locale).slice(0, 1)}
                          </span>
                          {displayText(character.name, locale)}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label={t("adaptationNotes")}>
                    <TextArea
                      rows={5}
                      maxLength={CHAPTER_LIMITS.adaptationNotes}
                      value={selected.adaptationNotes}
                      onChange={(event) =>
                        onChangeChapter(selected.id, (chapter) => {
                          chapter.adaptationNotes = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <SceneEditor
                    chapter={selected}
                    characters={characters}
                    locations={locations}
                    locale={locale}
                    t={t}
                    onChange={(change) => onChangeChapter(selected.id, change)}
                  />
                </aside>
              </div>
            </section>
          ) : (
            <EmptyState
              icon="book"
              title={t("chapterEmpty")}
              action={
                <Button variant="primary" icon="plus" onClick={onAddChapter}>
                  {t("addChapterTitle")}
                </Button>
              }
            >
              {t("noChaptersLead")}
            </EmptyState>
          )}
        </div>
      ) : null}

      {tab === "bible" ? (
        <div className="bible-layout">
          <section className="prose-card">
            <span className="eyebrow">SYNOPSIS / 梗概</span>
            <h2>{displayText(work.title, locale)}</h2>
            <p>{work.synopsis || displayText(work.logline, locale)}</p>
            <TagList
              values={[...work.themes, work.genre].filter(Boolean)}
              max={8}
            />
          </section>
          <section>
            <SectionTitle title={t("castAnchors")}>
              <Button variant="ghost" onClick={onOpenUniverse}>
                {t("openWorld")}
              </Button>
            </SectionTitle>
            <div className="bible-cast-grid">
              {characters.map((character) => (
                <article
                  className="bible-cast-card"
                  key={character.id}
                  style={{ "--cast": character.color } as React.CSSProperties}
                >
                  <span
                    className="avatar avatar-large"
                    style={{ background: character.color }}
                  >
                    {displayText(character.name, locale).slice(0, 1)}
                  </span>
                  <div>
                    <h3>{displayText(character.name, locale)}</h3>
                    <p>{displayText(character.role, locale)}</p>
                    <small>
                      {chapterCast.has(character.id)
                        ? t("castUsed")
                        : t("worldDetails")}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section>
            <SectionTitle eyebrow="RULES / 规则" title={t("worldRules")} />
            <div className="bible-rules">
              {lore.map((entry) => (
                <article key={entry.id}>
                  <span className={`rule-number ${entry.category}`}>
                    {loreLabels[locale][entry.category]}
                  </span>
                  <div>
                    <h3>{displayText(entry.title, locale)}</h3>
                    <p>{entry.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "nodes" ? nodeBoard : null}
    </div>
  );
}
