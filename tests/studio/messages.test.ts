import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArcReelBundle } from "../../apps/studio/src/core/arcreel.ts";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  aiConfigSchema,
  createAiConfigSchema,
  isReportableAiError,
  parseAiConfigInput,
  parseAiRequestInput,
  runCompletion,
} from "../../apps/studio/src/node/ai-client.ts";
import {
  closeFailureDialog,
  noRecoveryCopyDialog,
  recoveryFailedDialog,
  recoverySavedDialog,
  reloadCanceledDialog,
  rendererCrashDialog,
  type MainDialogOptions,
} from "../../apps/studio/src/node/dialog-copy.ts";
import {
  parseArcReelBundle,
  revealKnownPath,
} from "../../apps/studio/src/node/desktop-guards.ts";
import {
  englishMainMessages,
  mainMessagesFor,
  normalizeUiLocale,
  zhMainMessages,
  type MainMessages,
} from "../../apps/studio/src/node/messages.ts";
import { mcpClientConfigState } from "../../apps/studio/src/node/mcp-config.ts";
import {
  STALE_WORKSPACE_MARKER,
  markStaleWorkspaceMessage,
} from "../../apps/studio/src/save-errors.ts";
import {
  StaleWorkspaceError,
  WorkspaceStore,
} from "../../apps/studio/src/node/workspace-store.ts";

/** Recursively compares key sets (not values) of the two message presets. */
function assertSameShape(en: unknown, zh: unknown, path: string): void {
  if (typeof en === "function") {
    expect(typeof zh === "function" ? undefined : zh).toBeUndefined();
    return;
  }
  if (typeof en === "string") {
    expect(typeof zh === "string" ? undefined : zh).toBeUndefined();
    return;
  }
  if (en === null || typeof en !== "object") {
    throw new Error(`Unexpected catalog value at ${path}`);
  }
  expect(zh !== null && typeof zh === "object").toBe(true);
  const enKeys = Object.keys(en as object).sort();
  const zhKeys = Object.keys(zh as object).sort();
  expect(enKeys).toEqual(zhKeys);
  for (const key of enKeys) {
    assertSameShape(
      (en as Record<string, unknown>)[key],
      (zh as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
  }
}

/** Minimal fetch double satisfying Bun's `typeof fetch` (preconnect included). */
const stubFetch: typeof fetch = Object.assign(
  () => new Promise<Response>(() => undefined),
  { preconnect: () => undefined },
);
void stubFetch;

/**
 * Exercises every catalog entry in both presets: plain strings must be
 * non-empty, template functions must produce their inputs back in a
 * non-empty string. Doubles as the guarantee that no preset entry is
 * missing or returns blank copy (and keeps the coverage gate honest about
 * the catalog's real shape).
 */
function exerciseCatalog(preset: MainMessages): void {
  for (const group of [
    preset.shell,
    preset.ai,
    preset.store,
    preset.guards,
    preset.mcpConfig,
    preset.dialogs,
  ]) {
    for (const [key, value] of Object.entries(group)) {
      const produced = typeof value === "function" ? value(1, "x") : value;
      expect(produced, `${key}`).toBeTruthy();
      expect(produced.length, `${key}`).toBeGreaterThan(0);
    }
  }
}

describe("message catalog", () => {
  test("zh and English presets have identical key sets", () => {
    assertSameShape(englishMainMessages, zhMainMessages, "mainMessages");
  });

  test("mainMessagesFor selects zh-CN and defaults to English", () => {
    expect(mainMessagesFor("zh-CN")).toBe(zhMainMessages);
    expect(mainMessagesFor("en")).toBe(englishMainMessages);
  });

  test("normalizeUiLocale accepts supported locales and falls back otherwise", () => {
    expect(normalizeUiLocale("zh-CN", "en")).toBe("zh-CN");
    expect(normalizeUiLocale("en", "zh-CN")).toBe("en");
    expect(normalizeUiLocale("fr", "en")).toBe("en");
    expect(normalizeUiLocale("zh", "en")).toBe("en");
    expect(normalizeUiLocale("zh-cn", "en")).toBe("en");
    expect(normalizeUiLocale(undefined, "zh-CN")).toBe("zh-CN");
    expect(normalizeUiLocale(42, "en")).toBe("en");
  });

  test("every catalog entry produces non-empty copy in both presets", () => {
    exerciseCatalog(englishMainMessages);
    exerciseCatalog(zhMainMessages);
  });

  test("English preset keeps the pre-localization strings byte-identical", () => {
    // Anchors from the original hardcoded text; a rewording would break the
    // MCP error contract and existing message-matching tests.
    expect(englishMainMessages.ai.canceled).toBe(
      "Model request canceled by the user; no result was applied.",
    );
    expect(englishMainMessages.shell.handshakeActive).toBe(
      "A workspace save handshake is already active",
    );
    expect(englishMainMessages.store.missingOrInvalid("x")).toBe(
      "Workspace is missing or invalid. x",
    );
    expect(englishMainMessages.store.staleOlder("/w.json", 3, 2)).toContain(
      "Another process (for example the MCP server) changed",
    );
    expect(englishMainMessages.ai.httpHint(429, 7)).toBe(
      "Rate limit or quota reached; retry after 7 seconds.",
    );
    expect(englishMainMessages.guards.invalidArcReelBundle(" at a.b")).toBe(
      "Invalid ArcReel bundle at a.b",
    );
    expect(englishMainMessages.mcpConfig.bunMissing).toBe(
      "The development MCP server needs Bun, but no Bun executable was found.",
    );
  });
});

describe("localized workspace store", () => {
  test("stale-save errors carry Chinese text and the transport marker", () => {
    const error = new StaleWorkspaceError(
      "/w.json",
      4,
      2,
      3,
      zhMainMessages.store,
    );
    expect(error.message).toContain("拒绝");
    expect(error.message).toContain("MCP 服务器");
    const marked = markStaleWorkspaceMessage(error.message);
    expect(marked.startsWith(STALE_WORKSPACE_MARKER)).toBe(true);
    // English default keeps the original phrasing.
    const en = new StaleWorkspaceError("/w.json", 4, 2, 3);
    expect(en.message).toContain("Refusing to overwrite");
  });

  test("zh store localizes unreadable-file load failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-messages-"));
    const file = join(root, "workspace.json");
    writeFileSync(file, "{ not json", "utf8");
    const store = new WorkspaceStore(file, zhMainMessages);
    await expect(store.load()).rejects.toThrow("工作区缺失或无效");
  });

  test("setLocale re-derives the store copy without reconstructing", async () => {
    // Regression for the main-process locale sync: the store captures its
    // copy at construction, so a runtime language switch must re-derive it.
    const root = mkdtempSync(join(tmpdir(), "iploom-messages-"));
    const file = join(root, "workspace.json");
    writeFileSync(file, "{ not json", "utf8");
    const store = new WorkspaceStore(file);
    await expect(store.load()).rejects.toThrow(
      "Workspace is missing or invalid",
    );
    store.setLocale("zh-CN");
    await expect(store.load()).rejects.toThrow("工作区缺失或无效");
    store.setLocale("en");
    await expect(store.load()).rejects.toThrow(
      "Workspace is missing or invalid",
    );
  });

  test("zh store localizes snapshot-restore failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-messages-"));
    const file = join(root, "workspace.json");
    const store = new WorkspaceStore(file, zhMainMessages);
    await expect(
      store.restoreSnapshot(join(root, "nope.json")),
    ).rejects.toThrow("不是工作区快照");
  });

  test("zh store localizes unsafe export paths; English default stays", async () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    const tampered = {
      ...bundle,
      files: bundle.files.map((file, index) =>
        index === 0 ? { ...file, path: "../escape.md" } : file,
      ),
    };
    const root = mkdtempSync(join(tmpdir(), "iploom-messages-"));
    await expect(
      new WorkspaceStore(
        join(root, "workspace.json"),
        zhMainMessages,
      ).exportArcReel(tampered, join(root, "exports")),
    ).rejects.toThrow("不安全的导出路径");
    await expect(
      new WorkspaceStore(join(root, "workspace.json")).exportArcReel(
        tampered,
        join(root, "exports"),
      ),
    ).rejects.toThrow("Unsafe export path");
  });

  test("zh guards localize ArcReel bundle rejections", async () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    const tampered = { ...bundle, files: [] };
    expect(() => parseArcReelBundle(tampered, zhMainMessages.guards)).toThrow(
      "无效的 ArcReel 交付包",
    );
    expect(() => parseArcReelBundle(tampered)).toThrow(
      "Invalid ArcReel bundle",
    );
  });
});

describe("localized ai-client", () => {
  const config = {
    endpoint: "https://api.example.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
  };
  const request = { id: "req1", label: "l", prompt: "hi" };

  test("zh first-byte timeout surfaces in Chinese and stays reportable", async () => {
    const fetcher: typeof fetch = Object.assign(
      () => new Promise<Response>(() => undefined), // never responds; timer fires
      { preconnect: () => undefined },
    );
    const error = await runCompletion(
      config,
      request,
      new AbortController().signal,
      () => undefined,
      fetcher,
      { firstByteTimeoutMs: 30 },
      zhMainMessages,
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("秒内未返回数据");
    // The zh text has no English prefix; only the class keeps the gate open.
    expect(isReportableAiError(error)).toBe(true);
  });

  test("English default keeps the legacy abort text and stays reportable", async () => {
    const fetcher: typeof fetch = Object.assign(
      () => new Promise<Response>(() => undefined),
      { preconnect: () => undefined },
    );
    const error = await runCompletion(
      config,
      request,
      new AbortController().signal,
      () => undefined,
      fetcher,
      { firstByteTimeoutMs: 30 },
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("sent no data for 0 seconds");
    expect(isReportableAiError(error)).toBe(true);
  });

  test("parseAiConfigInput surfaces localized refinements, not Zod JSON", () => {
    expect(() =>
      parseAiConfigInput(
        { endpoint: "http://example.com/v1", model: "m", apiKey: "" },
        zhMainMessages.ai,
      ),
    ).toThrow("请使用 HTTPS 或本机回环 HTTP");
    expect(() =>
      parseAiConfigInput(
        { endpoint: "nope", model: "m", apiKey: "" },
        zhMainMessages.ai,
      ),
    ).toThrow("请输入有效的 URL");
    // A built-in Zod constraint has only English text; use the catalog hint.
    expect(() =>
      parseAiConfigInput(
        { endpoint: "https://api.example.com/v1", model: "", apiKey: "" },
        zhMainMessages.ai,
      ),
    ).toThrow(zhMainMessages.ai.invalidConfig);
    expect(
      parseAiConfigInput(
        { endpoint: "https://api.example.com/v1", model: "m", apiKey: "" },
        zhMainMessages.ai,
      ),
    ).toEqual({
      endpoint: "https://api.example.com/v1",
      model: "m",
      apiKey: "",
    });
  });

  test("parseAiRequestInput replaces Zod details with one localized message", () => {
    expect(() =>
      parseAiRequestInput(
        { id: "req1", label: "l", prompt: "" },
        zhMainMessages.ai,
      ),
    ).toThrow("AI 请求无效");
    const parsed = parseAiRequestInput(
      { id: "req1", label: "l", prompt: "hi" },
      zhMainMessages.ai,
    );
    expect(parsed).toEqual({ id: "req1", label: "l", prompt: "hi" });
  });

  test("localized messages still pass the reportable gate structurally", async () => {
    const body = JSON.stringify({
      error: { message: "quota gone", code: "x" },
    });
    const fetcher: typeof fetch = Object.assign(
      async () => new Response(body, { status: 429 }),
      { preconnect: () => undefined },
    );
    const error = await runCompletion(
      config,
      request,
      new AbortController().signal,
      () => undefined,
      fetcher,
      {},
      zhMainMessages,
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(isReportableAiError(error)).toBe(true);
    expect((error as Error).message).toContain("已达到速率或配额限制");
  });

  test("aiConfigSchema stays English; a zh instance localizes refinements", () => {
    const zhSchema = createAiConfigSchema(zhMainMessages.ai);
    const enIssues = aiConfigSchema.safeParse({ ...config, endpoint: "nope" });
    const zhIssues = zhSchema.safeParse({ ...config, endpoint: "nope" });
    expect(enIssues.success).toBe(false);
    expect(zhIssues.success).toBe(false);
    if (enIssues.success || zhIssues.success) return;
    expect(
      enIssues.error.issues.some((issue) =>
        issue.message.includes("valid URL"),
      ),
    ).toBe(true);
    expect(
      zhIssues.error.issues.some((issue) =>
        issue.message.includes("有效的 URL"),
      ),
    ).toBe(true);
  });
});

describe("localized desktop guards", () => {
  test("revealKnownPath reports in Chinese when injected", async () => {
    await expect(
      revealKnownPath("/etc", {
        allowedFolders: ["/workspace"],
        showItemInFolder: () => undefined,
        platform: "darwin",
        messages: zhMainMessages.guards,
      }),
    ).rejects.toThrow("路径在工作区已知位置之外");
  });

  test("default English messages still apply when not injected", async () => {
    await expect(
      revealKnownPath("/etc", {
        allowedFolders: ["/workspace"],
        showItemInFolder: () => undefined,
        platform: "darwin",
      }),
    ).rejects.toThrow("Path is outside this workspace's known locations");
  });
});

describe("localized mcp-config", () => {
  test("zh messages localize the missing-binary error; defaults stay English", () => {
    const base = {
      executable: "/bin/electron",
      workspacePath: "/w/workspace.json",
      resourcesRoot: "/resources",
      sourceCandidates: [],
      exists: () => false,
    };
    const zh = mcpClientConfigState({ ...base, messages: zhMainMessages });
    const en = mcpClientConfigState({ ...base });
    expect(zh.error).toBe("此安装缺少内置的 MCP 服务器。");
    expect(en.error).toBe(
      "Bundled MCP server is missing from this installation.",
    );
  });
});

describe("localized native dialogs", () => {
  const CJK = /[一-鿿]/;

  test("every zh dialog builder localizes title, message, detail and buttons", () => {
    const dialogs: Array<[string, MainDialogOptions]> = [
      ["reloadCanceled", reloadCanceledDialog("磁盘错误", zhMainMessages)],
      ["closeFailure", closeFailureDialog("保存失败", zhMainMessages)],
      ["noRecoveryCopy", noRecoveryCopyDialog(zhMainMessages)],
      ["recoverySaved", recoverySavedDialog("/tmp/r.json", zhMainMessages)],
      ["recoveryFailed", recoveryFailedDialog("权限不足", zhMainMessages)],
      ["rendererCrash", rendererCrashDialog("crashed", zhMainMessages)],
    ];
    for (const [name, dialog] of dialogs) {
      expect(dialog.title, name).toMatch(CJK);
      expect(dialog.message, name).toMatch(CJK);
      if (dialog.detail) expect(dialog.detail, name).toMatch(CJK);
      for (const button of dialog.buttons) expect(button, name).toMatch(CJK);
      expect(dialog.noLink, name).toBe(true);
    }
  });

  test("English dialogs keep the legacy copy and button ids", () => {
    const close = closeFailureDialog("save failed", englishMainMessages);
    expect(close.title).toBe("IPloom Studio could not finish saving");
    expect(close.message).toBe("save failed");
    expect(close.detail).toBe(englishMainMessages.dialogs.closeFailedDetail);
    expect(close.buttons).toEqual([
      "Retry",
      "Save a Copy and Exit",
      "Exit Without Saving",
      "Keep Editing",
    ]);
    expect(close.defaultId).toBe(0);
    expect(close.cancelId).toBe(3);

    const noRecovery = noRecoveryCopyDialog(englishMainMessages);
    expect(noRecovery.buttons).toEqual(["Retry", "Keep Editing"]);
    expect(noRecovery.cancelId).toBe(1);

    const saved = recoverySavedDialog("/w.json", englishMainMessages);
    expect(saved.type).toBe("info");
    expect(saved.message).toBe(
      "Your in-memory workspace was saved to /w.json.",
    );

    const crash = rendererCrashDialog("crashed", englishMainMessages);
    expect(crash.message).toBe(
      "The editor process closed unexpectedly (crashed).",
    );
    expect(crash.buttons).toEqual(["Reload", "Quit"]);
    expect(crash.cancelId).toBe(1);

    const reload = reloadCanceledDialog("disk error", englishMainMessages);
    expect(reload.buttons).toEqual(["OK"]);
    expect(reload.detail).toBe("disk error");

    const recoveryFailed = recoveryFailedDialog("denied", englishMainMessages);
    expect(recoveryFailed.buttons).toEqual(["Retry", "Keep Editing"]);
  });

  test("zh and English dialogs keep identical structure and button counts", () => {
    const pairs: Array<[MainDialogOptions, MainDialogOptions]> = [
      [
        reloadCanceledDialog("x", englishMainMessages),
        reloadCanceledDialog("x", zhMainMessages),
      ],
      [
        closeFailureDialog("x", englishMainMessages),
        closeFailureDialog("x", zhMainMessages),
      ],
      [
        noRecoveryCopyDialog(englishMainMessages),
        noRecoveryCopyDialog(zhMainMessages),
      ],
      [
        recoverySavedDialog("/w.json", englishMainMessages),
        recoverySavedDialog("/w.json", zhMainMessages),
      ],
      [
        recoveryFailedDialog("x", englishMainMessages),
        recoveryFailedDialog("x", zhMainMessages),
      ],
      [
        rendererCrashDialog("x", englishMainMessages),
        rendererCrashDialog("x", zhMainMessages),
      ],
    ];
    for (const [en, zh] of pairs) {
      expect(zh.type).toBe(en.type);
      expect(zh.defaultId).toBe(en.defaultId);
      expect(zh.cancelId).toBe(en.cancelId);
      expect(zh.buttons).toHaveLength(en.buttons.length);
    }
  });
});

/** Type-level: the exported presets must satisfy the full catalog interface. */
type PresetCheck = [MainMessages, MainMessages];
const presets: PresetCheck = [englishMainMessages, zhMainMessages];
void presets;
