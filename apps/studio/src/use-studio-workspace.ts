import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { bridge, browserFallback } from "./platform.ts";
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
          new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
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

  useEffect(() => {
    if (!workspace || workspace.revision === savedRevision.current) return;
    const snapshot = workspace;
    const timer = window.setTimeout(() => {
      pendingSave.current = persist(snapshot)
        .then(
          () => undefined,
          () => undefined,
        )
        .finally(() => {
          pendingSave.current = null;
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [persist, workspace]);

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

  const replaceWorkspace = useCallback((next: StudioWorkspace) => {
    workspaceRef.current = next;
    setWorkspace(next);
    // Callers only replace the workspace after it has been written to disk
    // (demo reset, snapshot restore). Marking it saved avoids a redundant
    // autosave ~450ms later that would rotate the user's only `.bak` away.
    savedRevision.current = next.revision;
    setSaveState("saved");
    setError(null);
  }, []);

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
