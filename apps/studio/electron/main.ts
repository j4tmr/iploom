import { constants, existsSync } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
} from "electron";
import { createDemoWorkspace } from "../src/core/factory.ts";
import {
  RELEASES_API_URL,
  buildUpdateCheck,
  parseReleasePayload,
  unavailableUpdateCheck,
  type UpdateCheckResult,
} from "../src/core/updates.ts";
import type {
  ArcReelBundle,
  StudioWorkspace,
  UiLocale,
} from "../src/core/types.ts";
import {
  WorkspaceStore,
  type LoadedWorkspace,
  type WorkspaceSnapshot,
} from "../src/node/workspace-store.ts";
import { createElectronMcpConfig } from "../src/node/mcp-config.ts";
import { AI_CANCELED_MESSAGE, aiConfigSchema, aiRequestSchema, isReportableAiError, runCompletion } from "../src/node/ai-client.ts";
import type { AiConfig } from "../src/core/ai.ts";
import type {
  AppInfo,
  McpClientConfig,
  WrittenBundle,
} from "../src/platform.ts";

const APP_ID = "com.j4tmr.iploom.studio";
const RENDERER_FILE = join(__dirname, "..", "renderer", "index.html");
const RENDERER_ROOT = dirname(RENDERER_FILE);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const UPDATE_CHECK_TIMEOUT_MS = 10_000;

let mainWindow: BrowserWindow | null = null;
let workspaceStore: WorkspaceStore | null = null;
let devUrl: URL | null = null;
const smokeMode = process.env.IPLOOM_STUDIO_SMOKE === "1";
const allowedFolders = new Set<string>();
let aiConfig: AiConfig = { endpoint: "", model: "", apiKey: "" };
const aiRuns = new Map<string, AbortController>();
const aiInfo = () => ({ endpoint: aiConfig.endpoint, model: aiConfig.model, configured: Boolean(aiConfig.endpoint && aiConfig.model) });
let closeApproved = false;
let closeInFlight = false;
let quitApproved = false;
let quitInFlight = false;
let reloadInFlight = false;
let flushWaiter:
  | {
      requestId: string;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  | undefined;
// The most recent workspace the renderer handed to the main process. It backs
// the "save a copy" escape hatch when the normal save keeps failing.
let recoveryWorkspace: StudioWorkspace | null = null;

app.setName("IPloom Studio");

function canonicalFolder(value: string): string {
  const absolute = resolve(value);
  return process.platform === "win32" ? absolute.toLocaleLowerCase() : absolute;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(canonicalFolder(parent), canonicalFolder(child));
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function parseDevUrl(): URL | null {
  if (app.isPackaged) return null;
  const raw = process.env.IPLOOM_STUDIO_DEV_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "IPLOOM_STUDIO_DEV_URL must be a loopback HTTP URL in development",
    );
  }
  return url;
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const target = new URL(value);
    if (devUrl) return target.origin === devUrl.origin;
    if (target.protocol !== "file:") return false;
    return isWithin(RENDERER_ROOT, fileURLToPath(target));
  } catch {
    return false;
  }
}

function safeExternalUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      value.length > 8_192
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function openExternalSafely(value: string): Promise<void> {
  const url = safeExternalUrl(value);
  if (!url) throw new Error("Only credential-free HTTP(S) links can be opened");
  await shell.openExternal(url.toString());
}

let updateCheckInFlight: Promise<UpdateCheckResult> | null = null;

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const checkedAt = () => new Date().toISOString();
  try {
    const response = await net.fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": `IPloom-Studio/${currentVersion}`,
      },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) {
      return unavailableUpdateCheck(
        currentVersion,
        checkedAt(),
        "http",
        response.status,
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    const releases = parseReleasePayload(payload);
    if (!releases) {
      return unavailableUpdateCheck(currentVersion, checkedAt(), "response");
    }
    return buildUpdateCheck(
      releases,
      currentVersion,
      process.platform,
      checkedAt(),
    );
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return unavailableUpdateCheck(
      currentVersion,
      checkedAt(),
      timedOut ? "timeout" : "network",
    );
  }
}

function requestUpdateCheck(): Promise<UpdateCheckResult> {
  if (!updateCheckInFlight) {
    updateCheckInFlight = checkForUpdates().finally(() => {
      updateCheckInFlight = null;
    });
  }
  return updateCheckInFlight;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error("Rejected IPC call from an untrusted renderer");
  }
}

function requireStore(): WorkspaceStore {
  if (!workspaceStore) throw new Error("Workspace store is not initialized");
  return workspaceStore;
}

function requestRendererFlush(window: BrowserWindow): Promise<void> {
  if (window.webContents.isDestroyed()) {
    return Promise.resolve();
  }
  if (flushWaiter) {
    return Promise.reject(new Error("A workspace save handshake is already active"));
  }
  const requestId = `flush-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (flushWaiter?.requestId !== requestId) return;
      flushWaiter = undefined;
      reject(
        new Error(
          "The editor did not confirm its final save within 8 seconds. The window was kept open.",
        ),
      );
    }, 8_000);
    timer.unref();
    flushWaiter = { requestId, resolve, reject, timer };
    window.webContents.send("iploom:flush-request", requestId);
  });
}

/**
 * Cmd/Ctrl+R and F5 must not reload the renderer directly: the workspace lives
 * in renderer memory until the debounced save lands, so an unguarded reload
 * drops the last edit. Flush first, reload only once the disk confirms it.
 */
async function reloadAfterFlush(window: BrowserWindow): Promise<void> {
  if (reloadInFlight || closeInFlight || quitInFlight) return;
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  reloadInFlight = true;
  try {
    await requestRendererFlush(window);
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.reload();
  } catch (error) {
    console.error("[IPloom Studio] reload flush failed", error);
    if (smokeMode) {
      app.exit(1);
      return;
    }
    await showMessage(window, {
      type: "error",
      title: "Reload canceled",
      message:
        "The editor could not confirm its save, so the reload was canceled.",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["OK"],
      defaultId: 0,
      noLink: true,
    });
  } finally {
    reloadInFlight = false;
  }
}

function showMessage(
  window: BrowserWindow,
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return window.isDestroyed()
    ? dialog.showMessageBox(options)
    : dialog.showMessageBox(window, options);
}

async function chooseCloseFailureAction(
  window: BrowserWindow,
  message: string,
): Promise<"retry" | "copy" | "exit" | "edit"> {
  const { response } = await showMessage(window, {
    type: "error",
    title: "IPloom Studio could not finish saving",
    message,
    detail:
      "Retry the save, save a copy of the in-memory workspace, or exit without saving. " +
      "Exiting without saving discards edits made since the last successful save.",
    buttons: [
      "Retry",
      "Save a Copy and Exit",
      "Exit Without Saving",
      "Keep Editing",
    ],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  });
  if (response === 1) return "copy";
  if (response === 2) return "exit";
  if (response === 3) return "edit";
  return "retry";
}

async function closeAfterFlush(
  window: BrowserWindow,
  quit: boolean,
): Promise<void> {
  if (quit ? quitInFlight : closeInFlight) return;
  if (quit) quitInFlight = true;
  else closeInFlight = true;
  try {
    for (;;) {
      try {
        await requestRendererFlush(window);
        closeApproved = true;
        if (quit) {
          quitApproved = true;
          app.quit();
        } else {
          window.close();
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[IPloom Studio] close flush failed", error);
        if (smokeMode) {
          app.exit(1);
          return;
        }
        const choice = await chooseCloseFailureAction(window, message);
        if (choice === "retry") continue;
        if (choice === "edit") return;
        if (choice === "copy") {
          if (!recoveryWorkspace) {
            await showMessage(window, {
              type: "error",
              title: "No workspace copy is available",
              message:
                "The editor has not handed the workspace to the main process yet. " +
                "Choose Retry, or keep editing and try again.",
              buttons: ["Retry", "Keep Editing"],
              defaultId: 0,
              cancelId: 1,
              noLink: true,
            });
            continue;
          }
          try {
            const path = await requireStore().saveRecoveryCopy(recoveryWorkspace);
            await showMessage(window, {
              type: "info",
              title: "Recovery copy saved",
              message: `Your in-memory workspace was saved to ${path}.`,
              buttons: ["Exit"],
              defaultId: 0,
              noLink: true,
            });
          } catch (copyError) {
            await showMessage(window, {
              type: "error",
              title: "Could not save a recovery copy",
              message:
                copyError instanceof Error
                  ? copyError.message
                  : String(copyError),
              buttons: ["Retry", "Keep Editing"],
              defaultId: 0,
              cancelId: 1,
              noLink: true,
            });
            continue;
          }
        }
        closeApproved = true;
        if (quit) {
          quitApproved = true;
          app.quit();
        } else {
          window.close();
        }
        return;
      }
    }
  } finally {
    if (quit) quitInFlight = false;
    else closeInFlight = false;
  }
}

function defaultLocale(): UiLocale {
  return app.getLocale().toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function rememberFolders(workspace: StudioWorkspace): void {
  const store = requireStore();
  allowedFolders.add(canonicalFolder(dirname(store.filePath)));
  allowedFolders.add(canonicalFolder(store.snapshotDirectory));
  for (const record of workspace.exports) {
    if (record.outputPath)
      allowedFolders.add(canonicalFolder(record.outputPath));
  }
}

async function loadWorkspace(): Promise<LoadedWorkspace> {
  const store = requireStore();
  try {
    const loaded = await store.load();
    rememberFolders(loaded.workspace);
    return loaded;
  } catch (error) {
    if (await exists(store.filePath)) throw error;
    const workspace = createDemoWorkspace(defaultLocale());
    await store.save(workspace);
    rememberFolders(workspace);
    return {
      workspace,
      path: store.filePath,
      recoveredFromBackup: false,
    };
  }
}

function assertArcReelBundle(value: unknown): asserts value is ArcReelBundle {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid ArcReel bundle");
  }
  const bundle = value as Partial<ArcReelBundle>;
  if (
    bundle.schema !== "iploom.arcreel/v1" ||
    typeof bundle.workTitle !== "string" ||
    typeof bundle.generatedAt !== "string" ||
    !Array.isArray(bundle.files)
  ) {
    throw new Error("Invalid ArcReel bundle");
  }
  for (const file of bundle.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      throw new Error("Invalid ArcReel bundle file");
    }
  }
}

function resolveMcpBinary(): string {
  const names = ["iploom-mcp"];
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, "..");
  const bundledDirectory = join(resourcesRoot, "bin");
  const candidates = [
    process.env.IPLOOM_MCP_BINARY,
    ...names.map((name) => join(bundledDirectory, name)),
    ...names.map((name) => join(resourcesRoot, name)),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    join(bundledDirectory, "iploom-mcp")
  );
}

function mcpClientConfig(): McpClientConfig {
  const binary = resolveMcpBinary();
  if (existsSync(binary)) {
    return createElectronMcpConfig({
      executable: process.execPath,
      mcpScript: binary,
      workspacePath: requireStore().filePath,
    });
  }
  const sourceMcp = [
    join(
      __dirname,
      "..",
      "..",
      "..",
      "apps",
      "studio",
      "mcp",
      "server.ts",
    ),
    join(__dirname, "..", "..", "apps", "studio", "mcp", "server.ts"),
  ].find((candidate) => existsSync(candidate));
  if (!sourceMcp) {
    throw new Error("Bundled MCP server is missing from this installation");
  }
  return {
    mcpServers: {
      "iploom-studio": {
        command: "bun",
        args: [
          sourceMcp,
          "--workspace",
          requireStore().filePath,
        ],
      },
    },
  };
}

async function exportArcReel(bundle: ArcReelBundle): Promise<WrittenBundle> {
  assertArcReelBundle(bundle);
  const options: OpenDialogOptions = {
    title:
      bundle.workLanguage === "zh-CN"
        ? "选择 ArcReel 导出目录"
        : "Choose an ArcReel export folder",
    buttonLabel: bundle.workLanguage === "zh-CN" ? "导出" : "Export",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  };
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const destination = selection.filePaths[0];
  if (selection.canceled || !destination) {
    return { directory: "", files: 0, bytes: 0, canceled: true };
  }
  const written = await requireStore().exportArcReel(bundle, destination);
  allowedFolders.add(canonicalFolder(written.directory));
  return written;
}

function registerIpcHandlers(): void {
  ipcMain.handle("iploom:ai-config", (event) => { assertTrustedSender(event); return aiInfo(); });
  ipcMain.handle("iploom:configure-ai", (event, config: unknown) => {
    assertTrustedSender(event);
    if (aiRuns.size) throw new Error("Wait for the current AI task or cancel it before changing configuration.");
    aiConfig = aiConfigSchema.parse(config);
    return aiInfo();
  });
  ipcMain.handle("iploom:cancel-ai", (event, id: string) => { assertTrustedSender(event); aiRuns.get(id)?.abort(); });
  ipcMain.handle("iploom:run-ai", async (event, input: unknown) => {
    assertTrustedSender(event);
    const request = aiRequestSchema.parse(input);
    if (aiRuns.size) throw new Error("Another AI task is running. Wait or cancel it first.");
    if (!aiInfo().configured) throw new Error("Configure the model API in Settings first.");
    const controller = new AbortController();
    aiRuns.set(request.id, controller);
    let lastSent = 0;
    try {
      return await runCompletion(aiConfig, request, controller.signal, (text) => {
        if (!event.sender.isDestroyed() && Date.now() - lastSent >= 80) {
          lastSent = Date.now();
          event.sender.send("iploom:ai-progress", { id: request.id, label: request.label, text });
        }
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(AI_CANCELED_MESSAGE);
      // Never echo provider payloads or credential-bearing fetch errors into IPC/logs.
      throw new Error(isReportableAiError(error) ? error.message : "Model request failed. Check configuration and retry.");
    } finally { aiRuns.delete(request.id); }
  });
  ipcMain.handle("iploom:load", async (event) => {
    assertTrustedSender(event);
    return loadWorkspace();
  });

  ipcMain.handle("iploom:save", async (event, workspace: StudioWorkspace) => {
    assertTrustedSender(event);
    if (workspace && typeof workspace === "object") recoveryWorkspace = workspace;
    await requireStore().save(workspace);
    return { savedAt: new Date().toISOString() };
  });

  ipcMain.handle(
    "iploom:flush-complete",
    async (
      event,
      requestId: string,
      error?: string,
      workspace?: StudioWorkspace,
    ) => {
      assertTrustedSender(event);
      if (workspace && typeof workspace === "object") {
        recoveryWorkspace = workspace;
      }
      if (typeof requestId !== "string") {
        throw new Error("Flush request id must be a string");
      }
      if (!flushWaiter || flushWaiter.requestId !== requestId) return;
      const waiter = flushWaiter;
      flushWaiter = undefined;
      clearTimeout(waiter.timer);
      if (error) waiter.reject(new Error(error));
      else waiter.resolve();
    },
  );

  ipcMain.handle(
    "iploom:export-arc-reel",
    async (event, bundle: ArcReelBundle) => {
      assertTrustedSender(event);
      return exportArcReel(bundle);
    },
  );

  ipcMain.handle("iploom:app-info", async (event): Promise<AppInfo> => {
    assertTrustedSender(event);
    return {
      version: app.getVersion(),
      platform: process.platform,
      workspacePath: requireStore().filePath,
      snapshotDirectory: requireStore().snapshotDirectory,
      desktop: true,
      mcp: mcpClientConfig(),
      mcpBinary: resolveMcpBinary(),
    };
  });

  ipcMain.handle("iploom:check-update", async (event): Promise<UpdateCheckResult> => {
    assertTrustedSender(event);
    return requestUpdateCheck();
  });

  ipcMain.handle("iploom:copy-text", async (event, value: string) => {
    assertTrustedSender(event);
    if (typeof value !== "string") throw new Error("Text must be a string");
    clipboard.writeText(value);
  });

  ipcMain.handle("iploom:open-folder", async (event, value: string) => {
    assertTrustedSender(event);
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("Folder path must be a string");
    }
    const folder = canonicalFolder(value);
    if (![...allowedFolders].some((allowed) => isWithin(allowed, folder))) {
      throw new Error("Folder is outside this workspace's export history");
    }
    const info = await stat(value);
    if (!info.isDirectory()) throw new Error("Path is not a directory");
    const failure = await shell.openPath(resolve(value));
    if (failure) throw new Error(failure);
  });

  ipcMain.handle("iploom:open-external", async (event, value: string) => {
    assertTrustedSender(event);
    if (typeof value !== "string") throw new Error("URL must be a string");
    await openExternalSafely(value);
  });

  ipcMain.handle(
    "iploom:create-snapshot",
    async (event, reason: string): Promise<string | null> => {
      assertTrustedSender(event);
      if (typeof reason !== "string") {
        throw new Error("Snapshot reason must be a string");
      }
      return requireStore().createSnapshot(reason);
    },
  );

  ipcMain.handle(
    "iploom:list-snapshots",
    async (event): Promise<WorkspaceSnapshot[]> => {
      assertTrustedSender(event);
      return requireStore().listSnapshots();
    },
  );

  ipcMain.handle(
    "iploom:restore-snapshot",
    async (event, snapshotPath: string): Promise<LoadedWorkspace> => {
      assertTrustedSender(event);
      if (typeof snapshotPath !== "string") {
        throw new Error("Snapshot path must be a string");
      }
      const loaded = await requireStore().restoreSnapshot(snapshotPath);
      rememberFolders(loaded.workspace);
      return loaded;
    },
  );

  ipcMain.handle("iploom:reset-demo", async (event, locale: UiLocale) => {
    assertTrustedSender(event);
    if (locale !== "zh-CN" && locale !== "en") {
      throw new Error("Unsupported locale");
    }
    const store = requireStore();
    // Keep the pre-reset workspace out of reach of the `.bak` rotation: the
    // renderer may save once more right after this handler returns.
    const snapshotPath = await store.createSnapshot("before-reset-demo");
    const workspace = createDemoWorkspace(locale);
    await store.save(workspace);
    rememberFolders(workspace);
    return {
      workspace,
      path: store.filePath,
      recoveredFromBackup: false,
      snapshotPath,
    } satisfies LoadedWorkspace;
  });
}

function guardWebContents(contents: WebContents): void {
  contents.on("will-navigate", (event) => {
    if (isTrustedRendererUrl(event.url)) return;
    event.preventDefault();
    const external = safeExternalUrl(event.url);
    if (external) void shell.openExternal(external.toString());
  });

  contents.on("will-redirect", (event) => {
    if (isTrustedRendererUrl(event.url)) return;
    event.preventDefault();
  });

  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame || isTrustedRendererUrl(event.url)) return;
    event.preventDefault();
  });

  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url);
    if (external) void shell.openExternal(external.toString());
    return { action: "deny" };
  });
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

/**
 * Electron's stock menu ships Reload and Force Reload (CmdOrCtrl+R), which
 * bypass the save handshake and drop unsaved edits. This menu keeps the roles
 * the app actually needs (clipboard editing, quit, window controls, devtools
 * when allowed) and omits every reload role; the shortcut is re-implemented as
 * a flush-then-reload in `createWindow`.
 */
function configureApplicationMenu(): void {
  const devToolsAllowed =
    !app.isPackaged || process.env.IPLOOM_STUDIO_DEVTOOLS === "1";
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    ...(devToolsAllowed
      ? [{ label: "View", submenu: [{ role: "toggleDevTools" as const }] }]
      : []),
    ...(isMac ? [{ role: "windowMenu" as const }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: "IPloom Studio",
    backgroundColor: "#0b1115",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.IPLOOM_STUDIO_DEVTOOLS === "1",
    },
  });

  window.once("ready-to-show", () => {
    if (!smokeMode) window.show();
  });
  // The custom application menu has no reload accelerator, but a shortcut can
  // still reach Chromium through other paths; intercept it here as well so the
  // only way to reload is the save-then-reload path.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLocaleLowerCase();
    const wantsReload =
      key === "f5" || ((input.control || input.meta) && key === "r");
    if (!wantsReload) return;
    event.preventDefault();
    void reloadAfterFlush(window);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[IPloom Studio] renderer process gone", details);
    if (details.reason === "clean-exit") return;
    if (window.isDestroyed()) return;
    if (closeApproved || closeInFlight || quitApproved || quitInFlight) return;
    if (smokeMode) {
      app.exit(1);
      return;
    }
    void (async () => {
      const { response } = await showMessage(window, {
        type: "error",
        title: "IPloom Studio stopped responding",
        message: `The editor process closed unexpectedly (${details.reason}).`,
        detail:
          "Reloading restores the last saved workspace. Edits made since the " +
          "last successful save cannot be recovered.",
        buttons: ["Reload", "Quit"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.reload();
        }
        return;
      }
      closeApproved = true;
      quitApproved = true;
      app.quit();
    })();
  });
  window.on("close", (event) => {
    if (closeApproved || window.webContents.isDestroyed()) return;
    event.preventDefault();
    closeAfterFlush(window, false);
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    if (smokeMode) app.exit(0);
  });

  const load = devUrl
    ? window.loadURL(devUrl.toString())
    : window.loadFile(RENDERER_FILE);
  if (smokeMode) {
    window.webContents.once("did-finish-load", () => {
      void finishSmoke(window);
    });
    window.webContents.once(
      "did-fail-load",
      (_event, code, description) => {
        console.error(`[smoke] renderer failed: ${code} ${description}`);
        app.exit(1);
      },
    );
  }
  void load.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("IPloom Studio failed to load", message);
  });
  return window;
}

async function finishSmoke(window: BrowserWindow): Promise<void> {
  try {
    const result = (await window.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const deadline = Date.now() + 20_000;
        const check = async () => {
          const shell = document.querySelector(".studio-shell");
          const text = document.body.innerText.trim();
          if (shell && text.length > 100) {
            const workflowNav = document.querySelector('[data-route="workflow"]');
            if (!(workflowNav instanceof HTMLElement)) {
              reject(new Error("workflow navigation did not render"));
              return;
            }
            workflowNav.click();
            await new Promise((resolveWorkflow, rejectWorkflow) => {
              const workflowDeadline = Date.now() + 5_000;
              const timeout = setTimeout(() => {
                rejectWorkflow(new Error("workflow view timed out"));
              }, 5_000);
              const poll = () => {
                if (
                  document.querySelector(".workflow-view") &&
                  document.querySelector(".workflow-row") &&
                  document.querySelector(".workflow-detail")
                ) {
                  clearTimeout(timeout);
                  resolveWorkflow();
                  return;
                }
                if (Date.now() >= workflowDeadline) {
                  clearTimeout(timeout);
                  rejectWorkflow(new Error("workflow view did not become ready"));
                  return;
                }
                setTimeout(poll, 100);
              };
              poll();
            });
            const info = await window.iploom.appInfo();
            const server = info.mcp.mcpServers["iploom-studio"];
            if (!info.desktop || !server) {
              reject(new Error("desktop bridge did not initialize"));
              return;
            }
            if (server.env?.ELECTRON_RUN_AS_NODE !== "1") {
              reject(
                new Error(
                  "MCP is not using the Electron runtime: " +
                    JSON.stringify(server),
                ),
              );
              return;
            }
            resolve({
              title: document.title,
              textLength: text.length,
              shells: document.querySelectorAll(".studio-shell").length,
              navigation: document.querySelectorAll("nav button, aside button").length,
              workflowTasks:
                document.querySelectorAll(".workflow-row").length,
              mcpCommand: server.command,
              mcpScript: server.args[0]
            });
            return;
          }
          if (Date.now() >= deadline) {
            reject(new Error("studio shell did not become ready"));
            return;
          }
          setTimeout(check, 100);
        };
        check();
      })`,
      true,
    )) as {
      title: string;
      textLength: number;
      shells: number;
      navigation: number;
      workflowTasks: number;
      mcpCommand: string;
      mcpScript: string;
    };
    await new Promise((resolveWait) => setTimeout(resolveWait, 600));
    const mockEndpoint = process.env.IPLOOM_STUDIO_SMOKE_AI_ENDPOINT;
    if (mockEndpoint) {
      await window.webContents.executeJavaScript(`(async () => {
        const waitFor = async (test) => {
          const deadline = Date.now() + 8000;
          while (!test()) { if (Date.now() > deadline) throw new Error("Production UI smoke timed out"); await new Promise(r => setTimeout(r, 30)); }
        };
        const setValue = (selector, value) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error("Missing smoke input: " + selector);
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        await window.iploom.configureAi({ endpoint: ${JSON.stringify(mockEndpoint)}, model: "smoke-model", apiKey: "" });
        const config = await window.iploom.aiConfig();
        if ("apiKey" in config) throw new Error("AI config exposed a secret field");
        document.querySelector('.production-panel').open = true;
        document.querySelector('[data-testid="production-compose"]').click();
        await waitFor(() => !document.querySelector('[data-testid="production-run"]').disabled);
        const originalConfirm = window.confirm;
        window.confirm = () => true;
        try { document.querySelector('[data-testid="production-run"]').click();
          await waitFor(() => document.querySelector('[data-testid="production-output"]')?.value.length > 500 && !document.querySelector('[data-testid="production-run"]').disabled);
        } finally { window.confirm = originalConfirm; }
        document.querySelector('[data-route="library"]').click();
        await waitFor(() => document.querySelector('[data-testid="import-open"]'));
        document.querySelector('[data-testid="import-open"]').click();
        await waitFor(() => document.querySelector('[data-testid="import-title"]'));
        setValue('[data-testid="import-title"]', 'smoke-import-novel');
        setValue('[data-testid="import-text"]', 'Chapter 1\\nA traveler arrived at the lighthouse.\\nChapter 2\\nThe lamp turned blue.');
        await waitFor(() => !document.querySelector('[data-testid="import-confirm"]').disabled);
        document.querySelector('[data-testid="import-confirm"]').click();
        await waitFor(() => document.querySelector('.work-view h1')?.textContent === 'smoke-import-novel');
        document.querySelector('[data-route="workflow"]').click();
        await waitFor(() => document.querySelector('[data-testid="workflow-result"]'));
      })()`, true);
      console.log("[smoke] live model output, review persistence and novel import verified (local mock)");
      await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    const screenshot = process.env.IPLOOM_STUDIO_SMOKE_SCREENSHOT;
    if (screenshot) {
      const image = await window.webContents.capturePage();
      await mkdir(dirname(resolve(screenshot)), { recursive: true });
      await writeFile(resolve(screenshot), image.toPNG());
      console.log(`[smoke] screenshot: ${resolve(screenshot)}`);
    }
    console.log(`[smoke] ok ${JSON.stringify(result)}`);
    const saveMarker = process.env.IPLOOM_STUDIO_SMOKE_SAVE_MARKER;
    if (saveMarker) {
      await window.webContents.executeJavaScript(
        `new Promise((resolve, reject) => {
          const textarea = document.querySelector(
            '[data-testid="workflow-result"]',
          );
          if (!(textarea instanceof HTMLTextAreaElement)) {
            reject(new Error("workflow result editor did not render"));
            return;
          }
          const setValue = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          ).set;
          setValue.call(textarea, ${JSON.stringify(saveMarker)});
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          const deadline = Date.now() + 2_000;
          const save = () => {
            const button = document.querySelector(
              '[data-testid="workflow-save-result"]',
            );
            if (button && !button.disabled) {
              button.click();
              setTimeout(resolve, 20);
              return;
            }
            if (Date.now() >= deadline) {
              reject(new Error("workflow result did not become saveable"));
              return;
            }
            setTimeout(save, 20);
          };
          save();
        })`,
        true,
      );
    }
    window.close();
  } catch (error) {
    console.error("[smoke] failed", error);
    app.exit(1);
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_ID);
  devUrl = parseDevUrl();
  const workspacePath = process.env.IPLOOM_STUDIO_WORKSPACE
    ? resolve(process.env.IPLOOM_STUDIO_WORKSPACE)
    : join(app.getPath("userData"), "workspace.json");
  workspaceStore = new WorkspaceStore(workspacePath);
  await loadWorkspace();
  configureSessionSecurity();
  app.on("web-contents-created", (_event, contents) => {
    guardWebContents(contents);
  });
  registerIpcHandlers();
  configureApplicationMenu();
  mainWindow = createWindow();
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[IPloom Studio]", error);
  dialog.showErrorBox("IPloom Studio could not start", message);
  process.exitCode = 1;
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);
  app.on("activate", () => {
    if (!mainWindow && workspaceStore) mainWindow = createWindow();
    else focusMainWindow();
  });
  app.on("before-quit", (event) => {
    if (quitApproved || !mainWindow) return;
    event.preventDefault();
    closeAfterFlush(mainWindow, true);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  void app.whenReady().then(bootstrap).catch(fail);
}
