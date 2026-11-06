import { contextBridge, ipcRenderer } from "electron";
import type { StudioBridge } from "../src/platform.ts";

const api: StudioBridge = {
  aiConfig: () => ipcRenderer.invoke("iploom:ai-config"),
  configureAi: (config) => ipcRenderer.invoke("iploom:configure-ai", config),
  runAi: (request) => ipcRenderer.invoke("iploom:run-ai", request),
  cancelAi: (id) => ipcRenderer.invoke("iploom:cancel-ai", id),
  onAiProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on("iploom:ai-progress", handler);
    return () => ipcRenderer.removeListener("iploom:ai-progress", handler);
  },
  load: () => ipcRenderer.invoke("iploom:load"),
  save: (workspace) => ipcRenderer.invoke("iploom:save", workspace),
  onFlushRequest: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: string) => {
      if (typeof requestId === "string") listener(requestId);
    };
    ipcRenderer.on("iploom:flush-request", handler);
    return () => ipcRenderer.removeListener("iploom:flush-request", handler);
  },
  flushComplete: (requestId, error) =>
    ipcRenderer.invoke("iploom:flush-complete", requestId, error),
  exportArcReel: (bundle) =>
    ipcRenderer.invoke("iploom:export-arc-reel", bundle),
  appInfo: () => ipcRenderer.invoke("iploom:app-info"),
  copyText: (value) => ipcRenderer.invoke("iploom:copy-text", value),
  openFolder: (path) => ipcRenderer.invoke("iploom:open-folder", path),
  openExternal: (url) => ipcRenderer.invoke("iploom:open-external", url),
  resetDemo: (locale) => ipcRenderer.invoke("iploom:reset-demo", locale),
};

contextBridge.exposeInMainWorld("iploom", Object.freeze(api));
