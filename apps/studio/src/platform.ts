import { createDemoWorkspace, createEmptyWorkspace } from "./core/factory.ts";
import type { ArcReelBundle, StudioWorkspace, UiLocale } from "./core/types.ts";
import { APP_VERSION } from "./core/version.ts";
import { loadBrowserWorkspace, saveBrowserWorkspace } from "./browser-workspace.ts";

export interface LoadedWorkspace {
  workspace: StudioWorkspace;
  path: string;
  recoveredFromBackup: boolean;
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
  desktop: boolean;
  mcp: McpClientConfig;
  mcpBinary: string;
}

export interface StudioBridge {
  load(): Promise<LoadedWorkspace>;
  save(workspace: StudioWorkspace): Promise<{ savedAt: string }>;
  onFlushRequest(listener: (requestId: string) => void): () => void;
  flushComplete(requestId: string, error?: string): Promise<void>;
  exportArcReel(bundle: ArcReelBundle): Promise<WrittenBundle>;
  appInfo(): Promise<AppInfo>;
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

function browserMcpConfig(): McpClientConfig {
  return {
    mcpServers: {
      "iploom-studio": {
        command: "iploom-mcp",
        args: ["--workspace", "/path/to/workspace.json"],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
      },
    },
  };
}

export const browserFallback: StudioBridge = {
  async load() {
    return browserLoad();
  },
  async save(workspace) {
    saveBrowserWorkspace(localStorage, workspace);
    return { savedAt: new Date().toISOString() };
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
      desktop: false,
      mcp: browserMcpConfig(),
      mcpBinary: "iploom-mcp",
    };
  },
  async copyText(value) {
    await navigator.clipboard.writeText(value);
  },
  async openFolder() {},
  async openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async resetDemo(locale) {
    const workspace = createDemoWorkspace(locale);
    saveBrowserWorkspace(localStorage, workspace);
    return { workspace, path: "Browser localStorage", recoveredFromBackup: false };
  },
};

export const bridge: StudioBridge = window.iploom ?? browserFallback;

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
