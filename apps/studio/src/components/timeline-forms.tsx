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

type Base = {
  open: boolean;
  onClose: () => void;
  locale: UiLocale;
};

const eventKindLabels: Record<TimelineEventKind, [string, string]> = {
  introduction: ["首次出现", "Introduction"],
  "state-change": ["状态变化", "State change"],
  transfer: ["转移 / 交接", "Transfer"],
  reveal: ["揭示", "Reveal"],
  loss: ["遗失 / 损坏", "Loss"],
  recovery: ["恢复 / 找回", "Recovery"],
  other: ["其他", "Other"],
};

const subjectKindLabels: Record<TimelineSubjectKind, [string, string]> = {
  character: ["人物状态", "Character"],
  scene: ["场景状态", "Scene"],
  location: ["地点变化", "Location"],
  object: ["物件状态", "Prop"],
};

export function StoryObjectModal({
  open,
  onClose,
  locale,
  workspace,
  initial,
  defaultUniverseId,
  onSave,
}: Base & {
  workspace: StudioWorkspace;
  initial?: StoryObject;
  defaultUniverseId?: string;
  onSave: (value: StoryObject) => void;
}) {
  const en = locale === "en";
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
      title={initial
        ? (en ? "Edit story prop" : "编辑故事物件")
        : (en ? "New story prop" : "新增故事物件")}
      description={en
        ? "Props carry identity, wear, hand changes, reveal rules and reusable image prompts across the project."
        : "物件可以记录外观、磨损、持有者变化、揭示规则与可复用的图像提示词。"}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{en ? "Cancel" : "取消"}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              onSave({
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
              onClose();
            }}
          >
            {en ? "Save prop" : "保存物件"}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={en ? "Universe" : "所属宇宙"} wide>
          <Select value={universeId} onChange={(event) => setUniverseId(event.target.value)}>
            {workspace.universes.map((item) => (
              <option key={item.id} value={item.id}>{displayText(item.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={en ? "Chinese name" : "中文名称"}>
          <TextInput autoFocus value={nameZh} onChange={(event) => setNameZh(event.target.value)} />
        </Field>
        <Field label="English name">
          <TextInput value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        <Field label={en ? "Chinese category" : "中文类别"}>
          <TextInput value={categoryZh} onChange={(event) => setCategoryZh(event.target.value)} />
        </Field>
        <Field label="English category">
          <TextInput value={categoryEn} onChange={(event) => setCategoryEn(event.target.value)} />
        </Field>
        <Field label={en ? "Chinese summary" : "中文说明"} wide>
          <TextArea rows={3} value={summaryZh} onChange={(event) => setSummaryZh(event.target.value)} />
        </Field>
        <Field label="English summary" wide>
          <TextArea rows={3} value={summaryEn} onChange={(event) => setSummaryEn(event.target.value)} />
        </Field>
        <Field
          label={en ? "Reusable visual prompt" : "可复用视觉提示词"}
          hint={en ? "Identity, materials, wear, views and negatives." : "固定 Identity、材质、磨损、视图与负向约束。"}
          wide
        >
          <TextArea rows={5} value={visualPrompt} onChange={(event) => setVisualPrompt(event.target.value)} />
        </Field>
        <Field label={en ? "Source and continuity notes" : "来源与连续性备注"} wide>
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
  onSave: (value: TimelineEvent) => void;
}) {
  const en = locale === "en";
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
      title={initial
        ? (en ? "Edit timeline event" : "编辑时间线事件")
        : (en ? "New timeline event" : "新增时间线事件")}
      description={en
        ? "Anchor a state change to a chapter, an in-world time, or both. Canon and proposed states stay visibly distinct."
        : "把状态变化绑定到章节、故事内时间或两者。既定事实与未来提案会保持明确区分。"}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{en ? "Cancel" : "取消"}</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              onSave({
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
              onClose();
            }}
          >
            {en ? "Save event" : "保存事件"}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={en ? "Universe" : "宇宙"}>
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
        <Field label={en ? "Novel / source" : "小说 / 来源"}>
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
        <Field label={en ? "Chapter anchor" : "章节锚点"} hint={en ? "Optional when an in-world time is supplied." : "填写故事内时间时可留空。"}>
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
        <Field label={en ? "In-world time" : "故事内时间"} hint={en ? "Example: Year 112, winter 7th, 22:40." : "例如：帝国历 112 年冬月初七 22:40。"}>
          <TextInput value={storyTime} onChange={(event) => setStoryTime(event.target.value)} />
        </Field>
        <Field label={en ? "Scene association" : "关联场景"}>
          <Select value={sceneId} onChange={(event) => setSceneId(event.target.value)}>
            <option value="">—</option>
            {(chapter?.scenes ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </Select>
        </Field>
        <Field label={en ? "Order within the anchor" : "同一时间锚点内顺序"}>
          <TextInput
            type="number"
            min={0}
            value={order}
            onChange={(event) => setOrder(Number(event.target.value))}
          />
        </Field>
        <Field label={en ? "State owner" : "状态主体"}>
          <Select
            value={subjectKind}
            onChange={(event) => {
              setSubjectKind(event.target.value as TimelineSubjectKind);
              setSubjectId("");
            }}
          >
            {(Object.keys(subjectKindLabels) as TimelineSubjectKind[]).map((kind) => (
              <option key={kind} value={kind}>{subjectKindLabels[kind][en ? 1 : 0]}</option>
            ))}
          </Select>
        </Field>
        <Field label={en ? "Subject" : "具体对象"}>
          <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            <option value="">—</option>
            {subjectOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label={en ? "Event kind" : "事件类型"}>
          <Select value={eventKind} onChange={(event) => setEventKind(event.target.value as TimelineEventKind)}>
            {(Object.keys(eventKindLabels) as TimelineEventKind[]).map((kind) => (
              <option key={kind} value={kind}>{eventKindLabels[kind][en ? 1 : 0]}</option>
            ))}
          </Select>
        </Field>
        <Field label={en ? "Canon status" : "事实状态"}>
          <Select value={canonStatus} onChange={(event) => setCanonStatus(event.target.value as TimelineCanonStatus)}>
            <option value="canon">{en ? "Established / canon" : "已确立 / 既定事实"}</option>
            <option value="proposed">{en ? "Proposed / needs review" : "提案 / 待审"}</option>
          </Select>
        </Field>
        <Field label={en ? "Chinese title" : "中文标题"}>
          <TextInput value={titleZh} onChange={(event) => setTitleZh(event.target.value)} />
        </Field>
        <Field label="English title">
          <TextInput value={titleEn} onChange={(event) => setTitleEn(event.target.value)} />
        </Field>
        <Field label={en ? "State before" : "变化前状态"} wide>
          <TextArea rows={3} value={stateBefore} onChange={(event) => setStateBefore(event.target.value)} />
        </Field>
        <Field label={en ? "State after" : "变化后状态"} wide>
          <TextArea rows={3} value={stateAfter} onChange={(event) => setStateAfter(event.target.value)} />
        </Field>
        <Field label={en ? "Characters present or affected" : "关联人物"} wide>
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
        <Field label={en ? "Locations" : "关联地点"} wide>
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
        <Field label={en ? "Props" : "关联物件"} wide>
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
        <Field label={en ? "Evidence / source location" : "证据 / 原文位置"} wide>
          <TextArea rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} />
        </Field>
        <Field
          label={en ? "Production state prompt" : "制作状态提示词"}
          hint={en ? "Describe the visible state, not the plot summary." : "描述可看见的状态，而不是重复剧情摘要。"}
          wide
        >
          <TextArea rows={5} value={productionPrompt} onChange={(event) => setProductionPrompt(event.target.value)} />
        </Field>
      </FieldGrid>
    </Modal>
  );
}
