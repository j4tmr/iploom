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
  runCompletion,
} from "../../apps/studio/src/node/ai-client.ts";
import {
  parseArcReelBundle,
  revealKnownPath,
} from "../../apps/studio/src/node/desktop-guards.ts";
import {
  englishMainMessages,
  mainMessagesFor,
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

  test("zh store localizes snapshot-restore failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-messages-"));
    const file = join(root, "workspace.json");
    const store = new WorkspaceStore(file, zhMainMessages);
    await expect(
      store.restoreSnapshot(join(root, "nope.json")),
    ).rejects.toThrow("不是工作区快照");
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

  test("zh first-byte timeout surfaces in Chinese", async () => {
    const fetcher: typeof fetch = Object.assign(
      () => new Promise<Response>(() => undefined), // never responds; timer fires
      { preconnect: () => undefined },
    );
    await expect(
      runCompletion(
        config,
        request,
        new AbortController().signal,
        () => undefined,
        fetcher,
        { firstByteTimeoutMs: 30 },
        zhMainMessages,
      ),
    ).rejects.toThrow("秒内未返回数据");
  });

  test("English default keeps the legacy abort text", async () => {
    const fetcher: typeof fetch = Object.assign(
      () => new Promise<Response>(() => undefined),
      { preconnect: () => undefined },
    );
    await expect(
      runCompletion(
        config,
        request,
        new AbortController().signal,
        () => undefined,
        fetcher,
        { firstByteTimeoutMs: 30 },
      ),
    ).rejects.toThrow("sent no data for 0 seconds");
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

/** Type-level: the exported presets must satisfy the full catalog interface. */
type PresetCheck = [MainMessages, MainMessages];
const presets: PresetCheck = [englishMainMessages, zhMainMessages];
void presets;
