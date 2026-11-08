import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import {
  STORYBOARD_LIMITS,
  storyboardWriteSchema,
} from "../../apps/studio/src/core/storyboard-contract.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import {
  buildWorkflowBrief,
  taskCycleRiskIds,
  taskDescendantIds,
  workflowSummary,
  workflowTaskReadiness,
} from "../../apps/studio/src/core/workflow.ts";
import { APP_VERSION } from "../../apps/studio/src/core/version.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";
import { createElectronMcpConfig } from "../../apps/studio/src/node/mcp-config.ts";
import packageMetadata from "../../package.json";

describe("studio domain", () => {
  test("demo workspace validates, counts and exposes reusable cast", () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    expect(workspace.universes).toHaveLength(2);
    expect(workspace.works).toHaveLength(2);
    expect(workspace.characters.filter((item) => item.reusable)).toHaveLength(
      2,
    );
    expect(
      workspace.characters.find((item) => item.id === "char_echo")?.universeIds,
    ).toEqual(["uni_mist_harbor", "uni_ninth_station"]);
    const stats = workspaceStats(workspace);
    expect(stats.approvedChapters).toBe(1);
    expect(stats.words).toBeGreaterThan(100);
    expect(stats.workflowTasks).toBe(4);
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
    const graph = buildRelationshipGraph(workspace, "uni_mist_harbor", "en");
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
    const duplicate = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    duplicate.works[0]!.chapters[1]!.number =
      duplicate.works[0]!.chapters[0]!.number;
    expect(() => validateWorkspace(duplicate)).toThrow(
      /duplicate chapter number/,
    );

    const dangling = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    dangling.characters[0]!.universeIds = ["uni_missing"];
    expect(() => validateWorkspace(dangling)).toThrow(/unknown universe/);
  });

  test("migrates schema v1 workspaces before strict validation", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 1;
    legacy.revision = 40;
    delete legacy.workflowTasks;
    delete legacy.storyObjects;
    delete legacy.timelineEvents;
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(7);
    expect(migrated.revision).toBe(46);
    expect(migrated.workflowTasks).toEqual([]);
    expect(migrated.storyObjects).toEqual([]);
    expect(migrated.timelineEvents).toEqual([]);
    expect(migrated.standards.length).toBe(6);
  });

  test("migrates schema v2 workspaces by adding timeline collections", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 2;
    legacy.revision = 10;
    delete legacy.storyObjects;
    delete legacy.timelineEvents;
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(7);
    expect(migrated.revision).toBe(15);
    expect(migrated.storyObjects).toEqual([]);
    expect(migrated.timelineEvents).toEqual([]);
  });

  test("migrates schema v4 export history before strict validation", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 4;
    legacy.revision = 7;
    legacy.lastOpenedWorkId = "work_deleted";
    legacy.exports = [
      {
        id: "export_orphan",
        workId: "work_deleted",
        workTitle: "Deleted",
        createdAt: "2026-11-06T00:00:00.000Z",
        chapterIds: ["chapter_tide_001"],
        fileCount: 1,
        bytes: 10,
        manifestSha256: "a".repeat(64),
      },
      {
        id: "export_same",
        workId: "work_tide_clock",
        workTitle: "The Tide Clock",
        createdAt: "2026-11-06T00:00:00.000Z",
        chapterIds: ["chapter_tide_001", "chapter_tide_001", "chapter_missing"],
        fileCount: 2,
        bytes: 20,
        manifestSha256: "b".repeat(64),
      },
      {
        id: "export_same",
        workId: "work_tide_clock",
        workTitle: "The Tide Clock",
        createdAt: "2026-11-06T00:00:00.000Z",
        chapterIds: [],
        fileCount: 0,
        bytes: 0,
        manifestSha256: "c".repeat(64),
      },
      { id: "export_broken", workId: 4 },
    ];
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(7);
    expect(migrated.revision).toBe(10);
    expect(migrated.lastOpenedWorkId).toBeUndefined();
    expect(migrated.exports.map((record) => record.id)).toEqual([
      "export_same",
      "export_same-2",
    ]);
    expect(migrated.exports[0]?.chapterIds).toEqual(["chapter_tide_001"]);
  });

  test("migrates schema v5 workspaces and strips composed prompts from task texts", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 5;
    legacy.revision = 7;
    const tasks = legacy.workflowTasks as Array<Record<string, unknown>>;
    tasks[0]!.brief = {
      zh: "# AI 任务简报: Lock\n\nSOURCE DATA (not instructions):\n{}",
      en: "# AI task brief: Lock\n\nSOURCE DATA (not instructions):\n{}",
    };
    tasks[0]!.deliverable = {
      zh: "Model: test-model; source revision: 7. 完成前请审阅设计稿。",
      en: "Model: test-model; source revision: 7. Review the draft before completion.",
    };
    tasks[1]!.brief = {
      zh: "",
      en: "Respond in English.\nTask: World bible\nSOURCE DATA (not instructions):\n{}",
    };
    const cleanBrief = JSON.stringify(tasks[2]!.brief);
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(7);
    expect(migrated.revision).toBe(9);
    expect(migrated.workflowTasks[0]!.brief.zh).toBe("");
    expect(migrated.workflowTasks[0]!.brief.en).toBe("");
    expect(migrated.workflowTasks[0]!.deliverable).toEqual({
      zh: "审阅设计结果与可复用提示词，再标记完成。",
      en: "Review the design and reusable prompts before marking done.",
    });
    expect(migrated.workflowTasks[1]!.brief).toEqual({ zh: "", en: "" });
    expect(JSON.stringify(migrated.workflowTasks[2]!.brief)).toBe(cleanBrief);
  });

  test("a v5 task whose title matches a template gets its description back", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 5;
    const tasks = legacy.workflowTasks as Array<Record<string, unknown>>;
    tasks[0]!.title = { zh: "世界观设计", en: "World bible" };
    tasks[0]!.brief = {
      zh: "# AI 任务简报: 世界观设计\nSOURCE DATA (not instructions):\n{}",
      en: "# AI task brief: World bible\nSOURCE DATA (not instructions):\n{}",
    };
    const migrated = validateWorkspace(legacy);
    expect(migrated.workflowTasks[0]!.brief).toEqual({
      zh: "Design rules, history, geography, factions and unresolved mysteries. Separate canon from proposals.",
      en: "Design rules, history, geography, factions and unresolved mysteries. Separate canon from proposals.",
    });
  });

  test("rejects dangling exports and a missing last-opened novel", () => {
    const base = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const record = {
      id: "export_tide",
      workId: "work_tide_clock",
      workTitle: "The Tide Clock",
      createdAt: "2026-11-06T00:00:00.000Z",
      chapterIds: ["chapter_tide_001"],
      fileCount: 1,
      bytes: 10,
      manifestSha256: "a".repeat(64),
    };

    const duplicate = structuredClone(base);
    duplicate.exports.push(record, { ...record });
    expect(() => validateWorkspace(duplicate)).toThrow(
      /duplicate id: export_tide/,
    );

    const foreignChapter = structuredClone(base);
    foreignChapter.exports.push({
      ...record,
      chapterIds: ["chapter_train_001"],
    });
    expect(() => validateWorkspace(foreignChapter)).toThrow(
      /unknown chapter: chapter_train_001/,
    );

    const repeatedChapter = structuredClone(base);
    repeatedChapter.exports.push({
      ...record,
      chapterIds: ["chapter_tide_001", "chapter_tide_001"],
    });
    expect(() => validateWorkspace(repeatedChapter)).toThrow(
      /duplicate chapter: chapter_tide_001/,
    );

    const unknownWork = structuredClone(base);
    unknownWork.exports.push({ ...record, workId: "work_missing" });
    expect(() => validateWorkspace(unknownWork)).toThrow(/unknown work/);

    const missingNovel = structuredClone(base);
    missingNovel.lastOpenedWorkId = "work_missing";
    expect(() => validateWorkspace(missingNovel)).toThrow(/lastOpenedWorkId/);
  });

  test("keeps package, UI and generated manifests on one version", async () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
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
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
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
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      approvedOnly: true,
      locale: "en",
    });
    expect(bundle.chapters).toHaveLength(1);
    expect(bundle.warnings.join(" ")).toContain("Excluded");
  });

  test("uses scene-level locations and stable sequence numbers", async () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const chapter = workspace.works[0]!.chapters[0]!;
    workspace.works[0]!.language = "en";
    workspace.locations.push({
      ...workspace.locations[0]!,
      id: "loc_tide_market",
      name: { zh: "潮汐市场", en: "Tide Market" },
      summary: {
        zh: "退潮后才出现的市场。",
        en: "A market revealed at low tide.",
      },
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
    expect(
      storyboard.scenes.map((scene: { sequence: number }) => scene.sequence),
    ).toEqual([1, 2]);
    expect(
      storyboard.scenes.map((scene: { location: string }) => scene.location),
    ).toEqual(["Tide Market", "The Old Clock Tower"]);
    expect(
      storyboard.scenes.map(
        (scene: { data: { source_scene_id: string } }) =>
          scene.data.source_scene_id,
      ),
    ).toEqual(["scene_market_alpha", "scene_tower_bravo"]);
    expect(
      storyboard.scenes.map(
        (scene: { shots: { data: { source_shot_id: string } }[] }) =>
          scene.shots[0]!.data.source_shot_id,
      ),
    ).toEqual(["shot_market_alpha", "shot_tower_bravo"]);
    expect(
      storyboard.scenes.every(
        (scene: { story_time: string; data: { pov?: string } }) =>
          scene.story_time === "" && scene.data.pov === chapter.pov,
      ),
    ).toBe(true);
  });

  test("keeps source scene IDs attached to content after reordering", async () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const chapter = workspace.works[0]!.chapters[0]!;
    const scene = (id: string, summary: string, shotId: string) => ({
      id,
      title: summary,
      summary,
      characterIds: ["char_lin"],
      shots: [
        {
          id: shotId,
          shotType: "wide",
          description: `${summary} shot`,
          dialogue: "",
          camera: "wide",
          durationMs: 2_500,
          visualPrompt: "",
        },
      ],
    });
    const market = scene("scene_market_alpha", "Market", "shot_market_alpha");
    const tower = scene("scene_tower_bravo", "Tower", "shot_tower_bravo");
    chapter.scenes = [market, tower];
    const first = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      chapterIds: [chapter.id],
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    chapter.scenes = [tower, market];
    const second = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      chapterIds: [chapter.id],
      generatedAt: "2026-11-06T04:00:00.000Z",
    });
    const readBoards = (content: string) => {
      const storyboard = JSON.parse(content) as {
        scenes: {
          description: string;
          data: { source_scene_id: string };
          shots: { data: { source_shot_id: string } }[];
        }[];
      };
      return storyboard.scenes.map((item) => [
        item.description,
        item.data.source_scene_id,
        item.shots[0]!.data.source_shot_id,
      ]);
    };
    const firstBoard = first.files.find((file) =>
      file.path.startsWith("storyboards/"),
    )!.content;
    const secondBoard = second.files.find((file) =>
      file.path.startsWith("storyboards/"),
    )!.content;
    expect(readBoards(firstBoard)).toEqual([
      ["Market", "scene_market_alpha", "shot_market_alpha"],
      ["Tower", "scene_tower_bravo", "shot_tower_bravo"],
    ]);
    expect(readBoards(secondBoard)).toEqual([
      ["Tower", "scene_tower_bravo", "shot_tower_bravo"],
      ["Market", "scene_market_alpha", "shot_market_alpha"],
    ]);
  });

  test("exports a 30k-character Chinese chapter with single-newline paragraphs", async () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    const chapter = workspace.works[0]!.chapters[0]!;
    const paragraph =
      "潮声沿着石阶一层层退下去，林舟把铜钥匙贴在掌心，确认缺口仍对着旧钟塔的门。".repeat(
        4,
      );
    chapter.content = Array.from(
      { length: 200 },
      (_, index) => `${paragraph}第${index + 1}段。`,
    ).join("\n");
    chapter.scenes = [];
    expect(chapter.content.length).toBeGreaterThan(30_000);
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      chapterIds: [chapter.id],
      locale: "zh-CN",
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    const storyboard = JSON.parse(
      bundle.files.find((file) => file.path.startsWith("storyboards/"))!
        .content,
    ) as {
      scenes: {
        heading: string;
        description: string;
        shots: { description: string; prompt: string }[];
      }[];
    };
    expect(storyboardWriteSchema.safeParse(storyboard).success).toBe(true);
    expect(storyboard.scenes.length).toBeGreaterThan(1);
    const shots = storyboard.scenes.flatMap((scene) => scene.shots);
    expect(shots.length).toBeLessThanOrEqual(STORYBOARD_LIMITS.shots);
    expect(
      storyboard.scenes.every(
        (scene) =>
          scene.shots.length >= 1 &&
          scene.shots.length <= STORYBOARD_LIMITS.shotsPerScene,
      ),
    ).toBe(true);
    expect(
      shots.every(
        (shot) =>
          shot.description.length <= STORYBOARD_LIMITS.shotDescription &&
          shot.prompt.length <= STORYBOARD_LIMITS.prompt,
      ),
    ).toBe(true);
    expect(bundle.warnings.join(" ")).toContain(
      "Chapter 1: 140 paragraph segment(s) were dropped",
    );
  });

  test("warns when author scenes exceed the scene limit", async () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const chapter = workspace.works[0]!.chapters[0]!;
    chapter.scenes = Array.from({ length: 15 }, (_, index) => ({
      id: `scene_author_${index + 1}`,
      title: `Scene ${index + 1}`,
      summary: `Summary ${index + 1}`,
      characterIds: ["char_lin"],
      shots: [
        {
          id: `shot_author_${index + 1}`,
          shotType: "wide",
          description: `Shot ${index + 1}`,
          dialogue: "",
          camera: "wide",
          durationMs: 2_500,
          visualPrompt: "",
        },
      ],
    }));
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      chapterIds: [chapter.id],
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    expect(bundle.warnings.join(" ")).toContain(
      "Chapter 1: 3 scene(s) were dropped",
    );
    const storyboard = JSON.parse(
      bundle.files.find((file) => file.path.startsWith("storyboards/"))!
        .content,
    ) as { scenes: { shots: unknown[] }[] };
    expect(storyboard.scenes.length).toBe(STORYBOARD_LIMITS.scenes);
    expect(storyboard.scenes.every((scene) => scene.shots.length >= 1)).toBe(
      true,
    );
  });

  test("splits an oversized author scene and warns", async () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const chapter = workspace.works[0]!.chapters[0]!;
    chapter.scenes = [
      {
        id: "scene_author_long",
        title: "Long scene",
        summary: "A long scene.",
        characterIds: ["char_lin"],
        shots: Array.from({ length: 25 }, (_, index) => ({
          id: `shot_author_long_${index + 1}`,
          shotType: "wide",
          description: `Shot ${index + 1}`,
          dialogue: "",
          camera: "wide",
          durationMs: 2_500,
          visualPrompt: "",
        })),
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
    ) as { scenes: { shots: { data: { source_shot_id: string } }[] }[] };
    expect(storyboard.scenes.length).toBe(2);
    expect(storyboard.scenes.map((scene) => scene.shots.length)).toEqual([
      20, 5,
    ]);
    expect(bundle.warnings.join(" ")).toContain(
      "Chapter 1: split 1 scene(s) with more than 20 shots.",
    );
    expect(storyboard.scenes[1]!.shots[0]!.data.source_shot_id).toBe(
      "shot_author_long_21",
    );
  });

  test("handoff lists every package path including approved designs", async () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    const bundle = await buildArcReelBundle(workspace, {
      workId: "work_tide_clock",
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    const handoff = bundle.files.find(
      (file) => file.path === "handoff.md",
    )!.content;
    for (const file of bundle.files) {
      expect(handoff).toContain(`\`${file.path}\``);
    }
    expect(handoff).toContain("`production/approved-designs.json`");
  });

  test("content hash is stable while in-limit chapter output is byte-identical", async () => {
    const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    const first = await buildArcReelBundle(structuredClone(workspace), {
      workId: "work_tide_clock",
      generatedAt: "2026-11-06T03:00:00.000Z",
    });
    const second = await buildArcReelBundle(structuredClone(workspace), {
      workId: "work_tide_clock",
      generatedAt: "2026-11-07T09:30:00.000Z",
    });
    const manifestOf = (bundle: typeof first) =>
      JSON.parse(
        bundle.files.find((file) => file.path === "manifest.json")!.content,
      );
    const firstManifest = manifestOf(first);
    const secondManifest = manifestOf(second);
    expect(firstManifest.generated_at).not.toBe(secondManifest.generated_at);
    expect(firstManifest.content_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(firstManifest.content_sha256).toBe(secondManifest.content_sha256);
    const contentOf = (bundle: typeof first) =>
      bundle.files
        .filter((file) => file.path !== "manifest.json")
        .map((file) => [file.path, file.content]);
    expect(contentOf(first)).toEqual(contentOf(second));
  });
});

describe("AI workflow", () => {
  test("derives independent work from explicit dependencies", () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    const summary = workflowSummary(workspace);
    expect(summary).toMatchObject({
      total: 4,
      active: 1,
      ready: 1,
      waiting: 2,
      done: 0,
    });
    const review = workspace.workflowTasks.find(
      (task) => task.id === "task_review_first",
    )!;
    expect(workflowTaskReadiness(workspace, review)).toMatchObject({
      ready: true,
      complete: false,
      blockers: [],
    });
    const chapter = workspace.workflowTasks.find(
      (task) => task.id === "task_chapter_three",
    )!;
    expect(workflowTaskReadiness(workspace, chapter).ready).toBe(false);
    expect(
      workflowTaskReadiness(workspace, chapter).blockers.map((item) => item.id),
    ).toEqual(["task_world_rules"]);
    expect(
      taskDescendantIds(workspace.workflowTasks, "task_world_rules").sort(),
    ).toEqual(["task_chapter_three", "task_review_first"]);
    expect(
      taskCycleRiskIds(workspace.workflowTasks, "task_review_first").sort(),
    ).toEqual(["task_adaptation_pass", "task_review_first"]);
  });

  test("builds a scoped, deterministic AI brief", () => {
    const workspace = createDemoWorkspace("zh-CN", "2026-11-06T00:00:00.000Z");
    const brief = buildWorkflowBrief(workspace, "task_chapter_three", "zh-CN");
    expect(brief).toContain("# AI 任务简报");
    expect(brief).toContain("task_chapter_three");
    expect(brief).toContain("潮汐钟");
    expect(brief).toContain("第七响");
    expect(brief).toContain("task_world_rules");
    expect(brief).toContain("不得把下游结果标记为已验收");
    expect(brief).not.toContain("末班列车");
    expect(buildWorkflowBrief(workspace, "task_review_first", "en")).toContain(
      "can start independently",
    );
  });

  test("rejects task cycles and dangling dependencies", () => {
    const cyclic = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    cyclic.workflowTasks[0]!.parentId = "task_chapter_three";
    expect(() => validateWorkspace(cyclic)).toThrow(/workflow cycle/);

    const dangling = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
    dangling.workflowTasks[1]!.dependsOnIds = ["task_missing"];
    expect(() => validateWorkspace(dangling)).toThrow(
      /unknown task: task_missing/,
    );
  });
});

describe("workspace store", () => {
  test("round-trips atomically and writes an ArcReel package", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-"));
    try {
      const file = join(root, "workspace.json");
      const store = new WorkspaceStore(file);
      const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
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

  test("keeps Chinese characters in the export directory slug", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-zh-"));
    try {
      const store = new WorkspaceStore(join(root, "workspace.json"));
      const workspace = createDemoWorkspace(
        "zh-CN",
        "2026-11-06T00:00:00.000Z",
      );
      const bundle = await buildArcReelBundle(workspace, {
        workId: "work_tide_clock",
        generatedAt: "2026-11-06T03:00:00.000Z",
      });
      const written = await store.exportArcReel(bundle, join(root, "exports"));
      expect(written.directory).toContain("潮汐钟-");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("serializes overlapping saves and recovers the previous snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-save-"));
    try {
      const file = join(root, "workspace.json");
      const store = new WorkspaceStore(file);
      const first = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
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
      const previous = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
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

      recovered.workspace.name = "Repaired";
      recovered.workspace.revision = 42;
      await store.save(recovered.workspace);
      expect((await store.load()).workspace.name).toBe("Repaired");
      // Recovery followed by another failure must still have a validated backup.
      await Bun.write(file, "{broken again");
      expect((await store.load()).workspace.name).toBe("Previous");
      // The second recovery quarantined the corrupt primary, so removing it is
      // best-effort; `ensure()` must still fall back to the validated backup.
      rmSync(file, { force: true });
      const afterMissingPrimary = await store.ensure();
      expect(afterMissingPrimary.recoveredFromBackup).toBe(true);
      expect(afterMissingPrimary.workspace.name).toBe("Previous");
      expect(readdirSync(root).some((name) => name.includes(".tmp-"))).toBe(
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("loads a schema v1 file and persists the upgraded shape", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-migrate-"));
    try {
      const file = join(root, "workspace.json");
      const legacy = structuredClone(
        createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
      ) as unknown as Record<string, unknown>;
      legacy.schema_version = 1;
      legacy.revision = 3;
      delete legacy.workflowTasks;
      await Bun.write(file, JSON.stringify(legacy));
      const store = new WorkspaceStore(file);
      const loaded = await store.load();
      expect(loaded.workspace.schema_version).toBe(7);
      expect(loaded.workspace.workflowTasks).toEqual([]);
      expect(loaded.workspace.revision).toBe(9);
      await store.save(loaded.workspace);
      const persisted = JSON.parse(readFileSync(file, "utf8")) as {
        schema_version: number;
        workflowTasks: unknown[];
      };
      expect(persisted.schema_version).toBe(7);
      expect(persisted.workflowTasks).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes export packages atomically and never reuses a directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-export-"));
    try {
      const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
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

  test("rejects malformed manifests and oversized packages before writing", async () => {
    const root = mkdtempSync(join(tmpdir(), "iploom-studio-bundle-"));
    try {
      const workspace = createDemoWorkspace("en", "2026-11-06T00:00:00.000Z");
      const bundle = await buildArcReelBundle(workspace, {
        workId: "work_tide_clock",
        generatedAt: "2026-11-06T03:00:00.000Z",
      });
      const store = new WorkspaceStore(join(root, "workspace.json"));
      const destination = join(root, "exports");

      for (const manifestSha256 of [
        "/../..//",
        "A".repeat(64),
        "0".repeat(63),
        `${"a".repeat(60)}/../`,
      ]) {
        const tampered = structuredClone(bundle);
        tampered.manifestSha256 = manifestSha256;
        await expect(
          store.exportArcReel(tampered, destination),
        ).rejects.toThrow(/Invalid ArcReel bundle/);
        expect(existsSync(destination)).toBe(false);
      }

      const wrongSchema = structuredClone(bundle) as unknown as {
        schema: string;
      };
      wrongSchema.schema = "iploom.arcreel.manifest/v0";
      await expect(
        store.exportArcReel(wrongSchema as never, destination),
      ).rejects.toThrow(/Invalid ArcReel bundle/);

      const oversized = structuredClone(bundle);
      oversized.files = Array.from({ length: 2_049 }, (_, index) => ({
        path: `files/${index}.txt`,
        content: "x",
        mediaType: "text/plain" as const,
      }));
      await expect(store.exportArcReel(oversized, destination)).rejects.toThrow(
        /Invalid ArcReel bundle/,
      );
      expect(existsSync(destination)).toBe(false);

      // A valid bundle still exports, and the package is exactly one level
      // below the selected destination.
      const written = await store.exportArcReel(bundle, destination);
      expect(dirname(written.directory)).toBe(destination);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("desktop MCP configuration", () => {
  test("uses the desktop runtime instead of a system Node dependency", () => {
    const config = createElectronMcpConfig({
      executable:
        "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio",
      mcpScript:
        "/Applications/IPloom Studio.app/Contents/Resources/bin/iploom-mcp",
      workspacePath:
        "/Users/example/Library/Application Support/IPloom Studio/workspace.json",
    });
    expect(config.mcpServers["iploom-studio"]).toMatchObject({
      command: "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio",
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(config.mcpServers["iploom-studio"].args[0]).toContain(
      "/Resources/bin/iploom-mcp",
    );
    expect(
      config.mcpServers["iploom-studio"].args
        .at(-1)
        ?.endsWith("workspace.json"),
    ).toBe(true);
  });

  test("uses an executable command on Windows and never a .cmd shim", () => {
    const config = createElectronMcpConfig({
      executable: "C:\\Program Files\\IPloom Studio\\IPloom Studio.exe",
      mcpScript: "C:\\Program Files\\IPloom Studio\\resources\\bin\\iploom-mcp",
      workspacePath: "C:\\Users\\example\\AppData\\Roaming\\workspace.json",
    });
    const server = config.mcpServers["iploom-studio"];
    expect(server.command.endsWith(".exe")).toBe(true);
    expect(server.command.endsWith(".cmd")).toBe(false);
    expect(server.args[0]!.endsWith("iploom-mcp")).toBe(true);
    expect(server.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });
});

describe("storyboard write contract", () => {
  const sha256 = "a".repeat(64);
  const shot = (id: string, sequence: number) => ({
    id,
    sequence,
    shot_type: "wide",
    description: "The harbor wakes.",
  });
  const scene = (
    id: string,
    sequence: number,
    shots: ReturnType<typeof shot>[],
  ) => ({
    id,
    sequence,
    heading: "EXT. MIST HARBOR - DAWN",
    shots,
  });
  const baseInput = {
    contract_version: 4,
    expected_revision: 1,
    id: "sb_test",
    episode_id: "ep_test",
    source_prose_version_id: "pv_test",
    source_prose_sha256: sha256,
    title: "Tide clock storyboard",
    data: {},
    scenes: [scene("sc_1", 1, [shot("sh_1", 1), shot("sh_2", 2)])],
  };

  test("requires the script version id and sha together", () => {
    const withShaOnly = storyboardWriteSchema.safeParse({
      ...baseInput,
      source_script_sha256: sha256,
    });
    expect(withShaOnly.success).toBe(false);
    if (!withShaOnly.success) {
      expect(withShaOnly.error.issues[0]?.message).toBe(
        "script version and sha must be supplied together",
      );
      expect(withShaOnly.error.issues[0]?.path).toEqual([
        "source_script_sha256",
      ]);
    }
    const withVersionOnly = storyboardWriteSchema.safeParse({
      ...baseInput,
      source_script_version_id: "sv_test",
    });
    expect(withVersionOnly.success).toBe(false);
  });

  test("rejects a duplicate scene id or sequence", () => {
    const parsed = storyboardWriteSchema.safeParse({
      ...baseInput,
      scenes: [
        scene("sc_1", 1, [shot("sh_1", 1)]),
        scene("sc_1", 2, [shot("sh_2", 1)]),
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "duplicate scene identity or sequence",
      );
      expect(parsed.error.issues[0]?.path).toEqual(["scenes", 1]);
    }
  });

  test("rejects a duplicate shot id or sequence inside a scene", () => {
    const parsed = storyboardWriteSchema.safeParse({
      ...baseInput,
      scenes: [scene("sc_1", 1, [shot("sh_1", 1), shot("sh_1", 2)])],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "duplicate shot identity or sequence",
      );
      expect(parsed.error.issues[0]?.path).toEqual(["scenes", 0, "shots", 1]);
    }
  });

  test("caps the total shot count across scenes at the shared limit", () => {
    const scenes = Array.from({ length: 4 }, (_, sceneIndex) =>
      scene(
        `sc_${sceneIndex + 1}`,
        sceneIndex + 1,
        Array.from(
          { length: STORYBOARD_LIMITS.shotsPerScene },
          (_, shotIndex) =>
            shot(`sh_${sceneIndex}_${shotIndex}`, shotIndex + 1),
        ),
      ),
    );
    const parsed = storyboardWriteSchema.safeParse({ ...baseInput, scenes });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      expect(issue.code).toBe("too_big");
      expect(issue.path).toEqual(["scenes"]);
      expect((issue as { maximum?: number }).maximum).toBe(
        STORYBOARD_LIMITS.shots,
      );
    }
    const atLimit = storyboardWriteSchema.safeParse({
      ...baseInput,
      scenes: scenes.slice(0, 3),
    });
    expect(atLimit.success).toBe(true);
  });
});
