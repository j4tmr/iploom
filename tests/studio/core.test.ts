import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildArcReelBundle,
  sha256Text,
} from "../../apps/studio/src/core/arcreel.ts";
import {
  createDemoWorkspace,
  createEmptyWorkspace,
  workspaceStats,
} from "../../apps/studio/src/core/factory.ts";
import {
  buildRelationshipGraph,
  layoutRelationshipGraph,
} from "../../apps/studio/src/core/graph.ts";
import { searchWorkspace } from "../../apps/studio/src/core/search.ts";
import { storyboardWriteSchema } from "../../apps/studio/src/core/storyboard-contract.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { APP_VERSION } from "../../apps/studio/src/core/version.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";
import { createElectronMcpConfig } from "../../apps/studio/src/node/mcp-config.ts";
import packageMetadata from "../../package.json";

describe("studio domain", () => {
  test("demo workspace validates, counts and exposes reusable cast", () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    expect(workspace.universes).toHaveLength(2);
    expect(workspace.works).toHaveLength(2);
    expect(workspace.characters.filter((item) => item.reusable)).toHaveLength(2);
    expect(
      workspace.characters.find((item) => item.id === "char_echo")?.universeIds,
    ).toEqual(["uni_mist_harbor", "uni_ninth_station"]);
    const stats = workspaceStats(workspace);
    expect(stats.approvedChapters).toBe(1);
    expect(stats.words).toBeGreaterThan(100);
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("empty workspace has stable defaults", () => {
    const workspace = createEmptyWorkspace(
      "Empty",
      "en",
      "2026-11-06T00:00:00.000Z",
    );
    expect(workspace.settings.locale).toBe("en");
    expect(workspace.settings.defaultAspectRatio).toBe("9:16");
    expect(workspaceStats(workspace)).toMatchObject({
      universes: 0,
      works: 0,
      words: 0,
    });
  });

  test("relationship graph is deterministic and reports degrees", () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const graph = buildRelationshipGraph(
      workspace,
      "uni_mist_harbor",
      "en",
    );
    expect(graph.nodes.map((node) => node.id)).toContain("char_lin");
    expect(graph.edges).toHaveLength(4);
    const lin = graph.nodes.find((node) => node.id === "char_lin");
    expect(lin?.degree).toBe(3);
    const laidOut = layoutRelationshipGraph(graph, 800, 600);
    expect(laidOut).toHaveLength(graph.nodes.length);
    expect(laidOut.every((node) => node.x > 0 && node.y > 0)).toBe(true);
  });

  test("search spans worlds, characters, chapters and lore", () => {
    const workspace = createDemoWorkspace("zh-CN");
    const keys = searchWorkspace(workspace, "钥匙", "zh-CN").map(
      (hit) => hit.kind,
    );
    expect(keys).toContain("chapter");
    const echo = searchWorkspace(workspace, "回声", "en");
    expect(echo.some((hit) => hit.id === "char_echo")).toBe(true);
    expect(
      searchWorkspace(workspace, "00:07", "en").some(
        (hit) => hit.id === "loc_platform_seven",
      ),
    ).toBe(true);
  });

  test("rejects duplicate chapter numbers and dangling references", () => {
    const duplicate = createDemoWorkspace(
      "en",
      "2026-11-06T00:00:00.000Z",
    );
    duplicate.works[0]!.chapters[1]!.number =
      duplicate.works[0]!.chapters[0]!.number;
    expect(() => validateWorkspace(duplicate)).toThrow(/duplicate chapter number/);

    const dangling = createDemoWorkspace(
      "en",
      "2026-11-06T00:00:00.000Z",
    );
    dangling.characters[0]!.universeIds = ["uni_missing"];
    expect(() => validateWorkspace(dangling)).toThrow(/unknown universe/);
  });

  test("keeps package, UI and generated manifests on one version", async () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
    const workspace = createDemoWorkspace(
      "en",
      "2026-11-06T00:00:00.000Z",
    );
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    const manifest = JSON.parse(
      bundle.files.find((file) => file.path === "manifest.json")!.content,
    );
    expect(manifest.generator.version).toBe(packageMetadata.version);
  });
});

describe("ArcReel export", () => {
  test("produces a hashed, deterministic, IPloom-compatible handoff", async () => {
    const workspace = createDemoWorkspace(
      "zh-CN",
      "2026-11-06T00:00:00.000Z",
    );
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      generatedAt: "2026-11-06T03:00:00.000Z",
      aspectRatio: "9:16",
    });
    expect(bundle.files.map((file) => file.path)).toContain("manifest.json");
    expect(bundle.files.some((file) => file.path === "world.json")).toBe(true);
    expect(bundle.totalScenes).toBeGreaterThan(0);
    expect(bundle.totalShots).toBeGreaterThan(bundle.totalScenes);
    const manifest = JSON.parse(
      bundle.files.find((file) => file.path === "manifest.json")!.content,
    );
    expect(manifest.adaptation.style).toBe("stylized-3d-animation");
    expect(manifest.adaptation.totals.chapters).toBe(3);
    const storyboardFile = bundle.files.find((file) =>
      file.path.startsWith("storyboards/"),
    )!;
    const storyboard = JSON.parse(storyboardFile.content);
    expect(storyboardWriteSchema.safeParse(storyboard).success).toBe(true);
    expect(
      storyboard.scenes[0].shots.every(
        (shot: { prompt: string }) =>
          shot.prompt.includes("stylized 3D") &&
          shot.prompt.includes("non-photorealistic"),
      ),
    ).toBe(true);
    expect(await sha256Text("abc")).toHaveLength(64);
  });

  test("approved-only exports skip drafts with warnings", async () => {
    const workspace = createDemoWorkspace(
      "en",
      "2026-11-06T00:00:00.000Z",
    );
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      approvedOnly: true,
      locale: "en",
    });
    expect(bundle.chapters).toHaveLength(1);
    expect(bundle.warnings.join(" ")).toContain("Excluded");
  });

  test("uses scene-level locations and stable sequence numbers", async () => {
    const workspace = createDemoWorkspace(
      "en",
      "2026-11-06T00:00:00.000Z",
    );
    const chapter = workspace.works[0]!.chapters[0]!;
    workspace.works[0]!.language = "en";
    workspace.locations.push({
      ...workspace.locations[0]!,
      id: "loc_tide_market",
      name: { zh: "潮汐市场", en: "Tide Market" },
      summary: { zh: "退潮后才出现的市场。", en: "A market revealed at low tide." },
    });
    chapter.locationId = "loc_old_tower";
    chapter.scenes = [
      {
        id: "scene_market_alpha",
        title: "Market",
        summary: "A crowded market.",
        locationId: "loc_tide_market",
        characterIds: ["char_lin"],
        shots: [
          {
            id: "shot_market_alpha",
            shotType: "wide",
            description: "Lanterns light the market.",
            dialogue: "",
            camera: "wide",
            durationMs: 2500,
            visualPrompt: "",
          },
        ],
      },
      {
        id: "scene_tower_bravo",
        title: "Tower",
        summary: "The clock tower answers.",
        locationId: "loc_old_tower",
        characterIds: ["char_lin"],
        shots: [
          {
            id: "shot_tower_bravo",
            shotType: "close",
            description: "The brass key turns.",
            dialogue: "",
            camera: "close",
            durationMs: 2500,
            visualPrompt: "",
          },
        ],
      },
    ];
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      chapterIds: [chapter.id],
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    const storyboard = JSON.parse(
      bundle.files.find((file) => file.path.startsWith("storyboards/"))!
        .content,
    );
    expect(storyboard.scenes.map((scene: { sequence: number }) => scene.sequence)).toEqual([
      1, 2,
    ]);
    expect(
      storyboard.scenes.map((scene: { location: string }) => scene.location),
    ).toEqual(["Tide Market", "The Old Clock Tower"]);
  });
});

describe("workspace store", () => {
  test("round-trips atomically and writes an ArcReel package", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-"));
    try {
      const file = join(root, "workspace.json");
      const store = new WorkspaceStore(file);
      const workspace = createDemoWorkspace(
        "en",
        "2026-11-06T00:00:00.000Z",
      );
      await store.save(workspace);
      const loaded = await store.load();
      expect(loaded.workspace.works[0]!.title.en).toBe("The Tide Clock");
      const bundle = await buildArcReelBundle(loaded.workspace, {
        workId: "work_tide_clock",
        generatedAt: "2026-11-06T03:00:00.000Z",
      });
      const written = await store.exportArcReel(bundle, join(root, "exports"));
      expect(written.files).toBe(bundle.files.length);
      expect(
        JSON.parse(
          readFileSync(join(written.directory, "manifest.json"), "utf8"),
        ).schema,
      ).toBe("iploom.arcreel.manifest/v1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("serializes overlapping saves and recovers the previous snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-save-"));
    try {
      const file = join(root, "workspace.json");
      const store = new WorkspaceStore(file);
      const first = createDemoWorkspace(
        "en",
        "2026-11-06T00:00:00.000Z",
      );
      first.name = "First";
      first.revision = 10;
      await store.save(first);

      const saves = Array.from({ length: 8 }, (_, index) => {
        const next = structuredClone(first);
        next.name = `Snapshot ${index}`;
        next.revision = 11 + index;
        return store.save(next);
      });
      await Promise.all(saves);
      expect((await store.load()).workspace.name).toBe("Snapshot 7");
      expect((await store.load()).workspace.revision).toBe(18);

      const main = JSON.parse(readFileSync(file, "utf8")) as {
        name: string;
      };
      expect(main.name).toBe("Snapshot 7");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("recovers the backup when the primary file is corrupt", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-recovery-"));
    try {
      const file = join(root, "workspace.json");
      const store = new WorkspaceStore(file);
      const previous = createDemoWorkspace(
        "en",
        "2026-11-06T00:00:00.000Z",
      );
      previous.name = "Previous";
      previous.revision = 40;
      await store.save(previous);
      const current = structuredClone(previous);
      current.name = "Current";
      current.revision = 41;
      await store.save(current);
      await Bun.write(file, "{broken");
      const recovered = await store.load();
      expect(recovered.recoveredFromBackup).toBe(true);
      expect(recovered.workspace.name).toBe("Previous");
      expect(recovered.workspace.revision).toBe(40);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes export packages atomically and never reuses a directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-export-"));
    try {
      const workspace = createDemoWorkspace(
        "en",
        "2026-11-06T00:00:00.000Z",
      );
      const bundle = await buildArcReelBundle(workspace, {
        workId: "work_tide_clock",
        generatedAt: "2026-11-06T03:00:00.000Z",
      });
      const store = new WorkspaceStore(join(root, "workspace.json"));
      const first = await store.exportArcReel(bundle, join(root, "exports"));
      const second = await store.exportArcReel(bundle, join(root, "exports"));
      expect(second.directory).not.toBe(first.directory);
      expect(second.directory.endsWith("-2")).toBe(true);

      const unsafe = structuredClone(bundle);
      unsafe.files[0]!.path = "../escape.json";
      await expect(
        store.exportArcReel(unsafe, join(root, "unsafe")),
      ).rejects.toThrow(/Unsafe export path/);
      expect(readdirSync(join(root, "unsafe"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("desktop MCP configuration", () => {
  test("uses the desktop runtime instead of a system Node dependency", () => {
    const config = createElectronMcpConfig({
      executable: "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio",
      mcpScript:
        "/Applications/IPloom Studio.app/Contents/Resources/bin/iploom-mcp",
      workspacePath: "/Users/example/Library/Application Support/IPloom Studio/workspace.json",
    });
    expect(config.mcpServers["iploom-studio"]).toMatchObject({
      command: "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio",
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(config.mcpServers["iploom-studio"].args[0]).toContain(
      "/Resources/bin/iploom-mcp",
    );
    expect(
      config.mcpServers["iploom-studio"].args.at(-1)?.endsWith("workspace.json"),
    ).toBe(true);
  });

  test("uses an executable command on Windows and never a .cmd shim", () => {
    const config = createElectronMcpConfig({
      executable: "C:\\Program Files\\IPloom Studio\\IPloom Studio.exe",
      mcpScript:
        "C:\\Program Files\\IPloom Studio\\resources\\bin\\iploom-mcp",
      workspacePath: "C:\\Users\\example\\AppData\\Roaming\\workspace.json",
    });
    const server = config.mcpServers["iploom-studio"];
    expect(server.command.endsWith(".exe")).toBe(true);
    expect(server.command.endsWith(".cmd")).toBe(false);
    expect(server.args[0]!.endsWith("iploom-mcp")).toBe(true);
    expect(server.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });
});
