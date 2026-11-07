import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildArcReelBundle } from "../../apps/studio/src/core/arcreel.ts";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  ARC_REEL_EXPORT_LIMITS,
  canonicalPath,
  isBlockedShellTarget,
  isTrustedRendererUrl,
  isWithin,
  parseArcReelBundle,
  parseDevUrl,
  realPathWithExistingAncestor,
  revealKnownPath,
  safeExternalUrl,
  workspaceRevealFolders,
} from "../../apps/studio/src/node/desktop-guards.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";

describe("desktop path guards", () => {
  test("isWithin treats the root as inside and sibling prefixes as outside", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
    expect(isWithin("/a/b", "/a/b/c.txt")).toBe(true);
    expect(isWithin("/a/b", "/a/bc")).toBe(false);
    expect(isWithin("/a/b", "/a")).toBe(false);
    expect(isWithin("/a/b", "/a/../c")).toBe(false);
    expect(isWithin("/a/b", "/a/b/../bc")).toBe(false);
  });

  test("isWithin folds case on Windows only", () => {
    expect(isWithin("C:\\App", "c:\\app\\file.txt", "win32")).toBe(true);
    expect(isWithin("C:\\App", "C:\\AppData", "win32")).toBe(false);
    expect(isWithin("C:\\App", "C:\\Other", "win32")).toBe(false);
    expect(isWithin("/a/b", "/a/B", "linux")).toBe(false);
    expect(canonicalPath("C:\\App\\Sub", "win32")).toBe("c:\\app\\sub");
    expect(canonicalPath("/a/b", "linux")).toBe("/a/b");
  });

  test("parseDevUrl accepts only loopback HTTP in development", () => {
    expect(parseDevUrl(undefined, false)).toBeNull();
    expect(parseDevUrl("   ", false)).toBeNull();
    expect(parseDevUrl("http://127.0.0.1:5173", true)).toBeNull();
    expect(parseDevUrl("http://127.0.0.1:5173", false)?.origin).toBe(
      "http://127.0.0.1:5173",
    );
    expect(parseDevUrl("http://localhost:5173", false)?.hostname).toBe(
      "localhost",
    );
    expect(() => parseDevUrl("https://127.0.0.1:5173", false)).toThrow(
      /loopback HTTP/,
    );
    expect(() => parseDevUrl("http://example.com", false)).toThrow(
      /loopback HTTP/,
    );
    expect(() => parseDevUrl("javascript:alert(1)", false)).toThrow();
  });

  test("isTrustedRendererUrl accepts only the renderer root or the dev origin", () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-guards-renderer-"));
    try {
      mkdirSync(join(root, "assets"));
      writeFileSync(join(root, "index.html"), "<!doctype html>");
      writeFileSync(join(root, "assets", "app.js"), "");
      const rendererRoot = root;

      expect(
        isTrustedRendererUrl(pathToFileURL(join(root, "index.html")).href, {
          rendererRoot,
        }),
      ).toBe(true);
      expect(
        isTrustedRendererUrl(pathToFileURL(join(root, "assets", "app.js")).href, {
          rendererRoot,
        }),
      ).toBe(true);
      expect(
        isTrustedRendererUrl(pathToFileURL(join(root, "..", "secret.html")).href, {
          rendererRoot,
        }),
      ).toBe(false);
      expect(
        isTrustedRendererUrl("file://evil.example/tmp/index.html", {
          rendererRoot,
        }),
      ).toBe(false);
      expect(
        isTrustedRendererUrl("https://127.0.0.1/index.html", { rendererRoot }),
      ).toBe(false);
      expect(isTrustedRendererUrl("not a url", { rendererRoot })).toBe(false);

      const devOrigin = new URL("http://127.0.0.1:5173");
      expect(
        isTrustedRendererUrl("http://127.0.0.1:5173/src/main.tsx", {
          rendererRoot,
          devOrigin,
        }),
      ).toBe(true);
      expect(
        isTrustedRendererUrl("http://127.0.0.1:5174/src/main.tsx", {
          rendererRoot,
          devOrigin,
        }),
      ).toBe(false);
      expect(
        isTrustedRendererUrl(pathToFileURL(join(root, "index.html")).href, {
          rendererRoot,
          devOrigin,
        }),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("safeExternalUrl allows only credential-free HTTP(S)", () => {
    expect(safeExternalUrl("https://example.com/docs")?.href).toBe(
      "https://example.com/docs",
    );
    expect(safeExternalUrl("http://example.com")?.protocol).toBe("http:");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("https://user:pass@example.com")).toBeNull();
    expect(safeExternalUrl(`https://example.com/${"a".repeat(8_192)}`)).toBeNull();
    expect(safeExternalUrl("::::")).toBeNull();
  });

  test("isBlockedShellTarget refuses application bundles", () => {
    expect(isBlockedShellTarget("/Applications/Evil.app")).toBe(true);
    expect(isBlockedShellTarget("/Applications/Evil.APP/")).toBe(true);
    expect(isBlockedShellTarget("/tmp/Installer.pkg")).toBe(true);
    expect(isBlockedShellTarget("/tmp/Thing.bundle")).toBe(true);
    expect(isBlockedShellTarget("/Applications/Evil.app/Contents/MacOS/Evil")).toBe(
      false,
    );
    expect(isBlockedShellTarget("/tmp/exports")).toBe(false);
    expect(isBlockedShellTarget("/tmp/my.app.backup")).toBe(false);
  });

  test("realPathWithExistingAncestor resolves the existing prefix and keeps the suffix", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-guards-real-"));
    try {
      const realRoot = await realpath(root);
      expect(await realPathWithExistingAncestor(join(root, "missing", "deeper"))).toBe(
        join(realRoot, "missing", "deeper"),
      );
      mkdirSync(join(root, "existing"));
      expect(
        await realPathWithExistingAncestor(join(root, "existing", "child.json")),
      ).toBe(join(realRoot, "existing", "child.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ArcReel bundle validation", () => {
  const bundleFor = async () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    return buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
  };

  test("accepts the bundle the exporter builds", async () => {
    const bundle = await bundleFor();
    expect(() => parseArcReelBundle(bundle)).not.toThrow();
    expect(parseArcReelBundle(bundle).manifestSha256).toBe(bundle.manifestSha256);
  });

  test("rejects payloads the directory name or writer would trust", async () => {
    const bundle = await bundleFor();

    const hashEscape = structuredClone(bundle);
    hashEscape.manifestSha256 = "/../..//";
    expect(() => parseArcReelBundle(hashEscape)).toThrow(/Invalid ArcReel bundle/);

    const shortHash = structuredClone(bundle);
    shortHash.manifestSha256 = "abc";
    expect(() => parseArcReelBundle(shortHash)).toThrow(/Invalid ArcReel bundle/);

    const badTimestamp = structuredClone(bundle);
    badTimestamp.generatedAt = "not-a-date";
    expect(() => parseArcReelBundle(badTimestamp)).toThrow(/Invalid ArcReel bundle/);

    const badWork = structuredClone(bundle);
    badWork.workId = "../../etc";
    expect(() => parseArcReelBundle(badWork)).toThrow(/Invalid ArcReel bundle/);

    const badSchema = structuredClone(bundle) as unknown as { schema: string };
    badSchema.schema = "iploom.arcreel.manifest/v0";
    expect(() => parseArcReelBundle(badSchema)).toThrow(/Invalid ArcReel bundle/);

    const noFiles = structuredClone(bundle);
    noFiles.files = [];
    expect(() => parseArcReelBundle(noFiles)).toThrow(/Invalid ArcReel bundle/);

    const longPath = structuredClone(bundle);
    longPath.files[0]!.path = "a".repeat(ARC_REEL_EXPORT_LIMITS.maxPathLength + 1);
    expect(() => parseArcReelBundle(longPath)).toThrow(/Invalid ArcReel bundle/);

    const oversizedFile = structuredClone(bundle);
    oversizedFile.files[0]!.content = "x".repeat(
      ARC_REEL_EXPORT_LIMITS.maxFileBytes + 1,
    );
    expect(() => parseArcReelBundle(oversizedFile)).toThrow(
      /Invalid ArcReel bundle/,
    );

    const tooManyFiles = structuredClone(bundle);
    tooManyFiles.files = Array.from(
      { length: ARC_REEL_EXPORT_LIMITS.maxFiles + 1 },
      (_, index) => ({
        path: `files/${index}.txt`,
        content: "x",
        mediaType: "text/plain" as const,
      }),
    );
    expect(() => parseArcReelBundle(tooManyFiles)).toThrow(/Invalid ArcReel bundle/);

    const badMedia = structuredClone(bundle) as unknown as {
      files: Array<{ mediaType: string }>;
    };
    badMedia.files[0]!.mediaType = "application/octet-stream";
    expect(() => parseArcReelBundle(badMedia)).toThrow(/Invalid ArcReel bundle/);

    const extraKey = structuredClone(bundle) as unknown as Record<string, unknown>;
    extraKey.command = "rm -rf /";
    expect(() => parseArcReelBundle(extraKey)).toThrow(/Invalid ArcReel bundle/);

    expect(() => parseArcReelBundle(null)).toThrow(/Invalid ArcReel bundle/);
  });
});

describe("revealKnownPath", () => {
  test("reveals files and folders only inside known locations", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-guards-reveal-"));
    const outside = mkdtempSync(join(tmpdir(), "iploom-guards-outside-"));
    try {
      mkdirSync(join(root, "exports", "package"), { recursive: true });
      writeFileSync(join(root, "workspace.json"), "{}");
      writeFileSync(join(root, "exports", "package", "manifest.json"), "{}");
      mkdirSync(join(root, "Evil.app"), { recursive: true });
      writeFileSync(join(outside, "secret.txt"), "secret");

      const shown: string[] = [];
      const allowedFolders = workspaceRevealFolders(
        join(root, "workspace.json"),
        join(root, "snapshots"),
      );
      const deps = {
        allowedFolders,
        showItemInFolder: (path: string) => shown.push(path),
      };

      await expect(
        revealKnownPath(join(root, "exports", "package"), deps),
      ).resolves.toBe(await realpath(join(root, "exports", "package")));
      await expect(
        revealKnownPath(join(root, "exports", "package", "manifest.json"), deps),
      ).resolves.toBe(
        await realpath(join(root, "exports", "package", "manifest.json")),
      );
      await expect(
        revealKnownPath(join(root, "workspace.json"), deps),
      ).resolves.toBe(await realpath(join(root, "workspace.json")));
      // The snapshot directory is a known location even before it exists.
      mkdirSync(join(root, "snapshots"));
      writeFileSync(join(root, "snapshots", "workspace-1-0-manual.json"), "{}");
      await expect(
        revealKnownPath(join(root, "snapshots", "workspace-1-0-manual.json"), deps),
      ).resolves.toBe(
        await realpath(join(root, "snapshots", "workspace-1-0-manual.json")),
      );
      expect(shown).toHaveLength(4);

      const attempts = [
        join(outside, "secret.txt"),
        join(root, "Evil.app"),
        join(root, "missing.json"),
        "",
        "   ",
      ];
      for (const attempt of attempts) {
        await expect(revealKnownPath(attempt, deps)).rejects.toThrow();
      }
      expect(shown).toHaveLength(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a poisoned export record cannot widen the reveal locations", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-guards-poison-"));
    const outside = mkdtempSync(join(tmpdir(), "iploom-guards-poison-out-"));
    try {
      writeFileSync(join(root, "workspace.json"), "{}");
      writeFileSync(join(outside, "payload.txt"), "payload");
      mkdirSync(join(root, "exports"), { recursive: true });

      // `workspace.exports[].outputPath` is renderer-writable, so it is never
      // used to build the allowlist; only main-process-created folders are.
      const allowedFolders = workspaceRevealFolders(
        join(root, "workspace.json"),
        join(root, "snapshots"),
      );
      const shown: string[] = [];
      await expect(
        revealKnownPath(join(outside, "payload.txt"), {
          allowedFolders,
          showItemInFolder: (path: string) => shown.push(path),
        }),
      ).rejects.toThrow(/outside this workspace's known locations/);
      expect(shown).toEqual([]);

      await expect(
        revealKnownPath(join(root, "exports"), {
          allowedFolders,
          showItemInFolder: (path: string) => shown.push(path),
        }),
      ).resolves.toBe(await realpath(join(root, "exports")));
      expect(shown).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a save/load roundtrip keeps a poisoned outputPath out of the allowlist", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-guards-roundtrip-"));
    const outside = mkdtempSync(join(tmpdir(), "iploom-guards-roundtrip-out-"));
    try {
      const workspaceFile = join(root, "workspace.json");
      const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
      workspace.exports.push({
        id: "exp_poison",
        workId: "work_tide_clock",
        workTitle: "The Tide Clock",
        createdAt: "2026-11-06T00:00:00.000Z",
        chapterIds: [],
        fileCount: 0,
        bytes: 0,
        manifestSha256: "a".repeat(64),
        outputPath: outside,
      });
      const store = new WorkspaceStore(workspaceFile);
      await store.save(workspace);
      const loaded = await store.load();
      const poisoned = loaded.workspace.exports[0]?.outputPath;
      expect(poisoned).toBe(outside);

      const shown: string[] = [];
      await expect(
        revealKnownPath(poisoned!, {
          allowedFolders: workspaceRevealFolders(
            workspaceFile,
            join(root, "snapshots"),
          ),
          showItemInFolder: (path: string) => shown.push(path),
        }),
      ).rejects.toThrow(/outside this workspace's known locations/);
      expect(shown).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects outside paths before any filesystem call", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-guards-prefix-"));
    const outside = mkdtempSync(join(tmpdir(), "iploom-guards-prefix-out-"));
    try {
      let statCalls = 0;
      let realpathCalls = 0;
      const shown: string[] = [];
      const depsFor = (statSucceeds: boolean) => ({
        allowedFolders: [join(root, "workspace")],
        platform: process.platform,
        showItemInFolder: (path: string) => shown.push(path),
        stat: async () => {
          statCalls += 1;
          if (!statSucceeds) throw new Error("ENOENT");
          return { isFile: () => true, isDirectory: () => false };
        },
        realpath: async (path: string) => {
          realpathCalls += 1;
          return path;
        },
      });
      const target = join(outside, "secret.txt");

      // The error must not reveal whether the outside path exists.
      await expect(revealKnownPath(target, depsFor(true))).rejects.toThrow(
        /outside this workspace's known locations/,
      );
      await expect(revealKnownPath(target, depsFor(false))).rejects.toThrow(
        /outside this workspace's known locations/,
      );
      expect(statCalls).toBe(0);
      expect(realpathCalls).toBe(0);
      expect(shown).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects a win32 UNC path without any filesystem call", async () => {
    let calls = 0;
    const deps = {
      allowedFolders: ["C:\\Users\\creator\\AppData\\IPloom Studio"],
      platform: "win32" as const,
      showItemInFolder: () => {
        calls += 1;
      },
      stat: async () => {
        calls += 1;
        return { isFile: () => true, isDirectory: () => false };
      },
      realpath: async (path: string) => {
        calls += 1;
        return path;
      },
    };

    await expect(
      revealKnownPath("\\\\server\\share\\payload.txt", deps),
    ).rejects.toThrow(/outside this workspace's known locations/);
    expect(calls).toBe(0);
  });

  test("reveals an inside path through injected dependencies", async () => {
    const shown: string[] = [];
    const calls = { stat: 0, realpath: 0 };
    const deps = {
      allowedFolders: ["/workspace"],
      platform: "linux" as const,
      showItemInFolder: (path: string) => shown.push(path),
      stat: async () => {
        calls.stat += 1;
        return { isFile: () => true, isDirectory: () => false };
      },
      realpath: async (path: string) => {
        calls.realpath += 1;
        return path;
      },
    };

    await expect(
      revealKnownPath("/workspace/exports/book.txt", deps),
    ).resolves.toBe("/workspace/exports/book.txt");
    expect(calls.stat).toBe(1);
    // Once for the target and once for the allowed folder.
    expect(calls.realpath).toBe(2);
    expect(shown).toEqual(["/workspace/exports/book.txt"]);
  });

  test("still rejects an inside-looking path whose real path escapes", async () => {
    const shown: string[] = [];
    let realpathCalls = 0;
    const deps = {
      allowedFolders: ["/workspace"],
      platform: "linux" as const,
      showItemInFolder: (path: string) => shown.push(path),
      stat: async () => ({ isFile: () => true, isDirectory: () => false }),
      realpath: async (path: string) => {
        realpathCalls += 1;
        return path === "/workspace/link.txt" ? "/outside/link.txt" : path;
      },
    };

    await expect(revealKnownPath("/workspace/link.txt", deps)).rejects.toThrow(
      /outside this workspace's known locations/,
    );
    expect(realpathCalls).toBe(2);
    expect(shown).toEqual([]);
  });

  test.skipIf(process.platform === "win32")(
    "refuses a symlink that points outside the known locations",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "iploom-guards-link-"));
      const outside = mkdtempSync(join(tmpdir(), "iploom-guards-link-out-"));
      try {
        writeFileSync(join(root, "workspace.json"), "{}");
        writeFileSync(join(outside, "secret.txt"), "secret");
        symlinkSync(outside, join(root, "escape"));

        const shown: string[] = [];
        await expect(
          revealKnownPath(join(root, "escape", "secret.txt"), {
            allowedFolders: [root],
            showItemInFolder: (path: string) => shown.push(path),
          }),
        ).rejects.toThrow(/outside this workspace's known locations/);
        expect(shown).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );
});
