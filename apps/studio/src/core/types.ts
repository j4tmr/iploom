export const WORKSPACE_SCHEMA_VERSION = 7 as const;
export const ARC_REEL_SCHEMA = "iploom.arcreel/v1" as const;
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
export type WorkflowTaskStatus =
  | "queued"
  | "active"
  | "review"
  | "done";
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
export type TimelineSubjectKind =
  | "character"
  | "scene"
  | "location"
  | "object";
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

export interface StoryWork {
  id: string;
  universeId: string;
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
  defaultAspectRatio: "9:16" | "16:9" | "1:1";
  exportApprovedOnly: boolean;
}

export interface ExportRecord {
  id: string;
  workId: string;
  workTitle: string;
  createdAt: string;
  chapterIds: string[];
  fileCount: number;
  bytes: number;
  manifestSha256: string;
  outputPath?: string;
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
  exports: ExportRecord[];
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

export interface ArcReelFile {
  path: string;
  content: string;
  mediaType: "application/json" | "text/markdown" | "text/plain";
}

export interface ArcReelChapterPreview {
  chapterId: string;
  number: number;
  title: string;
  status: ChapterStatus;
  words: number;
  sceneCount: number;
  shotCount: number;
}

export interface ArcReelBundle {
  schema: typeof ARC_REEL_SCHEMA;
  generatedAt: string;
  workspaceRevision: number;
  universeId: string;
  workId: string;
  workTitle: string;
  workLanguage: UiLocale;
  aspectRatio: string;
  style: "stylized-3d-animation";
  chapters: ArcReelChapterPreview[];
  totalWords: number;
  totalScenes: number;
  totalShots: number;
  warnings: string[];
  files: ArcReelFile[];
  manifestSha256: string;
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
    | "timeline";
  id: string;
  universeId: string;
  /**
   * Every universe a character belongs to. `universeId` keeps the first entry
   * for records that only read one world; filtering uses this list when set.
   */
  universeIds?: string[];
  workId?: string;
  chapterId?: string;
  title: string;
  subtitle: string;
  excerpt: string;
  score: number;
}
