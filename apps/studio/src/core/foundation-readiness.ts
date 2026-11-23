import type {
  FoundationBypassRecord,
  FoundationCheckId,
  StudioWorkspace,
} from "./types.ts";

/**
 * Derived foundation readiness and prose-vs-structured health for a single
 * universe. Never stored as a source of truth: every count and status is
 * computed directly from the live workspace records.
 */

export type FoundationCheckStatus = "done" | "draft" | "missing";

export type FoundationCheckTarget =
  | "edit-world"
  | "foundation"
  | "cast"
  | "atlas"
  | "timeline";

export interface FoundationCheckItem {
  id: FoundationCheckId;
  status: FoundationCheckStatus;
  target: FoundationCheckTarget;
  /** Derived counts behind this item's status. */
  counts: Record<string, number>;
}

export type FoundationHealthAxis = "rules" | "abilities" | "items" | "nodes";
export type FoundationHealthMode = "structured" | "prose-only" | "missing";

export interface FoundationHealthItem {
  axis: FoundationHealthAxis;
  mode: FoundationHealthMode;
  structuredCount: number;
  proseCount: number;
  activeStructuredCount?: number;
  draftStructuredCount?: number;
}

export interface UniverseFoundationReport {
  universeId: string;
  complete: boolean;
  completedCount: number;
  totalCount: number;
  draftCount: number;
  missingCount: number;
  incompleteIds: FoundationCheckId[];
  items: FoundationCheckItem[];
  health: FoundationHealthItem[];
  counts: {
    activeWorldStandards: number;
    draftWorldStandards: number;
    activeRuleSystems: number;
    draftRuleSystems: number;
    abilityTemplates: number;
    itemStatTemplates: number;
    characters: number;
    locations: number;
    factions: number;
    storyObjects: number;
    loreRules: number;
    worldCardTypes: number;
    worldCards: number;
    canonEvents: number;
    proposedEvents: number;
  };
}

/**
 * Evaluate a universe's foundation checklist and prose-vs-structured health.
 *
 * Project-wide baseline standards do not satisfy a world's own active-rule
 * requirement on their own — a brand-new blank world must still register and
 * activate at least one world-scoped prose standard or structured rule system
 * before its foundation is marked complete.
 */
export function evaluateUniverseFoundation(
  workspace: StudioWorkspace,
  universeId: string,
): UniverseFoundationReport {
  const universe = workspace.universes.find((item) => item.id === universeId);
  const hasSummary = Boolean(
    universe && (universe.summary.zh.trim() || universe.summary.en.trim()),
  );

  const worldStandards = workspace.standards.filter(
    (standard) => standard.universeId === universeId,
  );
  const activeWorldStandards = worldStandards.filter(
    (standard) => standard.status === "active",
  ).length;
  const draftWorldStandards = worldStandards.filter(
    (standard) => standard.status === "draft",
  ).length;

  const worldRuleSystems = workspace.ruleSystems.filter(
    (system) => system.universeId === universeId,
  );
  const activeRuleSystems = worldRuleSystems.filter(
    (system) => system.status === "active",
  ).length;
  const draftRuleSystems = worldRuleSystems.filter(
    (system) => system.status === "draft",
  ).length;
  const activeRuleSystemIds = new Set(
    worldRuleSystems
      .filter((system) => system.status === "active")
      .map((system) => system.id),
  );

  const worldAbilities = workspace.abilityTemplates.filter(
    (ability) => ability.universeId === universeId,
  );
  const worldItemTemplates = workspace.itemStatTemplates.filter(
    (item) => item.universeId === universeId,
  );
  const activeItemTemplates = worldItemTemplates.filter((item) =>
    activeRuleSystemIds.has(item.ruleSystemId),
  ).length;

  const characters = workspace.characters.filter((character) =>
    character.universeIds.includes(universeId),
  ).length;
  const locations = workspace.locations.filter(
    (location) => location.universeId === universeId,
  ).length;
  const factions = workspace.factions.filter(
    (faction) => faction.universeId === universeId,
  ).length;
  const storyObjects = workspace.storyObjects.filter(
    (object) => object.universeId === universeId,
  ).length;

  const worldLore = workspace.lore.filter(
    (entry) => entry.universeId === universeId,
  );
  const loreRules = worldLore.filter(
    (entry) => entry.category === "rule" || entry.category === "power",
  ).length;
  const powerLore = worldLore.filter(
    (entry) => entry.category === "power",
  ).length;

  const worldCardTypes = workspace.cardTypes.filter(
    (type) => type.universeId === universeId && !type.workId,
  );
  const worldCardTypeIds = new Set(worldCardTypes.map((type) => type.id));
  const worldCards = workspace.cards.filter((card) =>
    worldCardTypeIds.has(card.typeId),
  ).length;

  const worldEvents = workspace.timelineEvents.filter(
    (event) => event.universeId === universeId,
  );
  const canonEvents = worldEvents.filter(
    (event) => event.canonStatus === "canon",
  ).length;
  const proposedEvents = worldEvents.filter(
    (event) => event.canonStatus === "proposed",
  ).length;

  const activeRulesTotal = activeWorldStandards + activeRuleSystems;
  const draftRulesTotal = draftWorldStandards + draftRuleSystems;
  const activeRulesStatus: FoundationCheckStatus =
    activeRulesTotal > 0 ? "done" : draftRulesTotal > 0 ? "draft" : "missing";

  const itemsStatus: FoundationCheckStatus =
    storyObjects + activeItemTemplates > 0
      ? "done"
      : worldItemTemplates.length > 0
        ? "draft"
        : "missing";

  // Confirmed canon covers activated world rules/rule systems and canon
  // timeline events. Unreviewed foundation drafts keep this item in draft until
  // activated or discarded; proposed future-chapter timeline events remain
  // visible in counts without blocking an otherwise confirmed canon.
  const confirmedCanon = activeRulesTotal + canonEvents;
  const pendingTotal = draftRulesTotal + proposedEvents;
  const canonStatus: FoundationCheckStatus =
    confirmedCanon > 0 && draftRulesTotal === 0
      ? "done"
      : pendingTotal > 0
        ? "draft"
        : "missing";

  const items: FoundationCheckItem[] = [
    {
      id: "summary",
      status: hasSummary ? "done" : "missing",
      target: "edit-world",
      counts: { present: hasSummary ? 1 : 0 },
    },
    {
      id: "activeRules",
      status: activeRulesStatus,
      target: "foundation",
      counts: {
        active: activeRulesTotal,
        draft: draftRulesTotal,
        activeStandards: activeWorldStandards,
        activeRuleSystems,
      },
    },
    {
      id: "cast",
      status: characters > 0 ? "done" : "missing",
      target: "cast",
      counts: { characters },
    },
    {
      id: "locationsFactions",
      status: locations + factions > 0 ? "done" : "missing",
      target: "atlas",
      counts: { locations, factions },
    },
    {
      id: "items",
      status: itemsStatus,
      target: "timeline",
      counts: {
        storyObjects,
        itemTemplates: worldItemTemplates.length,
        activeItemTemplates,
      },
    },
    {
      id: "canonStatus",
      status: canonStatus,
      target: "foundation",
      counts: {
        canon: confirmedCanon,
        draftFoundation: draftRulesTotal,
        proposedEvents,
      },
    },
  ];

  const health: FoundationHealthItem[] = [
    {
      axis: "rules",
      mode:
        worldRuleSystems.length > 0
          ? "structured"
          : worldStandards.length + loreRules > 0
            ? "prose-only"
            : "missing",
      structuredCount: worldRuleSystems.length,
      proseCount: worldStandards.length + loreRules,
      activeStructuredCount: activeRuleSystems,
      draftStructuredCount: draftRuleSystems,
    },
    {
      axis: "abilities",
      mode:
        worldAbilities.length > 0
          ? "structured"
          : powerLore > 0
            ? "prose-only"
            : "missing",
      structuredCount: worldAbilities.length,
      proseCount: powerLore,
    },
    {
      axis: "items",
      mode:
        worldItemTemplates.length > 0
          ? "structured"
          : storyObjects > 0
            ? "prose-only"
            : "missing",
      structuredCount: worldItemTemplates.length,
      proseCount: storyObjects,
    },
    {
      axis: "nodes",
      mode:
        worldCardTypes.length > 0
          ? "structured"
          : characters + locations + factions > 0
            ? "prose-only"
            : "missing",
      structuredCount: worldCardTypes.length,
      proseCount: characters + locations + factions,
    },
  ];

  const completedCount = items.filter((item) => item.status === "done").length;
  const draftCount = items.filter((item) => item.status === "draft").length;
  const missingCount = items.filter((item) => item.status === "missing").length;
  const incompleteIds = items
    .filter((item) => item.status !== "done")
    .map((item) => item.id);

  return {
    universeId,
    complete: incompleteIds.length === 0,
    completedCount,
    totalCount: items.length,
    draftCount,
    missingCount,
    incompleteIds,
    items,
    health,
    counts: {
      activeWorldStandards,
      draftWorldStandards,
      activeRuleSystems,
      draftRuleSystems,
      abilityTemplates: worldAbilities.length,
      itemStatTemplates: worldItemTemplates.length,
      characters,
      locations,
      factions,
      storyObjects,
      loreRules,
      worldCardTypes: worldCardTypes.length,
      worldCards,
      canonEvents,
      proposedEvents,
    },
  };
}

/**
 * Snapshot the incomplete checklist items when the author deliberately creates
 * a work or chapter before the foundation is finished. Returns `undefined` when
 * the foundation is already complete.
 */
export function createFoundationBypass(
  report: Pick<UniverseFoundationReport, "complete" | "incompleteIds">,
  now = new Date().toISOString(),
): FoundationBypassRecord | undefined {
  if (report.complete || report.incompleteIds.length === 0) return undefined;
  return {
    at: now,
    missingItems: [...report.incompleteIds],
  };
}
