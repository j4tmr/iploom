import { contextBridge, ipcRenderer } from "electron";
import type { StudioBridge } from "../src/platform.ts";
import { unwrapIpcError } from "../src/ipc-errors.ts";

/**
 * Every bridge method funnels through this helper so a main-process rejection
 * arrives without Electron's untranslated "Error invoking remote method"
 * wrapper; the renderer sees the original, localized message.
 */
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    throw unwrapIpcError(channel, error);
  });

const api: StudioBridge = {
  aiConfig: () => invoke("iploom:ai-config"),
  configureAi: (config) => invoke("iploom:configure-ai", config),
  runAi: (request) => invoke("iploom:run-ai", request),
  cancelAi: (id) => invoke("iploom:cancel-ai", id),
  onAiProgress: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof listener>[0],
    ) => listener(progress);
    ipcRenderer.on("iploom:ai-progress", handler);
    return () => ipcRenderer.removeListener("iploom:ai-progress", handler);
  },
  load: () => invoke("iploom:load"),
  save: (workspace, baseRevision) =>
    invoke("iploom:save", workspace, baseRevision),
  createSnapshot: (reason) => invoke("iploom:create-snapshot", reason),
  listSnapshots: () => invoke("iploom:list-snapshots"),
  restoreSnapshot: (path) => invoke("iploom:restore-snapshot", path),
  onFlushRequest: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: string) => {
      if (typeof requestId === "string") listener(requestId);
    };
    ipcRenderer.on("iploom:flush-request", handler);
    return () => ipcRenderer.removeListener("iploom:flush-request", handler);
  },
  flushComplete: (requestId, error, workspace, stale) =>
    invoke("iploom:flush-complete", requestId, error, workspace, stale),
  exportArcReel: (bundle) => invoke("iploom:export-arc-reel", bundle),
  appInfo: () => invoke("iploom:app-info"),
  checkForUpdates: () => invoke("iploom:check-update"),
  copyText: (value) => invoke("iploom:copy-text", value),
  openFolder: (path) => invoke("iploom:open-folder", path),
  openExternal: (url) => invoke("iploom:open-external", url),
  resetDemo: (locale) => invoke("iploom:reset-demo", locale),
};

contextBridge.exposeInMainWorld("iploom", Object.freeze(api));
