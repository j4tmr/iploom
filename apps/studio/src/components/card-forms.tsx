import { useMemo, useState } from "react";
import {
  CARD_FIELD_KEY_PATTERN,
  createCardBatch,
  type BuiltInConstruct,
} from "../core/cards.ts";
import { createId, displayText } from "../core/factory.ts";
import {
  MAX_LOCALIZED_LENGTH,
  type Card,
  type CardEdge,
  type CardField,
  type CardFieldType,
  type CardType,
  type StudioWorkspace,
  type UiLocale,
} from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import {
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

type FieldDraft = {
  /** Stable row identity while the user renames a field key. */
  uid: string;
  key: string;
  labelZh: string;
  labelEn: string;
  type: CardFieldType;
  unit: string;
  min: string;
  max: string;
  enumValues: string;
  defaultValue: string;
};

const FIELD_TYPES: CardFieldType[] = ["integer", "decimal", "text", "enum"];

function fieldTypeLabel(t: Translate, type: CardFieldType): string {
  if (type === "integer") return t("cardsFieldTypeInteger");
  if (type === "decimal") return t("cardsFieldTypeDecimal");
  if (type === "enum") return t("cardsFieldTypeEnum");
  return t("cardsFieldTypeText");
}

function newFieldDraft(index: number): FieldDraft {
  return {
    uid: createId("field"),
    key: `field${index}`,
    labelZh: "",
    labelEn: "",
    type: "text",
    unit: "",
    min: "",
    max: "",
    enumValues: "",
    defaultValue: "",
  };
}

function toDraft(field: CardField): FieldDraft {
  return {
    uid: createId("field"),
    key: field.key,
    labelZh: field.label.zh,
    labelEn: field.label.en,
    type: field.type,
    unit: field.unit,
    min: field.min === undefined ? "" : String(field.min),
    max: field.max === undefined ? "" : String(field.max),
    enumValues: field.enumValues.join(", "),
    defaultValue:
      field.defaultValue === undefined ? "" : String(field.defaultValue),
  };
}

function numeric(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function fieldDraftIssue(draft: FieldDraft): string | null {
  if (!CARD_FIELD_KEY_PATTERN.test(draft.key.trim())) return "key";
  if (!draft.labelZh.trim() && !draft.labelEn.trim()) return "label";
  if (draft.min.trim() && numeric(draft.min) === undefined) return "min";
  if (draft.max.trim() && numeric(draft.max) === undefined) return "max";
  const min = numeric(draft.min);
  const max = numeric(draft.max);
  if (min !== undefined && max !== undefined && min > max) return "range";
  if (draft.type === "enum") {
    const values = draft.enumValues
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!values.length) return "enum";
    if (
      draft.defaultValue.trim() &&
      !values.includes(draft.defaultValue.trim())
    )
      return "default";
  }
  if (draft.type === "integer" || draft.type === "decimal") {
    const fallback = numeric(draft.defaultValue);
    if (draft.defaultValue.trim() && fallback === undefined) return "default";
    if (
      draft.type === "integer" &&
      draft.defaultValue.trim() &&
      !Number.isInteger(fallback)
    )
      return "default";
    if (fallback !== undefined) {
      if (min !== undefined && fallback < min) return "default";
      if (max !== undefined && fallback > max) return "default";
    }
  }
  return null;
}

function draftToField(draft: FieldDraft): CardField {
  const min = numeric(draft.min);
  const max = numeric(draft.max);
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
    defaultValue =
      draft.type === "integer" || draft.type === "decimal"
        ? numeric(rawDefault)
        : rawDefault;
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
  };
}

function typeIssue(fields: FieldDraft[]): string | null {
  const keys = new Set<string>();
  for (const field of fields) {
    const issue = fieldDraftIssue(field);
    if (issue) return issue;
    if (keys.has(field.key.trim())) return "duplicate";
    keys.add(field.key.trim());
  }
  return null;
}

export function CardTypeModal({
  open,
  onClose,
  t,
  universeId,
  initial,
  onSave,
}: ModalBase & {
  universeId: string;
  initial?: CardType;
  onSave: (type: CardType) => boolean;
}) {
  const [nameZh, setNameZh] = useState(initial?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(initial?.name.en ?? "");
  const [summaryZh, setSummaryZh] = useState(initial?.summary.zh ?? "");
  const [summaryEn, setSummaryEn] = useState(initial?.summary.en ?? "");
  const [color, setColor] = useState(initial?.color ?? "#3f6f8f");
  const [fields, setFields] = useState<FieldDraft[]>(
    initial ? initial.fields.map(toDraft) : [newFieldDraft(1)],
  );
  const issue = typeIssue(fields);
  const named = Boolean(nameZh.trim() || nameEn.trim());
  const updateField = (index: number, patch: Partial<FieldDraft>) =>
    setFields((current) =>
      current.map((field, at) =>
        at === index ? { ...field, ...patch } : field,
      ),
    );
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={initial ? t("cardsEditType") : t("cardsNewType")}
      description={t("cardsLead")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!named || Boolean(issue)}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("ctype"),
                universeId: initial?.universeId ?? universeId,
                name: { zh: nameZh.trim(), en: nameEn.trim() },
                summary: { zh: summaryZh.trim(), en: summaryEn.trim() },
                color,
                fields: fields.map(draftToField),
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
        <Field label={t("coverColor")}>
          <input
            className="color-input"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </Field>
      </FieldGrid>

      <div className="card-field-editor">
        <div className="card-field-editor-head">
          <strong>{t("cardsFieldList")}</strong>
          <Button
            variant="ghost"
            icon="plus"
            onClick={() =>
              setFields((current) => [
                ...current,
                newFieldDraft(current.length + 1),
              ])
            }
          >
            {t("cardsAddField")}
          </Button>
        </div>
        {fields.length === 0 ? (
          <p className="hint">{t("cardsEmptyLead")}</p>
        ) : null}
        {fields.map((field, index) => (
          <div className="card-field-row" key={field.uid}>
            <Field label={t("cardsFieldKey")}>
              <TextInput
                value={field.key}
                onChange={(event) =>
                  updateField(index, { key: event.target.value })
                }
              />
            </Field>
            <Field label={t("cardsFieldLabel")}>
              <TextInput
                value={field.labelZh}
                maxLength={MAX_LOCALIZED_LENGTH}
                placeholder={t("nameZh")}
                onChange={(event) =>
                  updateField(index, { labelZh: event.target.value })
                }
              />
            </Field>
            <Field label="English">
              <TextInput
                value={field.labelEn}
                maxLength={MAX_LOCALIZED_LENGTH}
                placeholder={t("nameEn")}
                onChange={(event) =>
                  updateField(index, { labelEn: event.target.value })
                }
              />
            </Field>
            <Field label={t("cardsFieldType")}>
              <Select
                value={field.type}
                onChange={(event) =>
                  updateField(index, {
                    type: event.target.value as CardFieldType,
                  })
                }
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {fieldTypeLabel(t, type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("cardsFieldUnit")}>
              <TextInput
                value={field.unit}
                maxLength={40}
                onChange={(event) =>
                  updateField(index, { unit: event.target.value })
                }
              />
            </Field>
            <Field label={t("cardsFieldMin")}>
              <TextInput
                type="number"
                value={field.min}
                onChange={(event) =>
                  updateField(index, { min: event.target.value })
                }
              />
            </Field>
            <Field label={t("cardsFieldMax")}>
              <TextInput
                type="number"
                value={field.max}
                onChange={(event) =>
                  updateField(index, { max: event.target.value })
                }
              />
            </Field>
            <Field label={t("cardsFieldDefault")}>
              <TextInput
                value={field.defaultValue}
                onChange={(event) =>
                  updateField(index, { defaultValue: event.target.value })
                }
              />
            </Field>
            {field.type === "enum" ? (
              <Field label={t("cardsFieldEnum")} wide>
                <TextInput
                  value={field.enumValues}
                  placeholder="普通, 精英, 首领"
                  onChange={(event) =>
                    updateField(index, { enumValues: event.target.value })
                  }
                />
              </Field>
            ) : null}
            <Button
              variant="ghost"
              icon="trash"
              onClick={() =>
                setFields((current) => current.filter((_, at) => at !== index))
              }
            >
              {t("cardsRemoveField")}
            </Button>
          </div>
        ))}
        {issue ? <p className="hint">{t("cardsFieldInvalid")}</p> : null}
      </div>
    </Modal>
  );
}

function cardValueIssue(
  type: CardType,
  values: Record<string, string>,
): string | null {
  for (const field of type.fields) {
    const raw = values[field.key] ?? "";
    if (field.type === "text" || field.type === "enum") continue;
    if (!raw.trim()) continue;
    const value = numeric(raw);
    if (value === undefined) return field.key;
    if (field.type === "integer" && !Number.isInteger(value)) return field.key;
    if (field.min !== undefined && value < field.min) return field.key;
    if (field.max !== undefined && value > field.max) return field.key;
  }
  return null;
}

function cardValuesForSave(
  type: CardType,
  values: Record<string, string>,
): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  for (const field of type.fields) {
    const raw = values[field.key] ?? "";
    if (field.type === "integer" || field.type === "decimal") {
      const value = numeric(raw);
      if (value !== undefined) result[field.key] = value;
    } else if (raw !== "") {
      result[field.key] = raw;
    }
  }
  return result;
}

export function CardModal({
  open,
  onClose,
  t,
  locale,
  type,
  initial,
  onSave,
}: ModalBase & {
  type: CardType;
  initial?: Card;
  onSave: (card: Card) => boolean;
}) {
  const [titleZh, setTitleZh] = useState(initial?.title.zh ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const field of type.fields) {
      const value = initial?.values[field.key] ?? field.defaultValue;
      seed[field.key] = value === undefined ? "" : String(value);
    }
    return seed;
  });
  const issue = cardValueIssue(type, values);
  const named = Boolean(titleZh.trim() || titleEn.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={initial ? t("cardsEditCard") : t("cardsNewCard")}
      description={displayText(type.name, locale)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!named || Boolean(issue)}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: initial?.id ?? createId("card"),
                typeId: type.id,
                title: { zh: titleZh.trim(), en: titleEn.trim() },
                values: cardValuesForSave(type, values),
                notes,
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
            value={titleZh}
            onChange={(event) => setTitleZh(event.target.value)}
          />
        </Field>
        <Field label={t("nameEn")}>
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={titleEn}
            onChange={(event) => setTitleEn(event.target.value)}
          />
        </Field>
        {type.fields.map((field) => (
          <Field
            key={field.key}
            label={displayText(field.label, locale)}
            hint={field.unit || undefined}
          >
            {field.type === "enum" ? (
              <Select
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              >
                <option value="">—</option>
                {field.enumValues.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            ) : (
              <TextInput
                type={field.type === "text" ? "text" : "number"}
                step={field.type === "integer" ? "1" : "any"}
                min={field.min}
                max={field.max}
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            )}
          </Field>
        ))}
        <Field label={t("cardsCardNotes")} wide>
          <TextArea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function CardBatchModal({
  open,
  onClose,
  t,
  locale,
  type,
  onSave,
}: ModalBase & {
  type: CardType;
  onSave: (cards: Card[]) => boolean;
}) {
  const [count, setCount] = useState("10");
  const [prefix, setPrefix] = useState("");
  const parsed = Number(count);
  const valid =
    Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= 500 &&
    Boolean(prefix.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={t("cardsBatch")}
      description={t("cardsBatchLead")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="plus"
            disabled={!valid}
            onClick={() => {
              const saved = onSave(
                createCardBatch(type, {
                  count: parsed,
                  titlePrefix: prefix.trim(),
                }),
              );
              if (saved) onClose();
            }}
          >
            {t("cardsBatch")}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label={t("cardsBatchCount")}>
          <TextInput
            type="number"
            min={1}
            max={500}
            step={1}
            value={count}
            onChange={(event) => setCount(event.target.value)}
          />
        </Field>
        <Field label={t("cardsBatchPrefix")}>
          <TextInput
            autoFocus
            value={prefix}
            placeholder={displayText(type.name, locale)}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function CardEdgeModal({
  open,
  onClose,
  t,
  locale,
  workspace,
  universeId,
  defaultSourceId,
  onSave,
}: ModalBase & {
  workspace: StudioWorkspace;
  universeId: string;
  defaultSourceId?: string;
  onSave: (edge: CardEdge) => boolean;
}) {
  const cards = useMemo(
    () =>
      workspace.cards
        .map((card) => {
          const type = workspace.cardTypes.find(
            (item) => item.id === card.typeId,
          );
          return { card, type };
        })
        .filter((entry) => entry.type?.universeId === universeId)
        .map(({ card, type }) => ({
          card,
          label: type
            ? `${displayText(type.name, locale)} · ${displayText(card.title, locale)}`
            : displayText(card.title, locale),
        })),
    [workspace.cards, workspace.cardTypes, universeId, locale],
  );
  const [sourceId, setSourceId] = useState(defaultSourceId ?? "");
  const [targetId, setTargetId] = useState("");
  const [labelZh, setLabelZh] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [notes, setNotes] = useState("");
  const valid =
    Boolean(sourceId) &&
    Boolean(targetId) &&
    sourceId !== targetId &&
    Boolean(labelZh.trim() || labelEn.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={t("cardsNewEdge")}
      description={t("cardsEdgeLead")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!valid}
            onClick={() => {
              const now = new Date().toISOString();
              const saved = onSave({
                id: createId("cedge"),
                sourceId,
                targetId,
                label: { zh: labelZh.trim(), en: labelEn.trim() },
                notes,
                createdAt: now,
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
        <Field label={t("cardsEdgeSource")}>
          <Select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          >
            <option value="">—</option>
            {cards.map((entry) => (
              <option key={entry.card.id} value={entry.card.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("cardsEdgeTarget")}>
          <Select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">—</option>
            {cards.map((entry) => (
              <option key={entry.card.id} value={entry.card.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("cardsEdgeLabel")}>
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={labelZh}
            placeholder={t("nameZh")}
            onChange={(event) => setLabelZh(event.target.value)}
          />
        </Field>
        <Field label="English">
          <TextInput
            maxLength={MAX_LOCALIZED_LENGTH}
            value={labelEn}
            placeholder={t("nameEn")}
            onChange={(event) => setLabelEn(event.target.value)}
          />
        </Field>
        <Field label={t("cardsCardNotes")} wide>
          <TextArea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </FieldGrid>
    </Modal>
  );
}

export function ConstructModal({
  open,
  onClose,
  t,
  locale,
  construct,
  universeId,
  alreadyApplied,
  onApply,
}: ModalBase & {
  construct: BuiltInConstruct;
  universeId: string;
  alreadyApplied: boolean;
  onApply: () => boolean;
}) {
  const preview = useMemo(
    () => construct.build(new Date().toISOString(), universeId),
    [construct, universeId],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={displayText(construct.name, locale)}
      description={displayText(construct.summary, locale)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            icon="sparkles"
            disabled={alreadyApplied}
            onClick={() => {
              if (onApply()) onClose();
            }}
          >
            {alreadyApplied
              ? t("constructAlreadyApplied")
              : t("constructApply")}
          </Button>
        </>
      }
    >
      <div className="construct-preview">
        <span>
          <strong>{preview.types.length}</strong> {t("cardsTypes")}
        </span>
        <span>
          <strong>{preview.cards.length}</strong> {t("cards")}
        </span>
        <span>
          <strong>{preview.edges.length}</strong> {t("cardsEdges")}
        </span>
      </div>
      <ul className="construct-type-list">
        {preview.types.map((type) => (
          <li key={type.id}>
            <i style={{ background: type.color }} />
            <span>
              <strong>{displayText(type.name, locale)}</strong>
              <small>{displayText(type.summary, locale)}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">{t("constructTemplateHint")}</p>
    </Modal>
  );
}
