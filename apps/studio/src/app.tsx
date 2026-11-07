import { useEffect, useMemo, useState } from "react";
import type { AiConfigInfo } from "./core/ai.ts";
import {
  attachOverlayKeyboard,
  isComposingEvent,
  overlayStack,
} from "./core/overlay-stack.ts";
import { buildRelationshipGraph } from "./core/graph.ts";
import { setWorkflowTaskResult, taskDescendantIds } from "./core/workflow.ts";
import { removeSceneReferences } from "./core/timeline.ts";
import {
  deleteChapterFromDraft,
  deleteCharacterFromDraft,
  deleteUniverseFromDraft,
  deleteWorkFromDraft,
  reassignStandardUniverse,
  saveWorkFromEditor,
  unlinkCharacterFromUniverse,
} from "./core/integrity.ts";
import {
  createId,
  displayText,
  findWork,
  nextChapterNumber,
  workWords,
} from "./core/factory.ts";
import type {
  ArcReelBundle,
  Character,
  Chapter,
  ExportRecord,
  LoreEntry,
  Relationship,
  SearchHit,
  StoryFaction,
  StoryLocation,
  StoryObject,
  StoryUniverse,
  StoryWork,
  StudioWorkspace,
  StandardStatus,
  TimelineEvent,
  ThemeMode,
  UiLocale,
  WorkflowTask,
  WorkflowTaskRunMeta,
  WorkflowTaskStatus,
  WorkspaceSettings,
  WorkspaceStandard,
} from "./core/types.ts";
import {
  dictionaries,
  formatNumber,
  translator,
  type Translate,
} from "./i18n.ts";
import { MAX_WORKFLOW_RESULT_LENGTH } from "./core/types.ts";
import { bridge, type AppInfo } from "./platform.ts";
import {
  applyTheme,
  useStudioWorkspace,
} from "./use-studio-workspace.ts";
import type { StudioRoute } from "./routes.ts";
import { describeWorkspaceProblem } from "./validation-message.ts";
import { Sidebar, Topbar } from "./components/app-shell.tsx";
import {
  AtlasModal,
  ChapterModal,
  CharacterModal,
  NovelModal,
  RelationshipModal,
  StandardModal,
  UniverseModal,
  WorkflowTaskModal,
} from "./components/forms.tsx";
import { Icon } from "./components/icon.tsx";
import { SearchOverlay } from "./components/search-overlay.tsx";
import { useToast } from "./components/use-toast.ts";
import {
  Button,
  Modal,
  Toast,
} from "./components/ui.tsx";
import { CastLibrary } from "./views/cast-library.tsx";
import { Dashboard } from "./views/dashboard.tsx";
import { ExportsView } from "./views/exports-view.tsx";
import { LibraryView } from "./views/library-view.tsx";
import { RelationshipsView } from "./views/relationships-view.tsx";
import { SettingsView } from "./views/settings-view.tsx";
import { FoundationView } from "./views/foundation-view.tsx";
import { UniverseView } from "./views/universe-view.tsx";
import { WorkView } from "./views/work-view.tsx";
import { WorkflowView } from "./views/workflow-view.tsx";
import { ProductionPanel } from "./components/production-panel.tsx";
import { ManuscriptImport } from "./components/manuscript-import.tsx";
import { mergeManuscriptImport } from "./core/manuscript.ts";
import { StoryObjectModal, TimelineEventModal } from "./components/timeline-forms.tsx";
import { TimelineView } from "./views/timeline-view.tsx";
import type { StandardCandidate } from "./core/standards.ts";

type ModalState =
  | { kind: "import" }
  | { kind: "world"; initial?: StoryUniverse }
  | { kind: "novel"; universeId?: string; initial?: StoryWork }
  | { kind: "character"; initial?: Character; universeId?: string }
  | { kind: "relationship"; universeId: string; initial?: Relationship }
  | {
      kind: "timeline";
      universeId?: string;
      workId?: string;
      chapterId?: string;
      initial?: TimelineEvent;
    }
  | { kind: "object"; universeId?: string; initial?: StoryObject }
  | {
      kind: "atlas";
      atlasKind: "location" | "faction" | "lore";
      universeId: string;
      initial?: StoryLocation | StoryFaction | LoreEntry;
    }
  | { kind: "chapter"; workId: string }
  | {
      kind: "task";
      initial?: WorkflowTask;
      parentId?: string;
      universeId?: string;
      workId?: string;
    }
  | { kind: "mcp" }
  | { kind: "standard"; initial?: WorkspaceStandard };

export function App() {
  const state = useStudioWorkspace();
  const { workspace } = state;
  const locale: UiLocale = workspace?.settings.locale ?? "zh-CN";
  const t = useMemo(() => translator(locale), [locale]);
  const [route, setRoute] = useState<StudioRoute>({ name: "dashboard" });
  const [history, setHistory] = useState<StudioRoute[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const { toast, notify } = useToast();
  const [aiInfo, setAiInfo] = useState<AiConfigInfo | null>(null);

  const navigate = (next: StudioRoute) => {
    setHistory((current) => [...current, route].slice(-30));
    setRoute(next);
  };

  const replaceRoute = (next: StudioRoute) => setRoute(next);

  const back = () => {
    setHistory((current) => {
      const previous = current.at(-1) ?? { name: "dashboard" };
      setRoute(previous);
      return current.slice(0, -1);
    });
  };

  /**
   * Persist pending edits, then store a snapshot outside the rotating `.bak`
   * slot. Destructive actions abort when this fails: without a snapshot the
   * deleted content would have no recoverable copy.
   */
  const snapshotBefore = async (reason: string): Promise<boolean> => {
    try {
      await state.saveNow();
      await bridge.createSnapshot(reason);
      return true;
    } catch {
      notify(t("snapshotFailed"));
      return false;
    }
  };

  const theme = workspace?.settings.theme ?? "system";
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [theme]);

  useEffect(() => {
    void bridge.aiConfig().then(setAiInfo).catch(() => setAiInfo(null));
  }, []);

  // One capture-phase Escape listener for every overlay. Overlays register in
  // open order, so Escape closes the palette before the dialog beneath it.
  useEffect(() => attachOverlayKeyboard(overlayStack, window), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never steal shortcuts from an open IME composition.
      if (isComposingEvent(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        void state.saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.saveNow]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (state.saveState === "loading" || !workspace) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">界</div>
        <p>{state.error ? t("errorTitle") : t("loading")}</p>
        {state.error ? (
          <>
            <pre>{state.error}</pre>
            <Button icon="arrowLeft" onClick={() => window.location.reload()}>{t("retry")}</Button>
          </>
        ) : (
          <span className="boot-loader" />
        )}
      </div>
    );
  }

  const universe =
    route.name === "universe"
      ? workspace.universes.find((item) => item.id === route.id)
      : undefined;
  const work =
    route.name === "work" ? findWork(workspace, route.workId) : undefined;
  const topbarCopy = (() => {
    if (route.name === "universe" && universe)
      return {
        eyebrow: "IP UNIVERSE / 宇宙",
        title: displayText(universe.name, locale),
      };
    if (route.name === "work" && work)
      return {
        eyebrow: "NOVEL / 小说",
        title: displayText(work.title, locale),
      };
    if (route.name === "cast")
      return { eyebrow: "CAST SYSTEM / 人物系统", title: t("cast") };
    if (route.name === "library")
      return { eyebrow: "LIBRARY / 小说书架", title: t("library") };
    if (route.name === "graph")
      return { eyebrow: "RELATION MAP / 关系图", title: t("relationships") };
    if (route.name === "timeline")
      return { eyebrow: "STORY STATE / 故事状态", title: t("timeline") };
    if (route.name === "workflow")
      return { eyebrow: "AI WORKFLOW / 创作流水线", title: t("workflow") };
    if (route.name === "foundation")
      return { eyebrow: "FOUNDATION / 基础规则", title: t("foundation") };
    if (route.name === "exports")
      return { eyebrow: "ARCREEL / 漫剧交付", title: t("exports") };
    if (route.name === "settings")
      return { eyebrow: "PREFERENCES / 设置", title: t("settings") };
    return { eyebrow: "IPLOOM STUDIO / 造界工坊", title: t("dashboard") };
  })();

  const mutate = state.mutate;

  /**
   * Structural edits must leave a workspace that can still be saved. Rejected
   * changes keep the previous state intact and tell the user what blocked them.
   */
  const mutateChecked = (change: (draft: StudioWorkspace) => void): boolean => {
    const outcome = state.applyChange(change);
    if (outcome.ok) return true;
    const problem = describeWorkspaceProblem(
      outcome.details,
      workspace,
      locale,
      t,
    );
    notify(`${t("changeRejected")} ${problem || outcome.error}`);
    return false;
  };

  const saveUniverse = (next: StoryUniverse): boolean => {
    const exists = workspace.universes.some((item) => item.id === next.id);
    const applied = mutateChecked((draft) => {
      const index = draft.universes.findIndex((item) => item.id === next.id);
      if (index >= 0) draft.universes[index] = next;
      else draft.universes.push(next);
    });
    if (!applied) return false;
    if (!exists) navigate({ name: "universe", id: next.id });
    notify(t("saved"));
    return true;
  };

  const saveNovel = (next: StoryWork): boolean => {
    const exists = workspace.works.some((item) => item.id === next.id);
    const applied = mutateChecked((draft) => saveWorkFromEditor(draft, next));
    if (!applied) return false;
    if (!exists) navigate({ name: "work", workId: next.id });
    notify(t("saved"));
    return true;
  };

  const deleteUniverse = async (target: StoryUniverse) => {
    if (!window.confirm(t("confirmDeleteWorld"))) return;
    if (!(await snapshotBefore("before-delete-world"))) return;
    if (!mutateChecked((draft) => deleteUniverseFromDraft(draft, target.id)))
      return;
    replaceRoute({ name: "dashboard" });
    setHistory([]);
    notify(t("saved"));
  };

  const deleteNovel = async (target: StoryWork) => {
    if (!window.confirm(t("confirmDeleteNovel"))) return;
    if (!(await snapshotBefore("before-delete-novel"))) return;
    if (!mutateChecked((draft) => deleteWorkFromDraft(draft, target.id)))
      return;
    replaceRoute({ name: "universe", id: target.universeId, tab: "stories" });
    notify(t("saved"));
  };

  const saveCharacter = (next: Character): boolean => {
    return mutateChecked((draft) => {
      const index = draft.characters.findIndex((item) => item.id === next.id);
      const previous = index >= 0 ? draft.characters[index] : undefined;
      const removedUniverses = previous
        ? previous.universeIds.filter((id) => !next.universeIds.includes(id))
        : [];
      if (index >= 0) draft.characters[index] = next;
      else draft.characters.push(next);
      for (const universeId of removedUniverses)
        unlinkCharacterFromUniverse(draft, next.id, universeId);
    });
  };

  const removeCharacterFromUniverse = (character: Character, universeId: string) => {
    if (
      !window.confirm(
        t("confirmRemoveCharacterFromWorld"),
      )
    )
      return;
    if (
      !mutateChecked((draft) =>
        unlinkCharacterFromUniverse(draft, character.id, universeId),
      )
    )
      return;
    notify(t("saved"));
  };

  const deleteCharacter = (character: Character, universeId?: string) => {
    if (character.universeIds.length > 1) {
      const message = t("confirmDeleteCharacterEverywhere", {
        worlds: character.universeIds.length,
      });
      if (!window.confirm(message)) return;
    } else if (!window.confirm(t("confirmDelete"))) return;
    mutateChecked((draft) => deleteCharacterFromDraft(draft, character.id));
  };

  const saveRelationship = (relationship: Relationship): boolean => {
    return mutateChecked((draft) => {
      const index = draft.relationships.findIndex((item) => item.id === relationship.id);
      if (index < 0) draft.relationships.push(relationship);
      else draft.relationships[index] = relationship;
    });
  };

  const saveTimelineEvent = (event: TimelineEvent): boolean => {
    const applied = mutateChecked((draft) => {
      const index = draft.timelineEvents.findIndex((item) => item.id === event.id);
      if (index >= 0) draft.timelineEvents[index] = event;
      else draft.timelineEvents.push(event);
    });
    if (applied) notify(t("saved"));
    return applied;
  };

  const deleteTimelineEvent = (event: TimelineEvent) => {
    if (!window.confirm(t("confirmDelete"))) return;
    mutateChecked((draft) => {
      draft.timelineEvents = draft.timelineEvents.filter(
        (item) => item.id !== event.id,
      );
    });
  };

  const saveObject = (object: StoryObject): boolean => {
    const applied = mutateChecked((draft) => {
      const index = draft.storyObjects.findIndex((item) => item.id === object.id);
      if (index >= 0) draft.storyObjects[index] = object;
      else draft.storyObjects.push(object);
    });
    if (applied) notify(t("saved"));
    return applied;
  };

  const deleteObject = (object: StoryObject) => {
    if (!window.confirm(t("confirmDelete"))) return;
    mutateChecked((draft) => {
      draft.storyObjects = draft.storyObjects.filter(
        (item) => item.id !== object.id,
      );
      draft.timelineEvents = draft.timelineEvents
        .filter(
          (event) =>
            event.subjectKind !== "object" || event.subjectId !== object.id,
        )
        .map((event) => ({
          ...event,
          relatedObjectIds: event.relatedObjectIds.filter(
            (id) => id !== object.id,
          ),
        }));
    });
  };

  const saveAtlas = (
    value:
      | StoryLocation
      | StoryFaction
      | {
          id: string;
          universeId: string;
          category: LoreEntry["category"];
          title: { zh: string; en: string };
          body: string;
          createdAt: string;
          updatedAt: string;
        },
  ) => {
    return mutateChecked((draft) => {
      if ("body" in value) {
        const index = draft.lore.findIndex((item) => item.id === value.id);
        if (index >= 0) draft.lore[index] = value as LoreEntry;
        else draft.lore.push(value as LoreEntry);
      } else if ("atmosphere" in value) {
        const index = draft.locations.findIndex((item) => item.id === value.id);
        if (index >= 0) draft.locations[index] = value;
        else draft.locations.push(value);
      } else {
        const index = draft.factions.findIndex((item) => item.id === value.id);
        if (index >= 0) draft.factions[index] = value;
        else draft.factions.push(value);
      }
    });
  };

  const saveWorkflowTask = (next: WorkflowTask): boolean => {
    const applied = mutateChecked((draft) => {
      const index = draft.workflowTasks.findIndex((item) => item.id === next.id);
      if (index >= 0) draft.workflowTasks[index] = next;
      else draft.workflowTasks.push(next);
    });
    if (applied) notify(t("saved"));
    return applied;
  };

  const deleteWorkflowTask = (task: WorkflowTask) => {
    const removed = new Set([
      task.id,
      ...taskDescendantIds(workspace.workflowTasks, task.id),
    ]);
    const message =
      removed.size > 1
        ? locale === "en"
          ? `Delete this task and ${removed.size - 1} subtask(s)?`
          : `确定删除此任务及其 ${removed.size - 1} 个子任务吗？`
        : t("confirmDelete");
    if (!window.confirm(message)) return;
    mutateChecked((draft) => {
      draft.workflowTasks = draft.workflowTasks
        .filter((item) => !removed.has(item.id))
        .map((item) => ({
          ...item,
          parentId:
            item.parentId && removed.has(item.parentId)
              ? undefined
              : item.parentId,
          dependsOnIds: item.dependsOnIds.filter((id) => !removed.has(id)),
        }));
    });
  };

  const changeWorkflowStatus = (
    task: WorkflowTask,
    status: WorkflowTaskStatus,
  ) => {
    mutate((draft) => {
      const target = draft.workflowTasks.find((item) => item.id === task.id);
      if (!target) return;
      target.status = status;
      if (status === "done") delete target.resultSuperseded;
      target.updatedAt = new Date().toISOString();
    });
  };

  const saveWorkflowResult = (
    task: WorkflowTask,
    result: string,
    run?: WorkflowTaskRunMeta,
  ): boolean => {
    if (result.length > MAX_WORKFLOW_RESULT_LENGTH) {
      notify(
        t("resultTooLong", {
          limit: formatNumber(MAX_WORKFLOW_RESULT_LENGTH, locale),
        }),
      );
      return false;
    }
    let found = false;
    const applied = mutateChecked((draft) => {
      found = setWorkflowTaskResult(draft, task.id, result, locale, run);
    });
    const saved = applied && found;
    if (saved) notify(t("saved"));
    return saved;
  };

  const saveStandard = (next: WorkspaceStandard): boolean => {
    const applied = mutateChecked((draft) => {
      const index = draft.standards.findIndex((item) => item.id === next.id);
      if (index >= 0) draft.standards[index] = next;
      else draft.standards.push(next);
      reassignStandardUniverse(draft, next.id, next.universeId);
    });
    if (applied) notify(t("saved"));
    return applied;
  };

  const changeStandardStatus = (
    standard: WorkspaceStandard,
    status: StandardStatus,
  ) => {
    mutate((draft) => {
      const target = draft.standards.find((item) => item.id === standard.id);
      if (!target || target.status === status) return;
      target.status = status;
      target.updatedAt = new Date().toISOString();
    });
  };

  const registerStandardCandidates = (candidates: StandardCandidate[]) => {
    if (candidates.length === 0) return;
    const room = Math.max(0, 1_000 - workspace.standards.length);
    const accepted = candidates.slice(0, room);
    if (accepted.length === 0) {
      notify(t("foundationLimitReached"));
      return;
    }
    const now = new Date().toISOString();
    mutate((draft) => {
      for (const candidate of accepted.slice(
        0,
        Math.max(0, 1_000 - draft.standards.length),
      )) {
        draft.standards.push({
          id: createId("std"),
          kind: candidate.kind,
          title: candidate.title,
          body: candidate.body,
          status: "draft",
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    notify(
      accepted.length < candidates.length
        ? t("foundationLimitReached")
        : t("foundationRegistered"),
    );
  };

  const deleteAtlas = (kind: "location" | "faction" | "lore", id: string) => {
    if (!window.confirm(t("confirmDelete"))) return;
    mutateChecked((draft) => {
      if (kind === "location") {
        draft.locations = draft.locations.filter((item) => item.id !== id);
        draft.timelineEvents = draft.timelineEvents
          .filter(
            (event) =>
              event.subjectKind !== "location" || event.subjectId !== id,
          )
          .map((event) => ({
            ...event,
            relatedLocationIds: event.relatedLocationIds.filter(
              (locationId) => locationId !== id,
            ),
          }));
        for (const item of draft.works) {
          for (const chapter of item.chapters) {
            if (chapter.locationId === id) chapter.locationId = undefined;
            for (const scene of chapter.scenes)
              if (scene.locationId === id) scene.locationId = undefined;
          }
        }
      } else if (kind === "faction") {
        draft.factions = draft.factions.filter((item) => item.id !== id);
      } else {
        draft.lore = draft.lore.filter((item) => item.id !== id);
      }
    });
  };

  const addChapter = (workId: string, chapter: Chapter): boolean => {
    return mutateChecked((draft) => {
      const target = draft.works.find((item) => item.id === workId);
      if (!target) return;
      target.chapters.push(chapter);
      target.updatedAt = new Date().toISOString();
    });
  };

  const deleteChapter = async (workId: string, chapter: Chapter) => {
    if (!window.confirm(t("confirmDelete"))) return;
    if (!(await snapshotBefore("before-delete-chapter"))) return;
    mutateChecked((draft) => {
      deleteChapterFromDraft(draft, workId, chapter.id);
      const target = draft.works.find((item) => item.id === workId);
      if (target) target.updatedAt = new Date().toISOString();
    });
  };

  const changeChapter = (
    workId: string,
    chapterId: string,
    change: (chapter: Chapter) => void,
  ) => {
    mutate((draft) => {
      const target = draft.works.find((item) => item.id === workId);
      const chapter = target?.chapters.find((item) => item.id === chapterId);
      if (!target || !chapter) return;
      const sceneIdsBefore = new Set(chapter.scenes.map((scene) => scene.id));
      change(chapter);
      const removedSceneIds = new Set(
        [...sceneIdsBefore].filter(
          (id) => !chapter.scenes.some((scene) => scene.id === id),
        ),
      );
      if (removedSceneIds.size > 0) {
        draft.timelineEvents = removeSceneReferences(
          draft.timelineEvents,
          workId,
          chapterId,
          removedSceneIds,
        );
      }
      chapter.revision += 1;
      chapter.updatedAt = new Date().toISOString();
      target.updatedAt = chapter.updatedAt;
    });
  };

  const recordExport = (
    bundle: ArcReelBundle,
    directory: string,
    files: number,
    bytes: number,
  ) => {
    let recorded = false;
    const applied = mutateChecked((draft) => {
      const work = draft.works.find((item) => item.id === bundle.workId);
      if (!work) return;
      const chapterIds = new Set(work.chapters.map((item) => item.id));
      const record: ExportRecord = {
        id: createId("export"),
        workId: work.id,
        workTitle: bundle.workTitle,
        createdAt: new Date().toISOString(),
        chapterIds: [
          ...new Set(
            bundle.chapters
              .map((chapter) => chapter.chapterId)
              .filter((id) => chapterIds.has(id)),
          ),
        ],
        fileCount: files,
        bytes,
        manifestSha256: bundle.manifestSha256,
        outputPath: directory,
      };
      draft.exports.unshift(record);
      recorded = true;
    });
    if (!applied) return;
    notify(recorded ? t("exportSuccess") : t("exportWorkMissing"));
  };

  const updateSettings = (change: Partial<WorkspaceSettings>) => {
    mutate((draft) => {
      Object.assign(draft.settings, change);
    });
  };

  const resetDemo = async () => {
    const loaded = await bridge.resetDemo(locale);
    state.replaceWorkspace(loaded.workspace);
    setRoute({ name: "dashboard" });
    setHistory([]);
    notify(
      loaded.snapshotPath
        ? t("snapshotSaved", { path: loaded.snapshotPath })
        : t("saved"),
    );
  };

  const restoreSnapshot = async (snapshotPath: string) => {
    const loaded = await bridge.restoreSnapshot(snapshotPath);
    state.replaceWorkspace(loaded.workspace);
    setRoute({ name: "dashboard" });
    setHistory([]);
    notify(t("snapshotRestored"));
  };

  const selectSearchHit = (hit: SearchHit) => {
    if (hit.kind === "universe") {
      navigate({ name: "universe", id: hit.universeId });
    } else if (hit.kind === "work" || hit.kind === "chapter") {
      if (hit.workId) navigate({ name: "work", workId: hit.workId });
    } else if (hit.kind === "character") {
      const character = workspace.characters.find((item) => item.id === hit.id);
      if (character) setModal({ kind: "character", initial: character });
    } else if (hit.kind === "location") {
      const location = workspace.locations.find((item) => item.id === hit.id);
      navigate({ name: "universe", id: hit.universeId, tab: "atlas" });
      if (location)
        setModal({
          kind: "atlas",
          atlasKind: "location",
          universeId: hit.universeId,
          initial: location,
        });
    } else if (hit.kind === "faction") {
      const faction = workspace.factions.find((item) => item.id === hit.id);
      navigate({ name: "universe", id: hit.universeId, tab: "atlas" });
      if (faction)
        setModal({
          kind: "atlas",
          atlasKind: "faction",
          universeId: hit.universeId,
          initial: faction,
        });
    } else if (hit.kind === "lore") {
      const entry = workspace.lore.find((item) => item.id === hit.id);
      navigate({ name: "universe", id: hit.universeId, tab: "atlas" });
      if (entry)
        setModal({
          kind: "atlas",
          atlasKind: "lore",
          universeId: hit.universeId,
          initial: entry,
        });
    } else if (hit.kind === "object") {
      const object = workspace.storyObjects.find((item) => item.id === hit.id);
      navigate({ name: "timeline", universeId: hit.universeId });
      if (object) setModal({ kind: "object", initial: object });
    } else if (hit.kind === "timeline") {
      const event = workspace.timelineEvents.find((item) => item.id === hit.id);
      navigate({ name: "timeline", universeId: hit.universeId });
      if (event) setModal({ kind: "timeline", initial: event });
    }
  };

  const defaultUniverseId =
    route.name === "universe"
      ? route.id
      : route.name === "timeline"
        ? route.universeId
      : work?.universeId;
  const chapterModalWork =
    modal?.kind === "chapter"
      ? workspace.works.find((item) => item.id === modal.workId)
      : undefined;

  return (
    <div className="studio-shell">
      <Sidebar
        workspace={workspace}
        route={route}
        locale={locale}
        t={t}
        onNavigate={navigate}
      />
      <div className="studio-column">
        <Topbar
          eyebrow={topbarCopy.eyebrow}
          title={topbarCopy.title}
          locale={locale}
          theme={theme}
          t={t}
          saveState={state.saveState}
          aiInfo={aiInfo}
          onSearch={() => setSearchOpen(true)}
          onSetLocale={(next) => updateSettings({ locale: next })}
          onToggleTheme={() => {
            const next: ThemeMode =
              theme === "dark" ? "light" : theme === "light" ? "dark" : "dark";
            updateSettings({ theme: next });
          }}
          onModelSettings={() => navigate({ name: "settings" })}
          onMcp={() => setModal({ kind: "mcp" })}
        />
        <main className="studio-main">
          <ProductionPanel
            workspace={workspace} locale={locale} t={t}
            aiInfo={aiInfo}
            onOpenSettings={() => navigate({ name: "settings" })}
            context={{ universeId: defaultUniverseId ?? workspace.universes[0]?.id, workId: work?.id, characterId: modal?.kind === "character" ? modal.initial?.id : undefined }}
            onTasks={(tasks) => mutateChecked((draft) => { for (const task of tasks) { const index = draft.workflowTasks.findIndex((item) => item.id === task.id); if (index < 0) draft.workflowTasks.push(task); else draft.workflowTasks[index] = task; } })}
            onStatus={changeWorkflowStatus} onResult={saveWorkflowResult}
          />
          {state.recovered ? (
            <div className="recovery-banner" title={state.rejectedReason ?? undefined}>
              <Icon name="check" size={16} />
              {state.rejectedPath
                ? t("recoveredFromBackup", { path: state.rejectedPath })
                : t("recoveredFromBackupNoQuarantine")}
            </div>
          ) : null}
          {state.error && state.saveState === "error" ? (
            <div className="error-banner">
              <strong>{t("errorTitle")}</strong>
              <span>{state.error}</span>
            </div>
          ) : null}

          {route.name === "dashboard" ? (
            <Dashboard
              workspace={workspace}
              locale={locale}
              t={t}
              onOpenUniverse={(item) => navigate({ name: "universe", id: item.id })}
              onOpenWork={(workId) => navigate({ name: "work", workId })}
              onNewWorld={() => setModal({ kind: "world" })}
              onNewNovel={() => setModal({ kind: "novel" })}
            />
          ) : null}

          {route.name === "library" ? (
            <LibraryView
              onImportNovel={() => setModal({ kind: "import" })}
              workspace={workspace}
              locale={locale}
              t={t}
              onOpenWork={(workId) => navigate({ name: "work", workId })}
              onNewNovel={() => setModal({ kind: "novel" })}
            />
          ) : null}

          {route.name === "universe" && universe ? (
            <UniverseView
              workspace={workspace}
              universe={universe}
              initialTab={route.tab}
              locale={locale}
              t={t}
              onBack={back}
              onEditUniverse={() => setModal({ kind: "world", initial: universe })}
              onDeleteUniverse={() => deleteUniverse(universe)}
              onOpenWork={(workId) => navigate({ name: "work", workId })}
              onNewNovel={() => setModal({ kind: "novel", universeId: universe.id })}
              onNewCharacter={() => setModal({ kind: "character", universeId: universe.id })}
              onEditCharacter={(character) => setModal({ kind: "character", initial: character, universeId: universe.id })}
              onDeleteCharacter={(character) =>
                deleteCharacter(character, universe.id)
              }
              onRemoveCharacterFromWorld={(character) =>
                removeCharacterFromUniverse(character, universe.id)
              }
              onAddAtlas={(atlasKind) => setModal({ kind: "atlas", atlasKind, universeId: universe.id })}
              onEditAtlas={(atlasKind, initial) => setModal({ kind: "atlas", atlasKind, universeId: universe.id, initial })}
              onDeleteAtlas={deleteAtlas}
              onAddRelationship={() => setModal({ kind: "relationship", universeId: universe.id })}
              onDeleteRelationship={(id) => {
                if (window.confirm(t("confirmDelete")))
                  mutate((draft) => {
                    draft.relationships = draft.relationships.filter((item) => item.id !== id);
                  });
              }}
            />
          ) : null}

          {route.name === "work" && work ? (
            <WorkView
              key={work.id}
              workspace={workspace}
              work={work}
              locale={locale}
              t={t}
              onBack={back}
              onOpenUniverse={() => navigate({ name: "universe", id: work.universeId })}
              onEditWork={() => setModal({ kind: "novel", initial: work })}
              onDeleteWork={() => deleteNovel(work)}
              onAddChapter={() => setModal({ kind: "chapter", workId: work.id })}
              onOpenTimeline={(chapterId) =>
                {
                  navigate({
                    name: "timeline",
                    universeId: work.universeId,
                  });
                  setModal({
                    kind: "timeline",
                    universeId: work.universeId,
                    workId: work.id,
                    chapterId,
                  });
                }
              }
              onDeleteChapter={(chapter) => deleteChapter(work.id, chapter)}
              onChangeChapter={(chapterId, change) => changeChapter(work.id, chapterId, change)}
              onRecordExport={recordExport}
            />
          ) : null}

          {route.name === "cast" ? (
            <CastLibrary
              workspace={workspace}
              locale={locale}
              t={t}
              onNewCharacter={() => setModal({ kind: "character", universeId: defaultUniverseId })}
              onEditCharacter={(character) => setModal({ kind: "character", initial: character })}
              onOpenUniverse={(id) => navigate({ name: "universe", id })}
            />
          ) : null}

          {route.name === "graph" ? (
            <RelationshipsView
              onEditRelationship={(initial) => setModal({ kind: "relationship", universeId: initial.universeId, initial })}
              workspace={workspace}
              locale={locale}
              t={t}
              initialUniverseId={route.universeId}
              onAddRelationship={(universeId) => setModal({ kind: "relationship", universeId })}
              onDeleteRelationship={(id) => {
                if (window.confirm(t("confirmDelete")))
                  mutate((draft) => {
                    draft.relationships = draft.relationships.filter((item) => item.id !== id);
                  });
              }}
              onEditCharacter={(character) => setModal({ kind: "character", initial: character })}
            />
          ) : null}

          {route.name === "timeline" ? (
            <TimelineView
              workspace={workspace}
              locale={locale}
              t={t}
              initialUniverseId={route.universeId ?? defaultUniverseId}
              onNewEvent={(universeId, workId) =>
                setModal({ kind: "timeline", universeId, workId })
              }
              onEditEvent={(initial) =>
                setModal({ kind: "timeline", initial })
              }
              onDeleteEvent={deleteTimelineEvent}
              onNewObject={(universeId) =>
                setModal({ kind: "object", universeId })
              }
              onEditObject={(initial) =>
                setModal({ kind: "object", initial })
              }
              onDeleteObject={deleteObject}
              onOpenWork={(workId) => navigate({ name: "work", workId })}
            />
          ) : null}

          {route.name === "exports" ? (
            <ExportsView
              workspace={workspace}
              locale={locale}
              t={t}
              onOpenWork={(workId) => navigate({ name: "work", workId })}
            />
          ) : null}

          {route.name === "foundation" ? (
            <FoundationView
              workspace={workspace}
              locale={locale}
              t={t}
              aiInfo={aiInfo}
              onNewStandard={() => setModal({ kind: "standard" })}
              onEditStandard={(initial) => setModal({ kind: "standard", initial })}
              onStatusChange={changeStandardStatus}
              onRegisterCandidates={registerStandardCandidates}
              onOpenWorkflow={() => navigate({ name: "workflow" })}
              onOpenSettings={() => navigate({ name: "settings" })}
            />
          ) : null}

          {route.name === "workflow" ? (
            <WorkflowView
              workspace={workspace}
              locale={locale}
              t={t}
              onNewTask={() =>
                setModal({
                  kind: "task",
                  universeId:
                    workspace.works.find(
                      (item) => item.id === workspace.lastOpenedWorkId,
                    )?.universeId ?? workspace.universes[0]?.id,
                  workId: workspace.lastOpenedWorkId,
                })
              }
              onEditTask={(initial) => setModal({ kind: "task", initial })}
              onAddSubtask={(task) =>
                setModal({
                  kind: "task",
                  parentId: task.id,
                  universeId: task.universeId,
                  workId: task.workId,
                })
              }
              onDeleteTask={deleteWorkflowTask}
              onStatusChange={changeWorkflowStatus}
              onSaveResult={saveWorkflowResult}
              onOpenWork={(workId) => navigate({ name: "work", workId })}
            />
          ) : null}

          {route.name === "settings" ? (
            <SettingsView
              workspace={workspace}
              locale={locale}
              t={t}
              path={state.path}
              aiInfo={aiInfo}
              onAiConfigured={setAiInfo}
              onUpdateSettings={updateSettings}
              onResetDemo={resetDemo}
              onRestoreSnapshot={restoreSnapshot}
            />
          ) : null}

          {route.name === "work" && !work ? (
            <div className="view">
              <p>{t("errorTitle")}</p>
              <Button onClick={() => replaceRoute({ name: "dashboard" })}>{t("dashboard")}</Button>
            </div>
          ) : null}
        </main>
        <footer className="studio-statusbar">
          <span><span className="status-dot" />{t("local")} · {dictionaries[locale].appName}</span>
          <span>{workspace.name} · rev {workspace.revision}</span>
          <span>{formatNumber(workspace.works.reduce((sum, item) => sum + workWords(item), 0), locale)} {t("words")}</span>
        </footer>
      </div>

      <SearchOverlay
        open={searchOpen}
        workspace={workspace}
        locale={locale}
        t={t}
        onClose={() => setSearchOpen(false)}
        onSelect={selectSearchHit}
      />

      {modal?.kind === "import" ? <ManuscriptImport locale={locale} onClose={() => setModal(null)} onImport={async (imported) => {
        if (!(await snapshotBefore("before-import-novel"))) return;
        // Validate the combined snapshot before scheduling the mutation.
        mergeManuscriptImport(workspace, imported);
        mutate((draft) => Object.assign(draft, mergeManuscriptImport(draft, imported)));
        navigate({ name: "work", workId: imported.works[0]!.id });
      }} /> : null}
      {modal?.kind === "world" ? (
        <UniverseModal
          key={`world-${modal.initial?.id ?? "new"}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          initial={modal.initial}
          onSave={saveUniverse}
        />
      ) : null}
      {modal?.kind === "novel" ? (
        <NovelModal
          key={`novel-${modal.initial?.id ?? modal.universeId ?? "default"}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          workspace={workspace}
          defaultUniverseId={modal.universeId ?? defaultUniverseId}
          initial={modal.initial}
          onSave={saveNovel}
        />
      ) : null}
      {modal?.kind === "character" ? (
        <CharacterModal
          key={`character-${modal.initial?.id ?? "new"}-${modal.universeId ?? ""}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          workspace={workspace}
          initial={modal.initial}
          defaultUniverseId={modal.universeId}
          onSave={saveCharacter}
        />
      ) : null}
      {modal?.kind === "relationship" ? (
        <RelationshipModal
          initial={modal.initial}
          key={`relationship-${modal.initial?.id ?? modal.universeId}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          workspace={workspace}
          universeId={modal.universeId}
          onSave={saveRelationship}
        />
      ) : null}
      {modal?.kind === "object" ? (
        <StoryObjectModal
          key={`object-${modal.initial?.id ?? modal.universeId ?? "new"}`}
          open
          onClose={() => setModal(null)}
          locale={locale}
          workspace={workspace}
          initial={modal.initial}
          defaultUniverseId={modal.universeId}
          onSave={saveObject}
        />
      ) : null}
      {modal?.kind === "timeline" ? (
        <TimelineEventModal
          key={`timeline-${modal.initial?.id ?? `${modal.universeId ?? "new"}-${modal.chapterId ?? ""}`}`}
          open
          onClose={() => setModal(null)}
          locale={locale}
          workspace={workspace}
          initial={modal.initial}
          defaultUniverseId={modal.universeId}
          defaultWorkId={modal.workId}
          defaultChapterId={modal.chapterId}
          onSave={saveTimelineEvent}
        />
      ) : null}
      {modal?.kind === "atlas" ? (
        <AtlasModal
          key={`atlas-${modal.atlasKind}-${modal.initial?.id ?? "new"}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          universeId={modal.universeId}
          kind={modal.atlasKind}
          initial={modal.initial}
          onSave={saveAtlas}
        />
      ) : null}
      {modal?.kind === "chapter" ? (
        <ChapterModal
          key={`chapter-${modal.workId}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          initialNumber={
            chapterModalWork ? nextChapterNumber(chapterModalWork) : 1
          }
          existingNumbers={chapterModalWork?.chapters.map((chapter) => chapter.number) ?? []}
          onSave={(chapter) => addChapter(modal.workId, chapter)}
        />
      ) : null}
      {modal?.kind === "mcp" ? (
        <McpModal
          open
          onClose={() => setModal(null)}
          t={t}
          workspacePath={state.path}
          locale={locale}
        />
      ) : null}
      {modal?.kind === "standard" ? (
        <StandardModal
          key={`standard-${modal.initial?.id ?? "new"}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          workspace={workspace}
          initial={modal.initial}
          onSave={saveStandard}
        />
      ) : null}
      {modal?.kind === "task" ? (
        <WorkflowTaskModal
          key={`task-${modal.initial?.id ?? "new"}-${modal.parentId ?? ""}`}
          open
          onClose={() => setModal(null)}
          t={t}
          locale={locale}
          workspace={workspace}
          initial={modal.initial}
          defaultParentId={modal.parentId}
          defaultUniverseId={modal.universeId}
          defaultWorkId={modal.workId}
          onSave={saveWorkflowTask}
        />
      ) : null}
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}

function McpModal({
  open,
  onClose,
  t,
  workspacePath,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  t: Translate;
  workspacePath: string;
  locale: UiLocale;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    bridge.appInfo().then(setInfo).catch(() => setInfo(null));
  }, []);
  const config = info
    ? JSON.stringify(info.mcp, null, 2)
    : JSON.stringify({
        mcpServers: {
          "iploom-studio": {
            command: "iploom-mcp",
            args: ["--workspace", workspacePath || "/path/to/workspace.json"],
          },
        },
      }, null, 2);
  const tools = [
    "list_story_worlds",
    "get_story_world",
    "list_novels",
    "get_novel",
    "get_chapter",
    "search_ip",
    "get_relationship_graph",
    "list_workflow_tasks",
    "get_workflow_brief",
    "list_standards",
    "get_standard",
    "create_standard",
    "update_standard",
    "export_arcreel_bundle",
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("mcpTitle")}
      description={t("mcpLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
          <Button
            variant="primary"
            icon="copy"
            onClick={async () => {
              await bridge.copyText(config);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? t("copied") : t("copyConfig")}
          </Button>
        </>
      }
    >
      <div className="mcp-modal-grid">
        <div>
          <span className="eyebrow">STDIO SERVER</span>
          <h3>{info?.desktop ? (locale === "en" ? "Bundled desktop server" : "桌面内置服务") : t("browserPreview")}</h3>
          <p>{t("mcpToolsNote")}</p>
          <div className="tool-pills vertical">
            {tools.map((tool) => <code key={tool}>{tool}</code>)}
          </div>
        </div>
        <div className="code-block light">
          <div className="code-block-head">
            <span>{t("mcpConfig")}</span>
            <span className="online-label"><i /> stdio</span>
          </div>
          <pre>{config}</pre>
        </div>
      </div>
    </Modal>
  );
}
