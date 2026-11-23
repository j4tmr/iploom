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
import {
  canonicalPath,
  isBlockedShellTarget,
  isTrustedRendererUrl,
  isWithin,
  parseDevUrl,
  revealKnownPath,
  safeExternalUrl,
  workspaceRevealFolders,
} from "../../apps/studio/src/node/desktop-guards.ts";

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
        isTrustedRendererUrl(
          pathToFileURL(join(root, "assets", "app.js")).href,
          {
            rendererRoot,
          },
        ),
      ).toBe(true);
      expect(
        isTrustedRendererUrl(
          pathToFileURL(join(root, "..", "secret.html")).href,
          {
            rendererRoot,
          },
        ),
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
    expect(
      safeExternalUrl(`https://example.com/${"a".repeat(8_192)}`),
    ).toBeNull();
    expect(safeExternalUrl("::::")).toBeNull();
  });

  test("isBlockedShellTarget refuses application bundles", () => {
    expect(isBlockedShellTarget("/Applications/Evil.app")).toBe(true);
    expect(isBlockedShellTarget("/Applications/Evil.APP/")).toBe(true);
    expect(isBlockedShellTarget("/tmp/Installer.pkg")).toBe(true);
    expect(isBlockedShellTarget("/tmp/Thing.bundle")).toBe(true);
    expect(
      isBlockedShellTarget("/Applications/Evil.app/Contents/MacOS/Evil"),
    ).toBe(false);
    expect(isBlockedShellTarget("/tmp/snapshots")).toBe(false);
    expect(isBlockedShellTarget("/tmp/my.app.backup")).toBe(false);
  });
});

describe("revealKnownPath", () => {
  test("reveals files and folders only inside known locations", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-guards-reveal-"));
    const outside = mkdtempSync(join(tmpdir(), "iploom-guards-outside-"));
    try {
      mkdirSync(join(root, "notes"), { recursive: true });
      writeFileSync(join(root, "workspace.json"), "{}");
      writeFileSync(join(root, "notes", "readme.txt"), "ok");
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

      await expect(revealKnownPath(join(root, "notes"), deps)).resolves.toBe(
        await realpath(join(root, "notes")),
      );
      await expect(
        revealKnownPath(join(root, "notes", "readme.txt"), deps),
      ).resolves.toBe(await realpath(join(root, "notes", "readme.txt")));
      await expect(
        revealKnownPath(join(root, "workspace.json"), deps),
      ).resolves.toBe(await realpath(join(root, "workspace.json")));
      // The snapshot directory is a known location even before it exists.
      mkdirSync(join(root, "snapshots"));
      writeFileSync(join(root, "snapshots", "workspace-1-0-manual.json"), "{}");
      await expect(
        revealKnownPath(
          join(root, "snapshots", "workspace-1-0-manual.json"),
          deps,
        ),
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
      revealKnownPath("/workspace/snapshots/book.json", deps),
    ).resolves.toBe("/workspace/snapshots/book.json");
    expect(calls.stat).toBe(1);
    // Once for the target and once for the allowed folder.
    expect(calls.realpath).toBe(2);
    expect(shown).toEqual(["/workspace/snapshots/book.json"]);
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
