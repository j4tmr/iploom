import { useEffect, useMemo, useState } from "react";
import { displayText } from "../core/factory.ts";
import {
  sortTimelineEvents,
  timelineAnchorLabel,
  timelineSubjectLabel,
} from "../core/timeline.ts";
import type {
  StoryObject,
  StudioWorkspace,
  TimelineEvent,
  TimelineSubjectKind,
  UiLocale,
} from "../core/types.ts";
import {
  timelineEventLabels,
  timelineSubjectLabels,
  type Translate,
} from "../i18n.ts";
import { Icon, type IconName } from "../components/icon.tsx";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Select,
  TextInput,
} from "../components/ui.tsx";

const subjectIcons: Record<TimelineSubjectKind, IconName> = {
  character: "users",
  scene: "grid",
  location: "world",
  object: "package",
};

export function TimelineView({
  workspace,
  locale,
  t,
  initialUniverseId,
  onNewEvent,
  onEditEvent,
  onDeleteEvent,
  onNewObject,
  onEditObject,
  onDeleteObject,
  onOpenWork,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  initialUniverseId?: string;
  onNewEvent: (universeId: string, workId?: string) => void;
  onEditEvent: (event: TimelineEvent) => void;
  onDeleteEvent: (event: TimelineEvent) => void;
  onNewObject: (universeId: string) => void;
  onEditObject: (object: StoryObject) => void;
  onDeleteObject: (object: StoryObject) => void;
  onOpenWork: (workId: string) => void;
}) {
  const en = locale === "en";
  const [universeId, setUniverseId] = useState(
    initialUniverseId ??
    workspace.universes.find((item) =>
      workspace.timelineEvents.some((event) => event.universeId === item.id),
    )?.id ??
    workspace.universes[0]?.id ??
    "",
  );
  const [workId, setWorkId] = useState("");
  const [subjectKind, setSubjectKind] = useState<TimelineSubjectKind | "all">("all");
  const [canonStatus, setCanonStatus] = useState<"all" | "canon" | "proposed">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!initialUniverseId) return;
    setUniverseId(initialUniverseId);
    setWorkId("");
  }, [initialUniverseId]);

  const works = workspace.works.filter((item) => item.universeId === universeId);
  const objects = workspace.storyObjects.filter(
    (item) => item.universeId === universeId,
  );
  const events = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sortTimelineEvents(
      workspace,
      workspace.timelineEvents.filter((event) => {
        if (event.universeId !== universeId) return false;
        if (workId && event.workId !== workId) return false;
        if (subjectKind !== "all" && event.subjectKind !== subjectKind) return false;
        if (canonStatus !== "all" && event.canonStatus !== canonStatus) return false;
        if (!needle) return true;
        const subject = timelineSubjectLabel(workspace, event, locale);
        return [
          event.title.zh,
          event.title.en,
          event.storyTime,
          event.stateBefore,
          event.stateAfter,
          event.evidence,
          event.productionPrompt,
          subject,
        ].join(" ").toLocaleLowerCase().includes(needle);
      }),
    );
  }, [canonStatus, locale, query, subjectKind, universeId, workId, workspace]);

  const canonCount = events.filter((event) => event.canonStatus === "canon").length;
  const objectUsage = new Map<string, number>();
  for (const event of workspace.timelineEvents) {
    if (event.universeId !== universeId) continue;
    for (const id of event.relatedObjectIds) {
      objectUsage.set(id, (objectUsage.get(id) ?? 0) + 1);
    }
    if (event.subjectKind === "object") {
      objectUsage.set(event.subjectId, (objectUsage.get(event.subjectId) ?? 0) + 1);
    }
  }

  const relatedNames = (event: TimelineEvent) => {
    const values = [
      ...event.relatedCharacterIds.map(
        (id) => workspace.characters.find((item) => item.id === id)?.name,
      ),
      ...event.relatedLocationIds.map(
        (id) => workspace.locations.find((item) => item.id === id)?.name,
      ),
      ...event.relatedObjectIds.map(
        (id) => workspace.storyObjects.find((item) => item.id === id)?.name,
      ),
    ].filter((item): item is { zh: string; en: string } => Boolean(item));
    return values.map((item) => displayText(item, locale));
  };

  return (
    <div className="view timeline-view">
      <header className="page-heading timeline-heading">
        <div>
          <span className="eyebrow">STORY STATE ENGINE / 故事状态引擎</span>
          <h1>{en ? "Every change leaves a trace." : "每一次变化，都留下可追溯的状态。"}</h1>
          <p>{en
            ? "Track characters, scenes, locations and props across chapters or in-world time. Canon states feed production prompts; proposed states remain visibly marked."
            : "按章节或故事内时间追踪人物、场景、地点与物件。既定状态会进入制作提示词，提案状态保持明确标记。"}</p>
        </div>
        <Button
          variant="primary"
          icon="plus"
          disabled={!universeId}
          onClick={() => onNewEvent(universeId, workId || undefined)}
        >
          {en ? "Add state event" : "新增状态事件"}
        </Button>
      </header>

      <section className="timeline-toolbar">
        <Select
          aria-label={en ? "Universe" : "宇宙"}
          value={universeId}
          onChange={(event) => {
            setUniverseId(event.target.value);
            setWorkId("");
          }}
        >
          {workspace.universes.map((item) => (
            <option key={item.id} value={item.id}>{displayText(item.name, locale)}</option>
          ))}
        </Select>
        <Select
          aria-label={en ? "Novel" : "小说"}
          value={workId}
          onChange={(event) => setWorkId(event.target.value)}
        >
          <option value="">{en ? "All novels" : "全部小说"}</option>
          {works.map((item) => (
            <option key={item.id} value={item.id}>{displayText(item.title, locale)}</option>
          ))}
        </Select>
        <Select
          aria-label={en ? "State owner" : "状态主体"}
          value={subjectKind}
          onChange={(event) =>
            setSubjectKind(event.target.value as TimelineSubjectKind | "all")
          }
        >
          <option value="all">{en ? "All state owners" : "全部主体"}</option>
          {(Object.keys(timelineSubjectLabels[locale]) as TimelineSubjectKind[]).map((kind) => (
            <option key={kind} value={kind}>{timelineSubjectLabels[locale][kind]}</option>
          ))}
        </Select>
        <Select
          aria-label={en ? "Canon status" : "事实状态"}
          value={canonStatus}
          onChange={(event) =>
            setCanonStatus(event.target.value as "all" | "canon" | "proposed")
          }
        >
          <option value="all">{en ? "Canon + proposals" : "既定事实 + 提案"}</option>
          <option value="canon">{en ? "Canon only" : "仅既定事实"}</option>
          <option value="proposed">{en ? "Proposals only" : "仅待审提案"}</option>
        </Select>
        <TextInput
          value={query}
          placeholder={en ? "Search state, evidence or prompt…" : "搜索状态、证据或提示词…"}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>

      <div className="timeline-summary">
        <div><strong>{events.length}</strong><span>{en ? "visible events" : "可见事件"}</span></div>
        <div><strong>{canonCount}</strong><span>{en ? "canon states" : "既定状态"}</span></div>
        <div><strong>{objects.length}</strong><span>{en ? "reusable props" : "可复用物件"}</span></div>
        <div><strong>{events.filter((event) => event.chapterId).length}</strong><span>{en ? "chapter anchors" : "章节锚点"}</span></div>
      </div>

      <div className="timeline-layout">
        <section className="timeline-stream" aria-label={en ? "Story timeline" : "故事时间线"}>
          {events.length ? events.map((event) => {
            const icon = subjectIcons[event.subjectKind];
            const labels = relatedNames(event);
            const work = workspace.works.find((item) => item.id === event.workId);
            return (
              <article className={`timeline-event ${event.canonStatus}`} key={event.id}>
                <div className="timeline-rail">
                  <span className="timeline-marker"><Icon name={icon} size={16} /></span>
                  <i />
                </div>
                <div className="timeline-event-card">
                  <header>
                    <div className="timeline-event-kicker">
                      <span>{timelineSubjectLabels[locale][event.subjectKind]}</span>
                      <span>{timelineEventLabels[locale][event.eventKind]}</span>
                      <Badge tone={event.canonStatus === "canon" ? "green" : "amber"} dot>
                        {event.canonStatus === "canon"
                          ? (en ? "Canon" : "既定事实")
                          : (en ? "Proposed" : "待审提案")}
                      </Badge>
                    </div>
                    <div className="timeline-event-actions">
                      <IconButton label={en ? "Edit event" : "编辑事件"} icon="edit" onClick={() => onEditEvent(event)} />
                      <IconButton label={en ? "Delete event" : "删除事件"} icon="trash" onClick={() => onDeleteEvent(event)} />
                    </div>
                  </header>
                  <h2>{displayText(event.title, locale)}</h2>
                  <button
                    className="timeline-anchor"
                    onClick={() => onOpenWork(event.workId)}
                    title={work ? displayText(work.title, locale) : event.workId}
                  >
                    <Icon name="timeline" size={14} />
                    {timelineAnchorLabel(workspace, event, locale)}
                  </button>
                  <div className="timeline-subject">
                    <span>{en ? "State of" : "状态主体"}</span>
                    <strong>{timelineSubjectLabel(workspace, event, locale)}</strong>
                  </div>
                  <div className="state-change">
                    <div>
                      <span>{en ? "Before" : "变化前"}</span>
                      <p>{event.stateBefore || "—"}</p>
                    </div>
                    <Icon name="arrow" size={19} />
                    <div>
                      <span>{en ? "After" : "变化后"}</span>
                      <p>{event.stateAfter || "—"}</p>
                    </div>
                  </div>
                  {labels.length ? (
                    <div className="timeline-links">
                      <Icon name="link" size={13} />
                      {labels.map((label) => <span key={label}>{label}</span>)}
                    </div>
                  ) : null}
                  {event.productionPrompt ? (
                    <div className="timeline-prompt">
                      <span>{en ? "PRODUCTION STATE" : "制作状态提示词"}</span>
                      <p>{event.productionPrompt}</p>
                    </div>
                  ) : null}
                  {event.evidence ? (
                    <p className="timeline-evidence">
                      <strong>{en ? "Evidence" : "依据"}</strong>
                      {event.evidence}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          }) : (
            <EmptyState
              icon="timeline"
              title={en ? "No state events match these filters." : "当前筛选下没有状态事件。"}
              action={
                <Button
                  variant="primary"
                  icon="plus"
                  disabled={!universeId}
                  onClick={() => onNewEvent(universeId, workId || undefined)}
                >
                  {en ? "Create the first event" : "建立第一个事件"}
                </Button>
              }
            >
              {en
                ? "Record an introduction, costume change, injury, relationship reveal, location change or prop handoff."
                : "记录首次出现、服装变化、受伤、关系揭示、地点变化或物件交接。"}
            </EmptyState>
          )}
        </section>

        <aside className="timeline-objects">
          <div className="timeline-objects-head">
            <div>
              <span className="eyebrow">PROP LEDGER / 物件账本</span>
              <h2>{en ? "Reusable props" : "可复用物件"}</h2>
            </div>
            <IconButton
              label={en ? "New prop" : "新增物件"}
              icon="plus"
              disabled={!universeId}
              onClick={() => onNewObject(universeId)}
            />
          </div>
          <p>{en
            ? "Keep silhouette, material, wear and hand-change rules stable when props move between people or scenes."
            : "物件在人物与场景之间流转时，固定轮廓、材质、磨损和持有规则。"}</p>
          <div className="timeline-object-list">
            {objects.map((object) => (
              <article key={object.id}>
                <div>
                  <span>{displayText(object.category, locale) || (en ? "Prop" : "物件")}</span>
                  <button onClick={() => onEditObject(object)}>{displayText(object.name, locale)}</button>
                  <small>{objectUsage.get(object.id) ?? 0} {en ? "timeline links" : "条时间线关联"}</small>
                </div>
                <IconButton label={en ? "Delete prop" : "删除物件"} icon="trash" onClick={() => onDeleteObject(object)} />
              </article>
            ))}
            {!objects.length ? (
              <button className="timeline-object-empty" onClick={() => onNewObject(universeId)}>
                <Icon name="package" size={24} />
                <span>{en ? "Add the first reusable prop" : "添加第一个可复用物件"}</span>
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
