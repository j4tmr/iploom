import { useEffect, useMemo, useRef, useState } from "react";
import { createId, displayText } from "../core/factory.ts";
import {
  RULE_ATTRIBUTE_TYPES,
  RULE_EFFECT_OPERATIONS,
  RULE_SYSTEM_KINDS,
  ruleAttributeTypeLabel,
  ruleEffectLabel,
  ruleSystemKindLabel,
  validateEffects,
  validateRuleSystemDefinition,
} from "../core/rule-layer.ts";
import {
  createAiSkillRun,
  registerAiSkillRun,
  reviewAiSkillRun,
  validateAiSkillOutput,
  type AiSkillRun,
} from "../core/skills.ts";
import {
  worldFoundationSkill,
  type WorldFoundationOutput,
} from "../core/skills/world-foundation.ts";
import { standardKindLabel } from "../core/standards.ts";
import {
  MAX_LOCALIZED_LENGTH,
  type AbilityTemplate,
  type ItemStatTemplate,
  type RuleAttribute,
  type RuleAttributeType,
  type RuleEffect,
  type RuleEffectOperation,
  type RuleSystem,
  type RuleSystemKind,
  type RuleTier,
  type StudioWorkspace,
  type UiLocale,
} from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import {
  Badge,
  Button,
  Field,
  FieldGrid,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "./ui.tsx";

type ModalBase = {
  open: boolean;
  onClose: () => void;
  t: Translate;
  locale: UiLocale;
};

interface TierDraft {
  uid: string;
  id: string;
  nameZh: string;
  nameEn: string;
  minValue: string;
  maxValue: string;
  summary: string;
}

interface AttributeDraft {
  uid: string;
  key: string;
  labelZh: string;
  labelEn: string;
  type: RuleAttributeType;
  unit: string;
  min: string;
  max: string;
  enumValues: string;
  defaultValue: string;
  description: string;
}

export interface EffectDraft {
  uid: string;
  attributeKey: string;
  operation: RuleEffectOperation;
  value: string;
}

function parseNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function newTierDraft(): TierDraft {
  return {
    uid: createId("tdraft"),
    id: createId("tier"),
    nameZh: "",
    nameEn: "",
    minValue: "",
    maxValue: "",
    summary: "",
  };
}

function tierToDraft(tier: RuleTier): TierDraft {
  return {
    uid: createId("tdraft"),
    id: tier.id,
    nameZh: tier.name.zh,
    nameEn: tier.name.en,
    minValue: tier.minValue === undefined ? "" : String(tier.minValue),
    maxValue: tier.maxValue === undefined ? "" : String(tier.maxValue),
    summary: tier.summary,
  };
}

function draftToTier(draft: TierDraft, rank: number): RuleTier {
  const minValue = parseNumber(draft.minValue);
  const maxValue = parseNumber(draft.maxValue);
  return {
    id: draft.id,
    name: { zh: draft.nameZh.trim(), en: draft.nameEn.trim() },
    rank,
    ...(minValue === undefined ? {} : { minValue }),
    ...(maxValue === undefined ? {} : { maxValue }),
    summary: draft.summary.trim(),
  };
}

function newAttributeDraft(index: number): AttributeDraft {
  return {
    uid: createId("adraft"),
    key: `attr${index}`,
    labelZh: "",
    labelEn: "",
    type: "integer",
    unit: "",
    min: "",
    max: "",
    enumValues: "",
    defaultValue: "",
    description: "",
  };
}

function attributeToDraft(attribute: RuleAttribute): AttributeDraft {
  return {
    uid: createId("adraft"),
    key: attribute.key,
    labelZh: attribute.label.zh,
    labelEn: attribute.label.en,
    type: attribute.type,
    unit: attribute.unit,
    min: attribute.min === undefined ? "" : String(attribute.min),
    max: attribute.max === undefined ? "" : String(attribute.max),
    enumValues: attribute.enumValues.join(", "),
    defaultValue:
      attribute.defaultValue === undefined
        ? ""
        : String(attribute.defaultValue),
    description: attribute.description,
  };
}

function draftToAttribute(draft: AttributeDraft): RuleAttribute {
  const isNumeric = draft.type === "integer" || draft.type === "decimal";
  const min = isNumeric ? parseNumber(draft.min) : undefined;
  const max = isNumeric ? parseNumber(draft.max) : undefined;
  const enumValues =
    draft.type === "enum"
      ? draft.enumValues
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  const rawDefault = draft.defaultValue.trim();
  let defaultValue: number | string | undefined;
  if (rawDefault) {
    defaultValue = isNumeric ? parseNumber(rawDefault) : rawDefault;
  }
  return {
    key: draft.key.trim(),
    label: { zh: draft.labelZh.trim(), en: draft.labelEn.trim() },
    type: draft.type,
    unit: draft.unit.trim(),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    enumValues,
    ...(defaultValue === undefined ? {} : { defaultValue }),
    description: draft.description.trim(),
  };
}

function hasInvalidNumericInput(draft: AttributeDraft): boolean {
  if (draft.type !== "integer" && draft.type !== "decimal") return false;
  if (draft.min.trim() && parseNumber(draft.min) === undefined) return true;
  if (draft.max.trim() && parseNumber(draft.max) === undefined) return true;
  if (
    draft.defaultValue.trim() &&
    parseNumber(draft.defaultValue) === undefined
  )
    return true;
  return false;
}

export function effectsToDrafts(effects: readonly RuleEffect[]): EffectDraft[] {
  return effects.map((effect) => ({
    uid: createId("edraft"),
    attributeKey: effect.attributeKey,
    operation: effect.operation,
    value: String(effect.value),
  }));
}

export function draftsToEffects(drafts: readonly EffectDraft[]): {
  effects: RuleEffect[];
  invalidValue: boolean;
} {
  const effects: RuleEffect[] = [];
  for (const draft of drafts) {
    const value = parseNumber(draft.value);
    if (!draft.attributeKey || value === undefined)
      return { effects: [], invalidValue: true };
    effects.push({
      attributeKey: draft.attributeKey,
      operation: draft.operation,
      value,
    });
  }
  return { effects, invalidValue: false };
}

function operationLabel(op: RuleEffectOperation, t: Translate): string {
  if (op === "add") return t("rulesOpAdd");
  if (op === "set") return t("rulesOpSet");
  return t("rulesOpMultiply");
}

export function EffectsEditor({
  system,
  drafts,
  onChange,
  title,
  locale,
  t,
}: {
  system: RuleSystem;
  drafts: EffectDraft[];
  onChange: (next: EffectDraft[]) => void;
  title: string;
  locale: UiLocale;
  t: Translate;
}) {
  const numericAttributes = useMemo(
    () =>
      system.attributes.filter(
        (item) => item.type === "integer" || item.type === "decimal",
      ),
    [system.attributes],
  );
  const update = (index: number, patch: Partial<EffectDraft>) =>
    onChange(
      drafts.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  return (
    <div className="card-field-editor">
      <div className="card-field-editor-head">
        <strong>{title}</strong>
        <Button
          variant="ghost"
          icon="plus"
          disabled={!numericAttributes.length}
          onClick={() =>
            onChange([
              ...drafts,
              {
                uid: createId("edraft"),
                attributeKey: numericAttributes[0]?.key ?? "",
                operation: "add",
                value: "1",
              },
            ])
          }
        >
          {t("rulesAddEffect")}
        </Button>
      </div>
      {!numericAttributes.length ? (
        <p className="hint">{t("rulesNoNumericAttrHint")}</p>
      ) : null}
      {drafts.map((effect, index) => (
        <div className="rule-effect-row" key={effect.uid}>
          <Field label={t("rulesEffectAttribute")}>
            <Select
              value={effect.attributeKey}
              onChange={(event) =>
                update(index, { attributeKey: event.target.value })
              }
            >
              {numericAttributes.map((attribute) => (
                <option key={attribute.key} value={attribute.key}>
                  {displayText(attribute.label, locale)} ({attribute.key}
                  {attribute.unit ? ` · ${attribute.unit}` : ""})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("rulesEffectOperation")}>
            <Select
              value={effect.operation}
              onChange={(event) =>
                update(index, {
                  operation: event.target.value as RuleEffectOperation,
                })
              }
            >
              {RULE_EFFECT_OPERATIONS.map((operation) => (
                <option key={operation} value={operation}>
                  {operationLabel(operation, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("rulesEffectValue")}>
            <TextInput
              type="number"
              step="any"
              value={effect.value}
              onChange={(event) => update(index, { value: event.target.value })}
            />
          </Field>
          <Button
            variant="ghost"
            icon="trash"
            onClick={() => onChange(drafts.filter((_, at) => at !== index))}
          >
            {t("rulesRemoveEffect")}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function RuleSystemModal({
  open,
  onClose,
  t,
  locale,
  universeId,
  initial,
  onSave,
}: ModalBase & {
  universeId: string;
  initial?: RuleSystem;
  onSave: (system: RuleSystem) => boolean;
}) {
  const [titleZh, setTitleZh] = useState(initial?.title.zh ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [kind, setKind] = useState<RuleSystemKind>(initial?.kind ?? "power");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    initial
      ? [...initial.tiers].sort((a, b) => a.rank - b.rank).map(tierToDraft)
      : [newTierDraft(), newTierDraft()],
  );
  const [attributes, setAttributes] = useState<AttributeDraft[]>(() =>
    initial ? initial.attributes.map(attributeToDraft) : [],
  );

  const builtTiers = useMemo(
    () => tiers.map((tier, index) => draftToTier(tier, index + 1)),
    [tiers],
  );
  const builtAttributes = useMemo(
    () => attributes.map(draftToAttribute),
    [attributes],
  );
  const badTierNumber = tiers.some(
    (tier) =>
      (tier.minValue.trim() && parseNumber(tier.minValue) === undefined) ||
      (tier.maxValue.trim() && parseNumber(tier.maxValue) === undefined),
  );
  const badAttrNumber = attributes.some(hasInvalidNumericInput);
  const semanticIssues = useMemo(
    () =>
      validateRuleSystemDefinition({
        kind,
        tiers: builtTiers,
        attributes: builtAttributes,
      }),
    [kind, builtTiers, builtAttributes],
  );
  const named = Boolean(titleZh.trim() || titleEn.trim());
  const canSave =
    named && !badTierNumber && !badAttrNumber && semanticIssues.length === 0;

  const updateTier = (index: number, patch: Partial<TierDraft>) =>
    setTiers((current) =>
      current.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  const updateAttribute = (index: number, patch: Partial<AttributeDraft>) =>
    setAttributes((current) =>
      current.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={initial ? t("rulesEditSystem") : t("rulesNewSystem")}
      description={t("rulesEmptyLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const nextTitle = { zh: titleZh.trim(), en: titleEn.trim() };
              const nextSummary = summary.trim();
              const nextUnit = unit.trim();
              const contentChanged = initial
                ? nextTitle.zh !== initial.title.zh ||
                  nextTitle.en !== initial.title.en ||
                  kind !== initial.kind ||
                  nextSummary !== initial.summary ||
                  nextUnit !== initial.unit ||
                  JSON.stringify(builtTiers) !==
                    JSON.stringify(initial.tiers) ||
                  JSON.stringify(builtAttributes) !==
                    JSON.stringify(initial.attributes)
                : false;
              const saved = onSave({
                id: initial?.id ?? createId("rules"),
                universeId: initial?.universeId ?? universeId,
                title: nextTitle,
                kind,
                summary: nextSummary,
                unit: nextUnit,
                tiers: builtTiers,
                attributes: builtAttributes,
                status: initial?.status ?? "draft",
                version: initial
                  ? initial.version + (contentChanged ? 1 : 0)
                  : 1,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("titleZh")}>
          <TextInput
            autoFocus
            maxLength={MAX_LOCALIZED_LENGTH}
            value={titleZh}
            onChange={(event) => setTitleZh(event.target.value)}
          />
        </Field>
        <Field label={t("titleEn")}>
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={titleEn}
            onChange={(event) => setTitleEn(event.target.value)}
          />
        </Field>
        <Field label={t("rulesSystemKind")}>
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as RuleSystemKind)}
          >
            {RULE_SYSTEM_KINDS.map((value) => (
              <option key={value} value={value}>
                {ruleSystemKindLabel(value, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("rulesUnit")} hint={t("rulesUnitHint")}>
          <TextInput
            maxLength={40}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
        </Field>
        <Field label={t("rulesSummary")} wide>
          <TextArea
            rows={2}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </Field>
      </FieldGrid>

      <div className="card-field-editor">
        <div className="card-field-editor-head">
          <strong>{t("rulesTiersTitle")}</strong>
          <Button
            variant="ghost"
            icon="plus"
            onClick={() => setTiers((current) => [...current, newTierDraft()])}
          >
            {t("rulesAddTier")}
          </Button>
        </div>
        {tiers.length === 0 ? (
          <p className="hint">{t("rulesNoTiers")}</p>
        ) : null}
        {tiers.map((tier, index) => (
          <div className="card-field-row" key={tier.uid}>
            <Field label={`${t("rulesTierRank")} #${index + 1}`}>
              <TextInput
                value={tier.nameZh}
                maxLength={MAX_LOCALIZED_LENGTH}
                placeholder={t("nameZh")}
                onChange={(event) =>
                  updateTier(index, { nameZh: event.target.value })
                }
              />
            </Field>
            <Field label={t("nameEn")}>
              <TextInput
                value={tier.nameEn}
                maxLength={MAX_LOCALIZED_LENGTH}
                placeholder={t("nameEn")}
                onChange={(event) =>
                  updateTier(index, { nameEn: event.target.value })
                }
              />
            </Field>
            <Field label={t("rulesTierMin")}>
              <TextInput
                type="number"
                step="any"
                value={tier.minValue}
                onChange={(event) =>
                  updateTier(index, { minValue: event.target.value })
                }
              />
            </Field>
            <Field label={t("rulesTierMax")}>
              <TextInput
                type="number"
                step="any"
                value={tier.maxValue}
                onChange={(event) =>
                  updateTier(index, { maxValue: event.target.value })
                }
              />
            </Field>
            <Field label={t("rulesTierSummary")} wide>
              <TextInput
                value={tier.summary}
                onChange={(event) =>
                  updateTier(index, { summary: event.target.value })
                }
              />
            </Field>
            <Button
              variant="ghost"
              icon="trash"
              onClick={() =>
                setTiers((current) => current.filter((_, at) => at !== index))
              }
            >
              {t("rulesRemoveTier")}
            </Button>
          </div>
        ))}
      </div>

      <div className="card-field-editor">
        <div className="card-field-editor-head">
          <strong>{t("rulesAttributesTitle")}</strong>
          <Button
            variant="ghost"
            icon="plus"
            onClick={() =>
              setAttributes((current) => [
                ...current,
                newAttributeDraft(current.length + 1),
              ])
            }
          >
            {t("rulesAddAttribute")}
          </Button>
        </div>
        {attributes.length === 0 ? (
          <p className="hint">{t("rulesNoAttributes")}</p>
        ) : null}
        {attributes.map((attribute, index) => (
          <div className="card-field-row" key={attribute.uid}>
            <Field label={t("cardsFieldKey")}>
              <TextInput
                value={attribute.key}
                onChange={(event) =>
                  updateAttribute(index, { key: event.target.value })
                }
              />
            </Field>
            <Field label={t("nameZh")}>
              <TextInput
                value={attribute.labelZh}
                maxLength={MAX_LOCALIZED_LENGTH}
                onChange={(event) =>
                  updateAttribute(index, { labelZh: event.target.value })
                }
              />
            </Field>
            <Field label={t("nameEn")}>
              <TextInput
                value={attribute.labelEn}
                maxLength={MAX_LOCALIZED_LENGTH}
                onChange={(event) =>
                  updateAttribute(index, { labelEn: event.target.value })
                }
              />
            </Field>
            <Field label={t("cardsFieldType")}>
              <Select
                value={attribute.type}
                onChange={(event) =>
                  updateAttribute(index, {
                    type: event.target.value as RuleAttributeType,
                  })
                }
              >
                {RULE_ATTRIBUTE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ruleAttributeTypeLabel(type, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("cardsFieldUnit")}>
              <TextInput
                value={attribute.unit}
                maxLength={40}
                onChange={(event) =>
                  updateAttribute(index, { unit: event.target.value })
                }
              />
            </Field>
            {attribute.type === "integer" || attribute.type === "decimal" ? (
              <>
                <Field label={t("cardsFieldMin")}>
                  <TextInput
                    type="number"
                    step={attribute.type === "integer" ? "1" : "any"}
                    value={attribute.min}
                    onChange={(event) =>
                      updateAttribute(index, { min: event.target.value })
                    }
                  />
                </Field>
                <Field label={t("cardsFieldMax")}>
                  <TextInput
                    type="number"
                    step={attribute.type === "integer" ? "1" : "any"}
                    value={attribute.max}
                    onChange={(event) =>
                      updateAttribute(index, { max: event.target.value })
                    }
                  />
                </Field>
              </>
            ) : null}
            <Field label={t("cardsFieldDefault")}>
              <TextInput
                value={attribute.defaultValue}
                onChange={(event) =>
                  updateAttribute(index, { defaultValue: event.target.value })
                }
              />
            </Field>
            {attribute.type === "enum" ? (
              <Field label={t("cardsFieldEnum")} wide>
                <TextInput
                  value={attribute.enumValues}
                  onChange={(event) =>
                    updateAttribute(index, { enumValues: event.target.value })
                  }
                />
              </Field>
            ) : null}
            <Field label={t("rulesAttributeDesc")} wide>
              <TextInput
                value={attribute.description}
                onChange={(event) =>
                  updateAttribute(index, { description: event.target.value })
                }
              />
            </Field>
            <Button
              variant="ghost"
              icon="trash"
              onClick={() =>
                setAttributes((current) =>
                  current.filter((_, at) => at !== index),
                )
              }
            >
              {t("rulesRemoveAttribute")}
            </Button>
          </div>
        ))}
      </div>

      {badTierNumber || badAttrNumber || semanticIssues.length > 0 ? (
        <p className="form-error">
          {semanticIssues[0]?.message ?? t("cardsFieldInvalid")}
        </p>
      ) : null}
    </Modal>
  );
}

export function AbilityTemplateModal({
  open,
  onClose,
  t,
  locale,
  system,
  initial,
  onSave,
}: ModalBase & {
  system: RuleSystem;
  initial?: AbilityTemplate;
  onSave: (ability: AbilityTemplate) => boolean;
}) {
  const [nameZh, setNameZh] = useState(initial?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(initial?.name.en ?? "");
  const [summaryZh, setSummaryZh] = useState(initial?.summary.zh ?? "");
  const [summaryEn, setSummaryEn] = useState(initial?.summary.en ?? "");
  const [tierId, setTierId] = useState(initial?.tierId ?? "");
  const [cost, setCost] = useState(initial?.cost ?? "");
  const [effectDrafts, setEffectDrafts] = useState<EffectDraft[]>(() =>
    effectsToDrafts(initial?.effects ?? []),
  );
  const parsed = useMemo(() => draftsToEffects(effectDrafts), [effectDrafts]);
  const attributesByKey = useMemo(
    () => new Map(system.attributes.map((item) => [item.key, item])),
    [system.attributes],
  );
  const issues = useMemo(
    () =>
      parsed.invalidValue
        ? [{ path: ["effects"], message: t("cardsFieldInvalid") }]
        : validateEffects(parsed.effects, attributesByKey, ["effects"]),
    [parsed, attributesByKey, t],
  );
  const canSave =
    Boolean(nameZh.trim() || nameEn.trim()) && issues.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={initial ? t("rulesEditAbility") : t("rulesAddAbility")}
      description={displayText(system.title, locale)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("ability"),
                universeId: system.universeId,
                ruleSystemId: system.id,
                name: { zh: nameZh.trim(), en: nameEn.trim() },
                summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                ...(tierId ? { tierId } : {}),
                effects: parsed.effects,
                cost: cost.trim(),
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("nameZh")}>
          <TextInput
            autoFocus
            maxLength={MAX_LOCALIZED_LENGTH}
            value={nameZh}
            onChange={(event) => setNameZh(event.target.value)}
          />
        </Field>
        <Field label={t("nameEn")}>
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </Field>
        <Field label={t("rulesSelectTier")}>
          <Select
            value={tierId}
            onChange={(event) => setTierId(event.target.value)}
          >
            <option value="">{t("rulesNoTierOption")}</option>
            {[...system.tiers]
              .sort((a, b) => a.rank - b.rank)
              .map((tier) => (
                <option key={tier.id} value={tier.id}>
                  #{tier.rank} {displayText(tier.name, locale)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("rulesAbilityCost")}>
          <TextInput
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
        <Field label={t("summaryZh")} wide>
          <TextArea
            rows={2}
            maxLength={MAX_LOCALIZED_LENGTH}
            value={summaryZh}
            onChange={(event) => setSummaryZh(event.target.value)}
          />
        </Field>
        <Field label={t("summaryEn")} wide>
          <TextArea
            rows={2}
            maxLength={MAX_LOCALIZED_LENGTH}
            value={summaryEn}
            onChange={(event) => setSummaryEn(event.target.value)}
          />
        </Field>
      </FieldGrid>

      <EffectsEditor
        system={system}
        drafts={effectDrafts}
        onChange={setEffectDrafts}
        title={t("rulesEffectsTitle")}
        locale={locale}
        t={t}
      />

      {issues.length ? (
        <p className="form-error">{issues[0]!.message}</p>
      ) : null}
    </Modal>
  );
}

export function ItemStatTemplateModal({
  open,
  onClose,
  t,
  locale,
  system,
  initial,
  onSave,
}: ModalBase & {
  system: RuleSystem;
  initial?: ItemStatTemplate;
  onSave: (item: ItemStatTemplate) => boolean;
}) {
  const [nameZh, setNameZh] = useState(initial?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(initial?.name.en ?? "");
  const [categoryZh, setCategoryZh] = useState(initial?.category.zh ?? "");
  const [categoryEn, setCategoryEn] = useState(initial?.category.en ?? "");
  const [summaryZh, setSummaryZh] = useState(initial?.summary.zh ?? "");
  const [summaryEn, setSummaryEn] = useState(initial?.summary.en ?? "");
  const [tierId, setTierId] = useState(initial?.tierId ?? "");
  const [statDrafts, setStatDrafts] = useState<EffectDraft[]>(() =>
    effectsToDrafts(initial?.stats ?? []),
  );
  const parsed = useMemo(() => draftsToEffects(statDrafts), [statDrafts]);
  const attributesByKey = useMemo(
    () => new Map(system.attributes.map((item) => [item.key, item])),
    [system.attributes],
  );
  const issues = useMemo(
    () =>
      parsed.invalidValue
        ? [{ path: ["stats"], message: t("cardsFieldInvalid") }]
        : validateEffects(parsed.effects, attributesByKey, ["stats"]),
    [parsed, attributesByKey, t],
  );
  const canSave =
    Boolean(nameZh.trim() || nameEn.trim()) &&
    Boolean(categoryZh.trim() || categoryEn.trim()) &&
    issues.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={initial ? t("rulesEditItem") : t("rulesAddItem")}
      description={displayText(system.title, locale)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!canSave}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("item"),
                universeId: system.universeId,
                ruleSystemId: system.id,
                name: { zh: nameZh.trim(), en: nameEn.trim() },
                category: { zh: categoryZh.trim(), en: categoryEn.trim() },
                summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                ...(tierId ? { tierId } : {}),
                stats: parsed.effects,
                createdAt: initial?.createdAt ?? now,
                updatedAt: now,
              });
              if (saved) onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("nameZh")}>
          <TextInput
            autoFocus
            maxLength={MAX_LOCALIZED_LENGTH}
            value={nameZh}
            onChange={(event) => setNameZh(event.target.value)}
          />
        </Field>
        <Field label={t("nameEn")}>
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </Field>
        <Field label={t("storyObjectCategoryZh")}>
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={categoryZh}
            onChange={(event) => setCategoryZh(event.target.value)}
          />
        </Field>
        <Field label={t("storyObjectCategoryEn")}>
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={categoryEn}
            onChange={(event) => setCategoryEn(event.target.value)}
          />
        </Field>
        <Field label={t("rulesSelectTier")} wide>
          <Select
            value={tierId}
            onChange={(event) => setTierId(event.target.value)}
          >
            <option value="">{t("rulesNoTierOption")}</option>
            {[...system.tiers]
              .sort((a, b) => a.rank - b.rank)
              .map((tier) => (
                <option key={tier.id} value={tier.id}>
                  #{tier.rank} {displayText(tier.name, locale)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("summaryZh")} wide>
          <TextArea
            rows={2}
            maxLength={MAX_LOCALIZED_LENGTH}
            value={summaryZh}
            onChange={(event) => setSummaryZh(event.target.value)}
          />
        </Field>
        <Field label={t("summaryEn")} wide>
          <TextArea
            rows={2}
            maxLength={MAX_LOCALIZED_LENGTH}
            value={summaryEn}
            onChange={(event) => setSummaryEn(event.target.value)}
          />
        </Field>
      </FieldGrid>

      <EffectsEditor
        system={system}
        drafts={statDrafts}
        onChange={setStatDrafts}
        title={t("rulesFieldStats")}
        locale={locale}
        t={t}
      />

      {issues.length ? (
        <p className="form-error">{issues[0]!.message}</p>
      ) : null}
    </Modal>
  );
}

export function WorldFoundationSkillModal({
  open,
  onClose,
  t,
  locale,
  workspace,
  universeId,
  onCommitWorkspace,
}: ModalBase & {
  workspace: StudioWorkspace;
  universeId: string;
  onCommitWorkspace: (nextWorkspace: StudioWorkspace) => boolean;
}) {
  const universe = workspace.universes.find((item) => item.id === universeId);
  const [premise, setPremise] = useState(
    universe
      ? displayText(universe.summary, locale) ||
          displayText(universe.tagline, locale)
      : "",
  );
  const [genre, setGenre] = useState(universe?.genres.join(" / ") ?? "");
  const [tone, setTone] = useState("");
  const [powerSystem, setPowerSystem] = useState("numeric");
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [run, setRun] = useState<AiSkillRun | null>(null);
  const [selectedStandardKeys, setSelectedStandardKeys] = useState<Set<string>>(
    new Set(),
  );
  const [includeRuleSystem, setIncludeRuleSystem] = useState(false);
  const [selectedAbilityKeys, setSelectedAbilityKeys] = useState<Set<string>>(
    new Set(),
  );
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(
    new Set(),
  );
  const activeAi = useRef("");

  useEffect(
    () => () => {
      if (activeAi.current) void bridge.cancelAi(activeAi.current);
    },
    [],
  );

  const output =
    run?.status === "validated"
      ? (run.output as WorldFoundationOutput)
      : undefined;

  const toggleKey = (
    key: string,
    setKeys: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) =>
    setKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const execute = async () => {
    const info = await bridge.aiConfig().catch(() => null);
    if (!info?.configured) {
      setStatusMessage(t("foundationNeedModel"));
      return;
    }
    if (
      !window.confirm(
        t("rulesSkillConfirm", { endpoint: info.endpoint, model: info.model }),
      )
    )
      return;
    let draftRun: AiSkillRun;
    try {
      draftRun = createAiSkillRun({
        skill: worldFoundationSkill,
        workspace,
        universeId,
        locale,
        input: { premise, genre, tone, powerSystem },
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    const aiId = createId("ai");
    activeAi.current = aiId;
    setRunning(true);
    setStatusMessage(t("rulesSkillRunning"));
    try {
      const response = await bridge.runAi({
        id: aiId,
        prompt: draftRun.prompt,
        label: displayText(worldFoundationSkill.title, locale),
      });
      const validated = validateAiSkillOutput(
        { skill: worldFoundationSkill, workspace, universeId, locale },
        draftRun,
        response.text,
      );
      setRun(validated);
      if (validated.status === "validated" && validated.output) {
        const candidate = validated.output as WorldFoundationOutput;
        setSelectedStandardKeys(
          new Set(candidate.standards.map((item) => item.key)),
        );
        setIncludeRuleSystem(Boolean(candidate.ruleSystem));
        setSelectedAbilityKeys(
          new Set(candidate.abilities.map((item) => item.key)),
        );
        setSelectedItemKeys(new Set(candidate.items.map((item) => item.key)));
        setStatusMessage("");
      } else {
        setStatusMessage(t("rulesSkillIssuesTitle"));
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      activeAi.current = "";
      setRunning(false);
    }
  };

  const canRegister =
    Boolean(output) && (selectedStandardKeys.size > 0 || includeRuleSystem);

  const registerSelection = () => {
    if (!run || !output) return;
    try {
      const context = {
        skill: worldFoundationSkill,
        workspace,
        universeId,
        locale,
      };
      const reviewed = reviewAiSkillRun(context, run, {
        acceptedStandardKeys: [...selectedStandardKeys],
        includeRuleSystem,
        acceptedAbilityKeys: includeRuleSystem ? [...selectedAbilityKeys] : [],
        acceptedItemKeys: includeRuleSystem ? [...selectedItemKeys] : [],
      });
      const registered = registerAiSkillRun(context, reviewed);
      if (onCommitWorkspace(registered.workspace)) onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const powerField = worldFoundationSkill.inputFields.find(
    (field) => field.key === "powerSystem",
  );
  const premiseField = worldFoundationSkill.inputFields.find(
    (field) => field.key === "premise",
  );
  const genreField = worldFoundationSkill.inputFields.find(
    (field) => field.key === "genre",
  );
  const toneField = worldFoundationSkill.inputFields.find(
    (field) => field.key === "tone",
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={t("rulesSkillModalTitle")}
      description={t("rulesSkillModalLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          {output ? (
            <Button
              variant="primary"
              icon="check"
              disabled={!canRegister}
              onClick={registerSelection}
            >
              {t("rulesSkillRegisterAction")}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon="sparkles"
              disabled={running || !premise.trim()}
              onClick={() => void execute()}
            >
              {running ? t("rulesSkillRunning") : t("rulesSkillRunAction")}
            </Button>
          )}
        </>
      }
    >
      {!output ? (
        <FieldGrid>
          <Field
            label={
              premiseField
                ? displayText(premiseField.label, locale)
                : t("summary")
            }
            wide
          >
            <TextArea
              rows={3}
              value={premise}
              placeholder={
                premiseField?.placeholder
                  ? displayText(premiseField.placeholder, locale)
                  : undefined
              }
              onChange={(event) => setPremise(event.target.value)}
            />
          </Field>
          <Field
            label={
              genreField ? displayText(genreField.label, locale) : t("genre")
            }
          >
            <TextInput
              value={genre}
              onChange={(event) => setGenre(event.target.value)}
            />
          </Field>
          <Field
            label={toneField ? displayText(toneField.label, locale) : "Tone"}
          >
            <TextInput
              value={tone}
              onChange={(event) => setTone(event.target.value)}
            />
          </Field>
          <Field
            label={
              powerField
                ? displayText(powerField.label, locale)
                : t("rulesSystemKind")
            }
            wide
          >
            <Select
              value={powerSystem}
              onChange={(event) => setPowerSystem(event.target.value)}
            >
              {(powerField?.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {displayText(option.label, locale)}
                </option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      ) : (
        <div className="rule-skill-review">
          <p className="foundation-candidate-lead">
            {t("rulesSkillReviewLead")}
          </p>
          <div className="foundation-candidates">
            <span className="eyebrow">{t("rulesSkillStandardsGroup")}</span>
            {output.standards.map((standard) => {
              const checked = selectedStandardKeys.has(standard.key);
              return (
                <label
                  key={standard.key}
                  className={`foundation-candidate ${checked ? "selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      toggleKey(standard.key, setSelectedStandardKeys)
                    }
                  />
                  <span>
                    <span className="foundation-candidate-top">
                      <Badge tone="violet">
                        {standardKindLabel(standard.kind, locale)}
                      </Badge>
                      <strong>{displayText(standard.title, locale)}</strong>
                    </span>
                    <span className="foundation-candidate-body">
                      {displayText(standard.body, locale)}
                    </span>
                  </span>
                </label>
              );
            })}
            {output.ruleSystem ? (
              <>
                <span className="eyebrow">{t("rulesSkillIncludeSystem")}</span>
                <label
                  className={`foundation-candidate ${includeRuleSystem ? "selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={includeRuleSystem}
                    onChange={(event) =>
                      setIncludeRuleSystem(event.target.checked)
                    }
                  />
                  <span>
                    <span className="foundation-candidate-top">
                      <Badge tone="blue">
                        {ruleSystemKindLabel(output.ruleSystem.kind, locale)}
                      </Badge>
                      <strong>
                        {displayText(output.ruleSystem.title, locale)}
                      </strong>
                    </span>
                    <span className="foundation-candidate-body">
                      {output.ruleSystem.tiers
                        .map(
                          (tier) =>
                            `#${tier.rank} ${displayText(tier.name, locale)}`,
                        )
                        .join(" → ")}
                    </span>
                  </span>
                </label>
              </>
            ) : null}
            {output.abilities.length > 0 ? (
              <>
                <span className="eyebrow">{t("rulesSkillAbilitiesGroup")}</span>
                {output.abilities.map((ability) => {
                  const checked =
                    includeRuleSystem && selectedAbilityKeys.has(ability.key);
                  return (
                    <label
                      key={ability.key}
                      className={`foundation-candidate ${checked ? "selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!includeRuleSystem}
                        checked={checked}
                        onChange={() =>
                          toggleKey(ability.key, setSelectedAbilityKeys)
                        }
                      />
                      <span>
                        <span className="foundation-candidate-top">
                          <strong>{displayText(ability.name, locale)}</strong>
                          {ability.cost ? (
                            <Badge tone="neutral">{ability.cost}</Badge>
                          ) : null}
                        </span>
                        <span className="foundation-candidate-body">
                          {ability.effects
                            .map((effect) =>
                              ruleEffectLabel(
                                effect,
                                output.ruleSystem ?? undefined,
                                locale,
                              ),
                            )
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </>
            ) : null}
            {output.items.length > 0 ? (
              <>
                <span className="eyebrow">{t("rulesSkillItemsGroup")}</span>
                {output.items.map((item) => {
                  const checked =
                    includeRuleSystem && selectedItemKeys.has(item.key);
                  return (
                    <label
                      key={item.key}
                      className={`foundation-candidate ${checked ? "selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!includeRuleSystem}
                        checked={checked}
                        onChange={() =>
                          toggleKey(item.key, setSelectedItemKeys)
                        }
                      />
                      <span>
                        <span className="foundation-candidate-top">
                          <Badge tone="amber">
                            {displayText(item.category, locale)}
                          </Badge>
                          <strong>{displayText(item.name, locale)}</strong>
                        </span>
                        <span className="foundation-candidate-body">
                          {item.stats
                            .map((stat) =>
                              ruleEffectLabel(
                                stat,
                                output.ruleSystem ?? undefined,
                                locale,
                              ),
                            )
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </>
            ) : null}
            {output.notes ? (
              <p className="hint">
                <strong>{t("rulesSkillNotes")}: </strong>
                {output.notes}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {statusMessage ? (
        <p className="foundation-status" role="status">
          {statusMessage}
        </p>
      ) : null}
      {run?.issues.length ? (
        <ul className="rule-skill-issues">
          {run.issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <code>{issue.path || "<output>"}</code>: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
