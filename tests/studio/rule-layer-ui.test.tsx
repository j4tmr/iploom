import "./dom-setup";
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { CharacterModal } from "../../apps/studio/src/components/forms.tsx";
import {
  AbilityTemplateModal,
  ItemStatTemplateModal,
  RuleSystemModal,
  WorldFoundationSkillModal,
} from "../../apps/studio/src/components/rule-forms.tsx";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type {
  AbilityTemplate,
  Character,
  ItemStatTemplate,
  RuleStatus,
  RuleSystem,
  StandardStatus,
  StudioWorkspace,
  WorkspaceStandard,
} from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { bridge } from "../../apps/studio/src/platform.ts";
import { FoundationView } from "../../apps/studio/src/views/foundation-view.tsx";

afterEach(cleanup);

const NOW = "2026-11-23T12:00:00.000Z";
const UNIVERSE_ID = "uni_mist_harbor";
const t = translator("en");

function sampleRuleSystem(overrides: Partial<RuleSystem> = {}): RuleSystem {
  return {
    id: "rules_tide",
    universeId: UNIVERSE_ID,
    title: { zh: "潮汐等级", en: "Tide Ladder" },
    kind: "power",
    summary: "Bell resonance ladder.",
    unit: "level",
    tiers: [
      {
        id: "tier_1",
        name: { zh: "初响", en: "First Chime" },
        rank: 1,
        minValue: 1,
        maxValue: 9,
        summary: "Entry resonance.",
      },
      {
        id: "tier_2",
        name: { zh: "深钟", en: "Deep Bell" },
        rank: 2,
        minValue: 10,
        maxValue: 20,
        summary: "Tower resonance.",
      },
    ],
    attributes: [
      {
        key: "resonance",
        label: { zh: "共鸣", en: "Resonance" },
        type: "integer",
        unit: "pt",
        min: 0,
        max: 100,
        enumValues: [],
        defaultValue: 10,
        description: "Core bell resonance.",
      },
      {
        key: "school",
        label: { zh: "流派", en: "School" },
        type: "enum",
        unit: "",
        enumValues: ["tide", "bell"],
        defaultValue: "tide",
        description: "Listening school.",
      },
      {
        key: "motto",
        label: { zh: "铭言", en: "Motto" },
        type: "text",
        unit: "",
        enumValues: [],
        description: "",
      },
    ],
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function sampleAbility(
  overrides: Partial<AbilityTemplate> = {},
): AbilityTemplate {
  return {
    id: "ability_chime",
    universeId: UNIVERSE_ID,
    ruleSystemId: "rules_tide",
    name: { zh: "深钟共鸣", en: "Deep Chime" },
    summary: { zh: "放大钟声", en: "Amplifies bell echo" },
    tierId: "tier_2",
    effects: [{ attributeKey: "resonance", operation: "add", value: 15 }],
    cost: "1 memory",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function sampleItem(
  overrides: Partial<ItemStatTemplate> = {},
): ItemStatTemplate {
  return {
    id: "item_key",
    universeId: UNIVERSE_ID,
    ruleSystemId: "rules_tide",
    name: { zh: "缺齿铜钥", en: "Notched Brass Key" },
    category: { zh: "遗物", en: "Relic" },
    summary: { zh: "稳定共鸣", en: "Stabilizes resonance" },
    tierId: "tier_1",
    stats: [{ attributeKey: "resonance", operation: "add", value: 5 }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function workspaceWithRules(): StudioWorkspace {
  const workspace = createDemoWorkspace("en", NOW);
  const activeSystem = sampleRuleSystem();
  const draftSystem = sampleRuleSystem({
    id: "rules_draft",
    title: { zh: "草稿属性", en: "Draft Attributes" },
    kind: "attribute",
    unit: "",
    tiers: [],
    status: "draft",
  });
  workspace.ruleSystems.push(activeSystem, draftSystem);
  workspace.abilityTemplates.push(sampleAbility());
  workspace.itemStatTemplates.push(sampleItem());
  workspace.characters[0]!.ruleBindings = [
    {
      ruleSystemId: activeSystem.id,
      tierId: "tier_2",
      attributes: { resonance: 64, school: "bell", motto: "Listen" },
      abilityIds: ["ability_chime"],
    },
  ];
  workspace.storyObjects[0]!.ruleBinding = {
    ruleSystemId: activeSystem.id,
    itemStatTemplateId: "item_key",
    tierId: "tier_1",
    stats: [{ attributeKey: "resonance", operation: "add", value: 8 }],
  };
  return workspace;
}

describe("RuleSystemModal, AbilityTemplateModal and ItemStatTemplateModal", () => {
  test("creates and edits a structured rule system with tiers and typed attributes", () => {
    const onSave = mock((_system: RuleSystem) => true);
    const onClose = mock(() => {});
    const view = render(
      <RuleSystemModal
        open
        onClose={onClose}
        t={t}
        locale="en"
        universeId={UNIVERSE_ID}
        onSave={onSave}
      />,
    );

    const saveBtn = view.getByRole("button", {
      name: t("save"),
    }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Fill title, unit, summary
    const zhTitle = view.getByLabelText(t("titleZh")) as HTMLInputElement;
    const enTitle = view.getByLabelText(t("titleEn")) as HTMLInputElement;
    const kindSelect = view.getByLabelText(
      t("rulesSystemKind"),
    ) as HTMLSelectElement;
    const unitInput = view.getByLabelText(t("rulesUnit"), {
      exact: false,
    }) as HTMLInputElement;
    const summaryInput = view.getByLabelText(
      t("rulesSummary"),
    ) as HTMLTextAreaElement;

    fireEvent.change(zhTitle, { target: { value: "潮汐体系" } });
    fireEvent.change(enTitle, { target: { value: "Tide Ladder" } });
    fireEvent.change(kindSelect, { target: { value: "power" } });
    fireEvent.change(unitInput, { target: { value: "level" } });
    fireEvent.change(summaryInput, { target: { value: "Ordered tide tiers" } });

    // Add a third tier and remove it to exercise add/remove handlers
    fireEvent.click(view.getByRole("button", { name: t("rulesAddTier") }));
    const removeTierButtons = view.getAllByRole("button", {
      name: t("rulesRemoveTier"),
    });
    expect(removeTierButtons.length).toBe(3);
    fireEvent.click(removeTierButtons[2]!);

    // Fill both tiers
    const tierZhInputs = view.getAllByPlaceholderText(
      t("nameZh"),
    ) as HTMLInputElement[];
    const tierEnInputs = view.getAllByPlaceholderText(
      t("nameEn"),
    ) as HTMLInputElement[];
    const minInputs = view.getAllByLabelText(
      t("rulesTierMin"),
    ) as HTMLInputElement[];
    const maxInputs = view.getAllByLabelText(
      t("rulesTierMax"),
    ) as HTMLInputElement[];
    const tierSummaryInputs = view.getAllByLabelText(
      t("rulesTierSummary"),
    ) as HTMLInputElement[];

    fireEvent.change(tierZhInputs[0]!, { target: { value: "一阶" } });
    fireEvent.change(tierEnInputs[0]!, { target: { value: "Tier One" } });
    fireEvent.change(minInputs[0]!, { target: { value: "1" } });
    fireEvent.change(maxInputs[0]!, { target: { value: "10" } });
    fireEvent.change(tierSummaryInputs[0]!, { target: { value: "Novice" } });

    fireEvent.change(tierZhInputs[1]!, { target: { value: "二阶" } });
    fireEvent.change(tierEnInputs[1]!, { target: { value: "Tier Two" } });
    fireEvent.change(minInputs[1]!, { target: { value: "11" } });
    fireEvent.change(maxInputs[1]!, { target: { value: "20" } });
    fireEvent.change(tierSummaryInputs[1]!, { target: { value: "Adept" } });

    // Add two attributes: one integer, one enum, plus a third removed
    const addAttrBtn = view.getByRole("button", {
      name: t("rulesAddAttribute"),
    });
    fireEvent.click(addAttrBtn);
    fireEvent.click(addAttrBtn);
    fireEvent.click(addAttrBtn);

    const removeAttrButtons = view.getAllByRole("button", {
      name: t("rulesRemoveAttribute"),
    });
    expect(removeAttrButtons.length).toBe(3);
    fireEvent.click(removeAttrButtons[2]!);

    const attrKeyInputs = view.getAllByLabelText(
      t("cardsFieldKey"),
    ) as HTMLInputElement[];
    const attrNameZh = view.getAllByLabelText(
      t("nameZh"),
    ) as HTMLInputElement[];
    const attrNameEn = view.getAllByLabelText(
      t("nameEn"),
    ) as HTMLInputElement[];
    const attrTypeSelects = view.getAllByLabelText(
      t("cardsFieldType"),
    ) as HTMLSelectElement[];
    const attrUnitInputs = view.getAllByLabelText(
      t("cardsFieldUnit"),
    ) as HTMLInputElement[];
    const attrDefaultInputs = view.getAllByLabelText(
      t("cardsFieldDefault"),
    ) as HTMLInputElement[];
    const attrDescInputs = view.getAllByLabelText(
      t("rulesAttributeDesc"),
    ) as HTMLInputElement[];

    // Attribute 1: integer resonance
    fireEvent.change(attrKeyInputs[0]!, { target: { value: "resonance" } });
    fireEvent.change(attrNameZh[0]!, { target: { value: "共鸣" } });
    fireEvent.change(attrNameEn[0]!, { target: { value: "Resonance" } });
    fireEvent.change(attrUnitInputs[0]!, { target: { value: "pt" } });
    const attrMins = view.getAllByLabelText(
      t("cardsFieldMin"),
    ) as HTMLInputElement[];
    const attrMaxs = view.getAllByLabelText(
      t("cardsFieldMax"),
    ) as HTMLInputElement[];
    fireEvent.change(attrMins[0]!, { target: { value: "0" } });
    fireEvent.change(attrMaxs[0]!, { target: { value: "100" } });
    fireEvent.change(attrDefaultInputs[0]!, { target: { value: "10" } });
    fireEvent.change(attrDescInputs[0]!, { target: { value: "Bell power" } });

    // Attribute 2: enum school
    fireEvent.change(attrKeyInputs[1]!, { target: { value: "school" } });
    fireEvent.change(attrNameZh[1]!, { target: { value: "流派" } });
    fireEvent.change(attrNameEn[1]!, { target: { value: "School" } });
    fireEvent.change(attrTypeSelects[1]!, { target: { value: "enum" } });
    const enumInput = view.getByLabelText(
      t("cardsFieldEnum"),
    ) as HTMLInputElement;
    fireEvent.change(enumInput, { target: { value: "tide, bell" } });
    fireEvent.change(attrDefaultInputs[1]!, { target: { value: "tide" } });

    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    const saved = onSave.mock.calls[0]![0];
    expect(saved.status).toBe("draft");
    expect(saved.version).toBe(1);
    expect(saved.tiers).toHaveLength(2);
    expect(saved.attributes).toHaveLength(2);
    expect(saved.attributes[1]!.enumValues).toEqual(["tide", "bell"]);

    // Edit existing system and verify version bump
    view.unmount();
    const onSaveEdit = mock((_system: RuleSystem) => true);
    const editView = render(
      <RuleSystemModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        universeId={UNIVERSE_ID}
        initial={saved}
        onSave={onSaveEdit}
      />,
    );
    fireEvent.change(editView.getByLabelText(t("rulesSummary")), {
      target: { value: "Updated ladder summary" },
    });
    fireEvent.click(editView.getByRole("button", { name: t("save") }));
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit.mock.calls[0]![0].version).toBe(2);
  });

  test("creates and edits ability and item stat templates with EffectsEditor", () => {
    const system = sampleRuleSystem();
    const onSaveAbility = mock((_ability: AbilityTemplate) => true);
    const abilityView = render(
      <AbilityTemplateModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        system={system}
        onSave={onSaveAbility}
      />,
    );

    fireEvent.change(abilityView.getByLabelText(t("nameZh")), {
      target: { value: "钟鸣" },
    });
    fireEvent.change(abilityView.getByLabelText(t("nameEn")), {
      target: { value: "Bell Toll" },
    });
    fireEvent.change(abilityView.getByLabelText(t("rulesSelectTier")), {
      target: { value: "tier_1" },
    });
    fireEvent.change(abilityView.getByLabelText(t("rulesAbilityCost")), {
      target: { value: "5 pt" },
    });
    fireEvent.change(abilityView.getByLabelText(t("summaryZh")), {
      target: { value: "震慑" },
    });
    fireEvent.change(abilityView.getByLabelText(t("summaryEn")), {
      target: { value: "Stuns nearby foes" },
    });

    // Add two effects, test invalid set value > max, then fix & remove second
    const addEffectBtn = abilityView.getByRole("button", {
      name: t("rulesAddEffect"),
    });
    fireEvent.click(addEffectBtn);
    fireEvent.click(addEffectBtn);

    const opSelects = abilityView.getAllByLabelText(
      t("rulesEffectOperation"),
    ) as HTMLSelectElement[];
    const valInputs = abilityView.getAllByLabelText(
      t("rulesEffectValue"),
    ) as HTMLInputElement[];
    const attrSelects = abilityView.getAllByLabelText(
      t("rulesEffectAttribute"),
    ) as HTMLSelectElement[];

    fireEvent.change(attrSelects[0]!, { target: { value: "resonance" } });
    fireEvent.change(opSelects[0]!, { target: { value: "set" } });
    fireEvent.change(valInputs[0]!, { target: { value: "999" } });
    expect(
      (
        abilityView.getByRole("button", {
          name: t("save"),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // Fix value and remove second row
    fireEvent.change(opSelects[0]!, { target: { value: "multiply" } });
    fireEvent.change(valInputs[0]!, { target: { value: "1.5" } });
    const removeEffectBtns = abilityView.getAllByRole("button", {
      name: t("rulesRemoveEffect"),
    });
    fireEvent.click(removeEffectBtns[1]!);

    fireEvent.click(abilityView.getByRole("button", { name: t("save") }));
    expect(onSaveAbility).toHaveBeenCalledTimes(1);
    expect(onSaveAbility.mock.calls[0]![0].effects).toEqual([
      { attributeKey: "resonance", operation: "multiply", value: 1.5 },
    ]);
    abilityView.unmount();

    // ItemStatTemplateModal create & edit + empty numeric attributes hint
    const onSaveItem = mock((_item: ItemStatTemplate) => true);
    const itemView = render(
      <ItemStatTemplateModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        system={system}
        onSave={onSaveItem}
      />,
    );
    fireEvent.change(itemView.getByLabelText(t("nameZh")), {
      target: { value: "铜铃" },
    });
    fireEvent.change(itemView.getByLabelText(t("nameEn")), {
      target: { value: "Brass Bell" },
    });
    fireEvent.change(itemView.getByLabelText(t("storyObjectCategoryZh")), {
      target: { value: "法器" },
    });
    fireEvent.change(itemView.getByLabelText(t("storyObjectCategoryEn")), {
      target: { value: "Artifact" },
    });
    fireEvent.change(itemView.getByLabelText(t("rulesSelectTier")), {
      target: { value: "tier_2" },
    });
    fireEvent.change(itemView.getByLabelText(t("summaryZh")), {
      target: { value: "增强共鸣" },
    });
    fireEvent.change(itemView.getByLabelText(t("summaryEn")), {
      target: { value: "Boosts resonance" },
    });
    fireEvent.click(
      itemView.getByRole("button", { name: t("rulesAddEffect") }),
    );
    fireEvent.click(itemView.getByRole("button", { name: t("save") }));
    expect(onSaveItem).toHaveBeenCalledTimes(1);
    expect(onSaveItem.mock.calls[0]![0].category.en).toBe("Artifact");
    itemView.unmount();

    // System with no numeric attributes shows hint
    const textOnlySystem = sampleRuleSystem({
      attributes: [sampleRuleSystem().attributes[2]!],
    });
    const noNumericView = render(
      <AbilityTemplateModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        system={textOnlySystem}
        onSave={() => true}
      />,
    );
    expect(noNumericView.getByText(t("rulesNoNumericAttrHint"))).toBeTruthy();
  });
});

describe("WorldFoundationSkillModal", () => {
  test("runs world.foundation skill from draft through validation, review and registration", async () => {
    const workspace = createDemoWorkspace("en", NOW);
    const prevAiConfig = bridge.aiConfig;
    const prevRunAi = bridge.runAi;
    const prevCancelAi = bridge.cancelAi;
    const prevConfirm = window.confirm;

    let aiResponse = JSON.stringify({
      standards: [
        {
          key: "std-tide",
          kind: "continuity",
          title: { zh: "潮钟铁律", en: "Tide Bell Law" },
          body: { zh: "钟鸣必有代价。", en: "Every toll demands a price." },
        },
      ],
      ruleSystem: {
        key: "tide-ranks",
        title: { zh: "潮鸣阶位", en: "Tide Resonance Ranks" },
        kind: "power",
        unit: "level",
        summary: "Numeric resonance ladder",
        tiers: [
          {
            key: "tier-1",
            name: { zh: "初响", en: "First Chime" },
            rank: 1,
            minValue: 1,
            maxValue: 9,
            summary: "Apprentice",
          },
          {
            key: "tier-2",
            name: { zh: "深钟", en: "Deep Bell" },
            rank: 2,
            minValue: 10,
            maxValue: 20,
            summary: "Master",
          },
        ],
        attributes: [
          {
            key: "resonance",
            label: { zh: "共鸣", en: "Resonance" },
            type: "integer",
            unit: "pt",
            min: 0,
            max: 100,
            enumValues: [],
            defaultValue: 10,
            description: "Bell resonance",
          },
        ],
      },
      abilities: [
        {
          key: "ab-echo",
          name: { zh: "回响斩", en: "Echo Slash" },
          summary: { zh: "共鸣冲击", en: "Resonance strike" },
          tierKey: "tier-2",
          cost: "10 pt",
          effects: [{ attributeKey: "resonance", operation: "add", value: 12 }],
        },
      ],
      items: [
        {
          key: "it-key",
          name: { zh: "铜钥", en: "Brass Key" },
          category: { zh: "遗物", en: "Relic" },
          summary: { zh: "稳定共鸣", en: "Steadies resonance" },
          tierKey: "tier-1",
          stats: [{ attributeKey: "resonance", operation: "add", value: 5 }],
        },
      ],
      notes: "Review ranges before activating.",
    });

    bridge.aiConfig = async () => ({
      configured: false,
      endpoint: "",
      model: "",
    });
    bridge.runAi = async () => ({
      text: aiResponse,
      model: "mock-model",
      endpoint: "https://example.test",
    });
    bridge.cancelAi = async () => {};
    window.confirm = () => true;

    try {
      const committed: StudioWorkspace[] = [];
      const onClose = mock(() => {});
      const view = render(
        <WorldFoundationSkillModal
          open
          onClose={onClose}
          t={t}
          locale="en"
          workspace={workspace}
          universeId={UNIVERSE_ID}
          onCommitWorkspace={(next) => {
            committed.push(next);
            return true;
          }}
        />,
      );

      // 1. Unconfigured AI shows setup prompt
      fireEvent.click(
        view.getByRole("button", { name: t("rulesSkillRunAction") }),
      );
      await waitFor(() =>
        expect(view.getByText(t("foundationNeedModel"))).toBeTruthy(),
      );

      // 2. Configured AI returning malformed JSON displays validation issues
      bridge.aiConfig = async () => ({
        configured: true,
        endpoint: "https://example.test/v1/chat/completions",
        model: "mock-model",
      });
      const validPayload = aiResponse;
      aiResponse = "{ invalid json";
      fireEvent.click(
        view.getByRole("button", { name: t("rulesSkillRunAction") }),
      );
      await waitFor(() =>
        expect(view.getByText(t("rulesSkillIssuesTitle"))).toBeTruthy(),
      );

      // 3. Valid output enters review step; toggle checkboxes and register
      aiResponse = validPayload;
      fireEvent.click(
        view.getByRole("button", { name: t("rulesSkillRunAction") }),
      );
      await waitFor(() =>
        expect(view.getByText(t("rulesSkillReviewLead"))).toBeTruthy(),
      );
      expect(view.getByText("Review ranges before activating.")).toBeTruthy();

      const checkboxes = view.getAllByRole("checkbox") as HTMLInputElement[];
      expect(checkboxes.length).toBe(4);
      // Toggle standard off and back on, toggle item off
      fireEvent.click(checkboxes[0]!);
      fireEvent.click(checkboxes[0]!);
      fireEvent.click(checkboxes[3]!);

      fireEvent.click(
        view.getByRole("button", { name: t("rulesSkillRegisterAction") }),
      );
      expect(committed).toHaveLength(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      const next = committed[0]!;
      expect(next.ruleSystems).toHaveLength(1);
      expect(next.ruleSystems[0]!.status).toBe("draft");
      expect(next.abilityTemplates).toHaveLength(1);
      expect(next.itemStatTemplates).toHaveLength(0);
    } finally {
      bridge.aiConfig = prevAiConfig;
      bridge.runAi = prevRunAi;
      bridge.cancelAi = prevCancelAi;
      window.confirm = prevConfirm;
    }
  });
});

describe("CharacterModal rule bindings", () => {
  test("adds, edits and saves a character rule binding with tier, typed attributes and abilities", () => {
    const workspace = workspaceWithRules();
    const onSave = mock((_character: Character) => true);
    const char = workspace.characters[1]!; // Shen, no bindings yet
    const view = render(
      <CharacterModal
        open
        onClose={() => {}}
        t={t}
        locale="en"
        workspace={workspace}
        defaultUniverseId={UNIVERSE_ID}
        initial={char}
        onSave={onSave}
      />,
    );

    const addBinding = view.getByLabelText(
      t("rulesAddBinding"),
    ) as HTMLSelectElement;
    fireEvent.change(addBinding, { target: { value: "rules_tide" } });

    const tierSelect = view.getByLabelText(
      t("rulesSelectTier"),
    ) as HTMLSelectElement;
    fireEvent.change(tierSelect, { target: { value: "tier_1" } });

    const resonanceInput = view.getByLabelText(
      /Resonance/i,
    ) as HTMLInputElement;
    fireEvent.change(resonanceInput, { target: { value: "42" } });

    const schoolSelect = view.getByLabelText(/School/i) as HTMLSelectElement;
    fireEvent.change(schoolSelect, { target: { value: "bell" } });

    const abilityCheckbox = view.getByRole("checkbox", {
      name: /Deep Chime/i,
    }) as HTMLInputElement;
    fireEvent.click(abilityCheckbox);

    fireEvent.click(view.getByRole("button", { name: t("save") }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0];
    expect(saved.ruleBindings).toEqual([
      {
        ruleSystemId: "rules_tide",
        tierId: "tier_1",
        attributes: { resonance: 42, school: "bell" },
        abilityIds: ["ability_chime"],
      },
    ]);
  });
});

describe("FoundationView standards and structured rules modes", () => {
  test("switches between prose standards and structured rules, manages rule items and runs consistency audit", async () => {
    const workspace = workspaceWithRules();
    workspace.works[0]!.chapters[0]!.content =
      "The enemy reached 35 level with Resonance 150 pt.";
    const onNewStandard = mock(() => {});
    const onEditStandard = mock((_s: WorkspaceStandard) => {});
    const onStatusChange = mock(
      (_s: WorkspaceStandard, _status: StandardStatus) => {},
    );
    const onRegisterCandidates = mock(() => {});
    const onOpenWorkflow = mock(() => {});
    const onOpenSettings = mock(() => {});
    const onNewRuleSystem = mock(() => {});
    const onEditRuleSystem = mock((_s: RuleSystem) => {});
    const onRuleSystemStatusChange = mock(
      (_s: RuleSystem, _status: RuleStatus) => {},
    );
    const onDeleteRuleSystem = mock((_s: RuleSystem) => {});
    const onNewAbility = mock((_id: string) => {});
    const onEditAbility = mock((_a: AbilityTemplate) => {});
    const onDeleteAbility = mock((_a: AbilityTemplate) => {});
    const onNewItemTemplate = mock((_id: string) => {});
    const onEditItemTemplate = mock((_i: ItemStatTemplate) => {});
    const onDeleteItemTemplate = mock((_i: ItemStatTemplate) => {});
    const onOpenFoundationSkill = mock(() => {});

    const prevAiConfig = bridge.aiConfig;
    const prevRunAi = bridge.runAi;
    const prevCancelAi = bridge.cancelAi;
    const prevCopyText = bridge.copyText;
    const prevConfirm = window.confirm;
    bridge.aiConfig = async () => ({
      configured: true,
      endpoint: "https://example.test/v1/chat/completions",
      model: "mock-model",
    });
    bridge.runAi = async () => ({
      text: JSON.stringify([
        {
          kind: "style",
          title: { zh: "潮声文风", en: "Harbor Cadence" },
          body: { zh: "短句留白。", en: "Keep sentences crisp." },
        },
      ]),
      model: "mock-model",
      endpoint: "https://example.test",
    });
    bridge.cancelAi = async () => {};
    bridge.copyText = async () => {};
    window.confirm = () => true;

    try {
      const view = render(
        <FoundationView
          workspace={workspace}
          locale="en"
          t={t}
          aiInfo={{
            configured: true,
            endpoint: "https://example.test",
            model: "mock-model",
          }}
          universeId={UNIVERSE_ID}
          onNewStandard={onNewStandard}
          onEditStandard={onEditStandard}
          onStatusChange={onStatusChange}
          onRegisterCandidates={onRegisterCandidates}
          onOpenWorkflow={onOpenWorkflow}
          onOpenSettings={onOpenSettings}
          onNewRuleSystem={onNewRuleSystem}
          onEditRuleSystem={onEditRuleSystem}
          onRuleSystemStatusChange={onRuleSystemStatusChange}
          onDeleteRuleSystem={onDeleteRuleSystem}
          onNewAbility={onNewAbility}
          onEditAbility={onEditAbility}
          onDeleteAbility={onDeleteAbility}
          onNewItemTemplate={onNewItemTemplate}
          onEditItemTemplate={onEditItemTemplate}
          onDeleteItemTemplate={onDeleteItemTemplate}
          onOpenFoundationSkill={onOpenFoundationSkill}
        />,
      );

      // Standards mode: search, filter, select row, edit/disable/copy, draft candidate review & register
      const stdSearch = view.getByLabelText(
        t("foundationSearchLabel"),
      ) as HTMLInputElement;
      fireEvent.change(stdSearch, { target: { value: "no-match-xyz" } });
      expect(view.getByText(t("foundationNoMatch"))).toBeTruthy();
      fireEvent.change(stdSearch, { target: { value: "" } });

      fireEvent.click(
        view.getByRole("button", { name: /Canon vs\. proposal separation/i }),
      );
      fireEvent.click(view.getByRole("button", { name: t("edit") }));
      expect(onEditStandard).toHaveBeenCalledTimes(1);
      fireEvent.click(
        view.getByRole("button", { name: t("foundationDisable") }),
      );
      expect(onStatusChange).toHaveBeenCalledTimes(1);
      fireEvent.click(
        view.getByRole("button", { name: t("foundationCopyBody") }),
      );

      fireEvent.click(
        view.getByRole("button", { name: t("foundationNewStandardShort") }),
      );
      expect(onNewStandard).toHaveBeenCalledTimes(1);

      fireEvent.click(
        view.getByRole("button", { name: t("foundationDraftAction") }),
      );
      await waitFor(() =>
        expect(view.getByText("Harbor Cadence")).toBeTruthy(),
      );
      const candidateBox = view.getByRole("checkbox") as HTMLInputElement;
      fireEvent.click(candidateBox);
      fireEvent.click(
        view.getByRole("button", { name: t("foundationSelectAll") }),
      );
      fireEvent.click(
        view.getByRole("button", { name: t("foundationClearAll") }),
      );
      fireEvent.click(
        view.getByRole("button", { name: t("foundationSelectAll") }),
      );
      fireEvent.click(
        view.getByRole("button", {
          name: t("foundationRegisterSelected", { count: 1 }),
        }),
      );
      expect(onRegisterCandidates).toHaveBeenCalledTimes(1);

      // Switch to Structured Rules mode
      fireEvent.click(
        view.getByRole("tab", {
          name: new RegExp(t("rulesTabStructured"), "i"),
        }),
      );

      // Header actions
      fireEvent.click(view.getByRole("button", { name: t("rulesNewSystem") }));
      expect(onNewRuleSystem).toHaveBeenCalledTimes(1);
      fireEvent.click(
        view.getByRole("button", { name: t("rulesSkillDraftAction") }),
      );
      expect(onOpenFoundationSkill).toHaveBeenCalledTimes(1);

      // Detail pane shows active system tiers, attributes, abilities, items, bound entities
      expect(view.getAllByText(/First Chime/).length).toBeGreaterThan(0);
      expect(view.getAllByText(/Deep Chime/).length).toBeGreaterThan(0);
      expect(view.getAllByText(/Notched Brass Key/).length).toBeGreaterThan(0);
      expect(
        view.getByText(
          workspace.characters[0]!.name.en || workspace.characters[0]!.name.zh,
        ),
      ).toBeTruthy();

      // Template & system actions
      fireEvent.click(view.getByRole("button", { name: t("rulesAddAbility") }));
      expect(onNewAbility).toHaveBeenCalledWith("rules_tide");
      fireEvent.click(
        view.getByRole("button", { name: t("rulesEditAbility") }),
      );
      expect(onEditAbility).toHaveBeenCalledTimes(1);
      fireEvent.click(
        view.getByRole("button", { name: t("rulesDeleteAbility") }),
      );
      expect(onDeleteAbility).toHaveBeenCalledTimes(1);

      fireEvent.click(view.getByRole("button", { name: t("rulesAddItem") }));
      expect(onNewItemTemplate).toHaveBeenCalledWith("rules_tide");
      fireEvent.click(view.getByRole("button", { name: t("rulesEditItem") }));
      expect(onEditItemTemplate).toHaveBeenCalledTimes(1);
      fireEvent.click(view.getByRole("button", { name: t("rulesDeleteItem") }));
      expect(onDeleteItemTemplate).toHaveBeenCalledTimes(1);

      fireEvent.click(view.getByRole("button", { name: t("edit") }));
      expect(onEditRuleSystem).toHaveBeenCalledTimes(1);
      fireEvent.click(
        view.getByRole("button", { name: t("foundationDisable") }),
      );
      expect(onRuleSystemStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rules_tide" }),
        "disabled",
      );
      fireEvent.click(view.getByRole("button", { name: t("delete") }));
      expect(onDeleteRuleSystem).toHaveBeenCalledTimes(1);

      // Consistency panel catches workspace chapter out-of-range numbers AND pasted draft text
      expect(view.getByText(/35 level is outside/i)).toBeTruthy();
      expect(
        view.getByText(/Resonance \(150 pt\) exceeds maximum 100/i),
      ).toBeTruthy();

      const auditInput = view.getByLabelText(
        t("rulesConsistencyDraftLabel"),
      ) as HTMLTextAreaElement;
      fireEvent.change(auditInput, {
        target: { value: "Hero reaches 99 level." },
      });
      expect(view.getByText(/99 level is outside/i)).toBeTruthy();
      fireEvent.click(
        view.getByRole("button", { name: t("rulesConsistencyClearDraft") }),
      );
      expect(auditInput.value).toBe("");

      // Filter and select the draft system to verify activate action
      const tablists = view.getAllByRole("tablist");
      const filterTabs = tablists[1]!;
      fireEvent.click(
        within(filterTabs).getByRole("tab", {
          name: new RegExp(t("foundationStatDraft"), "i"),
        }),
      );
      fireEvent.click(view.getByText("Draft Attributes"));
      fireEvent.click(
        view.getByRole("button", { name: t("foundationActivate") }),
      );
      expect(onRuleSystemStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rules_draft" }),
        "active",
      );

      // Search filters out everything
      const ruleSearch = view.getByLabelText(
        t("rulesSearchLabel"),
      ) as HTMLInputElement;
      fireEvent.change(ruleSearch, { target: { value: "nonexistent-rule" } });
      expect(view.getByText(t("rulesEmptyTitle"))).toBeTruthy();

      // Switch back to standards tab & render unconfigured global view
      fireEvent.click(
        view.getByRole("tab", {
          name: new RegExp(t("rulesTabProse"), "i"),
        }),
      );
      view.unmount();

      const emptyWorkspace: StudioWorkspace = {
        ...createDemoWorkspace("en", NOW),
        standards: [],
      };
      const globalView = render(
        <FoundationView
          workspace={emptyWorkspace}
          locale="en"
          t={t}
          aiInfo={null}
          onNewStandard={onNewStandard}
          onEditStandard={onEditStandard}
          onStatusChange={onStatusChange}
          onRegisterCandidates={onRegisterCandidates}
          onOpenWorkflow={onOpenWorkflow}
          onOpenSettings={onOpenSettings}
        />,
      );
      fireEvent.click(
        globalView.getByRole("button", { name: t("openModelSettings") }),
      );
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    } finally {
      bridge.aiConfig = prevAiConfig;
      bridge.runAi = prevRunAi;
      bridge.cancelAi = prevCancelAi;
      bridge.copyText = prevCopyText;
      window.confirm = prevConfirm;
    }
  });
});
