export const WORKSPACE_SCHEMA_VERSION = 14 as const;
/** Longest result text the workspace stores per language. */
export const MAX_WORKFLOW_RESULT_LENGTH = 200_000 as const;
/** Longest text a localized name, tagline or summary field may hold per language. */
export const MAX_LOCALIZED_LENGTH = 500 as const;
/** Longest prompt the model client accepts for a single request. */
export const MAX_AI_PROMPT_LENGTH = 100_000 as const;
/**
 * Chapter text caps. Shared by the workspace schema and the manuscript
 * editor so the inputs stop at the same bound the save would reject.
 */
export const CHAPTER_LIMITS = {
  title: 300,
  pov: 300,
  summary: 20_000,
  outline: 200_000,
  content: 2_000_000,
  beats: 100,
  beatLength: 5_000,
  adaptationNotes: 50_000,
} as const;

export type UiLocale = "zh-CN" | "en";
export type ThemeMode = "system" | "light" | "dark";
export type WorkStatus =
  | "concept"
  | "outlining"
  | "drafting"
  | "complete"
  | "archived";
export type ChapterStatus =
  | "idea"
  | "outline"
  | "draft"
  | "revised"
  | "approved";
export type RelationshipStatus = "active" | "broken" | "hidden";
export type RelationshipType =
  | "family"
  | "ally"
  | "friend"
  | "rival"
  | "enemy"
  | "mentor"
  | "romance"
  | "debt"
  | "other";
export type LoreCategory =
  | "rule"
  | "history"
  | "culture"
  | "technology"
  | "power"
  | "mystery";
export type WorkflowTaskKind =
  | "world"
  | "novel"
  | "chapter"
  | "character"
  | "review"
  | "adaptation";
export type WorkflowTaskStatus = "queued" | "active" | "review" | "done";
/**
 * Stage templates a workflow task can be assembled from. Stored explicitly on
 * the task so renaming its title never silently changes its instructions.
 */
export const WORKFLOW_TASK_TEMPLATES = [
  "world",
  "chapter",
  "character",
  "costume",
  "relationship",
  "location",
  "scene",
  "storyboard",
  "review",
] as const;
export type WorkflowTaskTemplate = (typeof WORKFLOW_TASK_TEMPLATES)[number];
/**
 * Foundational standards keep AI output coherent across every project type.
 * They are registered on the workspace, not derived from a particular genre.
 */
export type StandardKind =
  | "style"
  | "format"
  | "naming"
  | "numeric"
  | "entity-prompt"
  | "continuity";
export type StandardStatus = "draft" | "active" | "disabled";
export type TimelineSubjectKind = "character" | "scene" | "location" | "object";
export type TimelineEventKind =
  | "introduction"
  | "state-change"
  | "transfer"
  | "reveal"
  | "loss"
  | "recovery"
  | "other";
export type TimelineCanonStatus = "proposed" | "canon";

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface StoryShot {
  id: string;
  shotType: string;
  description: string;
  dialogue: string;
  camera: string;
  durationMs: number;
  visualPrompt: string;
}

export interface StoryScene {
  id: string;
  title: string;
  summary: string;
  locationId?: string;
  characterIds: string[];
  shots: StoryShot[];
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  titleEn: string;
  status: ChapterStatus;
  pov: string;
  summary: string;
  outline: string;
  content: string;
  beats: string[];
  characterIds: string[];
  locationId?: string;
  adaptationNotes: string;
  scenes: StoryScene[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a world produces. A novel is written chapter by chapter; a game is
 * built from its own node pack and handed to an external agent for the rest.
 * Everything a work owns is scoped by its id, so one world can hold both.
 */
export type WorkKind = "novel" | "game";

export interface StoryWork {
  id: string;
  universeId: string;
  kind: WorkKind;
  title: LocalizedText;
  logline: LocalizedText;
  synopsis: string;
  status: WorkStatus;
  language: UiLocale;
  genre: string;
  themes: string[];
  targetWords: number;
  coverColor: string;
  chapters: Chapter[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryUniverse {
  id: string;
  name: LocalizedText;
  tagline: LocalizedText;
  summary: LocalizedText;
  genres: string[];
  themes: string[];
  accent: string;
  createdAt: string;
  updatedAt: string;
}

export interface Character {
  id: string;
  universeIds: string[];
  name: LocalizedText;
  role: LocalizedText;
  summary: LocalizedText;
  appearance: string;
  visualPrompt: string;
  personality: string;
  motivation: string;
  flaw: string;
  secret: string;
  voice: string;
  tags: string[];
  color: string;
  reusable: boolean;
  /** Optional per-rule-system tier, attribute values and learned abilities. */
  ruleBindings?: CharacterRuleBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryLocation {
  id: string;
  universeId: string;
  name: LocalizedText;
  summary: LocalizedText;
  atmosphere: string;
  visualPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryObject {
  id: string;
  universeId: string;
  name: LocalizedText;
  category: LocalizedText;
  summary: LocalizedText;
  visualPrompt: string;
  sourceNotes: string;
  /** Optional structured stat block linked to a universe rule system. */
  ruleBinding?: StoryObjectRuleBinding;
  createdAt: string;
  updatedAt: string;
}

export interface StoryFaction {
  id: string;
  universeId: string;
  name: LocalizedText;
  summary: LocalizedText;
  goal: string;
  visualMotif: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoreEntry {
  id: string;
  universeId: string;
  category: LoreCategory;
  title: LocalizedText;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Relationship {
  id: string;
  universeId: string;
  sourceId: string;
  targetId: string;
  type: RelationshipType;
  label: LocalizedText;
  strength: number;
  status: RelationshipStatus;
  mutual: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  universeId: string;
  workId: string;
  chapterId?: string;
  sceneId?: string;
  storyTime: string;
  order: number;
  subjectKind: TimelineSubjectKind;
  subjectId: string;
  eventKind: TimelineEventKind;
  title: LocalizedText;
  stateBefore: string;
  stateAfter: string;
  canonStatus: TimelineCanonStatus;
  relatedCharacterIds: string[];
  relatedLocationIds: string[];
  relatedObjectIds: string[];
  evidence: string;
  productionPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStandard {
  id: string;
  title: LocalizedText;
  kind: StandardKind;
  universeId?: string;
  body: LocalizedText;
  status: StandardStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The standard identity a task was composed against, pinned to its version. */
export interface StandardRef {
  id: string;
  version: number;
}

export type RuleSystemKind = "power" | "attribute" | "custom";
export type RuleAttributeType = "integer" | "decimal" | "enum" | "text";
export type RuleEffectOperation = "add" | "set" | "multiply";
/** Rule-layer records follow the same review lifecycle as prose standards. */
export type RuleStatus = StandardStatus;

/** One typed value the rule system defines once and every entity cites by key. */
export interface RuleAttribute {
  key: string;
  label: LocalizedText;
  type: RuleAttributeType;
  unit: string;
  min?: number;
  max?: number;
  enumValues: string[];
  defaultValue?: number | string;
  description: string;
}

/** One rung of an ordered ladder, from rank 1 upward with no gaps. */
export interface RuleTier {
  id: string;
  name: LocalizedText;
  rank: number;
  minValue?: number;
  maxValue?: number;
  summary: string;
}

/**
 * A universe-scoped structured rule set: an ordered tier ladder, typed
 * attributes, and the unit conventions that give their numbers meaning.
 * Prose stays in `WorkspaceStandard`; this record is the machine-readable half.
 */
export interface RuleSystem {
  id: string;
  universeId: string;
  title: LocalizedText;
  kind: RuleSystemKind;
  summary: string;
  unit: string;
  tiers: RuleTier[];
  attributes: RuleAttribute[];
  status: RuleStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A numeric change an ability or item applies through an attribute key. */
export interface RuleEffect {
  attributeKey: string;
  operation: RuleEffectOperation;
  value: number;
}

export interface AbilityTemplate {
  id: string;
  universeId: string;
  ruleSystemId: string;
  name: LocalizedText;
  summary: LocalizedText;
  tierId?: string;
  effects: RuleEffect[];
  cost: string;
  createdAt: string;
  updatedAt: string;
}

export interface ItemStatTemplate {
  id: string;
  universeId: string;
  ruleSystemId: string;
  name: LocalizedText;
  category: LocalizedText;
  tierId?: string;
  stats: RuleEffect[];
  summary: LocalizedText;
  createdAt: string;
  updatedAt: string;
}

/**
 * A character's structured standing under one universe-scoped rule system.
 * Meaning (tier bounds, attribute types, units) lives once on the rule system
 * rather than being restated per character.
 */
export interface CharacterRuleBinding {
  ruleSystemId: string;
  tierId?: string;
  attributes: Record<string, number | string>;
  abilityIds: string[];
}

/**
 * Structured stat block linking a story object to a universe rule system and
 * optional item stat template.
 */
export interface StoryObjectRuleBinding {
  ruleSystemId: string;
  itemStatTemplateId?: string;
  tierId?: string;
  stats: RuleEffect[];
}

export type CardFieldType = "integer" | "decimal" | "text" | "enum";

/**
 * Built-in behavior keys understood by the renderer, validation and export
 * mapping. A CardType may store any valid key string so unknown or future keys
 * survive round-trips and safely fall back to `"generic"`.
 */
export const BUILT_IN_CARD_BEHAVIORS = [
  "generic",
  "character",
  "location",
  "faction",
  "object",
  "lore",
  "scene",
  "monster",
  "equipment",
] as const;
export type BuiltInCardBehavior = (typeof BUILT_IN_CARD_BEHAVIORS)[number];

/** Curated icon keys available for card types in the Studio UI. */
export const CARD_TYPE_ICONS = [
  "layers",
  "users",
  "world",
  "grid",
  "package",
  "book",
  "sparkles",
  "file",
  "timeline",
  "graph",
  "link",
] as const;
export type CardTypeIcon = (typeof CARD_TYPE_ICONS)[number];

/**
 * One typed value a card type defines. Instances fill it by key, so the same
 * set of fields can describe many cards without a new entity kind per shape.
 */
export interface CardField {
  key: string;
  label: LocalizedText;
  type: CardFieldType;
  unit: string;
  min?: number;
  max?: number;
  enumValues: string[];
  defaultValue?: number | string;
}

/**
 * A user-defined card shape: a name, visual icon/color, behavior key plus the
 * ordered fields every card carries. A type belongs to exactly one universe,
 * so two worlds can have their own node vocabulary without sharing records.
 */
export interface CardType {
  id: string;
  universeId: string;
  /**
   * The work this type belongs to. Absent on world-level types shared by every
   * work of that world; a game quick build creates its own pack instead.
   */
  workId?: string;
  name: LocalizedText;
  summary: LocalizedText;
  icon: string;
  color: string;
  behavior: string;
  fields: CardField[];
  createdAt: string;
  updatedAt: string;
}

/** One instance of a card type, with a value per field key. */
export interface Card {
  id: string;
  typeId: string;
  title: LocalizedText;
  values: Record<string, number | string>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** A labelled relation between two cards of any type. */
export interface CardEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: LocalizedText;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A quick construct applied inside one universe. The same construct can be
 * applied once in every universe, so identity is (universeId, id).
 */
export interface AppliedConstruct {
  id: string;
  universeId: string;
  /** Set when the construct was applied inside one work instead of the world. */
  workId?: string;
  name: LocalizedText;
  appliedAt: string;
}

/** Metadata about the model run that produced a task's current result. */
export interface WorkflowTaskRunMeta {
  model: string;
  promptSha256: string;
  sourceRevision: number;
  at: string;
}

export interface WorkflowTask {
  id: string;
  title: LocalizedText;
  brief: LocalizedText;
  deliverable: LocalizedText;
  result: LocalizedText;
  /** The result this task had before the most recent model run overwrote it. */
  previousResult?: LocalizedText;
  /** Metadata for the run that produced the current result, if it came from a run. */
  lastRun?: WorkflowTaskRunMeta;
  /** Set on done dependents when an upstream task's result was replaced. */
  resultSuperseded?: boolean;
  kind: WorkflowTaskKind;
  /** Production stage template. Absent on handmade tasks and pre-v7 workspaces. */
  template?: WorkflowTaskTemplate;
  status: WorkflowTaskStatus;
  universeId?: string;
  workId?: string;
  chapterId?: string;
  parentId?: string;
  characterIds: string[];
  dependsOnIds: string[];
  standardRefs: StandardRef[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSettings {
  locale: UiLocale;
  theme: ThemeMode;
}

export interface StudioWorkspace {
  schema_version: typeof WORKSPACE_SCHEMA_VERSION;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedWorkId?: string;
  settings: WorkspaceSettings;
  standards: WorkspaceStandard[];
  ruleSystems: RuleSystem[];
  abilityTemplates: AbilityTemplate[];
  itemStatTemplates: ItemStatTemplate[];
  cardTypes: CardType[];
  cards: Card[];
  cardEdges: CardEdge[];
  constructs: AppliedConstruct[];
  universes: StoryUniverse[];
  characters: Character[];
  locations: StoryLocation[];
  storyObjects: StoryObject[];
  factions: StoryFaction[];
  lore: LoreEntry[];
  relationships: Relationship[];
  timelineEvents: TimelineEvent[];
  workflowTasks: WorkflowTask[];
  works: StoryWork[];
}

export interface RelationshipNode {
  id: string;
  kind: "character" | "location" | "faction";
  label: string;
  secondary: string;
  color: string;
  degree: number;
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  label: string;
  strength: number;
  status: RelationshipStatus;
  mutual: boolean;
  notes: string;
}

export interface RelationshipGraph {
  universeId: string;
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  warnings: string[];
}

export interface WorkspaceStats {
  standards: number;
  activeStandards: number;
  universes: number;
  works: number;
  chapters: number;
  approvedChapters: number;
  words: number;
  characters: number;
  storyObjects: number;
  relationships: number;
  timelineEvents: number;
  workflowTasks: number;
}

export interface SearchHit {
  kind:
    | "universe"
    | "work"
    | "chapter"
    | "character"
    | "location"
    | "object"
    | "faction"
    | "lore"
    | "timeline"
    | "card";
  id: string;
  universeId: string;
  /**
   * Every universe a character belongs to. `universeId` keeps the first entry
   * for records that only read one world; filtering uses this list when set.
   */
  universeIds?: string[];
  workId?: string;
  chapterId?: string;
  cardTypeId?: string;
  title: string;
  subtitle: string;
  excerpt: string;
  score: number;
}
