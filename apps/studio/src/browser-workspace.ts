import { createDemoWorkspace } from "./core/factory.ts";
import { validateWorkspace } from "./core/validate.ts";
import type { StudioWorkspace, UiLocale } from "./core/types.ts";

export const browserWorkspaceKey = "iploom-studio:workspace:v1";
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
