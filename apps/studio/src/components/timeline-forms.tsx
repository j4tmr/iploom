import { useState } from "react";
import { createId, displayText } from "../core/factory.ts";
import type {
  StoryObject,
  StudioWorkspace,
  TimelineCanonStatus,
  TimelineEvent,
  TimelineEventKind,
  TimelineSubjectKind,
  UiLocale,
} from "../core/types.ts";
import {
  Button,
  Field,
  FieldGrid,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "./ui.tsx";
import {
  timelineEventLabels,
  timelineSubjectLabels,
  type Translate,
} from "../i18n.ts";

type Base = {
  open: boolean;
  onClose: () => void;
  locale: UiLocale;
  t: Translate;
};

export function StoryObjectModal({
  open,
  onClose,
  locale,
  t,
  workspace,
  initial,
  defaultUniverseId,
  onSave,
}: Base & {
  workspace: StudioWorkspace;
  initial?: StoryObject;
  defaultUniverseId?: string;
  onSave: (value: StoryObject) => boolean;
}) {
  const [universeId, setUniverseId] = useState(
    initial?.universeId ?? defaultUniverseId ?? workspace.universes[0]?.id ?? "",
  );
  const [nameZh, setNameZh] = useState(initial?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(initial?.name.en ?? "");
  const [categoryZh, setCategoryZh] = useState(initial?.category.zh ?? "");
  const [categoryEn, setCategoryEn] = useState(initial?.category.en ?? "");
  const [summaryZh, setSummaryZh] = useState(initial?.summary.zh ?? "");
  const [summaryEn, setSummaryEn] = useState(initial?.summary.en ?? "");
  const [visualPrompt, setVisualPrompt] = useState(initial?.visualPrompt ?? "");
  const [sourceNotes, setSourceNotes] = useState(initial?.sourceNotes ?? "");
  const canSave = Boolean(universeId && (nameZh.trim() || nameEn.trim()));

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={initial ? t("storyObjectEditTitle") : t("storyObjectNewTitle")}
      description={t("storyObjectLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("object"),
                universeId,
                name: { zh: nameZh.trim(), en: nameEn.trim() },
                category: { zh: categoryZh.trim(), en: categoryEn.trim() },
                summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                visualPrompt,
                sourceNotes,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("storyObjectSave")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field
          label={t("universe")}
          hint={initial ? t("storyObjectUniverseFixed") : undefined}
          wide
        >
          <Select
            value={universeId}
            disabled={Boolean(initial)}
            onChange={(event) => setUniverseId(event.target.value)}
          >
            {workspace.universes.map((item) => (
              <option key={item.id} value={item.id}>{displayText(item.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("nameZh")}>
          <TextInput autoFocus value={nameZh} onChange={(event) => setNameZh(event.target.value)} />
        </Field>
        <Field label={t("nameEn")}>
          <TextInput value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        <Field label={t("storyObjectCategoryZh")}>
          <TextInput value={categoryZh} onChange={(event) => setCategoryZh(event.target.value)} />
        </Field>
        <Field label={t("storyObjectCategoryEn")}>
          <TextInput value={categoryEn} onChange={(event) => setCategoryEn(event.target.value)} />
        </Field>
        <Field label={t("summaryZh")} wide>
          <TextArea rows={3} value={summaryZh} onChange={(event) => setSummaryZh(event.target.value)} />
        </Field>
        <Field label={t("summaryEn")} wide>
          <TextArea rows={3} value={summaryEn} onChange={(event) => setSummaryEn(event.target.value)} />
        </Field>
        <Field
          label={t("storyObjectVisualPrompt")}
          hint={t("storyObjectVisualPromptHint")}
          wide
        >
          <TextArea rows={5} value={visualPrompt} onChange={(event) => setVisualPrompt(event.target.value)} />
        </Field>
        <Field label={t("storyObjectSourceNotes")} wide>
          <TextArea rows={4} value={sourceNotes} onChange={(event) => setSourceNotes(event.target.value)} />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function TimelineEventModal({
  open,
  onClose,
  locale,
  t,
  workspace,
  initial,
  defaultUniverseId,
  defaultWorkId,
  defaultChapterId,
  onSave,
}: Base & {
  workspace: StudioWorkspace;
  initial?: TimelineEvent;
  defaultUniverseId?: string;
  defaultWorkId?: string;
  defaultChapterId?: string;
  onSave: (value: TimelineEvent) => boolean;
}) {
  const initialWork = workspace.works.find((item) => item.id === (initial?.workId ?? defaultWorkId));
  const initialUniverseId =
    initial?.universeId ??
    initialWork?.universeId ??
    defaultUniverseId ??
    workspace.universes[0]?.id ??
    "";
  const [universeId, setUniverseId] = useState(initialUniverseId);
  const [workId, setWorkId] = useState(initial?.workId ?? initialWork?.id ?? "");
  const [chapterId, setChapterId] = useState(initial?.chapterId ?? defaultChapterId ?? "");
  const [sceneId, setSceneId] = useState(initial?.sceneId ?? "");
  const [storyTime, setStoryTime] = useState(initial?.storyTime ?? "");
  const [order, setOrder] = useState(initial?.order ?? 0);
  const [subjectKind, setSubjectKind] = useState<TimelineSubjectKind>(
    initial?.subjectKind ?? "character",
  );
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? "");
  const [eventKind, setEventKind] = useState<TimelineEventKind>(
    initial?.eventKind ?? "state-change",
  );
  const [titleZh, setTitleZh] = useState(initial?.title.zh ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [stateBefore, setStateBefore] = useState(initial?.stateBefore ?? "");
  const [stateAfter, setStateAfter] = useState(initial?.stateAfter ?? "");
  const [canonStatus, setCanonStatus] = useState<TimelineCanonStatus>(
    initial?.canonStatus ?? "proposed",
  );
  const [relatedCharacterIds, setRelatedCharacterIds] = useState(
    initial?.relatedCharacterIds ?? [],
  );
  const [relatedLocationIds, setRelatedLocationIds] = useState(
    initial?.relatedLocationIds ?? [],
  );
  const [relatedObjectIds, setRelatedObjectIds] = useState(
    initial?.relatedObjectIds ?? [],
  );
  const [evidence, setEvidence] = useState(initial?.evidence ?? "");
  const [productionPrompt, setProductionPrompt] = useState(
    initial?.productionPrompt ?? "",
  );

  const works = workspace.works.filter((item) => item.universeId === universeId);
  const work = works.find((item) => item.id === workId);
  const chapters = work?.chapters ?? [];
  const chapter = chapters.find((item) => item.id === chapterId);
  const characters = workspace.characters.filter((item) =>
    item.universeIds.includes(universeId),
  );
  const locations = workspace.locations.filter(
    (item) => item.universeId === universeId,
  );
  const objects = workspace.storyObjects.filter(
    (item) => item.universeId === universeId,
  );
  const subjectOptions =
    subjectKind === "character"
      ? characters.map((item) => [item.id, displayText(item.name, locale)] as const)
      : subjectKind === "location"
        ? locations.map((item) => [item.id, displayText(item.name, locale)] as const)
        : subjectKind === "object"
          ? objects.map((item) => [item.id, displayText(item.name, locale)] as const)
          : (chapter?.scenes ?? []).map((item) => [item.id, item.title] as const);
  const canSave = Boolean(
    universeId &&
    workId &&
    subjectId &&
    (chapterId || storyTime.trim()) &&
    (titleZh.trim() || titleEn.trim()) &&
    (stateBefore.trim() || stateAfter.trim()) &&
    (subjectKind !== "scene" || chapterId),
  );

  const toggle = (
    id: string,
    values: string[],
    setValues: (next: string[]) => void,
  ) =>
    setValues(values.includes(id)
      ? values.filter((value) => value !== id)
      : [...values, id]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={initial ? t("timelineEventEditTitle") : t("timelineEventNewTitle")}
      description={t("timelineEventLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("timeline"),
                universeId,
                workId,
                chapterId: chapterId || undefined,
                sceneId: sceneId || undefined,
                storyTime: storyTime.trim(),
                order: Number.isFinite(order) ? Math.max(0, Math.trunc(order)) : 0,
                subjectKind,
                subjectId,
                eventKind,
                title: { zh: titleZh.trim(), en: titleEn.trim() },
                stateBefore,
                stateAfter,
                canonStatus,
                relatedCharacterIds,
                relatedLocationIds,
                relatedObjectIds,
                evidence,
                productionPrompt,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("timelineSaveEvent")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("timelineUniverseLabel")}>
          <Select
            value={universeId}
            onChange={(event) => {
              setUniverseId(event.target.value);
              setWorkId("");
              setChapterId("");
              setSceneId("");
              setSubjectId("");
              setRelatedCharacterIds([]);
              setRelatedLocationIds([]);
              setRelatedObjectIds([]);
            }}
          >
            {workspace.universes.map((item) => (
              <option key={item.id} value={item.id}>{displayText(item.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("timelineNovelSource")}>
          <Select
            value={workId}
            onChange={(event) => {
              setWorkId(event.target.value);
              setChapterId("");
              setSceneId("");
              setSubjectId("");
              setUniverseId(
                workspace.works.find((item) => item.id === event.target.value)
                  ?.universeId ?? universeId,
              );
            }}
          >
            <option value="">—</option>
            {works.map((item) => (
              <option key={item.id} value={item.id}>{displayText(item.title, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("timelineChapterAnchor")} hint={t("timelineChapterAnchorHint")}>
          <Select
            value={chapterId}
            onChange={(event) => {
              setChapterId(event.target.value);
              setSceneId("");
              if (subjectKind === "scene") setSubjectId("");
            }}
          >
            <option value="">—</option>
            {chapters.map((item) => (
              <option key={item.id} value={item.id}>{item.number}. {item.title}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("timelineStoryTime")} hint={t("timelineStoryTimeHint")}>
          <TextInput value={storyTime} onChange={(event) => setStoryTime(event.target.value)} />
        </Field>
        <Field label={t("timelineSceneAssociation")}>
          <Select value={sceneId} onChange={(event) => setSceneId(event.target.value)}>
            <option value="">—</option>
            {(chapter?.scenes ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("timelineOrder")}>
          <TextInput
            type="number"
            min={0}
            value={order}
            onChange={(event) => setOrder(Number(event.target.value))}
          />
        </Field>
        <Field label={t("timelineStateOwner")}>
          <Select
            value={subjectKind}
            onChange={(event) => {
              setSubjectKind(event.target.value as TimelineSubjectKind);
              setSubjectId("");
            }}
          >
            {(Object.keys(timelineSubjectLabels[locale]) as TimelineSubjectKind[]).map((kind) => (
              <option key={kind} value={kind}>{timelineSubjectLabels[locale][kind]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("timelineSubject")}>
          <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            <option value="">—</option>
            {subjectOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("timelineEventKind")}>
          <Select value={eventKind} onChange={(event) => setEventKind(event.target.value as TimelineEventKind)}>
            {(Object.keys(timelineEventLabels[locale]) as TimelineEventKind[]).map((kind) => (
              <option key={kind} value={kind}>{timelineEventLabels[locale][kind]}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("timelineCanonStatus")}>
          <Select value={canonStatus} onChange={(event) => setCanonStatus(event.target.value as TimelineCanonStatus)}>
            <option value="canon">{t("timelineEstablished")}</option>
            <option value="proposed">{t("timelineProposedNeedsReview")}</option>
          </Select>
        </Field>
        <Field label={t("titleZh")}>
          <TextInput value={titleZh} onChange={(event) => setTitleZh(event.target.value)} />
        </Field>
        <Field label={t("titleEn")}>
          <TextInput value={titleEn} onChange={(event) => setTitleEn(event.target.value)} />
        </Field>
        <Field label={t("timelineStateBefore")} wide>
          <TextArea rows={3} value={stateBefore} onChange={(event) => setStateBefore(event.target.value)} />
        </Field>
        <Field label={t("timelineStateAfter")} wide>
          <TextArea rows={3} value={stateAfter} onChange={(event) => setStateAfter(event.target.value)} />
        </Field>
        <Field label={t("timelineCharacters")} wide>
          <div className="check-grid">
            {characters.map((item) => (
              <label className="check-card" key={item.id}>
                <input
                  type="checkbox"
                  checked={relatedCharacterIds.includes(item.id)}
                  onChange={() => toggle(item.id, relatedCharacterIds, setRelatedCharacterIds)}
                />
                <span style={{ background: item.color }} />
                {displayText(item.name, locale)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t("timelineLocations")} wide>
          <div className="check-grid">
            {locations.map((item) => (
              <label className="check-card" key={item.id}>
                <input
                  type="checkbox"
                  checked={relatedLocationIds.includes(item.id)}
                  onChange={() => toggle(item.id, relatedLocationIds, setRelatedLocationIds)}
                />
                <span className="timeline-check-mark">⌖</span>
                {displayText(item.name, locale)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t("timelineProps")} wide>
          <div className="check-grid">
            {objects.map((item) => (
              <label className="check-card" key={item.id}>
                <input
                  type="checkbox"
                  checked={relatedObjectIds.includes(item.id)}
                  onChange={() => toggle(item.id, relatedObjectIds, setRelatedObjectIds)}
                />
                <span className="timeline-check-mark">◇</span>
                {displayText(item.name, locale)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t("timelineEvidenceField")} wide>
          <TextArea rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} />
        </Field>
        <Field
          label={t("timelineProductionPrompt")}
          hint={t("timelineProductionPromptHint")}
          wide
        >
          <TextArea rows={5} value={productionPrompt} onChange={(event) => setProductionPrompt(event.target.value)} />
        </Field>
      </FieldGrid>
    </Modal>
  );
}
