import { describe, expect, test } from "bun:test";
import {
  createDemoWorkspace,
  createEmptyWorkspace,
  createId,
  localized,
} from "../../apps/studio/src/core/factory.ts";
import {
  createFoundationBypass,
  evaluateUniverseFoundation,
} from "../../apps/studio/src/core/foundation-readiness.ts";
import { deleteRuleSystemFromDraft } from "../../apps/studio/src/core/integrity.ts";
import {
  quickBuildWork,
  worksOfKind,
} from "../../apps/studio/src/core/quick-build.ts";
import type {
  StoryUniverse,
  StudioWorkspace,
} from "../../apps/studio/src/core/types.ts";
import { WORKSPACE_SCHEMA_VERSION } from "../../apps/studio/src/core/types.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { applyWorldTemplate } from "../../apps/studio/src/core/world-templates.ts";

const NOW = "2026-11-23T12:00:00.000Z";

function addBlankUniverse(
  workspace: StudioWorkspace,
  summary = "",
): StoryUniverse {
  const universe: StoryUniverse = {
    id: createId("uni"),
    name: localized("测试世界", "Test World"),
    tagline: localized("", ""),
    summary: localized(summary, summary),
    genres: [],
    themes: [],
    accent: "#2f7567",
    createdAt: NOW,
    updatedAt: NOW,
  };
  workspace.universes.push(universe);
  return universe;
}

describe("foundation readiness checklist and health", () => {
  test("a brand-new blank world starts 0/6 incomplete despite project-wide baseline standards", () => {
    const workspace = createEmptyWorkspace("Blank", "en", NOW);
    // Project-wide baseline standards are seeded active, but never count as a
    // world's own foundation rule set.
    expect(workspace.standards.length).toBe(6);
    const universe = addBlankUniverse(workspace);

    const report = evaluateUniverseFoundation(workspace, universe.id);
    expect(report.complete).toBe(false);
    expect(report.completedCount).toBe(0);
    expect(report.totalCount).toBe(6);
    expect(report.draftCount).toBe(0);
    expect(report.missingCount).toBe(6);
    expect(report.incompleteIds).toEqual([
      "summary",
      "activeRules",
      "cast",
      "locationsFactions",
      "items",
      "canonStatus",
    ]);
    expect(report.health.every((entry) => entry.mode === "missing")).toBe(true);
  });

  test("template-seeded worlds surface draft rules and canon status until explicitly activated", () => {
    const workspace = createEmptyWorkspace("Cultivation", "zh-CN", NOW);
    const universe = addBlankUniverse(workspace, "灵脉衰退中的修真界。");
    expect(applyWorldTemplate(workspace, "cultivation", universe.id, NOW)).toBe(
      true,
    );

    const beforeActivation = evaluateUniverseFoundation(workspace, universe.id);
    expect(beforeActivation.complete).toBe(false);
    expect(beforeActivation.completedCount).toBe(4);
    expect(beforeActivation.draftCount).toBe(2);
    expect(beforeActivation.incompleteIds).toEqual([
      "activeRules",
      "canonStatus",
    ]);
    expect(
      beforeActivation.items.find((item) => item.id === "activeRules")?.status,
    ).toBe("draft");
    expect(
      beforeActivation.items.find((item) => item.id === "canonStatus")?.status,
    ).toBe("draft");

    // Health reflects the seeded structured rule system, abilities and items.
    const healthByAxis = new Map(
      beforeActivation.health.map((item) => [item.axis, item]),
    );
    expect(healthByAxis.get("rules")?.mode).toBe("structured");
    expect(healthByAxis.get("abilities")?.mode).toBe("structured");
    expect(healthByAxis.get("items")?.mode).toBe("structured");
    expect(healthByAxis.get("nodes")?.mode).toBe("prose-only");

    // Activate all seeded world drafts -> checklist becomes 6/6 complete.
    for (const standard of workspace.standards) {
      if (standard.universeId === universe.id) standard.status = "active";
    }
    for (const system of workspace.ruleSystems) {
      if (system.universeId === universe.id) system.status = "active";
    }

    const afterActivation = evaluateUniverseFoundation(workspace, universe.id);
    expect(afterActivation.complete).toBe(true);
    expect(afterActivation.completedCount).toBe(6);
    expect(afterActivation.incompleteIds).toEqual([]);
    expect(createFoundationBypass(afterActivation, NOW)).toBeUndefined();
  });

  test("items item distinguishes draft rule-system templates from prose objects and active templates", () => {
    const workspace = createEmptyWorkspace("Items", "en", NOW);
    const universe = addBlankUniverse(workspace, "Summary");
    expect(applyWorldTemplate(workspace, "cultivation", universe.id, NOW)).toBe(
      true,
    );
    // Remove prose storyObjects so only draft itemStatTemplates remain.
    workspace.storyObjects = [];

    const draftOnly = evaluateUniverseFoundation(workspace, universe.id);
    expect(draftOnly.items.find((item) => item.id === "items")?.status).toBe(
      "draft",
    );

    // Activating the owning rule system promotes the item templates to done.
    workspace.ruleSystems[0]!.status = "active";
    const activated = evaluateUniverseFoundation(workspace, universe.id);
    expect(activated.items.find((item) => item.id === "items")?.status).toBe(
      "done",
    );
  });

  test("prose-only templates report prose-only health where no structured layer exists", () => {
    const workspace = createEmptyWorkspace("Mystery", "en", NOW);
    const universe = addBlankUniverse(workspace, "An old city mystery.");
    expect(
      applyWorldTemplate(workspace, "mystery-city", universe.id, NOW),
    ).toBe(true);

    const report = evaluateUniverseFoundation(workspace, universe.id);
    const healthByAxis = new Map(
      report.health.map((item) => [item.axis, item]),
    );
    expect(healthByAxis.get("rules")?.mode).toBe("prose-only");
    expect(healthByAxis.get("abilities")?.mode).toBe("missing");
    expect(healthByAxis.get("items")?.mode).toBe("prose-only");
    expect(healthByAxis.get("nodes")?.mode).toBe("prose-only");
  });

  test("demo world keeps proposed future events visible without blocking confirmed canon", () => {
    const workspace = createDemoWorkspace("en", NOW);
    const report = evaluateUniverseFoundation(workspace, "uni_mist_harbor");
    const canon = report.items.find((item) => item.id === "canonStatus")!;
    expect(canon.status).toBe("done");
    expect(canon.counts.canon).toBe(3);
    expect(canon.counts.proposedEvents).toBe(1);
    // Still missing world-scoped active rules (only project baseline exists).
    expect(report.incompleteIds).toEqual(["activeRules"]);
  });

  test("unknown universe returns a safe empty incomplete report", () => {
    const workspace = createEmptyWorkspace("Empty", "en", NOW);
    const report = evaluateUniverseFoundation(workspace, "uni_missing");
    expect(report.complete).toBe(false);
    expect(report.completedCount).toBe(0);
    expect(report.missingCount).toBe(6);
  });

  test("createFoundationBypass snapshots unfinished items and quickBuildWork records it", () => {
    const workspace = createEmptyWorkspace("Bypass", "en", NOW);
    const universe = addBlankUniverse(workspace);
    const report = evaluateUniverseFoundation(workspace, universe.id);
    const bypass = createFoundationBypass(report, NOW);
    expect(bypass).toEqual({
      at: NOW,
      missingItems: [
        "summary",
        "activeRules",
        "cast",
        "locationsFactions",
        "items",
        "canonStatus",
      ],
    });

    const novel = quickBuildWork(workspace, universe.id, "novel", "en", NOW, {
      foundationBypass: bypass,
    });
    expect(novel.foundationBypass).toEqual(bypass);
    expect(novel.chapters[0]?.foundationBypass).toEqual(bypass);
    const game = quickBuildWork(workspace, universe.id, "game", "zh-CN", NOW, {
      foundationBypass: bypass,
    });
    expect(game.foundationBypass).toEqual(bypass);
    expect(game.chapters).toHaveLength(0);
    expect(worksOfKind(workspace, universe.id)).toHaveLength(2);
    expect(worksOfKind(workspace, universe.id, "novel")).toHaveLength(1);
    expect(worksOfKind(workspace, universe.id, "game")).toHaveLength(1);
    expect(() =>
      quickBuildWork(workspace, "uni_missing", "novel", "en", NOW),
    ).toThrow("unknown world");
    expect(() => validateWorkspace(workspace)).not.toThrow();
  });

  test("deleteRuleSystemFromDraft removes linked ability and item templates cleanly", () => {
    const workspace = createEmptyWorkspace("Cascade", "en", NOW);
    const first = addBlankUniverse(workspace, "First");
    const second = addBlankUniverse(workspace, "Second");
    expect(applyWorldTemplate(workspace, "cultivation", first.id, NOW)).toBe(
      true,
    );
    expect(applyWorldTemplate(workspace, "urban-fantasy", second.id, NOW)).toBe(
      true,
    );

    const firstSystem = workspace.ruleSystems.find(
      (system) => system.universeId === first.id,
    )!;
    deleteRuleSystemFromDraft(workspace, firstSystem.id);

    expect(() => validateWorkspace(workspace)).not.toThrow();
    expect(
      workspace.ruleSystems.some((system) => system.id === firstSystem.id),
    ).toBe(false);
    expect(
      workspace.abilityTemplates.some(
        (ability) => ability.ruleSystemId === firstSystem.id,
      ),
    ).toBe(false);
    expect(
      workspace.itemStatTemplates.some(
        (item) => item.ruleSystemId === firstSystem.id,
      ),
    ).toBe(false);
    // The other world's rule system and templates remain intact.
    expect(
      workspace.ruleSystems.some((system) => system.universeId === second.id),
    ).toBe(true);
    expect(
      workspace.abilityTemplates.some(
        (ability) => ability.universeId === second.id,
      ),
    ).toBe(true);
  });
});

describe("schema v13 migration and foundationBypass validation", () => {
  test("migrates v12 workspaces to v13 without rewriting existing works or chapters", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", NOW),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 12;
    legacy.revision = 15;

    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(migrated.schema_version).toBe(13);
    expect(migrated.revision).toBe(16);
    expect(migrated.works[0]?.foundationBypass).toBeUndefined();
    expect(migrated.works[0]?.chapters[0]?.foundationBypass).toBeUndefined();
  });

  test("rejects malformed foundationBypass records with empty or duplicate items", () => {
    const emptyItems = createDemoWorkspace("en", NOW);
    emptyItems.works[0]!.foundationBypass = { at: NOW, missingItems: [] };
    expect(() => validateWorkspace(emptyItems)).toThrow();

    const duplicateItems = createDemoWorkspace("en", NOW);
    duplicateItems.works[0]!.chapters[0]!.foundationBypass = {
      at: NOW,
      missingItems: ["activeRules", "activeRules"],
    };
    expect(() => validateWorkspace(duplicateItems)).toThrow();
  });
});
