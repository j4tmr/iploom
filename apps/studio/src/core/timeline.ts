import { displayText } from "./factory.ts";
import type {
  StudioWorkspace,
  TimelineEvent,
  UiLocale,
} from "./types.ts";
import type { ProductionScope } from "./production.ts";

function chapterNumber(
  workspace: StudioWorkspace,
  event: TimelineEvent,
): number {
  const work = workspace.works.find((item) => item.id === event.workId);
  return (
    work?.chapters.find((item) => item.id === event.chapterId)?.number ??
    Number.MAX_SAFE_INTEGER
  );
}

export function sortTimelineEvents(
  workspace: StudioWorkspace,
  events: TimelineEvent[],
): TimelineEvent[] {
  return [...events].sort((left, right) => {
    const chapterDifference =
      chapterNumber(workspace, left) - chapterNumber(workspace, right);
    if (chapterDifference) return chapterDifference;
    const timeDifference = left.storyTime.localeCompare(
      right.storyTime,
      "zh-CN",
      { numeric: true, sensitivity: "base" },
    );
    if (timeDifference) return timeDifference;
    const orderDifference = left.order - right.order;
    if (orderDifference) return orderDifference;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function chapterLabel(
  workspace: StudioWorkspace,
  event: TimelineEvent,
  locale: UiLocale,
): string {
  const work = workspace.works.find((item) => item.id === event.workId);
  const chapter = work?.chapters.find((item) => item.id === event.chapterId);
  if (!chapter) return locale === "en" ? "Unanchored chapter" : "未绑定章节";
  return locale === "en"
    ? `Chapter ${chapter.number} · ${chapter.titleEn || chapter.title}`
    : `第 ${chapter.number} 章 · ${chapter.title}`;
}

export function timelineAnchorLabel(
  workspace: StudioWorkspace,
  event: TimelineEvent,
  locale: UiLocale,
): string {
  const chapter = event.chapterId
    ? chapterLabel(workspace, event, locale)
    : "";
  if (event.storyTime && chapter)
    return `${chapter} / ${event.storyTime}`;
  return event.storyTime || chapter;
}

export function timelineSubjectLabel(
  workspace: StudioWorkspace,
  event: TimelineEvent,
  locale: UiLocale,
): string {
  if (event.subjectKind === "character") {
    const item = workspace.characters.find((value) => value.id === event.subjectId);
    return item ? displayText(item.name, locale) : event.subjectId;
  }
  if (event.subjectKind === "location") {
    const item = workspace.locations.find((value) => value.id === event.subjectId);
    return item ? displayText(item.name, locale) : event.subjectId;
  }
  if (event.subjectKind === "object") {
    const item = workspace.storyObjects.find((value) => value.id === event.subjectId);
    return item ? displayText(item.name, locale) : event.subjectId;
  }
  const work = workspace.works.find((item) => item.id === event.workId);
  const chapter = work?.chapters.find((item) => item.id === event.chapterId);
  return chapter?.scenes.find((item) => item.id === event.subjectId)?.title ??
    (locale === "en" ? "Scene" : "场景");
}

function intersects(values: string[], expected: string[]): boolean {
  return expected.length === 0 || values.some((value) => expected.includes(value));
}

export function relevantTimelineEvents(
  workspace: StudioWorkspace,
  scope: ProductionScope,
): { canon: TimelineEvent[]; proposed: TimelineEvent[] } {
  const work = workspace.works.find((item) => item.id === scope.workId);
  const universeId = work?.universeId ?? scope.universeId;
  const chapter = work?.chapters.find((item) => item.id === scope.chapterId);
  const currentChapterNumber = chapter?.number ?? Number.MAX_SAFE_INTEGER;
  const castIds = chapter?.characterIds ?? [];
  const locationIds = chapter
    ? [
        ...(chapter.locationId ? [chapter.locationId] : []),
        ...chapter.scenes.flatMap((scene) =>
          scene.locationId ? [scene.locationId] : [],
        ),
      ]
    : [];
  const sceneIds = chapter?.scenes.map((scene) => scene.id) ?? [];
  const characterIds = scope.characterIds?.length
    ? scope.characterIds
    : scope.characterId
      ? [scope.characterId]
      : [];
  const events = workspace.timelineEvents.filter((event) => {
    if (universeId && event.universeId !== universeId) return false;
    if (scope.workId && event.workId !== scope.workId) return false;
    if (
      chapter &&
      event.chapterId &&
      chapterNumber(workspace, event) > currentChapterNumber
    ) {
      return false;
    }
    if (characterIds.length) {
      return (
        (event.subjectKind === "character" &&
          characterIds.includes(event.subjectId)) ||
        intersects(event.relatedCharacterIds, characterIds)
      );
    }
    if (!chapter) return true;
    return (
      (event.subjectKind === "character" && castIds.includes(event.subjectId)) ||
      (event.subjectKind === "location" &&
        [...castIds, ...locationIds].includes(event.subjectId)) ||
      (event.subjectKind === "scene" && sceneIds.includes(event.subjectId)) ||
      (event.subjectKind === "object" && event.chapterId === chapter.id) ||
      intersects(event.relatedCharacterIds, castIds) ||
      intersects(event.relatedLocationIds, locationIds)
    );
  });
  return {
    canon: sortTimelineEvents(
      workspace,
      events.filter((event) => event.canonStatus === "canon"),
    ).slice(0, 120),
    proposed: sortTimelineEvents(
      workspace,
      events.filter((event) => event.canonStatus === "proposed"),
    ).slice(0, 80),
  };
}

export function removeSceneReferences(
  events: TimelineEvent[],
  workId: string,
  chapterId: string,
  removedSceneIds: ReadonlySet<string>,
): TimelineEvent[] {
  if (removedSceneIds.size === 0) return events;
  const next: TimelineEvent[] = [];
  for (const event of events) {
    if (event.workId !== workId || event.chapterId !== chapterId) {
      next.push(event);
      continue;
    }
    if (
      event.subjectKind === "scene" &&
      removedSceneIds.has(event.subjectId)
    ) {
      continue;
    }
    next.push(
      event.sceneId && removedSceneIds.has(event.sceneId)
        ? { ...event, sceneId: undefined }
        : event,
    );
  }
  return next;
}

export function timelinePromptContext(
  workspace: StudioWorkspace,
  scope: ProductionScope,
  locale: UiLocale,
) {
  const timeline = relevantTimelineEvents(workspace, scope);
  const serialize = (event: TimelineEvent) => ({
    id: event.id,
    status: event.canonStatus,
    anchor: timelineAnchorLabel(workspace, event, locale),
    subject: `${event.subjectKind}: ${timelineSubjectLabel(workspace, event, locale)}`,
    event: displayText(event.title, locale),
    stateBefore: event.stateBefore,
    stateAfter: event.stateAfter,
    relatedCharacters: event.relatedCharacterIds.map(
      (id) =>
        workspace.characters.find((item) => item.id === id)?.name ?? { zh: id, en: id },
    ),
    relatedLocations: event.relatedLocationIds.map(
      (id) =>
        workspace.locations.find((item) => item.id === id)?.name ?? { zh: id, en: id },
    ),
    relatedObjects: event.relatedObjectIds.map(
      (id) =>
        workspace.storyObjects.find((item) => item.id === id)?.name ?? { zh: id, en: id },
    ),
    evidence: event.evidence,
    productionPrompt: event.productionPrompt,
  });
  return {
    canon: timeline.canon.map(serialize),
    proposed: timeline.proposed.map(serialize),
  };
}
