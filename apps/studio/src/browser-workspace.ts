import { createDemoWorkspace } from "./core/factory.ts";
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
      : validateWorkspace(JSON.parse(raw)),
    path: "Browser localStorage",
    recoveredFromBackup: false,
  };
}

export function saveBrowserWorkspace(storage: WorkspaceStorage, workspace: StudioWorkspace): void {
  const valid = validateWorkspace(workspace);
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
