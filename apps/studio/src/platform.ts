import { createDemoWorkspace, createEmptyWorkspace } from "./core/factory.ts";
import type { ArcReelBundle, StudioWorkspace, UiLocale } from "./core/types.ts";
import {
  unavailableUpdateCheck,
  type UpdateCheckResult,
} from "./core/updates.ts";
import { APP_VERSION } from "./core/version.ts";
import {
  loadBrowserSnapshot,
  loadBrowserWorkspace,
  saveBrowserSnapshot,
  saveBrowserWorkspace,
} from "./browser-workspace.ts";
import type {
  AiCompletion,
  AiConfig,
  AiConfigInfo,
  AiProgress,
  AiRequest,
} from "./core/ai.ts";
import { mapSaveErrorFromIpc } from "./save-errors.ts";

export interface LoadedWorkspace {
  workspace: StudioWorkspace;
  path: string;
  recoveredFromBackup: boolean;
  /** Present when the operation stored a recoverable pre-change snapshot. */
  snapshotPath?: string | null;
  /** Present when an unreadable primary file was moved aside during recovery. */
  rejectedPath?: string | null;
  /** Validation detail for the quarantined primary file. */
  rejectedReason?: string | null;
}

export interface WorkspaceSnapshotInfo {
  path: string;
  name: string;
  createdAt: string;
  bytes: number;
  reason: string;
}

export interface WrittenBundle {
  directory: string;
  files: number;
  bytes: number;
  canceled?: boolean;
}

export interface McpClientConfig {
  mcpServers: {
    "iploom-studio": {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
}

export interface AppInfo {
  version: string;
  platform: string;
  workspacePath: string;
  snapshotDirectory: string;
  desktop: boolean;
  mcp: McpClientConfig | null;
  mcpError: string | null;
  mcpBinary: string | null;
}

export interface StudioBridge {
  aiConfig(): Promise<AiConfigInfo>;
  configureAi(config: AiConfig): Promise<AiConfigInfo>;
  runAi(request: AiRequest): Promise<AiCompletion>;
  cancelAi(id: string): Promise<void>;
  onAiProgress(listener: (progress: AiProgress) => void): () => void;
  load(): Promise<LoadedWorkspace>;
  save(
    workspace: StudioWorkspace,
    baseRevision?: number,
  ): Promise<{ savedAt: string }>;
  createSnapshot(reason: string): Promise<string | null>;
  listSnapshots(): Promise<WorkspaceSnapshotInfo[]>;
  restoreSnapshot(path: string): Promise<LoadedWorkspace>;
  onFlushRequest(listener: (requestId: string) => void): () => void;
  flushComplete(
    requestId: string,
    error?: string,
    workspace?: StudioWorkspace,
    stale?: boolean,
  ): Promise<void>;
  exportArcReel(bundle: ArcReelBundle): Promise<WrittenBundle>;
  appInfo(): Promise<AppInfo>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  copyText(value: string): Promise<void>;
  openFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  resetDemo(locale: UiLocale): Promise<LoadedWorkspace>;
}

declare global {
  interface Window {
    iploom?: StudioBridge;
  }
}

function browserLoad(): LoadedWorkspace {
  const locale: UiLocale = navigator.language.startsWith("zh") ? "zh-CN" : "en";
  return loadBrowserWorkspace(localStorage, locale);
}

export const browserFallback: StudioBridge = {
  async aiConfig() {
    return { endpoint: "", model: "", configured: false };
  },
  async configureAi() {
    throw new Error(
      "模型 API 请在桌面版配置 / Configure model APIs in the desktop app.",
    );
  },
  async runAi() {
    throw new Error(
      "模型 API 请使用桌面版 / Model APIs require the desktop app.",
    );
  },
  async cancelAi() {},
  onAiProgress() {
    return () => undefined;
  },
  async load() {
    return browserLoad();
  },
  async save(workspace, baseRevision) {
    saveBrowserWorkspace(localStorage, workspace, { baseRevision });
    return { savedAt: new Date().toISOString() };
  },
  async createSnapshot() {
    return saveBrowserSnapshot(localStorage);
  },
  async listSnapshots() {
    return [];
  },
  async restoreSnapshot() {
    const snapshot = loadBrowserSnapshot(localStorage);
    if (!snapshot) throw new Error("No browser snapshot is available.");
    const snapshotPath = saveBrowserSnapshot(localStorage);
    saveBrowserWorkspace(localStorage, snapshot.workspace, {
      allowRollback: true,
    });
    return { ...snapshot, snapshotPath };
  },
  onFlushRequest() {
    return () => undefined;
  },
  async flushComplete() {},
  async exportArcReel(bundle) {
    const payload = {
      schema: bundle.schema,
      generatedAt: bundle.generatedAt,
      manifestSha256: bundle.manifestSha256,
      files: bundle.files,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${bundle.workTitle}-arcreel-preview.json`;
    link.click();
    URL.revokeObjectURL(url);
    return {
      directory: "Browser downloads",
      files: bundle.files.length,
      bytes: blob.size,
    };
  },
  async appInfo() {
    return {
      version: APP_VERSION,
      platform: navigator.platform,
      workspacePath: "Browser localStorage",
      snapshotDirectory: "Browser localStorage",
      desktop: false,
      mcp: null,
      mcpError: null,
      mcpBinary: null,
    };
  },
  async checkForUpdates() {
    return unavailableUpdateCheck(
      APP_VERSION,
      new Date().toISOString(),
      "desktop-only",
    );
  },
  async copyText(value) {
    await navigator.clipboard.writeText(value);
  },
  async openFolder() {},
  async openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async resetDemo(locale) {
    const snapshotPath = saveBrowserSnapshot(localStorage);
    const workspace = createDemoWorkspace(locale);
    saveBrowserWorkspace(localStorage, workspace, { allowRollback: true });
    return {
      workspace,
      path: "Browser localStorage",
      recoveredFromBackup: false,
      snapshotPath,
    };
  },
};

/**
 * Electron's contextBridge recreates an Error crossing from the preload world
 * into the main world with only `message`, dropping `name` and `retryable`.
 * Rebuild the non-retryable stale-save error here, in the renderer main world,
 * and strip the transport marker so it never reaches the UI.
 */
function withRendererSaveErrors(target: StudioBridge): StudioBridge {
  return {
    ...target,
    save: (workspace, baseRevision) =>
      target.save(workspace, baseRevision).catch((error: unknown) => {
        throw mapSaveErrorFromIpc(error);
      }),
  };
}

export const bridge: StudioBridge = window.iploom
  ? withRendererSaveErrors(window.iploom)
  : browserFallback;

export function newWorkspace(locale: UiLocale): StudioWorkspace {
  return createEmptyWorkspace(
    locale === "en" ? "Untitled Workspace" : "未命名工作区",
    locale,
  );
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
