import { createDemoWorkspace } from "./core/factory.ts";
import { validateWorkspace } from "./core/validate.ts";
import type { StudioWorkspace, UiLocale } from "./core/types.ts";

export const browserWorkspaceKey = "iploom-studio:workspace:v1";
export const browserSnapshotKey = "iploom-studio:workspace-snapshot:v1";
type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;

export function loadBrowserWorkspace(storage: WorkspaceStorage, locale: UiLocale) {
  const raw = storage.getItem(browserWorkspaceKey);
  if (raw === null) {
    const workspace = createDemoWorkspace(locale);
    try {
      // Persist the initial demo right away. Loading does not mark the
      // workspace dirty, so no autosave would ever write it, and without a
      // stored workspace the snapshot guard has nothing to protect and refuses
      // the first delete/import until some unrelated edit is saved.
      storage.setItem(browserWorkspaceKey, JSON.stringify(workspace));
    } catch {
      // Read-only or full storage still opens the demo; the snapshot guard
      // keeps refusing destructive actions, which is the safe outcome.
    }
    return {
      workspace,
      path: "Browser localStorage",
      recoveredFromBackup: false,
    };
  }
  return {
    workspace: validateWorkspace(JSON.parse(raw)),
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
    readonly baseRevision?: number,
  ) {
    super(
      storedRevision === incomingRevision
        ? `Refusing to overwrite browser workspace revision ${storedRevision} with different content. Reload to continue from the newer workspace.`
        : baseRevision != null && baseRevision < storedRevision
          ? `Refusing to save a browser workspace draft based on revision ${baseRevision} over revision ${storedRevision} (incoming revision ${incomingRevision}). Reload to continue from the newer workspace.`
          : `Refusing to overwrite browser workspace revision ${storedRevision} with older revision ${incomingRevision}. Reload to continue from the newer workspace.`,
    );
    this.name = "StaleBrowserWorkspaceError";
  }
}

export interface BrowserSaveOptions {
  /** Snapshot restore and demo reset intentionally move the workspace backwards. */
  allowRollback?: boolean;
  /** Revision of the last state this tab knows was persisted. */
  baseRevision?: number;
}

export function saveBrowserWorkspace(
  storage: WorkspaceStorage,
  workspace: StudioWorkspace,
  options: BrowserSaveOptions = {},
): void {
  const valid = validateWorkspace(workspace);
  const raw = storage.getItem(browserWorkspaceKey);
  if (raw !== null && !options.allowRollback) {
    let stored: StudioWorkspace | null = null;
    try {
      stored = validateWorkspace(JSON.parse(raw));
    } catch {
      // Unreadable stored data must stay replaceable by a healthy workspace.
      stored = null;
    }
    if (stored !== null) {
      // Both sides are `validateWorkspace` output, so this is the same
      // zod-canonical comparison the desktop store uses.
      const identical = JSON.stringify(stored) === JSON.stringify(valid);
      const advancedSinceBase =
        options.baseRevision != null &&
        options.baseRevision < stored.revision;
      if (
        stored.revision > valid.revision ||
        (!identical &&
          (stored.revision === valid.revision || advancedSinceBase))
      ) {
        throw new StaleBrowserWorkspaceError(
          stored.revision,
          valid.revision,
          options.baseRevision,
        );
      }
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
    validateWorkspace(JSON.parse(raw));
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
        workspace: validateWorkspace(JSON.parse(raw)),
        path: "Browser localStorage",
        recoveredFromBackup: false,
      };
}
