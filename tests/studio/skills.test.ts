import { describe, expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { findAiSkill } from "../../apps/studio/src/core/skills/index.ts";
import { worldFoundationSkill } from "../../apps/studio/src/core/skills/world-foundation.ts";
import {
  AiSkillRunError,
  type AiSkillRun,
  type AiSkillRunContext,
  createAiSkillRun,
  registerAiSkillRun,
  reviewAiSkillRun,
  validateAiSkillOutput,
} from "../../apps/studio/src/core/skills.ts";
import type { StudioWorkspace } from "../../apps/studio/src/core/types.ts";

const NOW = "2026-11-09T00:00:00.000Z";
const UNIVERSE = "uni_mist_harbor";

function demo(): StudioWorkspace {
  return createDemoWorkspace("en", NOW);
}

function contextFor(workspace: StudioWorkspace): AiSkillRunContext {
  return {
    skill: worldFoundationSkill,
    workspace,
    universeId: UNIVERSE,
    locale: "en",
  };
}

function startRun(workspace: StudioWorkspace): AiSkillRun {
  return createAiSkillRun({
    skill: worldFoundationSkill,
    workspace,
    universeId: UNIVERSE,
    locale: "en",
    input: {
      premise: "潮汐钟每错响一次，就会抹去一段记忆。",
      powerSystem: "numeric",
    },
    now: NOW,
    id: "skillrun_test",
  });
}

function output() {
  return {
    standards: [
      {
        key: "world-tone",
        title: { zh: "冷峻叙述", en: "Stark narration" },
        kind: "style",
        body: {
          zh: "叙述克制，不解释钟声的来源。",
          en: "Restrained narration; never explain where the bells come from.",
        },
      },
    ],
    ruleSystem: {
      key: "tide-ladder",
      title: { zh: "潮汐等级", en: "Tide tiers" },
      kind: "power",
      summary: "钟声强度决定潮汐等级。",
      unit: "级",
      tiers: [
        {
          key: "tier-1",
          name: { zh: "初响", en: "First chime" },
          rank: 1,
          minValue: 0,
          maxValue: 9,
          summary: "",
        },
        {
          key: "tier-2",
          name: { zh: "深钟", en: "Deep bell" },
          rank: 2,
          minValue: 10,
          maxValue: 19,
          summary: "",
        },
      ],
      attributes: [
        {
          key: "resonance",
          label: { zh: "共鸣", en: "Resonance" },
          type: "integer",
          unit: "点",
          min: 0,
          max: 100,
          enumValues: [],
          description: "钟声共鸣强度",
        },
      ],
    },
    abilities: [
      {
        key: "deep-chime",
        name: { zh: "深钟共鸣", en: "Deep resonance" },
        summary: { zh: "", en: "" },
        tierKey: "tier-2",
        effects: [{ attributeKey: "resonance", operation: "add", value: 10 }],
        cost: "一段记忆",
      },
    ],
    items: [
      {
        key: "notched-key",
        name: { zh: "缺口铜钥匙", en: "Notched brass key" },
        category: { zh: "遗物", en: "Relic" },
        tierKey: "tier-1",
        stats: [{ attributeKey: "resonance", operation: "add", value: 5 }],
        summary: { zh: "", en: "" },
      },
    ],
    notes: "潮汐刻度是本设定新造的量纲。",
  };
}

function issuesOf(action: () => unknown) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AiSkillRunError);
    return (error as AiSkillRunError).issues.map((issue) => issue.path);
  }
  throw new Error("expected AiSkillRunError");
}

function validatedRun(workspace: StudioWorkspace): AiSkillRun {
  return validateAiSkillOutput(
    contextFor(workspace),
    startRun(workspace),
    JSON.stringify(output()),
    NOW,
  );
}

describe("skill run state machine", () => {
  test("input is validated before a prompt exists", () => {
    const workspace = demo();
    expect(
      issuesOf(() =>
        createAiSkillRun({
          skill: worldFoundationSkill,
          workspace,
          universeId: UNIVERSE,
          locale: "en",
          input: { powerSystem: "numeric" },
        }),
      ),
    ).toEqual(["premise"]);

    expect(
      issuesOf(() =>
        createAiSkillRun({
          skill: worldFoundationSkill,
          workspace,
          universeId: UNIVERSE,
          locale: "en",
          input: { premise: "premise", powerSystem: "cosmic" },
        }),
      ),
    ).toEqual(["powerSystem"]);
  });

  test("a run belongs to a real universe and carries the built prompt", () => {
    const workspace = demo();
    expect(
      issuesOf(() =>
        createAiSkillRun({
          skill: worldFoundationSkill,
          workspace,
          universeId: "uni_missing",
          locale: "en",
          input: { premise: "premise", powerSystem: "numeric" },
        }),
      ),
    ).toEqual(["universeId"]);

    const run = startRun(workspace);
    expect(run.status).toBe("draft");
    expect(run.createdAt).toBe(NOW);
    expect(run.prompt).toContain("潮汐钟每错响一次");
    expect(run.prompt).toContain("## Existing rules");
  });

  test("only a validated run can be reviewed and only a reviewed run registered", () => {
    const workspace = demo();
    const context = contextFor(workspace);
    const run = startRun(workspace);

    expect(
      issuesOf(() =>
        reviewAiSkillRun(context, run, { includeRuleSystem: true }),
      ),
    ).toEqual(["status"]);

    const validated = validatedRun(workspace);
    expect(validated.status).toBe("validated");
    expect(issuesOf(() => registerAiSkillRun(context, validated))).toEqual([
      "status",
    ]);
  });

  test("a registered run is final", () => {
    const workspace = demo();
    const context = contextFor(workspace);
    const reviewed = reviewAiSkillRun(
      context,
      validatedRun(workspace),
      selection(),
      NOW,
    );
    const { run: registered } = registerAiSkillRun(context, reviewed, NOW);
    expect(registered.status).toBe("registered");
    expect(
      issuesOf(() =>
        validateAiSkillOutput(
          context,
          registered,
          JSON.stringify(output()),
          NOW,
        ),
      ),
    ).toEqual(["status"]);
  });

  test("a run from an older skill version is rejected", () => {
    const workspace = demo();
    const stale = { ...validatedRun(workspace), skillVersion: 99 };
    expect(
      issuesOf(() =>
        reviewAiSkillRun(contextFor(workspace), stale, selection()),
      ),
    ).toEqual(["skillVersion"]);
  });
});

describe("world.foundation output", () => {
  test("parse extracts JSON from prose and rejects semantic gaps", () => {
    const workspace = demo();
    const context = contextFor(workspace);
    const wrapped = `Here is the draft:
\`\`\`json
${JSON.stringify(output())}
\`\`\``;
    const result = worldFoundationSkill.parse(wrapped, {
      workspace,
      locale: "en",
      universeId: UNIVERSE,
      input: { premise: "p", powerSystem: "numeric" },
    });
    expect(result.issues).toEqual([]);
    expect(result.value).toBeDefined();

    const broken = output();
    broken.abilities[0]!.effects = [
      { attributeKey: "luck", operation: "add", value: 1 },
    ];
    const failed = validateAiSkillOutput(
      context,
      startRun(workspace),
      JSON.stringify(broken),
      NOW,
    );
    expect(failed.status).toBe("draft");
    expect(failed.output).toBeUndefined();
    expect(failed.rawOutput).toBe(JSON.stringify(broken));
    expect(failed.issues.map((issue) => issue.path)).toContain(
      "abilities.0.effects.0.attributeKey",
    );
  });

  test("powerSystem=none forbids a ladder", () => {
    const workspace = demo();
    const run = createAiSkillRun({
      skill: worldFoundationSkill,
      workspace,
      universeId: UNIVERSE,
      locale: "en",
      input: { premise: "没有超自然力量的世界。", powerSystem: "none" },
      now: NOW,
    });
    const failed = validateAiSkillOutput(
      contextFor(workspace),
      run,
      JSON.stringify(output()),
      NOW,
    );
    expect(failed.status).toBe("draft");
    expect(failed.issues.map((issue) => issue.message)).toContain(
      "powerSystem=none requires ruleSystem=null",
    );
  });

  test("review normalizes and rejects impossible selections", () => {
    const workspace = demo();
    const context = contextFor(workspace);
    const validated = validatedRun(workspace);

    expect(
      issuesOf(() =>
        reviewAiSkillRun(context, validated, {
          acceptedStandardKeys: ["world-tone", "nope"],
          includeRuleSystem: true,
        }),
      ),
    ).toEqual(["acceptedStandardKeys"]);

    expect(
      issuesOf(() =>
        reviewAiSkillRun(context, validated, {
          acceptedStandardKeys: ["world-tone"],
          includeRuleSystem: false,
          acceptedAbilityKeys: ["deep-chime"],
        }),
      ),
    ).toEqual(["includeRuleSystem"]);

    const reviewed = reviewAiSkillRun(context, validated, selection(), NOW);
    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.review).toEqual({
      at: NOW,
      selection: selection(),
    });
  });

  test("registration appends only the selected records as drafts", () => {
    const workspace = demo();
    const context = contextFor(workspace);
    const reviewed = reviewAiSkillRun(
      context,
      validatedRun(workspace),
      selection(),
      NOW,
    );
    const { run, workspace: next } = registerAiSkillRun(context, reviewed, NOW);

    expect(run.status).toBe("registered");
    expect(next.revision).toBe(workspace.revision + 1);
    expect(next.standards).toHaveLength(workspace.standards.length + 1);
    expect(next.ruleSystems).toHaveLength(1);
    expect(next.abilityTemplates).toHaveLength(1);
    expect(next.itemStatTemplates).toHaveLength(1);

    const standard = next.standards.at(-1)!;
    expect(standard.status).toBe("draft");
    expect(standard.universeId).toBe(UNIVERSE);
    expect(standard.body.en).toContain("Restrained narration");

    const system = next.ruleSystems[0]!;
    expect(system.status).toBe("draft");
    expect(system.tiers.map((tier) => tier.id)).toEqual([
      "tier_tier-1",
      "tier_tier-2",
    ]);
    expect(next.abilityTemplates[0]!.ruleSystemId).toBe(system.id);
    expect(next.abilityTemplates[0]!.tierId).toBe("tier_tier-2");
    expect(next.itemStatTemplates[0]!.ruleSystemId).toBe(system.id);
    expect(next.itemStatTemplates[0]!.tierId).toBe("tier_tier-1");

    // The source workspace is untouched; registration works on a clone.
    expect(workspace.ruleSystems).toEqual([]);
  });

  test("declining the rule system keeps only the accepted standards", () => {
    const workspace = demo();
    const context = contextFor(workspace);
    const reviewed = reviewAiSkillRun(
      context,
      validatedRun(workspace),
      {
        acceptedStandardKeys: ["world-tone"],
        includeRuleSystem: false,
        acceptedAbilityKeys: [],
        acceptedItemKeys: [],
      },
      NOW,
    );
    const { workspace: next } = registerAiSkillRun(context, reviewed, NOW);
    expect(next.standards).toHaveLength(workspace.standards.length + 1);
    expect(next.ruleSystems).toEqual([]);
    expect(next.abilityTemplates).toEqual([]);
    expect(next.itemStatTemplates).toEqual([]);
  });

  test("the prompt is bilingual and grounded in the selected universe", () => {
    const workspace = demo();
    const prompt = worldFoundationSkill.buildPrompt({
      workspace,
      locale: "zh-CN",
      universeId: UNIVERSE,
      input: {
        premise: "潮汐钟每错响一次，就会抹去一段记忆。",
        powerSystem: "numeric",
      },
    });
    expect(prompt).toContain("雾港");
    expect(prompt).toContain("战力体系");
    expect(prompt).toContain("tier-1");
    expect(prompt).toContain("JSON");
  });
});

describe("skill registry", () => {
  test("world.foundation is registered once", () => {
    expect(findAiSkill("world.foundation")).toBe(worldFoundationSkill);
    expect(findAiSkill("world.missing")).toBeUndefined();
  });
});

function selection() {
  return {
    acceptedStandardKeys: ["world-tone"],
    includeRuleSystem: true,
    acceptedAbilityKeys: ["deep-chime"],
    acceptedItemKeys: ["notched-key"],
  };
}
