import { createDemoWorkspace } from "./core/factory.ts";
import { loadWorkspace } from "./core/integrity.ts";
import { validateWorkspace } from "./core/validate.ts";
import {
  WORKSPACE_SCHEMA_VERSION,
  type StudioWorkspace,
  type UiLocale,
} from "./core/types.ts";

export const browserWorkspaceKey = "iploom-studio:workspace:v1";
export const browserSnapshotKey = "iploom-studio:workspace-snapshot:v1";
type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;

export function loadBrowserWorkspace(
  storage: WorkspaceStorage,
  locale: UiLocale,
) {
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
    workspace: loadWorkspace(JSON.parse(raw)),
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

/**
 * A newer build wrote a schema this build cannot read. Unlike corrupt data,
 * that workspace is healthy and must survive the downgrade untouched, so the
 * save is refused and marked non-retryable (retrying cannot help).
 */
export class NewerBrowserWorkspaceVersionError extends Error {
  readonly retryable = false;
  readonly foundVersion: number;

  constructor(foundVersion: number) {
    super(
      `This browser workspace was created by a newer IPloom Studio (schema ${foundVersion}; ` +
        `this build supports ${WORKSPACE_SCHEMA_VERSION}). Update the app to open it. ` +
        `The stored workspace was left untouched.`,
    );
    this.name = "NewerBrowserWorkspaceVersionError";
    this.foundVersion = foundVersion;
  }
}

function storedSchemaVersion(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const version = (value as { schema_version?: unknown }).schema_version;
  return typeof version === "number" && Number.isFinite(version)
    ? version
    : null;
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
  if (raw !== null) {
    let stored: unknown = null;
    try {
      stored = JSON.parse(raw);
    } catch {
      // Unreadable stored data must stay replaceable by a healthy workspace.
    }
    // Check the schema before validation: this build's validator rejects the
    // newer version, and treating that rejection as corruption would let an
    // old build silently replace a workspace written by a newer one.
    const storedVersion = storedSchemaVersion(stored);
    if (storedVersion !== null && storedVersion > WORKSPACE_SCHEMA_VERSION) {
      throw new NewerBrowserWorkspaceVersionError(storedVersion);
    }
    if (!options.allowRollback && stored !== null) {
      let storedWorkspace: StudioWorkspace | null = null;
      try {
        storedWorkspace = loadWorkspace(stored);
      } catch {
        // Unreadable stored data must stay replaceable by a healthy workspace.
        storedWorkspace = null;
      }
      if (storedWorkspace !== null) {
        // Both sides are validated workspace output, so this is the same
        // zod-canonical comparison the desktop store uses.
        const identical =
          JSON.stringify(storedWorkspace) === JSON.stringify(valid);
        const advancedSinceBase =
          options.baseRevision != null &&
          options.baseRevision < storedWorkspace.revision;
        if (
          storedWorkspace.revision > valid.revision ||
          (!identical &&
            (storedWorkspace.revision === valid.revision || advancedSinceBase))
        ) {
          throw new StaleBrowserWorkspaceError(
            storedWorkspace.revision,
            valid.revision,
            options.baseRevision,
          );
        }
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
