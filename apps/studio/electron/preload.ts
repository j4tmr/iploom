import { contextBridge, ipcRenderer } from "electron";
import type { StudioBridge } from "../src/platform.ts";

const api: StudioBridge = {
  load: () => ipcRenderer.invoke("iploom:load"),
  save: (workspace) => ipcRenderer.invoke("iploom:save", workspace),
  exportArcReel: (bundle) =>
    ipcRenderer.invoke("iploom:export-arc-reel", bundle),
  appInfo: () => ipcRenderer.invoke("iploom:app-info"),
  copyText: (value) => ipcRenderer.invoke("iploom:copy-text", value),
  openFolder: (path) => ipcRenderer.invoke("iploom:open-folder", path),
  openExternal: (url) => ipcRenderer.invoke("iploom:open-external", url),
  resetDemo: (locale) => ipcRenderer.invoke("iploom:reset-demo", locale),
};

contextBridge.exposeInMainWorld("iploom", Object.freeze(api));
