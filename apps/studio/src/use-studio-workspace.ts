import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { bridge } from "./platform.ts";
import type { StudioWorkspace, UiLocale } from "./core/types.ts";

export type SaveState = "loading" | "saved" | "saving" | "error";

export interface StudioWorkspaceState {
  workspace: StudioWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<StudioWorkspace | null>>;
  mutate: (change: (draft: StudioWorkspace) => void) => void;
  replaceWorkspace: (workspace: StudioWorkspace) => void;
  saveState: SaveState;
  error: string | null;
  path: string;
  recovered: boolean;
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
  const savedRevision = useRef(-1);
  const pendingSave = useRef<Promise<void> | null>(null);
  const saveSequence = useRef(0);

  useEffect(() => {
    let active = true;
    bridge
      .load()
      .then((loaded) => {
        if (!active) return;
        setWorkspace(loaded.workspace);
        setPath(loaded.path);
        setRecovered(loaded.recoveredFromBackup);
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
      await bridge.save(next);
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
      return next;
    });
  }, []);

  const replaceWorkspace = useCallback((next: StudioWorkspace) => {
    setWorkspace(next);
    savedRevision.current = -1;
  }, []);

  const saveNow = useCallback(async () => {
    if (workspace) await persist(workspace);
    if (pendingSave.current) await pendingSave.current;
  }, [persist, workspace]);

  const setLocale = useCallback(
    (locale: UiLocale) => {
      mutate((draft) => {
        draft.settings.locale = locale;
      });
    },
    [mutate],
  );

  return {
    workspace,
    setWorkspace,
    mutate,
    replaceWorkspace,
    saveState,
    error,
    path,
    recovered,
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
