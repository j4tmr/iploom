import { useEffect, useMemo, useState } from "react";
import { buildArcReelBundle } from "../core/arcreel.ts";
import { countChapterWords, displayText, workWords } from "../core/factory.ts";
import { CHAPTER_LIMITS } from "../core/types.ts";
import type {
  ArcReelBundle,
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
import { bridge } from "../platform.ts";
import { Icon } from "../components/icon.tsx";
import { SceneEditor } from "../components/scene-editor.tsx";
import { useToast } from "../components/use-toast.ts";
import {
  Badge,
  Button,
  Cover,
  EmptyState,
  Field,
  FieldGrid,
  IconButton,
  ProgressBar,
  Select,
  SectionTitle,
  TagList,
  TextArea,
  TextInput,
  Toast,
} from "../components/ui.tsx";

type WorkTab = "manuscript" | "bible" | "adaptation";

export function WorkView({
  workspace,
  work,
  locale,
  t,
  onBack,
  onOpenUniverse,
  onEditWork,
  onDeleteWork,
  onAddChapter,
  onOpenTimeline,
  onDeleteChapter,
  onChangeChapter,
  onRecordExport,
}: {
  workspace: StudioWorkspace;
  work: StoryWork;
  locale: UiLocale;
  t: Translate;
  onBack: () => void;
  onOpenUniverse: () => void;
  onEditWork: () => void;
  onDeleteWork: () => void;
  onAddChapter: () => void;
  onOpenTimeline: (chapterId?: string) => void;
  onDeleteChapter: (chapter: Chapter) => void;
  onChangeChapter: (chapterId: string, change: (chapter: Chapter) => void) => void;
  onRecordExport: (
    bundle: ArcReelBundle,
    directory: string,
    files: number,
    bytes: number,
  ) => void;
}) {
  const [tab, setTab] = useState<WorkTab>("manuscript");
  const [selectedId, setSelectedId] = useState(
    work.chapters[0]?.id ?? "",
  );
  const [titleDraft, setTitleDraft] = useState(
    work.chapters[0]?.title ?? "",
  );
  const universe = workspace.universes.find((item) => item.id === work.universeId);
  const characters = workspace.characters.filter((character) =>
    character.universeIds.includes(work.universeId),
  );
  const locations = workspace.locations.filter(
    (location) => location.universeId === work.universeId,
  );
  const lore = workspace.lore.filter((entry) => entry.universeId === work.universeId);
  const selected = work.chapters.find((chapter) => chapter.id === selectedId);
  const words = workWords(work);

  useEffect(() => {
    if (!work.chapters.some((chapter) => chapter.id === selectedId))
      setSelectedId(work.chapters[0]?.id ?? "");
  }, [selectedId, work.chapters]);

  useEffect(() => {
    setTitleDraft(selected?.title ?? "");
  }, [selected?.id, selected?.title]);

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
    () =>
      new Set(
        work.chapters.flatMap((chapter) => chapter.characterIds),
      ),
    [work.chapters],
  );

  return (
    <div className="view work-view">
      <button className="back-link" onClick={onBack}>
        <Icon name="arrowLeft" size={16} />
        {universe ? displayText(universe.name, locale) : t("dashboard")}
      </button>
      <header className="work-hero">
        <Cover title={displayText(work.title, locale)} accent={work.coverColor} size="large" />
        <div className="work-hero-copy">
          <button className="world-link" onClick={onOpenUniverse}>
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
            <span>{work.chapters.length} {t("chapters")}</span>
            <span>{formatNumber(words, locale)} {t("words")}</span>
            <span>{formatDate(work.updatedAt, locale)}</span>
          </div>
          <ProgressBar value={words} max={work.targetWords} color={work.coverColor} />
          <div className="work-hero-actions">
            <Button variant="ghost" icon="edit" onClick={onEditWork}>{t("edit")}</Button>
            <Button variant="danger" icon="trash" onClick={onDeleteWork}>{t("deleteNovel")}</Button>
          </div>
        </div>
        <div className="work-hero-aside">
          <span className="eyebrow">{t("progress")}</span>
          <strong>{Math.round((words / Math.max(1, work.targetWords)) * 100)}%</strong>
          <small>{formatNumber(work.targetWords, locale)} {t("words")}</small>
          <Button icon="package" onClick={() => setTab("adaptation")}>{t("adaptation")}</Button>
        </div>
      </header>

      <nav className="tab-bar">
        <button className={`tab-button ${tab === "manuscript" ? "active" : ""}`} onClick={() => setTab("manuscript")}>
          {t("manuscript")}<span>{work.chapters.length}</span>
        </button>
        <button className={`tab-button ${tab === "bible" ? "active" : ""}`} onClick={() => setTab("bible")}>
          {t("storyBible")}<span>{characters.length}</span>
        </button>
        <button className={`tab-button ${tab === "adaptation" ? "active" : ""}`} onClick={() => setTab("adaptation")}>
          {t("adaptation")}<span>3D</span>
        </button>
      </nav>

      {tab === "manuscript" ? (
        <div className="manuscript-layout">
          <aside className="chapter-list-panel">
            <div className="chapter-list-head">
              <span className="eyebrow">CHAPTERS</span>
              <IconButton label={t("addChapterTitle")} icon="plus" onClick={onAddChapter} />
            </div>
            <div className="chapter-list">
              {work.chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  className={`chapter-list-item ${selectedId === chapter.id ? "active" : ""}`}
                  onClick={() => setSelectedId(chapter.id)}
                >
                  <span className="chapter-number">{String(chapter.number).padStart(2, "0")}</span>
                  <span className="chapter-list-copy">
                    <strong>{chapter.title}</strong>
                    <small>{statusLabels[locale][chapter.status]} · {formatNumber(countChapterWords(chapter), locale)} {t("words")}</small>
                  </span>
                </button>
              ))}
            </div>
            {!work.chapters.length ? (
              <div className="chapter-list-empty">
                <p>{t("noChapters")}</p>
                <Button variant="primary" icon="plus" onClick={onAddChapter}>{t("createFirstChapter")}</Button>
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
                    {(Object.keys(statusLabels[locale]) as Array<keyof (typeof statusLabels)["en"]>)
                      .filter((key) => ["idea", "outline", "draft", "revised", "approved"].includes(key))
                      .map((key) => (
                        <option key={key} value={key}>{statusLabels[locale][key]}</option>
                      ))}
                  </Select>
                  <IconButton label={t("delete")} icon="trash" onClick={() => onDeleteChapter(selected)} />
                </div>
              </div>

              <div className="chapter-split">
                <div className="chapter-prose-column">
                  <label className="prose-editor-label">
                    <span>{t("chapterBody")}</span>
                    <small>{formatNumber(countChapterWords(selected), locale)} {t("words")}</small>
                  </label>
                  <textarea
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
                    <TextArea
                      rows={5}
                      value={selected.beats.join("\n")}
                      onChange={(event) =>
                        onChangeChapter(selected.id, (chapter) => {
                          chapter.beats = event.target.value
                            .split("\n")
                            .map((item) => item.trim().slice(0, CHAPTER_LIMITS.beatLength))
                            .filter(Boolean)
                            .slice(0, CHAPTER_LIMITS.beats);
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
                  <Field label={t("sceneCast")}>
                    <div className="cast-check-list">
                      {characters.map((character) => (
                        <label key={character.id} className="cast-check">
                          <input
                            type="checkbox"
                            checked={selected.characterIds.includes(character.id)}
                            onChange={(event) =>
                              onChangeChapter(selected.id, (chapter) => {
                                chapter.characterIds = event.target.checked
                                  ? [...chapter.characterIds, character.id]
                                  : chapter.characterIds.filter((id) => id !== character.id);
                              })
                            }
                          />
                          <span className="avatar avatar-tiny" style={{ background: character.color }}>
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
                  <SceneEditor chapter={selected} characters={characters} locations={locations} locale={locale} onChange={(change) => onChangeChapter(selected.id, change)} />
                </aside>
              </div>
            </section>
          ) : (
            <EmptyState
              icon="book"
              title={t("chapterEmpty")}
              action={<Button variant="primary" icon="plus" onClick={onAddChapter}>{t("addChapterTitle")}</Button>}
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
            <TagList values={[...work.themes, work.genre].filter(Boolean)} max={8} />
          </section>
          <section>
            <SectionTitle title={t("castAnchors")}>
              <Button variant="ghost" onClick={onOpenUniverse}>{t("openWorld")}</Button>
            </SectionTitle>
            <div className="bible-cast-grid">
              {characters.map((character) => (
                <article className="bible-cast-card" key={character.id} style={{ "--cast": character.color } as React.CSSProperties}>
                  <span className="avatar avatar-large" style={{ background: character.color }}>
                    {displayText(character.name, locale).slice(0, 1)}
                  </span>
                  <div>
                    <h3>{displayText(character.name, locale)}</h3>
                    <p>{displayText(character.role, locale)}</p>
                    <small>{chapterCast.has(character.id) ? t("castUsed") : t("worldDetails")}</small>
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
                  <span className={`rule-number ${entry.category}`}>{loreLabels[locale][entry.category]}</span>
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

      {tab === "adaptation" ? (
        <AdaptationPanel
          workspace={workspace}
          work={work}
          locale={locale}
          t={t}
          onRecordExport={onRecordExport}
        />
      ) : null}
    </div>
  );
}

function AdaptationPanel({
  workspace,
  work,
  locale,
  t,
  onRecordExport,
}: {
  workspace: StudioWorkspace;
  work: StoryWork;
  locale: UiLocale;
  t: Translate;
  onRecordExport: (bundle: ArcReelBundle, directory: string, files: number, bytes: number) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    work.chapters.map((chapter) => chapter.id),
  );
  const [approvedOnly, setApprovedOnly] = useState(
    workspace.settings.exportApprovedOnly,
  );
  const [bundle, setBundle] = useState<ArcReelBundle | null>(null);
  const [bundleSignature, setBundleSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, notify } = useToast();
  const [error, setError] = useState<string | null>(null);
  const currentSignature = JSON.stringify({
    workspaceRevision: workspace.revision,
    chapters: [...selected].sort(),
    approvedOnly,
    locale,
    aspectRatio: workspace.settings.defaultAspectRatio,
  });
  const stale = Boolean(bundle) && bundleSignature !== currentSignature;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await buildArcReelBundle(workspace, {
        workId: work.id,
        chapterIds: selected,
        locale,
        aspectRatio: workspace.settings.defaultAspectRatio,
        approvedOnly,
      });
      setBundle(next);
      setBundleSignature(currentSignature);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const exportBundle = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      const written = await bridge.exportArcReel(bundle);
      if (written.canceled) {
        notify(t("exportCanceled"));
        return;
      }
      onRecordExport(bundle, written.directory, written.files, written.bytes);
      notify(`${t("exportSuccess")} · ${written.directory}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adaptation-layout">
      <section className="adaptation-controls">
        <span className="eyebrow">ARCREEL / 3D COMIC DRAMA</span>
        <h2>{t("exportCenter")}</h2>
        <p>{t("exportLead")}</p>
        <div className="adaptation-style-card">
          <span className="style-orb">3D</span>
          <div>
            <strong>{t("style3d")}</strong>
            <small>9:16 · character model sheets · negative prompts · scene drafts</small>
          </div>
        </div>
        <div className="chapter-select-head">
          <strong>{t("chapterSelection")}</strong>
          <span>{t("selected", { n: selected.length })}</span>
        </div>
        <div className="chapter-select-list">
          {work.chapters.map((chapter) => (
            <label className="chapter-select-row" key={chapter.id}>
              <input
                type="checkbox"
                checked={selected.includes(chapter.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, chapter.id]
                      : current.filter((id) => id !== chapter.id),
                  )
                }
              />
              <span className="chapter-number">{String(chapter.number).padStart(2, "0")}</span>
              <span>
                <strong>{chapter.title}</strong>
                <small>{statusLabels[locale][chapter.status]} · {formatNumber(countChapterWords(chapter), locale)} {t("words")}</small>
              </span>
              <Badge tone={chapter.status === "approved" ? "green" : "neutral"}>
                {statusLabels[locale][chapter.status]}
              </Badge>
            </label>
          ))}
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={approvedOnly} onChange={(event) => setApprovedOnly(event.target.checked)} />
          <span><strong>{t("approvedOnly")}</strong></span>
        </label>
        <div className="adaptation-buttons">
          <Button variant="primary" icon="sparkles" disabled={busy || !selected.length} onClick={() => void generate()}>
            {busy ? t("exporting") : bundle ? t("regenerate") : t("generatePreview")}
          </Button>
          <Button
            icon="download"
            disabled={!bundle || busy || stale}
            title={stale ? t("regenerateRequired") : undefined}
            onClick={() => void exportBundle()}
          >
            {t("exportBundle")}
          </Button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="adaptation-preview">
        {!bundle ? (
          <EmptyState icon="package" title={t("noAdaptationPreview")}>
            {t("draftNote")}
          </EmptyState>
        ) : (
          <>
            <div className="bundle-summary">
              <div><strong>{bundle.chapters.length}</strong><span>{t("sourceChapters")}</span></div>
              <div><strong>{formatNumber(bundle.totalWords, locale)}</strong><span>{t("statWords")}</span></div>
              <div><strong>{bundle.totalScenes}</strong><span>{t("totalScenes")}</span></div>
              <div><strong>{bundle.totalShots}</strong><span>{t("totalShots")}</span></div>
            </div>
            <div className="manifest-hash">
              <span>{t("manifestHash")}</span>
              <code>{bundle.manifestSha256}</code>
            </div>
            {stale ? (
              <div className="warning-box stale-bundle-warning">
                <div className="warning-box-head">
                  <Icon name="sparkles" size={17} />
                  <strong>{t("bundleOutdated")}</strong>
                </div>
                <p>{t("regenerateRequired")}</p>
              </div>
            ) : null}
            <div className="warning-box">
              <div className="warning-box-head">
                <Icon name="sparkles" size={17} />
                <strong>{t("bundleWarnings")}</strong>
              </div>
              {bundle.warnings.length ? (
                <ul>{bundle.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              ) : <p>{t("noWarnings")}</p>}
            </div>
            <div className="file-tree">
              <div className="file-tree-head">
                <strong>{t("files")}</strong>
                <span>{bundle.files.length}</span>
              </div>
              {bundle.files.map((file) => (
                <div className="file-row" key={file.path}>
                  <Icon name={file.mediaType === "application/json" ? "layers" : "file"} size={16} />
                  <code>{file.path}</code>
                  <span>{new TextEncoder().encode(file.content).byteLength.toLocaleString()} B</span>
                </div>
              ))}
            </div>
            <div className="preview-chapters">
              {bundle.chapters.map((chapter) => (
                <div key={chapter.chapterId}>
                  <span className="chapter-number">{String(chapter.number).padStart(2, "0")}</span>
                  <strong>{chapter.title}</strong>
                  <small>{chapter.sceneCount} {t("scenes")} · {chapter.shotCount} {t("shots")}</small>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}
