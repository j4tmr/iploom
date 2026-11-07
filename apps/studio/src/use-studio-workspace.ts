import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  bridge,
  browserFallback,
  type LoadedWorkspace,
} from "./platform.ts";
import {
  applyWorkspaceChange,
  type WorkspaceChangeResult,
} from "./core/integrity.ts";
import type { StudioWorkspace, UiLocale } from "./core/types.ts";
import { retrySave } from "./save-retry.ts";

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

export function useStudioWorkspace(): StudioWorkspaceState {
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
  }, []);

  const persist = useCallback(async (next: StudioWorkspace) => {
    const sequence = ++saveSequence.current;
    setSaveState("saving");
    try {
      await retrySave(() => bridge.save(next), {
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
      if (sequence === saveSequence.current) {
        savedRevision.current = next.revision;
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
  }, []);

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

  const replaceWorkspace = useCallback((next: StudioWorkspace) => {
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
  }, [invalidatePendingSaves]);

  const saveNow = useCallback(async () => {
    const current = workspaceRef.current;
    if (current && current.revision !== savedRevision.current) {
      await persist(current);
    }
    if (pendingSave.current) await pendingSave.current;
  }, [persist, workspace]);

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
          )
          .catch(() => undefined);
      }
    });
  }, [saveNow]);

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
  const dirty = workspace !== null && workspace.revision !== savedRevision.current;
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
  }, [dirty]);

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
