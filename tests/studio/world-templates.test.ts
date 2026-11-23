import { describe, expect, test } from "bun:test";
import { BUILT_IN_CONSTRUCTS } from "../../apps/studio/src/core/cards.ts";
import {
  createEmptyWorkspace,
  createId,
  localized,
} from "../../apps/studio/src/core/factory.ts";
import type {
  StoryUniverse,
  StudioWorkspace,
} from "../../apps/studio/src/core/types.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import {
  applyWorldTemplate,
  findWorldTemplate,
  WORLD_TEMPLATES,
} from "../../apps/studio/src/core/world-templates.ts";

const NOW = "2026-11-19T00:00:00.000Z";

function newUniverse(name: string): StoryUniverse {
  return {
    id: createId("uni"),
    name: localized(name),
    tagline: localized(""),
    summary: localized(""),
    genres: [],
    themes: [],
    accent: "#2f7567",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function workspaceWithWorlds(names: string[]): {
  workspace: StudioWorkspace;
  universeIds: string[];
} {
  const workspace = createEmptyWorkspace("templates", "zh-CN", NOW);
  const universeIds = names.map((name) => {
    const universe = newUniverse(name);
    workspace.universes.push(universe);
    return universe.id;
  });
  return { workspace, universeIds };
}

describe("world templates", () => {
  test("every template has bilingual metadata and a resolvable card pack", () => {
    expect(WORLD_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of WORLD_TEMPLATES) {
      expect(template.name.zh.length).toBeGreaterThan(0);
      expect(template.name.en.length).toBeGreaterThan(0);
      expect(template.summary.zh.length).toBeGreaterThan(0);
      expect(template.summary.en.length).toBeGreaterThan(0);
      expect(template.accent).toMatch(/^#[0-9a-f]{6}$/i);
      if (template.constructId) {
        expect(
          BUILT_IN_CONSTRUCTS.some((item) => item.id === template.constructId),
        ).toBe(true);
      }
    }
    expect(new Set(WORLD_TEMPLATES.map((item) => item.id)).size).toBe(
      WORLD_TEMPLATES.length,
    );
  });

  test("seeding a new world from each template produces a valid workspace", () => {
    for (const template of WORLD_TEMPLATES) {
      const { workspace, universeIds } = workspaceWithWorlds(["新世界"]);
      const universeId = universeIds[0]!;
      expect(applyWorldTemplate(workspace, template.id, universeId, NOW)).toBe(
        true,
      );
      expect(() => validateWorkspace(workspace)).not.toThrow();
      expect(workspace.lore.length).toBeGreaterThan(0);
      expect(workspace.locations.length).toBeGreaterThan(0);
      expect(workspace.factions.length).toBeGreaterThan(0);
      expect(workspace.characters.length).toBeGreaterThan(0);
      expect(workspace.storyObjects.length).toBeGreaterThan(0);
      const worldStandards = workspace.standards.filter(
        (standard) => standard.universeId === universeId,
      );
      expect(worldStandards.length).toBeGreaterThan(0);
      // Seeded rules are always editable drafts, never locked canon.
      expect(
        worldStandards.every((standard) => standard.status === "draft"),
      ).toBe(true);
      const worldRuleSystems = workspace.ruleSystems.filter(
        (system) => system.universeId === universeId,
      );
      if (template.hasPowerScaffold) {
        expect(worldRuleSystems.length).toBeGreaterThan(0);
        expect(
          worldRuleSystems.every((system) => system.status === "draft"),
        ).toBe(true);
        expect(
          workspace.abilityTemplates.filter(
            (ability) => ability.universeId === universeId,
          ).length,
        ).toBeGreaterThan(0);
        expect(
          workspace.itemStatTemplates.filter(
            (item) => item.universeId === universeId,
          ).length,
        ).toBeGreaterThan(0);
      } else {
        expect(worldRuleSystems).toHaveLength(0);
      }
      for (const entry of workspace.lore)
        expect(entry.universeId).toBe(universeId);
      for (const entry of workspace.locations)
        expect(entry.universeId).toBe(universeId);
      for (const entry of workspace.factions)
        expect(entry.universeId).toBe(universeId);
      for (const entry of workspace.storyObjects)
        expect(entry.universeId).toBe(universeId);
      for (const entry of workspace.characters)
        expect(entry.universeIds).toEqual([universeId]);
      const characterIds = new Set(
        workspace.characters.map((character) => character.id),
      );
      for (const edge of workspace.relationships) {
        expect(edge.universeId).toBe(universeId);
        expect(characterIds.has(edge.sourceId)).toBe(true);
        expect(characterIds.has(edge.targetId)).toBe(true);
      }
      if (template.constructId) {
        expect(workspace.cardTypes.length).toBeGreaterThan(0);
        expect(
          workspace.constructs.some(
            (item) =>
              item.id === template.constructId &&
              item.universeId === universeId,
          ),
        ).toBe(true);
      }
    }
  });

  test("the game template seeds its card pack once and refuses a second run", () => {
    const { workspace, universeIds } = workspaceWithWorlds(["关卡世界"]);
    const universeId = universeIds[0]!;
    expect(applyWorldTemplate(workspace, "game-level", universeId, NOW)).toBe(
      true,
    );
    const snapshot = {
      cardTypes: workspace.cardTypes.length,
      cards: workspace.cards.length,
      constructs: workspace.constructs.length,
      lore: workspace.lore.length,
    };
    expect(applyWorldTemplate(workspace, "game-level", universeId, NOW)).toBe(
      false,
    );
    expect(workspace.cardTypes.length).toBe(snapshot.cardTypes);
    expect(workspace.cards.length).toBe(snapshot.cards);
    expect(workspace.constructs.length).toBe(snapshot.constructs);
    expect(workspace.lore.length).toBe(snapshot.lore);
  });

  test("an already-populated world is never seeded", () => {
    const { workspace, universeIds } = workspaceWithWorlds(["两个模板"]);
    const universeId = universeIds[0]!;
    expect(
      applyWorldTemplate(workspace, "wuxia-jianghu", universeId, NOW),
    ).toBe(true);
    expect(applyWorldTemplate(workspace, "mystery-city", universeId, NOW)).toBe(
      false,
    );
    // Mystery city's unique lore never landed: the wuxia seed is untouched.
    expect(workspace.lore.some((entry) => entry.category === "mystery")).toBe(
      false,
    );
    expect(workspace.lore.map((entry) => entry.title.zh)).not.toContain(
      "十年前的地铁事故",
    );
  });

  test("unknown templates and missing worlds are refused without writes", () => {
    const { workspace, universeIds } = workspaceWithWorlds(["空世界"]);
    expect(
      applyWorldTemplate(workspace, "no-such-template", universeIds[0]!, NOW),
    ).toBe(false);
    expect(
      applyWorldTemplate(workspace, "mystery-city", "uni_missing", NOW),
    ).toBe(false);
    expect(workspace.lore).toHaveLength(0);
    expect(workspace.characters).toHaveLength(0);
    expect(findWorldTemplate(undefined)).toBeUndefined();
    expect(findWorldTemplate("no-such-template")).toBeUndefined();
    expect(findWorldTemplate("mystery-city")?.id).toBe("mystery-city");
  });

  test("two worlds seeded from one template never share record ids", () => {
    const { workspace, universeIds } = workspaceWithWorlds(["甲", "乙"]);
    expect(
      applyWorldTemplate(workspace, "starfarer", universeIds[0]!, NOW),
    ).toBe(true);
    expect(
      applyWorldTemplate(workspace, "starfarer", universeIds[1]!, NOW),
    ).toBe(true);
    const ids = [
      ...workspace.standards.filter((item) => item.universeId),
      ...workspace.ruleSystems,
      ...workspace.abilityTemplates,
      ...workspace.itemStatTemplates,
      ...workspace.storyObjects,
      ...workspace.lore,
      ...workspace.locations,
      ...workspace.factions,
      ...workspace.characters,
      ...workspace.relationships,
    ].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const firstWorld = workspace.characters.filter((character) =>
      character.universeIds.includes(universeIds[0]!),
    );
    const secondWorld = workspace.characters.filter((character) =>
      character.universeIds.includes(universeIds[1]!),
    );
    expect(firstWorld).toHaveLength(secondWorld.length);
    expect(
      firstWorld.every((character) => !secondWorld.includes(character)),
    ).toBe(true);
  });
});
