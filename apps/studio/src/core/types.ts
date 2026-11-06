export const WORKSPACE_SCHEMA_VERSION = 2 as const;
export const ARC_REEL_SCHEMA = "iploom.arcreel/v1" as const;

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

export interface WorkflowTask {
  id: string;
  title: LocalizedText;
  brief: LocalizedText;
  deliverable: LocalizedText;
  result: LocalizedText;
  kind: WorkflowTaskKind;
  status: WorkflowTaskStatus;
  universeId?: string;
  workId?: string;
  chapterId?: string;
  parentId?: string;
  characterIds: string[];
  dependsOnIds: string[];
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
  universes: StoryUniverse[];
  characters: Character[];
  locations: StoryLocation[];
  factions: StoryFaction[];
  lore: LoreEntry[];
  relationships: Relationship[];
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
}

export interface RelationshipGraph {
  universeId: string;
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  warnings: string[];
}

export interface WorkspaceStats {
  universes: number;
  works: number;
  chapters: number;
  approvedChapters: number;
  words: number;
  characters: number;
  relationships: number;
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
  kind: "universe" | "work" | "chapter" | "character" | "location" | "faction" | "lore";
  id: string;
  universeId: string;
  workId?: string;
  chapterId?: string;
  title: string;
  subtitle: string;
  excerpt: string;
  score: number;
}
