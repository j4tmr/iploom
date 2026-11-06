import { displayText } from "./core/factory.ts";
import type { StudioWorkspace, UiLocale } from "./core/types.ts";
import type { WorkspaceIssueDetail } from "./core/validate.ts";
import type { MessageKey, Translate } from "./i18n.ts";

/**
 * Turn the first structured validation failure into a sentence a writer can
 * act on: which entity, which field, and what rule failed. The raw schema path
 * stays at the end so the technical detail is still available without being
 * the only thing shown.
 */
export function describeWorkspaceProblem(
  details: WorkspaceIssueDetail[],
  workspace: StudioWorkspace | null,
  locale: UiLocale,
  t: Translate,
): string {
  const first = details[0];
  if (!first) return "";
  const segments = first.path ? first.path.split(".") : [];
  const entity = resolveEntity(segments, workspace, locale, t);
  const field = resolveField(segments, locale, t);
  const where = entity.name
    ? t("validationWhere", {
        entity: entity.label,
        name: entity.name,
        field,
      })
    : t("validationWhereUnnamed", { entity: entity.label, field });
  const reason = describeReason(first, t);
  const path = first.path || "<root>";
  const more =
    details.length > 1
      ? t("issueMoreIssues", { count: details.length - 1 })
      : "";
  return `${t("validationIssue", { where, reason, path })}${more}`;
}

interface EntityRef {
  label: string;
  name?: string;
}

function clipName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

function resolveEntity(
  segments: string[],
  workspace: StudioWorkspace | null,
  locale: UiLocale,
  t: Translate,
): EntityRef {
  const [container, rawIndex, child] = segments;
  const index = Number(rawIndex);
  const at = (list: unknown[] | undefined) =>
    Number.isInteger(index) && index >= 0 ? list?.[index] : undefined;
  const named = (labelKey: MessageKey, name?: string): EntityRef => ({
    label: t(labelKey),
    name: clipName(name),
  });

  switch (container) {
    case "universes": {
      const item = at(workspace?.universes) as
        | StudioWorkspace["universes"][number]
        | undefined;
      return named("entityUniverse", item && displayText(item.name, locale));
    }
    case "works": {
      const work = at(workspace?.works) as StudioWorkspace["works"][number] | undefined;
      if (child === "chapters") {
        const chapterIndex = Number(segments[3]);
        const chapter =
          work && Number.isInteger(chapterIndex)
            ? work.chapters[chapterIndex]
            : undefined;
        return named(
          "entityChapter",
          chapter?.title ||
            (chapter ? t("chapterLabel", { n: chapter.number }) : undefined),
        );
      }
      return named("entityNovel", work && displayText(work.title, locale));
    }
    case "characters": {
      const item = at(workspace?.characters) as
        | StudioWorkspace["characters"][number]
        | undefined;
      return named("entityCharacter", item && displayText(item.name, locale));
    }
    case "relationships": {
      const item = at(workspace?.relationships) as
        | StudioWorkspace["relationships"][number]
        | undefined;
      return named("entityRelationship", item && displayText(item.label, locale));
    }
    case "standards": {
      const item = at(workspace?.standards) as
        | StudioWorkspace["standards"][number]
        | undefined;
      return named("entityStandard", item && displayText(item.title, locale));
    }
    case "workflowTasks": {
      const item = at(workspace?.workflowTasks) as
        | StudioWorkspace["workflowTasks"][number]
        | undefined;
      return named("entityWorkflowTask", item && displayText(item.title, locale));
    }
    case "timelineEvents": {
      const item = at(workspace?.timelineEvents) as
        | StudioWorkspace["timelineEvents"][number]
        | undefined;
      return named("entityTimelineEvent", item && displayText(item.title, locale));
    }
    case "storyObjects": {
      const item = at(workspace?.storyObjects) as
        | StudioWorkspace["storyObjects"][number]
        | undefined;
      return named("entityStoryObject", item && displayText(item.name, locale));
    }
    case "locations": {
      const item = at(workspace?.locations) as
        | StudioWorkspace["locations"][number]
        | undefined;
      return named("entityLocation", item && displayText(item.name, locale));
    }
    case "factions": {
      const item = at(workspace?.factions) as
        | StudioWorkspace["factions"][number]
        | undefined;
      return named("entityFaction", item && displayText(item.name, locale));
    }
    case "lore": {
      const item = at(workspace?.lore) as StudioWorkspace["lore"][number] | undefined;
      return named("entityLore", item && displayText(item.title, locale));
    }
    case "exports": {
      const item = at(workspace?.exports) as
        | StudioWorkspace["exports"][number]
        | undefined;
      return named("entityExport", item?.workTitle);
    }
    default:
      return { label: t("entityWorkspace") };
  }
}

const LOCALIZED_FIELD_LABELS: Record<
  string,
  { zh: MessageKey; en: MessageKey }
> = {
  title: { zh: "titleZh", en: "titleEn" },
  name: { zh: "nameZh", en: "nameEn" },
  role: { zh: "roleZh", en: "roleEn" },
  summary: { zh: "summaryZh", en: "summaryEn" },
  logline: { zh: "loglineZh", en: "loglineEn" },
  tagline: { zh: "titleZh", en: "titleEn" },
  body: { zh: "foundationBodyZh", en: "foundationBodyEn" },
  brief: { zh: "workflowObjectiveZh", en: "workflowObjectiveEn" },
  deliverable: {
    zh: "workflowDeliverableZh",
    en: "workflowDeliverableEn",
  },
};

const FIELD_LABELS: Record<string, MessageKey> = {
  id: "fieldId",
  name: "name",
  title: "title",
  titleEn: "titleEn",
  summary: "summary",
  synopsis: "synopsis",
  logline: "logline",
  genre: "genre",
  genres: "genre",
  themes: "themes",
  status: "status",
  targetWords: "targetWords",
  coverColor: "coverColor",
  accent: "color",
  language: "language",
  content: "chapterBody",
  outline: "chapterOutline",
  pov: "chapterPov",
  number: "chapterNumber",
  chapters: "chapters",
  beats: "beats",
  adaptationNotes: "adaptationNotes",
  scenes: "scenes",
  characterIds: "workflowCast",
  locationId: "sceneLocation",
  universeId: "universe",
  workId: "novel",
  chapterId: "chapterTitle",
  parentId: "workflowParentTask",
  dependsOnIds: "workflowDependencies",
  standardRefs: "foundation",
  role: "role",
  appearance: "appearance",
  visualPrompt: "visualPrompt",
  personality: "personality",
  motivation: "motivation",
  flaw: "flaw",
  secret: "secret",
  voice: "voice",
  tags: "tags",
  color: "color",
  category: "loreCategory",
  body: "body",
  notes: "notes",
  goal: "goal",
  atmosphere: "atmosphere",
  visualMotif: "visualMotif",
  brief: "workflowObjective",
  deliverable: "workflowDeliverable",
  result: "workflowResult",
  strength: "strength",
  mutual: "mutual",
  sourceId: "sourceCharacter",
  targetId: "targetCharacter",
  type: "relationType",
  label: "relationLabel",
  kind: "kind",
};

function resolveField(
  segments: string[],
  locale: UiLocale,
  t: Translate,
): string {
  let index = segments.length - 1;
  let field = segments[index] ?? "";
  let language: "zh" | "en" | null = null;
  if (field === "zh" || field === "en") {
    language = field;
    index -= 1;
    field = segments[index] ?? "";
  }
  if (/^\d+$/.test(field)) {
    index -= 1;
    field = segments[index] ?? "";
  }
  if (language) {
    const localized = LOCALIZED_FIELD_LABELS[field];
    if (localized) return t(localized[language]);
  }
  const key = FIELD_LABELS[field];
  return key ? t(key) : t("fieldUnknown");
}

function describeReason(detail: WorkspaceIssueDetail, t: Translate): string {
  switch (detail.code) {
    case "too_small": {
      const min = detail.minimum ?? 0;
      if (detail.origin === "string") return t("issueTooShort", { min });
      if (detail.origin === "array" || detail.origin === "set")
        return t("issueTooFew", { min });
      return t("issueBelowMinimum", { min });
    }
    case "too_big": {
      const max = detail.maximum ?? 0;
      if (detail.origin === "string") return t("issueTooLong", { max });
      if (detail.origin === "array" || detail.origin === "set")
        return t("issueTooMany", { max });
      return t("issueExceedsMaximum", { max });
    }
    case "custom":
      return describeCustomReason(detail.message, t);
    case "invalid_type":
    case "invalid_value":
    case "invalid_format":
    case "not_multiple_of":
    case "unrecognized_keys":
    case "invalid_key":
    case "invalid_element":
    case "invalid_union":
      return t("issueInvalid");
    default:
      return detail.message;
  }
}

/**
 * The workspace schema uses `superRefine` for cross-entity rules, so those
 * failures arrive with English text. Recognise the rules we can translate and
 * keep the original text for anything new.
 */
function describeCustomReason(message: string, t: Translate): string {
  if (message === "chapter or story time is required")
    return t("issueMissingChapterOrTime");
  if (message === "work is required for a chapter task")
    return t("issueMissingNovel");
  if (message === "at least one state is required") return t("issueMissingState");
  if (message.endsWith("is required")) return t("issueRequired");
  if (/^duplicate (id|standard):/.test(message)) return t("issueDuplicate");
  if (/^unknown (task|standard): /.test(message)) {
    return t("issueUnknownNamed", { id: message.slice(message.indexOf(": ") + 2) });
  }
  if (/^unknown /.test(message)) return t("issueUnknownReference");
  if (/cannot (parent|depend on) itself/.test(message)) return t("issueSelfReference");
  if (/^workflow cycle: /.test(message)) return t("issueCycle");
  if (/belongs to another universe/.test(message)) return t("issueConflict");
  return message;
}
