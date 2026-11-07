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
          <h1>{t("timelineHeading")}</h1>
          <p>{t("timelineLead")}</p>
        </div>
        <Button
          variant="primary"
          icon="plus"
          disabled={!universeId}
          onClick={() => onNewEvent(universeId, workId || undefined)}
        >
          {t("timelineAddEvent")}
        </Button>
      </header>

      <section className="timeline-toolbar">
        <Select
          aria-label={t("timelineUniverseLabel")}
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
          aria-label={t("novel")}
          value={workId}
          onChange={(event) => setWorkId(event.target.value)}
        >
          <option value="">{t("timelineAllNovels")}</option>
          {works.map((item) => (
            <option key={item.id} value={item.id}>{displayText(item.title, locale)}</option>
          ))}
        </Select>
        <Select
          aria-label={t("timelineStateOwner")}
          value={subjectKind}
          onChange={(event) =>
            setSubjectKind(event.target.value as TimelineSubjectKind | "all")
          }
        >
          <option value="all">{t("timelineAllSubjects")}</option>
          {(Object.keys(timelineSubjectLabels[locale]) as TimelineSubjectKind[]).map((kind) => (
            <option key={kind} value={kind}>{timelineSubjectLabels[locale][kind]}</option>
          ))}
        </Select>
        <Select
          aria-label={t("timelineCanonStatus")}
          value={canonStatus}
          onChange={(event) =>
            setCanonStatus(event.target.value as "all" | "canon" | "proposed")
          }
        >
          <option value="all">{t("timelineCanonAndProposals")}</option>
          <option value="canon">{t("timelineCanonOnly")}</option>
          <option value="proposed">{t("timelineProposalsOnly")}</option>
        </Select>
        <TextInput
          value={query}
          placeholder={t("timelineSearchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>

      <div className="timeline-summary">
        <div><strong>{events.length}</strong><span>{t("timelineVisibleEvents")}</span></div>
        <div><strong>{canonCount}</strong><span>{t("timelineCanonStates")}</span></div>
        <div><strong>{objects.length}</strong><span>{t("timelineReusableProps")}</span></div>
        <div><strong>{events.filter((event) => event.chapterId).length}</strong><span>{t("timelineChapterAnchors")}</span></div>
      </div>

      <div className="timeline-layout">
        <section className="timeline-stream" aria-label={t("timelineStreamLabel")}>
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
                          ? t("timelineCanon")
                          : t("timelineProposed")}
                      </Badge>
                    </div>
                    <div className="timeline-event-actions">
                      <IconButton label={t("timelineEditEvent")} icon="edit" onClick={() => onEditEvent(event)} />
                      <IconButton label={t("timelineDeleteEvent")} icon="trash" onClick={() => onDeleteEvent(event)} />
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
                    <span>{t("timelineStateOf")}</span>
                    <strong>{timelineSubjectLabel(workspace, event, locale)}</strong>
                  </div>
                  <div className="state-change">
                    <div>
                      <span>{t("timelineBefore")}</span>
                      <p>{event.stateBefore || "—"}</p>
                    </div>
                    <Icon name="arrow" size={19} />
                    <div>
                      <span>{t("timelineAfter")}</span>
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
                      <span>{t("timelineProductionState")}</span>
                      <p>{event.productionPrompt}</p>
                    </div>
                  ) : null}
                  {event.evidence ? (
                    <p className="timeline-evidence">
                      <strong>{t("timelineEvidence")}</strong>
                      {event.evidence}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          }) : (
            <EmptyState
              icon="timeline"
              title={t("timelineNoEvents")}
              action={
                <Button
                  variant="primary"
                  icon="plus"
                  disabled={!universeId}
                  onClick={() => onNewEvent(universeId, workId || undefined)}
                >
                  {t("timelineCreateFirst")}
                </Button>
              }
            >
              {t("timelineEmptyLead")}
            </EmptyState>
          )}
        </section>

        <aside className="timeline-objects">
          <div className="timeline-objects-head">
            <div>
              <span className="eyebrow">PROP LEDGER / 物件账本</span>
              <h2>{t("timelineReusableProps")}</h2>
            </div>
            <IconButton
              label={t("timelineNewProp")}
              icon="plus"
              disabled={!universeId}
              onClick={() => onNewObject(universeId)}
            />
          </div>
          <p>{t("timelineObjectsLead")}</p>
          <div className="timeline-object-list">
            {objects.map((object) => (
              <article key={object.id}>
                <div>
                  <span>{displayText(object.category, locale) || t("timelineProp")}</span>
                  <button onClick={() => onEditObject(object)}>{displayText(object.name, locale)}</button>
                  <small>{t("timelineLinkCount", { count: objectUsage.get(object.id) ?? 0 })}</small>
                </div>
                <IconButton label={t("timelineDeleteProp")} icon="trash" onClick={() => onDeleteObject(object)} />
              </article>
            ))}
            {!objects.length ? (
              <button className="timeline-object-empty" onClick={() => onNewObject(universeId)}>
                <Icon name="package" size={24} />
                <span>{t("timelineAddFirstProp")}</span>
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
