import { useState } from "react";
import { createId, displayText } from "../core/factory.ts";
import { STANDARD_KINDS, standardKindLabel, standardRefsFor } from "../core/standards.ts";
import { CHAPTER_LIMITS, MAX_LOCALIZED_LENGTH } from "../core/types.ts";
import type {
  Chapter,
  Character,
  LoreCategory,
  Relationship,
  RelationshipStatus,
  RelationshipType,
  StandardKind,
  StoryFaction,
  StoryLocation,
  StoryUniverse,
  StoryWork,
  StudioWorkspace,
  UiLocale,
  WorkflowTask,
  WorkflowTaskKind,
  WorkflowTaskStatus,
  WorkspaceStandard,
  WorkStatus,
} from "../core/types.ts";
import { taskCycleRiskIds } from "../core/workflow.ts";
import {
  loreLabels,
  relationshipLabels,
  relationStatusLabels,
  statusLabels,
  type Translate,
} from "../i18n.ts";
import { Button, Field, FieldGrid, Modal, Select, TextArea, TextInput, splitTags } from "./ui.tsx";

type ModalBase = {
  open: boolean;
  onClose: () => void;
  t: Translate;
  locale: UiLocale;
};

export function CharacterModal({
  open,
  onClose,
  t,
  locale,
  workspace,
  initial,
  defaultUniverseId,
  onSave,
}: ModalBase & {
  workspace: StudioWorkspace;
  initial?: Character;
  defaultUniverseId?: string;
  onSave: (character: Character) => boolean;
}) {
  const [nameZh, setNameZh] = useState(initial?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(initial?.name.en ?? "");
  const [roleZh, setRoleZh] = useState(initial?.role.zh ?? "");
  const [roleEn, setRoleEn] = useState(initial?.role.en ?? "");
  const [summaryZh, setSummaryZh] = useState(initial?.summary.zh ?? "");
  const [summaryEn, setSummaryEn] = useState(initial?.summary.en ?? "");
  const [appearance, setAppearance] = useState(initial?.appearance ?? "");
  const [visualPrompt, setVisualPrompt] = useState(initial?.visualPrompt ?? "");
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [motivation, setMotivation] = useState(initial?.motivation ?? "");
  const [flaw, setFlaw] = useState(initial?.flaw ?? "");
  const [secret, setSecret] = useState(initial?.secret ?? "");
  const [voice, setVoice] = useState(initial?.voice ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [color, setColor] = useState(initial?.color ?? "#2f7567");
  const [reusable, setReusable] = useState(initial?.reusable ?? false);
  const [universeIds, setUniverseIds] = useState<string[]>(
    initial?.universeIds ?? (defaultUniverseId ? [defaultUniverseId] : []),
  );
  const canSave = (nameZh.trim() || nameEn.trim()) && universeIds.length > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t("editCharacterTitle") : t("createCharacterTitle")}
      description={t("characterLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("char"),
                universeIds,
                name: { zh: nameZh.trim(), en: nameEn.trim() },
                role: { zh: roleZh.trim(), en: roleEn.trim() },
                summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                appearance,
                visualPrompt,
                personality,
                motivation,
                flaw,
                secret,
                voice,
                tags: splitTags(tags),
                color,
                reusable,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("nameZh")}>
          <TextInput value={nameZh} onChange={(event) => setNameZh(event.target.value)} autoFocus />
        </Field>
        <Field label={t("nameEn")}>
          <TextInput value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        <Field label={t("roleZh")}>
          <TextInput value={roleZh} onChange={(event) => setRoleZh(event.target.value)} />
        </Field>
        <Field label={t("roleEn")}>
          <TextInput value={roleEn} onChange={(event) => setRoleEn(event.target.value)} />
        </Field>
        <Field label={t("summaryZh")} wide>
          <TextArea rows={3} value={summaryZh} onChange={(event) => setSummaryZh(event.target.value)} />
        </Field>
        <Field label={t("summaryEn")} wide>
          <TextArea rows={3} value={summaryEn} onChange={(event) => setSummaryEn(event.target.value)} />
        </Field>
        <Field label={t("appearance")} wide>
          <TextArea rows={3} value={appearance} onChange={(event) => setAppearance(event.target.value)} />
        </Field>
        <Field label={t("visualPrompt")} hint={t("style3d")} wide>
          <TextArea rows={4} value={visualPrompt} onChange={(event) => setVisualPrompt(event.target.value)} />
        </Field>
        <Field label={t("personality")}>
          <TextArea rows={3} value={personality} onChange={(event) => setPersonality(event.target.value)} />
        </Field>
        <Field label={t("motivation")}>
          <TextArea rows={3} value={motivation} onChange={(event) => setMotivation(event.target.value)} />
        </Field>
        <Field label={t("flaw")}>
          <TextArea rows={3} value={flaw} onChange={(event) => setFlaw(event.target.value)} />
        </Field>
        <Field label={t("secret")}>
          <TextArea rows={3} value={secret} onChange={(event) => setSecret(event.target.value)} />
        </Field>
        <Field label={t("voice")}>
          <TextArea rows={3} value={voice} onChange={(event) => setVoice(event.target.value)} />
        </Field>
        <Field label={t("tags")} hint={t("tagPlaceholder")}>
          <TextInput value={tags} onChange={(event) => setTags(event.target.value)} />
        </Field>
        <Field label={t("color")}>
          <input className="color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </Field>
        <Field label={t("linkedWorlds")} wide>
          <div className="check-grid">
            {workspace.universes.map((universe) => (
              <label className="check-card" key={universe.id}>
                <input
                  type="checkbox"
                  checked={universeIds.includes(universe.id)}
                  onChange={(event) =>
                    setUniverseIds((current) =>
                      event.target.checked
                        ? [...current, universe.id]
                        : current.filter((id) => id !== universe.id),
                    )
                  }
                />
                <span style={{ background: universe.accent }} />
                {displayText(universe.name, locale)}
              </label>
            ))}
          </div>
        </Field>
        <label className="toggle-row field-wide">
          <input type="checkbox" checked={reusable} onChange={(event) => setReusable(event.target.checked)} />
          <span>
            <strong>{t("reusable")}</strong>
            <small>{t("characterLead")}</small>
          </span>
        </label>
      </FieldGrid>
    </Modal>
  );
}

export function UniverseModal({
  open,
  onClose,
  t,
  initial,
  onSave,
}: ModalBase & {
  initial?: StoryUniverse;
  onSave: (universe: StoryUniverse) => boolean;
}) {
  const [nameZh, setNameZh] = useState(initial?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(initial?.name.en ?? "");
  const [taglineZh, setTaglineZh] = useState(initial?.tagline.zh ?? "");
  const [taglineEn, setTaglineEn] = useState(initial?.tagline.en ?? "");
  const [summaryZh, setSummaryZh] = useState(initial?.summary.zh ?? "");
  const [summaryEn, setSummaryEn] = useState(initial?.summary.en ?? "");
  const [genres, setGenres] = useState((initial?.genres ?? []).join(", "));
  const [themes, setThemes] = useState((initial?.themes ?? []).join(", "));
  const [accent, setAccent] = useState(initial?.accent ?? "#2f7567");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t("editWorldTitle") : t("createWorldTitle")}
      description={t("createWorldLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!nameZh.trim() && !nameEn.trim()}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("uni"),
                name: { zh: nameZh.trim(), en: nameEn.trim() },
                tagline: { zh: taglineZh.trim(), en: taglineEn.trim() },
                summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                genres: splitTags(genres),
                themes: splitTags(themes),
                accent,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("nameZh")}>
          <TextInput autoFocus maxLength={MAX_LOCALIZED_LENGTH} value={nameZh} onChange={(event) => setNameZh(event.target.value)} />
        </Field>
        <Field label={t("nameEn")}>
          <TextInput maxLength={MAX_LOCALIZED_LENGTH} value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        <Field label={t("titleZh")}>
          <TextInput maxLength={MAX_LOCALIZED_LENGTH} value={taglineZh} onChange={(event) => setTaglineZh(event.target.value)} />
        </Field>
        <Field label={t("titleEn")}>
          <TextInput maxLength={MAX_LOCALIZED_LENGTH} value={taglineEn} onChange={(event) => setTaglineEn(event.target.value)} />
        </Field>
        <Field label={t("summaryZh")} wide>
          <TextArea rows={4} maxLength={MAX_LOCALIZED_LENGTH} value={summaryZh} onChange={(event) => setSummaryZh(event.target.value)} />
        </Field>
        <Field label={t("summaryEn")} wide>
          <TextArea rows={4} maxLength={MAX_LOCALIZED_LENGTH} value={summaryEn} onChange={(event) => setSummaryEn(event.target.value)} />
        </Field>
        <Field label={t("genre")} hint={t("tagPlaceholder")}>
          <TextInput value={genres} onChange={(event) => setGenres(event.target.value)} />
        </Field>
        <Field label={t("themes")} hint={t("tagPlaceholder")}>
          <TextInput value={themes} onChange={(event) => setThemes(event.target.value)} />
        </Field>
        <Field label={t("coverColor")}>
          <input className="color-input" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function NovelModal({
  open,
  onClose,
  t,
  locale,
  workspace,
  defaultUniverseId,
  initial,
  onSave,
}: ModalBase & {
  workspace: StudioWorkspace;
  defaultUniverseId?: string;
  initial?: StoryWork;
  onSave: (work: StoryWork) => boolean;
}) {
  const [universeId, setUniverseId] = useState(
    initial?.universeId ?? defaultUniverseId ?? workspace.universes[0]?.id ?? "",
  );
  const [titleZh, setTitleZh] = useState(initial?.title.zh ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [loglineZh, setLoglineZh] = useState(initial?.logline.zh ?? "");
  const [loglineEn, setLoglineEn] = useState(initial?.logline.en ?? "");
  const [synopsis, setSynopsis] = useState(initial?.synopsis ?? "");
  const [genre, setGenre] = useState(initial?.genre ?? "");
  const [themes, setThemes] = useState((initial?.themes ?? []).join(", "));
  const [targetWords, setTargetWords] = useState(
    String(initial?.targetWords ?? 120_000),
  );
  const [status, setStatus] = useState<WorkStatus>(initial?.status ?? "concept");
  const [language, setLanguage] = useState<UiLocale>(
    initial?.language ?? locale,
  );
  const [coverColor, setCoverColor] = useState(initial?.coverColor ?? "#2f7567");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t("editNovelTitle") : t("createNovelTitle")}
      description={t("createNovelLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!universeId || (!titleZh.trim() && !titleEn.trim())}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("work"),
                universeId,
                title: { zh: titleZh.trim(), en: titleEn.trim() },
                logline: { zh: loglineZh.trim(), en: loglineEn.trim() },
                synopsis,
                status,
                language,
                genre,
                themes: splitTags(themes),
                targetWords: Math.max(1, Number(targetWords) || 120_000),
                coverColor,
                chapters: initial?.chapters ?? [],
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("storyWorld")}>
          <Select value={universeId} onChange={(event) => setUniverseId(event.target.value)}>
            {workspace.universes.map((universe) => (
              <option key={universe.id} value={universe.id}>
                {displayText(universe.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("status")}>
          <Select value={status} onChange={(event) => setStatus(event.target.value as WorkStatus)}>
            {(["concept", "outlining", "drafting", "complete", "archived"] as WorkStatus[]).map((value) => (
              <option key={value} value={value}>{statusLabels[locale][value]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("titleZh")}>
          <TextInput autoFocus value={titleZh} onChange={(event) => setTitleZh(event.target.value)} />
        </Field>
        <Field label={t("titleEn")}>
          <TextInput value={titleEn} onChange={(event) => setTitleEn(event.target.value)} />
        </Field>
        <Field label={t("loglineZh")} wide>
          <TextArea rows={2} value={loglineZh} onChange={(event) => setLoglineZh(event.target.value)} />
        </Field>
        <Field label={t("loglineEn")} wide>
          <TextArea rows={2} value={loglineEn} onChange={(event) => setLoglineEn(event.target.value)} />
        </Field>
        <Field label={t("synopsis")} wide>
          <TextArea rows={5} value={synopsis} onChange={(event) => setSynopsis(event.target.value)} />
        </Field>
        <Field label={t("genre")}>
          <TextInput value={genre} onChange={(event) => setGenre(event.target.value)} />
        </Field>
        <Field label={t("themes")} hint={t("tagPlaceholder")}>
          <TextInput value={themes} onChange={(event) => setThemes(event.target.value)} />
        </Field>
        <Field label={t("targetWords")}>
          <TextInput type="number" min={1} value={targetWords} onChange={(event) => setTargetWords(event.target.value)} />
        </Field>
        <Field label={t("language")}>
          <Select value={language} onChange={(event) => setLanguage(event.target.value as UiLocale)}>
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field label={t("coverColor")}>
          <input className="color-input" type="color" value={coverColor} onChange={(event) => setCoverColor(event.target.value)} />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function ChapterModal({
  open,
  onClose,
  t,
  initialNumber,
  existingNumbers,
  onSave,
}: ModalBase & {
  initialNumber: number;
  existingNumbers: number[];
  onSave: (chapter: Chapter) => boolean;
}) {
  const [number, setNumber] = useState(String(initialNumber));
  const [title, setTitle] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [summary, setSummary] = useState("");
  const parsedNumber = Math.max(1, Number(number) || initialNumber);
  const duplicateNumber = existingNumbers.includes(parsedNumber);
  const canSave = Boolean(title.trim()) && !duplicateNumber;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("addChapterTitle")}
      description={t("addChapterLead")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="plus"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: createId("chapter"),
                number: parsedNumber,
                title: title.trim(),
                titleEn: titleEn.trim(),
                status: "idea",
                pov: "",
                summary: summary.trim(),
                outline: "",
                content: "",
                beats: [],
                characterIds: [],
                adaptationNotes: "",
                scenes: [],
                revision: 0,
                createdAt: now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("add")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("chapterNumber")}>
          <TextInput type="number" min={1} value={number} onChange={(event) => setNumber(event.target.value)} />
        </Field>
        {duplicateNumber ? <p className="form-error">{t("duplicateChapterNumber")}</p> : null}
        <div />
        <Field label={t("chapterTitle")}>
          <TextInput
            autoFocus
            maxLength={CHAPTER_LIMITS.title}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t("titleEn")}>
          <TextInput
            maxLength={CHAPTER_LIMITS.title}
            value={titleEn}
            onChange={(event) => setTitleEn(event.target.value)}
          />
        </Field>
        <Field label={t("chapterSummary")} wide>
          <TextArea
            rows={4}
            maxLength={CHAPTER_LIMITS.summary}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function WorkflowTaskModal({
  open,
  onClose,
  t,
  locale,
  workspace,
  initial,
  defaultParentId,
  defaultUniverseId,
  defaultWorkId,
  onSave,
}: ModalBase & {
  workspace: StudioWorkspace;
  initial?: WorkflowTask;
  defaultParentId?: string;
  defaultUniverseId?: string;
  defaultWorkId?: string;
  onSave: (task: WorkflowTask) => boolean;
}) {
  const [titleZh, setTitleZh] = useState(initial?.title.zh ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [briefZh, setBriefZh] = useState(initial?.brief.zh ?? "");
  const [briefEn, setBriefEn] = useState(initial?.brief.en ?? "");
  const [deliverableZh, setDeliverableZh] = useState(
    initial?.deliverable.zh ?? "",
  );
  const [deliverableEn, setDeliverableEn] = useState(
    initial?.deliverable.en ?? "",
  );
  const [kind, setKind] = useState<WorkflowTaskKind>(initial?.kind ?? "novel");
  const [status, setStatus] = useState<WorkflowTaskStatus>(
    initial?.status ?? "queued",
  );
  const [universeId, setUniverseId] = useState(
    initial?.universeId ?? defaultUniverseId ?? "",
  );
  const [workId, setWorkId] = useState(
    initial?.workId ?? defaultWorkId ?? "",
  );
  const [chapterId, setChapterId] = useState(initial?.chapterId ?? "");
  const [parentId, setParentId] = useState(
    initial?.parentId ?? defaultParentId ?? "",
  );
  const [characterIds, setCharacterIds] = useState<string[]>(
    initial?.characterIds ?? [],
  );
  const [dependsOnIds, setDependsOnIds] = useState<string[]>(
    initial?.dependsOnIds ?? [],
  );
  const unavailable = new Set<string>(
    initial ? taskCycleRiskIds(workspace.workflowTasks, initial.id) : [],
  );
  const eligibleParents = workspace.workflowTasks.filter(
    (task) => !unavailable.has(task.id),
  );
  const eligibleDependencies = workspace.workflowTasks.filter(
    (task) => !unavailable.has(task.id),
  );
  const works = universeId
    ? workspace.works.filter((work) => work.universeId === universeId)
    : workspace.works;
  const selectedWork = works.find((work) => work.id === workId);
  const chapters = selectedWork?.chapters ?? [];
  const characters = universeId
    ? workspace.characters.filter((character) =>
        character.universeIds.includes(universeId),
      )
    : workspace.characters;
  const canSave =
    Boolean(titleZh.trim() || titleEn.trim()) &&
    (!chapterId || Boolean(workId));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t("workflowEditTask") : t("workflowNewTask")}
      description={t("workflowTaskLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("task"),
                title: { zh: titleZh.trim(), en: titleEn.trim() },
                brief: { zh: briefZh.trim(), en: briefEn.trim() },
                deliverable: {
                  zh: deliverableZh.trim(),
                  en: deliverableEn.trim(),
                },
                result: initial?.result ?? { zh: "", en: "" },
                kind,
                status,
                universeId: universeId || undefined,
                workId: workId || undefined,
                chapterId: chapterId || undefined,
                parentId: parentId || undefined,
                characterIds,
                dependsOnIds,
                standardRefs:
                  initial &&
                  initial.universeId === (universeId || undefined)
                    ? initial.standardRefs
                    : standardRefsFor(workspace, universeId || undefined),
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("kind")}>
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as WorkflowTaskKind)}
          >
            <option value="world">{t("taskKind_world")}</option>
            <option value="novel">{t("taskKind_novel")}</option>
            <option value="chapter">{t("taskKind_chapter")}</option>
            <option value="character">{t("taskKind_character")}</option>
            <option value="review">{t("taskKind_review")}</option>
            <option value="adaptation">{t("taskKind_adaptation")}</option>
          </Select>
        </Field>
        <Field label={t("status")}>
          <Select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as WorkflowTaskStatus)
            }
          >
            <option value="queued">{t("taskStatus_queued")}</option>
            <option value="active">{t("taskStatus_active")}</option>
            <option value="review">{t("taskStatus_review")}</option>
            <option value="done">{t("taskStatus_done")}</option>
          </Select>
        </Field>
        <Field label={t("titleZh")}>
          <TextInput
            autoFocus
            value={titleZh}
            onChange={(event) => setTitleZh(event.target.value)}
          />
        </Field>
        <Field label={t("titleEn")}>
          <TextInput
            value={titleEn}
            onChange={(event) => setTitleEn(event.target.value)}
          />
        </Field>
        <Field label={t("workflowObjectiveZh")} wide>
          <TextArea
            rows={3}
            value={briefZh}
            onChange={(event) => setBriefZh(event.target.value)}
          />
        </Field>
        <Field label={t("workflowObjectiveEn")} wide>
          <TextArea
            rows={3}
            value={briefEn}
            onChange={(event) => setBriefEn(event.target.value)}
          />
        </Field>
        <Field label={t("workflowDeliverableZh")} wide>
          <TextArea
            rows={2}
            value={deliverableZh}
            onChange={(event) => setDeliverableZh(event.target.value)}
          />
        </Field>
        <Field label={t("workflowDeliverableEn")} wide>
          <TextArea
            rows={2}
            value={deliverableEn}
            onChange={(event) => setDeliverableEn(event.target.value)}
          />
        </Field>
        <Field label={t("universe")}>
          <Select
            value={universeId}
            onChange={(event) => {
              const next = event.target.value;
              setUniverseId(next);
              const selected = workspace.works.find((work) => work.id === workId);
              if (selected && selected.universeId !== next) {
                setWorkId("");
                setChapterId("");
              }
              setCharacterIds((current) =>
                current.filter((id) =>
                  workspace.characters
                    .find((character) => character.id === id)
                    ?.universeIds.includes(next),
                ),
              );
            }}
          >
            <option value="">{t("workflowNoWorld")}</option>
            {workspace.universes.map((universe) => (
              <option key={universe.id} value={universe.id}>
                {displayText(universe.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("novel")}>
          <Select
            value={workId}
            onChange={(event) => {
              setWorkId(event.target.value);
              setChapterId("");
            }}
          >
            <option value="">{t("workflowNoNovel")}</option>
            {works.map((work) => (
              <option key={work.id} value={work.id}>
                {displayText(work.title, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("chapterTitle")}>
          <Select
            value={chapterId}
            disabled={!workId}
            onChange={(event) => setChapterId(event.target.value)}
          >
            <option value="">{t("workflowNoChapter")}</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.number}. {chapter.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("workflowParentTask")}>
          <Select
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">{t("workflowIndependentTask")}</option>
            {eligibleParents.map((task) => (
              <option key={task.id} value={task.id}>
                {displayText(task.title, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("workflowCast")} wide>
          <div className="check-grid">
            {characters.map((character) => (
              <label className="check-card" key={character.id}>
                <input
                  type="checkbox"
                  checked={characterIds.includes(character.id)}
                  onChange={(event) =>
                    setCharacterIds((current) =>
                      event.target.checked
                        ? [...current, character.id]
                        : current.filter((id) => id !== character.id),
                    )
                  }
                />
                <span style={{ background: character.color }} />
                {displayText(character.name, locale)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t("workflowDependencies")} hint={t("workflowDependenciesHint")} wide>
          <div className="check-grid">
            {eligibleDependencies.map((task) => (
              <label className="check-card" key={task.id}>
                <input
                  type="checkbox"
                  checked={dependsOnIds.includes(task.id)}
                  onChange={(event) =>
                    setDependsOnIds((current) =>
                      event.target.checked
                        ? [...current, task.id]
                        : current.filter((id) => id !== task.id),
                    )
                  }
                />
                <span className="task-check-mark" />
                {displayText(task.title, locale)}
              </label>
            ))}
          </div>
        </Field>
      </FieldGrid>
    </Modal>
  );
}


export function RelationshipModal({
  open,
  onClose,
  t,
  locale,
  workspace,
  universeId,
  onSave,
  initial,
}: ModalBase & {
  workspace: StudioWorkspace;
  universeId: string;
  initial?: Relationship;
  onSave: (relationship: Relationship) => boolean;
}) {
  const characters = workspace.characters.filter((character) =>
    character.universeIds.includes(universeId),
  );
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? characters[0]?.id ?? "");
  const [targetId, setTargetId] = useState(initial?.targetId ?? characters[1]?.id ?? "");
  const [type, setType] = useState<RelationshipType>(initial?.type ?? "ally");
  const [labelZh, setLabelZh] = useState(initial?.label.zh ?? "");
  const [labelEn, setLabelEn] = useState(initial?.label.en ?? "");
  const [strength, setStrength] = useState(String(initial?.strength ?? 3));
  const [status, setStatus] = useState<RelationshipStatus>(initial?.status ?? "active");
  const [mutual, setMutual] = useState(initial?.mutual ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t("edit") : t("createRelationshipTitle")}
      description={t("relationshipLead")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="link"
            disabled={!sourceId || !targetId || sourceId === targetId}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("rel"),
                universeId,
                sourceId,
                targetId,
                type,
                label: { zh: labelZh.trim(), en: labelEn.trim() },
                strength: Math.max(1, Math.min(5, Number(strength) || 3)),
                status,
                mutual,
                notes,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {initial ? t("save") : t("add")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("sourceCharacter")}>
          <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>{displayText(character.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("targetCharacter")}>
          <Select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {characters.filter((character) => character.id !== sourceId).map((character) => (
              <option key={character.id} value={character.id}>{displayText(character.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("relationType")}>
          <Select value={type} onChange={(event) => setType(event.target.value as RelationshipType)}>
            {(Object.keys(relationshipLabels[locale]) as RelationshipType[]).map((value) => (
              <option key={value} value={value}>{relationshipLabels[locale][value]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("status")}>
          <Select value={status} onChange={(event) => setStatus(event.target.value as RelationshipStatus)}>
            {(Object.keys(relationStatusLabels[locale]) as RelationshipStatus[]).map((value) => (
              <option key={value} value={value}>{relationStatusLabels[locale][value]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("relationLabel") + " · 中文"}>
          <TextInput value={labelZh} onChange={(event) => setLabelZh(event.target.value)} />
        </Field>
        <Field label={t("relationLabel") + " · English"}>
          <TextInput value={labelEn} onChange={(event) => setLabelEn(event.target.value)} />
        </Field>
        <Field label={t("strength")}>
          <input className="range" type="range" min={1} max={5} value={strength} onChange={(event) => setStrength(event.target.value)} />
        </Field>
        <label className="toggle-row">
          <input type="checkbox" checked={mutual} onChange={(event) => setMutual(event.target.checked)} />
          <span><strong>{t("mutual")}</strong></span>
        </label>
        <Field label={t("notes")} wide>
          <TextArea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function AtlasModal({
  open,
  onClose,
  t,
  locale,
  universeId,
  kind,
  initial,
  onSave,
}: ModalBase & {
  universeId: string;
  kind: "location" | "faction" | "lore";
  initial?: StoryLocation | StoryFaction | { id: string; title: { zh: string; en: string }; body: string; category: LoreCategory; createdAt: string; updatedAt: string };
  onSave: (value: StoryLocation | StoryFaction | {
    id: string;
    universeId: string;
    category: LoreCategory;
    title: { zh: string; en: string };
    body: string;
    createdAt: string;
    updatedAt: string;
  }) => boolean;
}) {
  const isLore = kind === "lore";
  const existingName = initial
    ? "name" in initial
      ? initial.name
      : initial.title
    : { zh: "", en: "" };
  const existingSummary = initial && "summary" in initial ? initial.summary : { zh: "", en: "" };
  const [nameZh, setNameZh] = useState(existingName.zh);
  const [nameEn, setNameEn] = useState(existingName.en);
  const [summaryZh, setSummaryZh] = useState(existingSummary.zh);
  const [summaryEn, setSummaryEn] = useState(existingSummary.en);
  const [atmosphere, setAtmosphere] = useState(initial && "atmosphere" in initial ? initial.atmosphere : "");
  const [visualPrompt, setVisualPrompt] = useState(initial && "visualPrompt" in initial ? initial.visualPrompt : "");
  const [goal, setGoal] = useState(initial && "goal" in initial ? initial.goal : "");
  const [visualMotif, setVisualMotif] = useState(initial && "visualMotif" in initial ? initial.visualMotif : "");
  const [body, setBody] = useState(initial && "body" in initial ? initial.body : "");
  const [category, setCategory] = useState<LoreCategory>(
    initial && "category" in initial ? initial.category : "rule",
  );
  const title =
    isLore
      ? initial ? t("editLoreTitle") : t("addLoreTitle")
      : kind === "location"
        ? initial ? t("editLocationTitle") : t("addLocationTitle")
        : initial ? t("editFactionTitle") : t("addFactionTitle");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!nameZh.trim() && !nameEn.trim()}
            onClick={() => {
              const now = new Date().toISOString();
              const createdAt = initial?.createdAt ?? now;
              let saved = false;
              if (isLore) {
                saved = onSave({
                  id: initial?.id ?? createId("lore"),
                  universeId,
                  category,
                  title: { zh: nameZh.trim(), en: nameEn.trim() },
                  body,
                  createdAt,
                  updatedAt: now,
                });
              } else if (kind === "location") {
                saved = onSave({
                  id: initial?.id ?? createId("loc"),
                  universeId,
                  name: { zh: nameZh.trim(), en: nameEn.trim() },
                  summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                  atmosphere,
                  visualPrompt,
                  createdAt,
                  updatedAt: now,
                });
              } else {
                saved = onSave({
                  id: initial?.id ?? createId("fac"),
                  universeId,
                  name: { zh: nameZh.trim(), en: nameEn.trim() },
                  summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                  goal,
                  visualMotif,
                  createdAt,
                  updatedAt: now,
                });
              }
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={isLore ? t("titleZh") : t("nameZh")}>
          <TextInput autoFocus value={nameZh} onChange={(event) => setNameZh(event.target.value)} />
        </Field>
        <Field label={isLore ? t("titleEn") : t("nameEn")}>
          <TextInput value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        {isLore ? (
          <>
            <Field label={t("loreCategory")}>
              <Select value={category} onChange={(event) => setCategory(event.target.value as LoreCategory)}>
                {(Object.keys(loreLabels[locale]) as LoreCategory[]).map((value) => (
                  <option key={value} value={value}>{loreLabels[locale][value]}</option>
                ))}
              </Select>
            </Field>
            <div />
            <Field label={t("body")} wide>
              <TextArea rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("summaryZh")} wide>
              <TextArea rows={3} value={summaryZh} onChange={(event) => setSummaryZh(event.target.value)} />
            </Field>
            <Field label={t("summaryEn")} wide>
              <TextArea rows={3} value={summaryEn} onChange={(event) => setSummaryEn(event.target.value)} />
            </Field>
            {kind === "location" ? (
              <>
                <Field label={t("atmosphere")} wide>
                  <TextArea rows={3} value={atmosphere} onChange={(event) => setAtmosphere(event.target.value)} />
                </Field>
                <Field label={t("visualPrompt")} wide>
                  <TextArea rows={4} value={visualPrompt} onChange={(event) => setVisualPrompt(event.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t("goal")} wide>
                  <TextArea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} />
                </Field>
                <Field label={t("visualMotif")} wide>
                  <TextArea rows={3} value={visualMotif} onChange={(event) => setVisualMotif(event.target.value)} />
                </Field>
              </>
            )}
          </>
        )}
      </FieldGrid>
    </Modal>
  );
}

export function StandardModal({
  open,
  onClose,
  t,
  locale,
  workspace,
  initial,
  defaultKind,
  onSave,
}: ModalBase & {
  workspace: StudioWorkspace;
  initial?: WorkspaceStandard;
  defaultKind?: StandardKind;
  onSave: (standard: WorkspaceStandard) => boolean;
}) {
  const [kind, setKind] = useState<StandardKind>(initial?.kind ?? defaultKind ?? "style");
  const [titleZh, setTitleZh] = useState(initial?.title.zh ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [bodyZh, setBodyZh] = useState(initial?.body.zh ?? "");
  const [bodyEn, setBodyEn] = useState(initial?.body.en ?? "");
  const [universeId, setUniverseId] = useState(initial?.universeId ?? "");
  const changed = initial
    ? kind !== initial.kind ||
      titleZh.trim() !== initial.title.zh.trim() ||
      titleEn.trim() !== initial.title.en.trim() ||
      bodyZh.trim() !== initial.body.zh.trim() ||
      bodyEn.trim() !== initial.body.en.trim() ||
      (universeId || undefined) !== initial.universeId
    : true;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t("foundationEditStandard") : t("foundationNewStandard")}
      description={t("foundationDraftNote")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={(!titleZh.trim() && !titleEn.trim()) || (!bodyZh.trim() && !bodyEn.trim())}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("std"),
                kind,
                universeId: universeId || undefined,
                title: { zh: titleZh.trim(), en: titleEn.trim() },
                body: { zh: bodyZh.trim(), en: bodyEn.trim() },
                status: initial?.status ?? "draft",
                version: initial ? (changed ? initial.version + 1 : initial.version) : 1,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("foundationKind")}>
          <Select value={kind} onChange={(event) => setKind(event.target.value as StandardKind)}>
            {STANDARD_KINDS.map((value) => (
              <option key={value} value={value}>{standardKindLabel(value, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("foundationScope")}>
          <Select value={universeId} onChange={(event) => setUniverseId(event.target.value)}>
            <option value="">{t("foundationProjectWide")}</option>
            {workspace.universes.map((universe) => (
              <option key={universe.id} value={universe.id}>{displayText(universe.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("titleZh")}>
          <TextInput value={titleZh} onChange={(event) => setTitleZh(event.target.value)} />
        </Field>
        <Field label={t("titleEn")}>
          <TextInput value={titleEn} onChange={(event) => setTitleEn(event.target.value)} />
        </Field>
        <Field label={t("foundationBodyZh")} wide>
          <TextArea rows={7} value={bodyZh} onChange={(event) => setBodyZh(event.target.value)} />
        </Field>
        <Field label={t("foundationBodyEn")} wide>
          <TextArea rows={7} value={bodyEn} onChange={(event) => setBodyEn(event.target.value)} />
        </Field>
      </FieldGrid>
    </Modal>
  );
}
