import { createDemoWorkspace } from "./core/factory.ts";
import { loadWorkspace } from "./core/integrity.ts";
import { validateWorkspace } from "./core/validate.ts";
import type { StudioWorkspace, UiLocale } from "./core/types.ts";

export const browserWorkspaceKey = "iploom-studio:workspace:v1";
export const browserSnapshotKey = "iploom-studio:workspace-snapshot:v1";
type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;

export function loadBrowserWorkspace(storage: WorkspaceStorage, locale: UiLocale) {
  const raw = storage.getItem(browserWorkspaceKey);
  return {
    workspace: raw === null
      ? createDemoWorkspace(locale)
      : loadWorkspace(JSON.parse(raw)),
    path: "Browser localStorage",
    recoveredFromBackup: false,
  };
}

/**
 * Two browser tabs share one localStorage key. Saving an older revision after
 * another tab has written a newer one would roll the workspace back, so the
 * write is refused instead (and marked non-retryable: retrying cannot help).
 */
export class StaleBrowserWorkspaceError extends Error {
  readonly retryable = false;

  constructor(
    readonly storedRevision: number,
    readonly incomingRevision: number,
  ) {
    super(
      `Refusing to overwrite browser workspace revision ${storedRevision} with older revision ${incomingRevision}. Reload to continue from the newer workspace.`,
    );
    this.name = "StaleBrowserWorkspaceError";
  }
}

export interface BrowserSaveOptions {
  /** Snapshot restore and demo reset intentionally move the workspace backwards. */
  allowRollback?: boolean;
}

export function saveBrowserWorkspace(
  storage: WorkspaceStorage,
  workspace: StudioWorkspace,
  options: BrowserSaveOptions = {},
): void {
  const valid = validateWorkspace(workspace);
  const raw = storage.getItem(browserWorkspaceKey);
  if (raw !== null && !options.allowRollback) {
    let storedRevision: number | null = null;
    try {
      storedRevision = loadWorkspace(JSON.parse(raw)).revision;
    } catch {
      // Unreadable stored data must stay replaceable by a healthy workspace.
      storedRevision = null;
    }
    if (storedRevision !== null && storedRevision > valid.revision) {
      throw new StaleBrowserWorkspaceError(storedRevision, valid.revision);
    }
  }
  storage.setItem(browserWorkspaceKey, JSON.stringify(valid));
}

/**
 * Browser mode has no file system, so it keeps one snapshot slot outside the
 * main key. A corrupt workspace is never allowed to replace a healthy one.
 */
export function saveBrowserSnapshot(storage: WorkspaceStorage): string | null {
  const raw = storage.getItem(browserWorkspaceKey);
  if (raw === null) return null;
  try {
    loadWorkspace(JSON.parse(raw));
  } catch {
    return null;
  }
  storage.setItem(browserSnapshotKey, raw);
  return browserSnapshotKey;
}

export function loadBrowserSnapshot(storage: WorkspaceStorage) {
  const raw = storage.getItem(browserSnapshotKey);
  return raw === null
    ? null
    : {
        workspace: loadWorkspace(JSON.parse(raw)),
        path: "Browser localStorage",
        recoveredFromBackup: false,
      };
}
