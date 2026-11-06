import { describe, expect, test } from "bun:test";
import { createDemoWorkspace, createEmptyWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  applicableStandards,
  buildStandardDraftPrompt,
  createBaselineStandards,
  MAX_STANDARD_CANDIDATES,
  parseStandardCandidates,
  standardRefsFor,
  standardsPromptSection,
} from "../../apps/studio/src/core/standards.ts";
import {
  buildProductionPrompt,
  createProductionTasks,
  taskProductionPrompt,
} from "../../apps/studio/src/core/production.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { buildWorkflowBrief } from "../../apps/studio/src/core/workflow.ts";
import type { WorkspaceStandard } from "../../apps/studio/src/core/types.ts";

const NOW = "2026-11-06T00:00:00.000Z";

function customStandard(
  id: string,
  overrides: Partial<WorkspaceStandard> = {},
): WorkspaceStandard {
  return {
    id,
    kind: "style",
    title: { zh: `规则 ${id}`, en: `Rule ${id}` },
    body: { zh: `正文 ${id}`, en: `Body ${id}` },
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("foundation standards", () => {
  test("every project starts from six deterministic active baselines", () => {
    const standards = createBaselineStandards(NOW);
    expect(standards).toHaveLength(6);
    expect(standards.every((standard) => standard.status === "active")).toBe(
      true,
    );
    expect(standards.every((standard) => standard.version === 1)).toBe(true);
    expect(standards.map((standard) => standard.kind)).toEqual([
      "style",
      "continuity",
      "continuity",
      "entity-prompt",
      "numeric",
      "format",
    ]);
    const textSource = standards.find(
      (standard) => standard.id === "std_baseline_text_source",
    );
    expect(textSource?.body.zh).toContain("下游产物");
    expect(textSource?.body.en).toContain("downstream");
    expect(createEmptyWorkspace("New project", "en", NOW).standards).toHaveLength(
      6,
    );
  });

  test("applicability is scoped, active-only and deterministically ordered", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.standards.push(
      customStandard("std_custom_draft", { status: "draft" }),
      customStandard("std_custom_disabled", { status: "disabled" }),
      customStandard("std_custom_style", { kind: "style" }),
      customStandard("std_custom_numeric", { kind: "numeric" }),
      customStandard("std_custom_other_world", {
        kind: "format",
        universeId: "uni_ninth_station",
      }),
      customStandard("std_custom_this_world", {
        kind: "format",
        universeId: "uni_mist_harbor",
      }),
    );
    const applied = applicableStandards(workspace, "uni_mist_harbor");
    const ids = applied.map((standard) => standard.id);
    expect(ids).not.toContain("std_custom_draft");
    expect(ids).not.toContain("std_custom_disabled");
    expect(ids).not.toContain("std_custom_other_world");
    expect(ids).toContain("std_custom_style");
    expect(ids).toContain("std_custom_this_world");
    expect(idOrderIsStable(applied)).toBe(true);
    expect(applicableStandards(workspace)).toHaveLength(8);
  });

  test("the prompt block names every applied rule by id and version", () => {
    const workspace = createDemoWorkspace("en", NOW);
    const section = standardsPromptSection(workspace, "uni_mist_harbor", "en");
    expect(section[1]).toBe("## Foundation standards");
    const text = section.join("\n");
    for (const standard of applicableStandards(workspace, "uni_mist_harbor")) {
      expect(text).toContain(`\`${standard.id}\` · v${standard.version}`);
    }
    expect(section).toEqual(
      standardsPromptSection(workspace, "uni_mist_harbor", "en"),
    );
    workspace.standards = workspace.standards.map((standard) => ({
      ...standard,
      status: "draft",
    }));
    expect(standardsPromptSection(workspace, "uni_mist_harbor", "en")).toEqual(
      [],
    );
  });

  test("production prompts and workflow briefs inject the same foundation", () => {
    const workspace = createDemoWorkspace("en", NOW);
    const prompt = buildProductionPrompt(
      workspace,
      "character",
      { universeId: "uni_mist_harbor", workId: "work_tide_clock" },
      "en",
    );
    expect(prompt).toContain("## Foundation standards");
    expect(prompt).toContain("std_baseline_entity_prompt");

    const task = workspace.workflowTasks[0]!;
    const brief = buildWorkflowBrief(workspace, task.id, "en");
    expect(brief).toContain("## Foundation standards");
    const composed = taskProductionPrompt(workspace, task, "en");
    expect(composed.match(/## Foundation standards/g)).toHaveLength(1);
  });

  test("new production tasks pin the active version of every applied rule", () => {
    const workspace = createDemoWorkspace("en", NOW);
    workspace.standards.push(
      customStandard("std_custom_draft", { status: "draft" }),
      customStandard("std_custom_style", { kind: "style", version: 3 }),
    );
    const tasks = createProductionTasks(
      workspace,
      { universeId: "uni_mist_harbor", workId: "work_tide_clock" },
      "en",
    );
    const expected = standardRefsFor(workspace, "uni_mist_harbor");
    expect(tasks).toHaveLength(6);
    expect(tasks.every((task) => task.standardRefs.length === expected.length)).toBe(
      true,
    );
    expect(
      expected.some(
        (ref) => ref.id === "std_custom_style" && ref.version === 3,
      ),
    ).toBe(true);
    expect(expected.some((ref) => ref.id === "std_custom_draft")).toBe(false);
  });

  test("workspace validation rejects dangling or duplicated standard references", () => {
    const duplicate = createDemoWorkspace("en", NOW);
    duplicate.standards.push(structuredClone(duplicate.standards[0]!));
    expect(() => validateWorkspace(duplicate)).toThrow(/duplicate id/);

    const dangling = createDemoWorkspace("en", NOW);
    dangling.workflowTasks[0]!.standardRefs = [
      { id: "std_missing", version: 1 },
    ];
    expect(() => validateWorkspace(dangling)).toThrow(/unknown standard/);

    const foreign = createDemoWorkspace("en", NOW);
    foreign.standards.push(
      customStandard("std_other_world", { universeId: "uni_ninth_station" }),
    );
    foreign.workflowTasks[0]!.standardRefs = [
      { id: "std_other_world", version: 1 },
    ];
    expect(() => validateWorkspace(foreign)).toThrow(
      /standard belongs to another universe/,
    );
  });

  test("migrating schema v3 registers an empty foundation", () => {
    const legacy = structuredClone(
      createDemoWorkspace("en", NOW),
    ) as unknown as Record<string, unknown>;
    legacy.schema_version = 3;
    legacy.revision = 20;
    delete legacy.standards;
    legacy.workflowTasks = [];
    const migrated = validateWorkspace(legacy);
    expect(migrated.schema_version).toBe(4);
    expect(migrated.revision).toBe(21);
    expect(migrated.standards).toEqual([]);
  });
});

describe("AI standard drafting", () => {
  test("the draft prompt is genre-neutral and lists existing rules", () => {
    const workspace = createDemoWorkspace("zh-CN", NOW);
    const prompt = buildStandardDraftPrompt(workspace, "zh-CN");
    expect(prompt).toContain("游戏场景");
    expect(prompt).toContain("实体提示词统一模板");
    expect(prompt).toContain("一个 JSON 数组");
  });

  test("accepts fenced JSON and drops malformed or duplicate candidates", () => {
    const raw = [
      "```json",
      JSON.stringify([
        {
          kind: "style",
          title: { zh: "统一语气", en: "Unified tone" },
          body: { zh: "保持同一语气。", en: "Keep one tone." },
        },
        {
          kind: "style",
          title: { zh: "统一语气", en: "Unified tone" },
          body: { zh: "重复项。", en: "Duplicate." },
        },
        {
          kind: "not-a-kind",
          title: { zh: "非法", en: "Invalid" },
          body: { zh: "非法。", en: "Invalid." },
        },
        {
          kind: "format",
          title: { zh: "", en: "" },
          body: { zh: "缺标题。", en: "Missing title." },
        },
        {
          kind: "numeric",
          title: { zh: "单位", en: "Units" },
          body: { en: "Always use units." },
        },
      ]),
      "```",
    ].join("\n");
    const candidates = parseStandardCandidates(raw);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.kind).toBe("style");
    expect(candidates[1]!.kind).toBe("numeric");
    expect(candidates[1]!.title.zh).toBe("单位");
  });

  test("caps a runaway candidate list and rejects non-arrays", () => {
    const many = Array.from({ length: MAX_STANDARD_CANDIDATES + 5 }, (_, index) => ({
      kind: "style",
      title: { zh: `规则 ${index}`, en: `Rule ${index}` },
      body: { zh: `正文 ${index}`, en: `Body ${index}` },
    }));
    expect(parseStandardCandidates(JSON.stringify(many))).toHaveLength(
      MAX_STANDARD_CANDIDATES,
    );
    expect(() => parseStandardCandidates("no array here")).toThrow(
      /did not contain a standards array/,
    );
    expect(() => parseStandardCandidates("[{\"kind\":]")).toThrow(
      /not valid JSON/,
    );
  });
});

function idOrderIsStable(standards: WorkspaceStandard[]): boolean {
  const rank = [
    "style",
    "format",
    "naming",
    "numeric",
    "entity-prompt",
    "continuity",
  ];
  for (let index = 1; index < standards.length; index += 1) {
    const previous = standards[index - 1]!;
    const current = standards[index]!;
    const previousRank = rank.indexOf(previous.kind);
    const currentRank = rank.indexOf(current.kind);
    if (previousRank > currentRank) return false;
    if (previousRank === currentRank && previous.id > current.id) return false;
  }
  return true;
}
