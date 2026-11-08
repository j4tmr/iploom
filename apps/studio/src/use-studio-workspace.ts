import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  bridge as platformBridge,
  browserFallback as platformBrowserFallback,
  type LoadedWorkspace,
  type StudioBridge,
} from "./platform.ts";
import {
  applyWorkspaceChange,
  type WorkspaceChangeResult,
} from "./core/integrity.ts";
import type { StudioWorkspace, UiLocale } from "./core/types.ts";
import { retrySave } from "./save-retry.ts";
import { isStaleSaveError } from "./save-errors.ts";

export type SaveState = "loading" | "saved" | "pending" | "saving" | "error";

export interface StudioWorkspaceState {
  workspace: StudioWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<StudioWorkspace | null>>;
  mutate: (change: (draft: StudioWorkspace) => void) => void;
  /**
   * Apply a structural change only when the result is still a valid workspace.
   * The outcome carries the applied workspace or the rejection details.
   */
  applyChange: (
    change: (draft: StudioWorkspace) => void,
  ) => WorkspaceChangeResult;
  replaceWorkspace: (workspace: StudioWorkspace) => void;
  /**
   * Run a bridge operation that replaces the workspace on disk (snapshot
   * restore, demo reset). Pending saves are invalidated synchronously at
   * dispatch, so nothing queued for the pre-replacement workspace can land
   * after the operation resolves. A rejected operation changes nothing on
   * disk, so a still-dirty edit gets its autosave re-armed.
   */
  dispatchWorkspaceReplacement: (
    operation: () => Promise<LoadedWorkspace>,
  ) => Promise<LoadedWorkspace>;
  /**
   * Drop every save that has not reached the bridge yet. Call this before
   * dispatching an operation that replaces the workspace on disk (snapshot
   * restore, demo reset): the load is still in flight for a while, and a retry
   * waking up in that window would otherwise save the pre-replacement data
   * after the replacement has already been written.
   */
  invalidatePendingSaves: () => void;
  /**
   * Arm the debounced autosave when the current workspace still has edits the
   * disk has not confirmed. `invalidatePendingSaves` cancels that timer, so a
   * replacement that rejects must call this again: the autosave effect depends
   * on the workspace object and would not re-run on its own.
   */
  scheduleSaveIfDirty: () => void;
  saveState: SaveState;
  error: string | null;
  path: string;
  recovered: boolean;
  rejectedPath: string | null;
  rejectedReason: string | null;
  saveNow: () => Promise<void>;
  setLocale: (locale: UiLocale) => void;
}

function cloneWorkspace(workspace: StudioWorkspace): StudioWorkspace {
  return structuredClone(workspace);
}

/**
 * The bridge methods the workspace hook drives. Narrowed so a test can supply
 * a fake without stubbing the whole `StudioBridge` surface — and, unlike
 * `mock.module`, without replacing the real module for every later test file in
 * the same process.
 */
export type WorkspaceBridge = Pick<
  StudioBridge,
  "load" | "save" | "onFlushRequest" | "flushComplete"
>;

/**
 * Everything the hook needs from the platform layer. Callers should pass a
 * module-level constant: the load effect re-runs whenever `bridge`'s identity
 * changes, so an inline object literal would reload the workspace each render.
 */
export interface WorkspacePlatform {
  bridge: WorkspaceBridge;
  /**
   * The browser fallback, passed only so the hook can tell a desktop bridge
   * from the in-browser one and show the beforeunload guard for the latter.
   */
  browserFallback: WorkspaceBridge;
}

const defaultPlatform: WorkspacePlatform = {
  bridge: platformBridge,
  browserFallback: platformBrowserFallback,
};

export function useStudioWorkspace(
  platform: WorkspacePlatform = defaultPlatform,
): StudioWorkspaceState {
  const { bridge, browserFallback } = platform;
  const [workspace, setWorkspace] = useState<StudioWorkspace | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [recovered, setRecovered] = useState(false);
  const [rejectedPath, setRejectedPath] = useState<string | null>(null);
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);
  const savedRevision = useRef(-1);
  const pendingSave = useRef<Promise<void> | null>(null);
  const saveSequence = useRef(0);
  const retryWake = useRef<(() => void) | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const workspaceRef = useRef<StudioWorkspace | null>(null);

  useEffect(() => {
    let active = true;
    bridge
      .load()
      .then((loaded) => {
        if (!active) return;
        workspaceRef.current = loaded.workspace;
        setWorkspace(loaded.workspace);
        setPath(loaded.path);
        setRecovered(loaded.recoveredFromBackup);
        setRejectedPath(loaded.rejectedPath ?? null);
        setRejectedReason(loaded.rejectedReason ?? null);
        savedRevision.current = loaded.workspace.revision;
        setSaveState("saved");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setSaveState("error");
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  const persist = useCallback(
    (next: StudioWorkspace) => {
      const sequence = ++saveSequence.current;
      setSaveState("saving");
      const attempt = async () => {
        // Optimistic concurrency: the base is the revision this renderer last
        // knew the file held. Serializing attempts guarantees the previous save
        // has already refreshed the ref. retrySave deliberately re-sends this
        // same base; an identical re-save is accepted when the response was lost
        // after the file was written.
        const baseRevision = savedRevision.current;
        try {
          await retrySave(() => bridge.save(next, baseRevision), {
            isCurrent: () => sequence === saveSequence.current,
            sleep: (milliseconds) =>
              new Promise<void>((resolve) => {
                let timer: number | null = null;
                const wake = () => {
                  if (timer !== null) {
                    window.clearTimeout(timer);
                    timer = null;
                  }
                  if (retryWake.current === wake) retryWake.current = null;
                  resolve();
                };
                timer = window.setTimeout(wake, milliseconds);
                retryWake.current = wake;
              }),
          });
          // The file now holds this revision even when a newer edit has already
          // superseded the indicator update, so a queued save must base on it.
          savedRevision.current = Math.max(
            savedRevision.current,
            next.revision,
          );
          if (sequence === saveSequence.current) {
            setSaveState("saved");
            setError(null);
          }
        } catch (reason) {
          if (sequence === saveSequence.current) {
            setSaveState("error");
            setError(reason instanceof Error ? reason.message : String(reason));
          }
          throw reason;
        }
      };
      // Overlapping autosaves (debounce plus Cmd+S or a close flush) must not
      // race their base revisions against each other.
      const pending = saveQueue.current.then(attempt);
      saveQueue.current = pending.catch(() => undefined);
      return pending;
    },
    [bridge],
  );

  /**
   * Arm the 450 ms autosave for the current revision. A single timer: calling
   * this again replaces the previous one instead of stacking saves.
   */
  const scheduleSaveIfDirty = useCallback(() => {
    const snapshot = workspaceRef.current;
    if (!snapshot || snapshot.revision === savedRevision.current) return;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
    }
    const timer = window.setTimeout(() => {
      autosaveTimer.current = null;
      const task = persist(snapshot)
        .then(
          () => undefined,
          () => undefined,
        )
        .finally(() => {
          if (pendingSave.current === task) pendingSave.current = null;
        });
      pendingSave.current = task;
    }, 450);
    autosaveTimer.current = timer;
  }, [persist]);

  useEffect(() => {
    if (!workspace || workspace.revision === savedRevision.current) return;
    scheduleSaveIfDirty();
    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [scheduleSaveIfDirty, workspace]);

  const mutate = useCallback((change: (draft: StudioWorkspace) => void) => {
    setWorkspace((current) => {
      if (!current) return current;
      const next = cloneWorkspace(current);
      change(next);
      next.revision = current.revision + 1;
      next.updatedAt = new Date().toISOString();
      workspaceRef.current = next;
      return next;
    });
  }, []);

  const applyChange = useCallback(
    (change: (draft: StudioWorkspace) => void): WorkspaceChangeResult => {
      const current = workspaceRef.current;
      if (!current)
        return {
          ok: false,
          error: "workspace is not loaded",
          issues: [],
          details: [],
        };
      const outcome = applyWorkspaceChange(current, change);
      if (!outcome.ok) return outcome;
      workspaceRef.current = outcome.workspace;
      setWorkspace(outcome.workspace);
      return outcome;
    },
    [],
  );

  /**
   * Invalidate every save still in flight: a retry sleeping in backoff for the
   * pre-replacement revision considers itself current otherwise and overwrites
   * the replacement later.
   */
  const invalidatePendingSaves = useCallback(() => {
    saveSequence.current += 1;
    pendingSave.current = null;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    retryWake.current?.();
  }, []);

  /**
   * Invalidate before the bridge operation is dispatched, not after it
   * resolves: the load stays in flight for a while and a retry waking up in
   * that window would otherwise save the pre-replacement workspace over the
   * replacement. If the operation rejects nothing was written, so re-arm the
   * debounce the invalidation just cancelled.
   */
  const dispatchWorkspaceReplacement = useCallback(
    async (
      operation: () => Promise<LoadedWorkspace>,
    ): Promise<LoadedWorkspace> => {
      invalidatePendingSaves();
      try {
        return await operation();
      } catch (reason) {
        scheduleSaveIfDirty();
        throw reason;
      }
    },
    [invalidatePendingSaves, scheduleSaveIfDirty],
  );

  const replaceWorkspace = useCallback(
    (next: StudioWorkspace) => {
      // Callers only replace the workspace after it has been written to disk
      // (demo reset, snapshot restore). They invalidate before dispatching that
      // write as well; this post-load bump covers replacements that arrive
      // without one.
      invalidatePendingSaves();
      workspaceRef.current = next;
      setWorkspace(next);
      // Marking it saved avoids a redundant autosave ~450ms later that would
      // rotate the user's only `.bak` away.
      savedRevision.current = next.revision;
      setSaveState("saved");
      setError(null);
    },
    [invalidatePendingSaves],
  );

  const saveNow = useCallback(async () => {
    const current = workspaceRef.current;
    if (current && current.revision !== savedRevision.current) {
      await persist(current);
    }
    if (pendingSave.current) await pendingSave.current;
  }, [persist]);

  useEffect(() => {
    return bridge.onFlushRequest(async (requestId) => {
      try {
        await saveNow();
        await bridge.flushComplete(requestId);
      } catch (reason) {
        await bridge
          .flushComplete(
            requestId,
            reason instanceof Error ? reason.message : String(reason),
            workspaceRef.current ?? undefined,
            isStaleSaveError(reason),
          )
          .catch(() => undefined);
      }
    });
  }, [saveNow, bridge]);

  const setLocale = useCallback(
    (locale: UiLocale) => {
      mutate((draft) => {
        draft.settings.locale = locale;
      });
    },
    [mutate],
  );

  // A revision the disk has not confirmed yet is "pending", not "saved":
  // during a fast typing burst the indicator must never claim the workspace
  // is safe while the 450 ms debounce is still counting down.
  const dirty =
    workspace !== null && workspace.revision !== savedRevision.current;
  const effectiveSaveState: SaveState =
    saveState === "saved" && dirty ? "pending" : saveState;

  useEffect(() => {
    // The desktop app flushes through its own close handshake (and shows a
    // real dialog); only a browser tab can disappear without one.
    if (bridge !== browserFallback || !dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, bridge, browserFallback]);

  return {
    workspace,
    setWorkspace,
    mutate,
    applyChange,
    replaceWorkspace,
    dispatchWorkspaceReplacement,
    invalidatePendingSaves,
    scheduleSaveIfDirty,
    saveState: effectiveSaveState,
    error,
    path,
    recovered,
    rejectedPath,
    rejectedReason,
    saveNow,
    setLocale,
  };
}

export function applyTheme(
  mode: "system" | "light" | "dark",
  element: HTMLElement = document.documentElement,
): void {
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  element.dataset.theme = dark ? "dark" : "light";
  element.dataset.themeMode = mode;
}
