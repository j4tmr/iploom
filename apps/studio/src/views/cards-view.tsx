import { useEffect, useMemo, useState } from "react";
import {
  appliedConstructs,
  BUILT_IN_CONSTRUCTS,
  createCard,
  defaultCardValues,
  isKnownCardBehavior,
  parseCardFieldInput,
  previewFieldsForType,
  resolveCardBehavior,
  resolveCardIcon,
  setLocalizedTitle,
} from "../core/cards.ts";
import { createId, displayText } from "../core/factory.ts";
import {
  MAX_LOCALIZED_LENGTH,
  type Card,
  type CardEdge,
  type CardField,
  type CardType,
  type StudioWorkspace,
  type UiLocale,
} from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { Icon } from "../components/icon.tsx";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  SectionTitle,
} from "../components/ui.tsx";

type CardsViewMode = "list" | "table";

interface TableRowDraft {
  id: string;
  isNew: boolean;
  base?: Card;
  titleText: string;
  values: Record<string, string>;
  notes: string;
}

function fieldValueLabel(
  field: CardField,
  values: Record<string, number | string>,
): string | null {
  const value = values[field.key];
  if (value === undefined || value === "") return null;
  return `${value}${field.unit ? ` ${field.unit}` : ""}`;
}

function cardToDraft(
  card: Card,
  type: CardType,
  locale: UiLocale,
): TableRowDraft {
  const values: Record<string, string> = {};
  for (const field of type.fields) {
    const stored = card.values[field.key];
    values[field.key] = stored === undefined ? "" : String(stored);
  }
  return {
    id: card.id,
    isNew: false,
    base: card,
    titleText: displayText(card.title, locale),
    values,
    notes: card.notes,
  };
}

function newBlankRowDraft(type: CardType): TableRowDraft {
  const defaults = defaultCardValues(type);
  const values: Record<string, string> = {};
  for (const field of type.fields) {
    const value = defaults[field.key];
    values[field.key] = value === undefined ? "" : String(value);
  }
  return {
    id: createId("card"),
    isNew: true,
    titleText: "",
    values,
    notes: "",
  };
}

function CardRow({
  card,
  type,
  locale,
  t,
  relationCount,
  onEdit,
  onDelete,
  onNewEdge,
}: {
  card: Card;
  type: CardType;
  locale: UiLocale;
  t: Translate;
  relationCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onNewEdge: () => void;
}) {
  const preview = previewFieldsForType(type)
    .map((field) => {
      const value = fieldValueLabel(field, card.values);
      return value ? `${displayText(field.label, locale)} ${value}` : null;
    })
    .filter(Boolean)
    .slice(0, 3);
  return (
    <article className="card-row">
      <i className="card-row-dot" style={{ background: type.color }} />
      <div className="card-row-main">
        <strong>{displayText(card.title, locale)}</strong>
        <span className="card-row-values">
          {preview.length ? (
            preview.map((item) => (
              <span key={item} className="card-value">
                {item}
              </span>
            ))
          ) : (
            <span className="card-value muted">{t("cardsValueEmpty")}</span>
          )}
        </span>
      </div>
      <span className="card-row-relations">
        {relationCount > 0 ? (
          <Badge tone="blue">
            {relationCount === 1
              ? t("cardsRelationCountOne")
              : t("cardsRelationCount", { n: relationCount })}
          </Badge>
        ) : null}
      </span>
      <span className="card-row-actions">
        <IconButton label={t("cardsNewEdge")} icon="link" onClick={onNewEdge} />
        <IconButton label={t("cardsEditCard")} icon="edit" onClick={onEdit} />
        <IconButton
          label={t("cardsDeleteCard")}
          icon="trash"
          onClick={onDelete}
        />
      </span>
    </article>
  );
}

function CardTableEditor({
  type,
  cards,
  locale,
  t,
  relationCountFor,
  onSaveCards,
  onEditCard,
  onDeleteCard,
  onNewEdge,
}: {
  type: CardType;
  cards: Card[];
  locale: UiLocale;
  t: Translate;
  relationCountFor: (cardId: string) => number;
  onSaveCards: (cards: Card[]) => boolean;
  onEditCard: (card: Card) => void;
  onDeleteCard: (card: Card) => void;
  onNewEdge: (defaultSourceId?: string) => void;
}) {
  const [edits, setEdits] = useState<Record<string, TableRowDraft>>({});
  const [addedRows, setAddedRows] = useState<TableRowDraft[]>([]);

  // Switching card types resets pending inline edits so stale cells never leak across types.
  // biome-ignore lint/correctness/useExhaustiveDependencies: type.id intentionally clears inline drafts when switching active card type
  useEffect(() => {
    setEdits({});
    setAddedRows([]);
  }, [type.id]);

  const rows: TableRowDraft[] = useMemo(
    () => [
      ...cards.map((card) => edits[card.id] ?? cardToDraft(card, type, locale)),
      ...addedRows,
    ],
    [cards, edits, addedRows, type, locale],
  );

  const dirtyCount = Object.keys(edits).length + addedRows.length;

  const updateRow = (
    row: TableRowDraft,
    updater: (draft: TableRowDraft) => TableRowDraft,
  ) => {
    if (row.isNew) {
      setAddedRows((current) =>
        current.map((item) => (item.id === row.id ? updater(item) : item)),
      );
      return;
    }
    setEdits((current) => ({
      ...current,
      [row.id]: updater(current[row.id] ?? row),
    }));
  };

  const rowHasInvalidCell = (row: TableRowDraft): boolean => {
    if (!row.titleText.trim()) return true;
    for (const field of type.fields) {
      if (!parseCardFieldInput(field, row.values[field.key] ?? "").ok)
        return true;
    }
    return false;
  };

  const dirtyRows = [...Object.values(edits), ...addedRows];
  const hasInvalid = dirtyRows.some(rowHasInvalidCell);

  const commitTable = () => {
    if (!dirtyRows.length || hasInvalid) return;
    const now = new Date().toISOString();
    const toSave: Card[] = [];
    for (const row of dirtyRows) {
      const parsedValues: Record<string, number | string> = {};
      for (const field of type.fields) {
        const result = parseCardFieldInput(field, row.values[field.key] ?? "");
        if (!result.ok) return;
        if (result.value !== undefined) parsedValues[field.key] = result.value;
      }
      if (row.isNew || !row.base) {
        toSave.push(
          createCard(type, {
            id: row.id,
            title: setLocalizedTitle({ zh: "", en: "" }, locale, row.titleText),
            values: parsedValues,
            notes: row.notes,
            now,
          }),
        );
      } else {
        toSave.push({
          ...row.base,
          title: setLocalizedTitle(row.base.title, locale, row.titleText),
          values: parsedValues,
          notes: row.notes,
          updatedAt: now,
        });
      }
    }
    if (onSaveCards(toSave)) {
      setEdits({});
      setAddedRows([]);
    }
  };

  return (
    <div className="card-grid-wrap">
      <div className="card-grid-toolbar">
        <Button
          variant="ghost"
          icon="plus"
          onClick={() =>
            setAddedRows((current) => [...current, newBlankRowDraft(type)])
          }
        >
          {t("cardsTableAddRow")}
        </Button>
        {dirtyCount > 0 ? (
          <div className="card-grid-commit">
            <Button
              variant="ghost"
              onClick={() => {
                setEdits({});
                setAddedRows([]);
              }}
            >
              {t("cardsTableDiscardChanges")}
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={hasInvalid}
              onClick={commitTable}
            >
              {t("cardsTableSaveChanges")} ({dirtyCount})
            </Button>
          </div>
        ) : null}
      </div>
      {hasInvalid ? (
        <p className="card-ai-error">{t("cardsTableInvalidHint")}</p>
      ) : null}
      <div className="card-grid-scroll">
        <table className="card-grid-table">
          <thead>
            <tr>
              <th>{t("cardsCardTitle")}</th>
              {type.fields.map((field) => (
                <th key={field.key}>
                  <span>{displayText(field.label, locale)}</span>
                  {field.unit ? <small>{field.unit}</small> : null}
                </th>
              ))}
              <th>{t("cardsCardNotes")}</th>
              <th aria-label={t("edit")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const titleInvalid = !row.titleText.trim();
              const isDirty = row.isNew || Boolean(edits[row.id]);
              return (
                <tr key={row.id} className={isDirty ? "dirty" : ""}>
                  <td>
                    <input
                      className={`card-cell-input ${titleInvalid ? "invalid" : ""}`}
                      maxLength={MAX_LOCALIZED_LENGTH}
                      aria-label={t("cardsCardTitle")}
                      placeholder={t("cardsTableEmptyTitle")}
                      value={row.titleText}
                      onChange={(event) =>
                        updateRow(row, (draft) => ({
                          ...draft,
                          titleText: event.target.value,
                        }))
                      }
                    />
                  </td>
                  {type.fields.map((field) => {
                    const raw = row.values[field.key] ?? "";
                    const parsed = parseCardFieldInput(field, raw);
                    return (
                      <td key={field.key}>
                        {field.type === "enum" ? (
                          <select
                            className={`card-cell-input ${parsed.ok ? "" : "invalid"}`}
                            aria-label={displayText(field.label, locale)}
                            value={raw}
                            onChange={(event) =>
                              updateRow(row, (draft) => ({
                                ...draft,
                                values: {
                                  ...draft.values,
                                  [field.key]: event.target.value,
                                },
                              }))
                            }
                          >
                            <option value="">—</option>
                            {field.enumValues.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={`card-cell-input ${parsed.ok ? "" : "invalid"}`}
                            type={field.type === "text" ? "text" : "number"}
                            step={field.type === "integer" ? "1" : "any"}
                            min={field.min}
                            max={field.max}
                            aria-label={displayText(field.label, locale)}
                            value={raw}
                            onChange={(event) =>
                              updateRow(row, (draft) => ({
                                ...draft,
                                values: {
                                  ...draft.values,
                                  [field.key]: event.target.value,
                                },
                              }))
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <input
                      className="card-cell-input"
                      aria-label={t("cardsCardNotes")}
                      value={row.notes}
                      onChange={(event) =>
                        updateRow(row, (draft) => ({
                          ...draft,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="card-grid-actions">
                    {row.isNew ? (
                      <IconButton
                        label={t("cardsDeleteCard")}
                        icon="trash"
                        onClick={() =>
                          setAddedRows((current) =>
                            current.filter((item) => item.id !== row.id),
                          )
                        }
                      />
                    ) : row.base ? (
                      <>
                        {relationCountFor(row.base.id) > 0 ? (
                          <Badge tone="blue">
                            {relationCountFor(row.base.id)}
                          </Badge>
                        ) : null}
                        <IconButton
                          label={t("cardsNewEdge")}
                          icon="link"
                          onClick={() => onNewEdge(row.base!.id)}
                        />
                        <IconButton
                          label={t("cardsEditCard")}
                          icon="edit"
                          onClick={() => onEditCard(row.base!)}
                        />
                        <IconButton
                          label={t("cardsDeleteCard")}
                          icon="trash"
                          onClick={() => onDeleteCard(row.base!)}
                        />
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The node board of one world or one work. Without `workId` it shows the
 * world-level packs shared by everything in that world; with `workId` it shows
 * only that work's own packs — a game's dedicated board.
 */
export function CardsView({
  workspace,
  universeId,
  workId,
  locale,
  t,
  onNewType,
  onEditType,
  onDuplicateType,
  onDeleteType,
  onNewCard,
  onEditCard,
  onSaveCards,
  onBatch,
  onAiBatch,
  onNewEdge,
  onDeleteCard,
  onDeleteEdge,
  onApplyConstruct,
}: {
  workspace: StudioWorkspace;
  universeId: string;
  workId?: string;
  locale: UiLocale;
  t: Translate;
  onNewType: () => void;
  onEditType: (type: CardType) => void;
  onDuplicateType: (type: CardType) => void;
  onDeleteType: (type: CardType) => void;
  onNewCard: (typeId: string) => void;
  onEditCard: (card: Card) => void;
  onSaveCards: (cards: Card[]) => boolean;
  onBatch: (typeId: string) => void;
  onAiBatch: (typeId: string) => void;
  onNewEdge: (defaultSourceId?: string) => void;
  onDeleteCard: (card: Card) => void;
  onDeleteEdge: (edge: CardEdge) => void;
  onApplyConstruct: (constructId: string) => void;
}) {
  const universeTypes = useMemo(
    () =>
      workspace.cardTypes.filter(
        (type) =>
          type.universeId === universeId &&
          (type.workId ?? undefined) === workId,
      ),
    [workspace.cardTypes, universeId, workId],
  );
  const universeCards = useMemo(() => {
    const typeIds = new Set(universeTypes.map((type) => type.id));
    return workspace.cards.filter((card) => typeIds.has(card.typeId));
  }, [workspace.cards, universeTypes]);
  const universeEdges = useMemo(() => {
    const cardIds = new Set(universeCards.map((card) => card.id));
    return workspace.cardEdges.filter(
      (edge) => cardIds.has(edge.sourceId) && cardIds.has(edge.targetId),
    );
  }, [workspace.cardEdges, universeCards]);
  const usedConstructs = appliedConstructs(workspace, universeId, workId);
  const unusedConstructs = BUILT_IN_CONSTRUCTS.filter(
    (item) => !usedConstructs.some((applied) => applied.id === item.id),
  );
  const [selectedTypeId, setSelectedTypeId] = useState(
    () => universeTypes[0]?.id ?? "",
  );
  const [viewMode, setViewMode] = useState<CardsViewMode>("list");
  const activeType =
    universeTypes.find((type) => type.id === selectedTypeId) ??
    universeTypes[0];
  const activeBehavior = activeType
    ? resolveCardBehavior(activeType.behavior)
    : null;
  const activeBehaviorIsFallback =
    activeType !== undefined && !isKnownCardBehavior(activeType.behavior);
  const cardsById = useMemo(() => {
    const map = new Map<string, Card>();
    for (const card of universeCards) map.set(card.id, card);
    return map;
  }, [universeCards]);
  const activeCards = useMemo(
    () =>
      activeType
        ? universeCards.filter((card) => card.typeId === activeType.id)
        : [],
    [universeCards, activeType],
  );
  const activeCardIds = useMemo(
    () => new Set(activeCards.map((card) => card.id)),
    [activeCards],
  );
  const activeEdges = useMemo(
    () =>
      universeEdges.filter(
        (edge) =>
          activeCardIds.has(edge.sourceId) || activeCardIds.has(edge.targetId),
      ),
    [universeEdges, activeCardIds],
  );
  const relationCountByCardId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of universeEdges) {
      counts.set(edge.sourceId, (counts.get(edge.sourceId) ?? 0) + 1);
      counts.set(edge.targetId, (counts.get(edge.targetId) ?? 0) + 1);
    }
    return counts;
  }, [universeEdges]);
  const relationCountFor = (cardId: string) =>
    relationCountByCardId.get(cardId) ?? 0;

  return (
    <div className="cards-view">
      <section className="cards-head">
        <div>
          <span className="eyebrow">NODE SYSTEM / 节点系统</span>
          <h2>{t("cardsTitle")}</h2>
          <p>{t("cardsLead")}</p>
        </div>
        <div className="cards-head-actions">
          <Button
            icon="link"
            disabled={universeCards.length < 2}
            onClick={() => onNewEdge()}
          >
            {t("cardsNewEdge")}
          </Button>
          <Button variant="primary" icon="plus" onClick={onNewType}>
            {t("cardsNewType")}
          </Button>
        </div>
      </section>

      {unusedConstructs.length ? (
        <div className="construct-inline">
          <span className="construct-inline-label">
            {t("constructQuickStart")}
          </span>
          {unusedConstructs.map((construct) => (
            <button
              type="button"
              className="construct-inline-chip"
              key={construct.id}
              onClick={() => onApplyConstruct(construct.id)}
            >
              <Icon name="sparkles" size={14} />
              {displayText(construct.name, locale)}
            </button>
          ))}
          <span className="hint">{t("constructTemplateHint")}</span>
        </div>
      ) : null}

      {!activeType ? (
        <EmptyState
          icon="layers"
          title={t("cardsEmptyTitle")}
          action={
            <div className="empty-action-row">
              <Button variant="primary" icon="plus" onClick={onNewType}>
                {t("cardsNewType")}
              </Button>
              {unusedConstructs[0] ? (
                <Button
                  icon="sparkles"
                  onClick={() => onApplyConstruct(unusedConstructs[0]!.id)}
                >
                  {t("constructQuickStart")}
                </Button>
              ) : null}
            </div>
          }
        >
          {t("cardsEmptyLead")}
        </EmptyState>
      ) : (
        <div className="cards-layout">
          <aside className="card-type-rail">
            {universeTypes.map((type) => {
              const count = universeCards.filter(
                (card) => card.typeId === type.id,
              ).length;
              return (
                <button
                  type="button"
                  key={type.id}
                  className={`card-type-chip ${type.id === activeType.id ? "active" : ""}`}
                  onClick={() => setSelectedTypeId(type.id)}
                >
                  <span
                    className="card-type-chip-icon"
                    style={{ background: type.color }}
                  >
                    <Icon
                      name={resolveCardIcon(type.icon, type.behavior)}
                      size={13}
                    />
                  </span>
                  <span>
                    <strong>{displayText(type.name, locale)}</strong>
                    <small>
                      {count === 1
                        ? t("cardsCardCountOne")
                        : t("cardsCardCount", { n: count })}
                    </small>
                  </span>
                </button>
              );
            })}
            <Button variant="ghost" icon="plus" onClick={onNewType}>
              {t("cardsNewType")}
            </Button>
          </aside>

          <section className="card-type-panel">
            <header className="card-type-head">
              <span
                className="card-type-mark"
                style={{ background: activeType.color }}
              >
                <Icon
                  name={resolveCardIcon(activeType.icon, activeType.behavior)}
                  size={18}
                />
              </span>
              <div className="card-type-copy">
                <div className="card-type-title-row">
                  <h2>{displayText(activeType.name, locale)}</h2>
                  {activeBehavior ? (
                    <Badge
                      tone={activeBehaviorIsFallback ? "amber" : "neutral"}
                    >
                      {displayText(activeBehavior.label, locale)}
                    </Badge>
                  ) : null}
                  {activeBehaviorIsFallback ? (
                    <Badge tone="amber">
                      {t("cardsTypeBehaviorFallbackBadge")}:{" "}
                      {activeType.behavior}
                    </Badge>
                  ) : null}
                </div>
                <p>{displayText(activeType.summary, locale)}</p>
              </div>
              <div className="card-type-actions">
                <div className="segmented card-view-toggle">
                  <button
                    type="button"
                    className={viewMode === "list" ? "active" : ""}
                    onClick={() => setViewMode("list")}
                  >
                    {t("cardsViewList")}
                  </button>
                  <button
                    type="button"
                    className={viewMode === "table" ? "active" : ""}
                    onClick={() => setViewMode("table")}
                  >
                    {t("cardsViewTable")}
                  </button>
                </div>
                <IconButton
                  label={t("cardsEditType")}
                  icon="edit"
                  onClick={() => onEditType(activeType)}
                />
                <IconButton
                  label={t("cardsDuplicateType")}
                  icon="copy"
                  onClick={() => onDuplicateType(activeType)}
                />
                <IconButton
                  label={t("cardsDeleteType")}
                  icon="trash"
                  onClick={() => onDeleteType(activeType)}
                />
                <Button icon="plus" onClick={() => onNewCard(activeType.id)}>
                  {t("cardsNewCard")}
                </Button>
                <Button icon="copy" onClick={() => onBatch(activeType.id)}>
                  {t("cardsBatch")}
                </Button>
                <Button
                  icon="sparkles"
                  onClick={() => onAiBatch(activeType.id)}
                >
                  {t("cardsAiFill")}
                </Button>
              </div>
            </header>

            <div className="card-field-strip">
              <span className="card-field-strip-label">
                {t("cardsFieldList")}
              </span>
              {activeType.fields.length ? (
                activeType.fields.map((field) => (
                  <span className="card-field-chip" key={field.key}>
                    {displayText(field.label, locale)}
                    {field.unit ? <small>{field.unit}</small> : null}
                  </span>
                ))
              ) : (
                <span className="card-field-chip muted">
                  {t("cardsValueEmpty")}
                </span>
              )}
            </div>

            {viewMode === "table" ? (
              <CardTableEditor
                type={activeType}
                cards={activeCards}
                locale={locale}
                t={t}
                relationCountFor={relationCountFor}
                onSaveCards={onSaveCards}
                onEditCard={onEditCard}
                onDeleteCard={onDeleteCard}
                onNewEdge={onNewEdge}
              />
            ) : activeCards.length ? (
              <div className="card-table">
                {activeCards.map((card) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    type={activeType}
                    locale={locale}
                    t={t}
                    relationCount={relationCountFor(card.id)}
                    onEdit={() => onEditCard(card)}
                    onDelete={() => onDeleteCard(card)}
                    onNewEdge={() => onNewEdge(card.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="file"
                title={t("cardsNoCards")}
                action={
                  <div className="empty-action-row">
                    <Button
                      variant="primary"
                      icon="plus"
                      onClick={() => onNewCard(activeType.id)}
                    >
                      {t("cardsNewCard")}
                    </Button>
                    <Button icon="copy" onClick={() => onBatch(activeType.id)}>
                      {t("cardsBatch")}
                    </Button>
                    <Button
                      icon="sparkles"
                      onClick={() => onAiBatch(activeType.id)}
                    >
                      {t("cardsAiFill")}
                    </Button>
                  </div>
                }
              >
                {t("cardsNoCardsLead")}
              </EmptyState>
            )}

            <SectionTitle eyebrow="EDGES / 关系" title={t("cardsEdges")}>
              <Button
                variant="ghost"
                icon="link"
                disabled={universeCards.length < 2}
                onClick={() => onNewEdge()}
              >
                {t("cardsNewEdge")}
              </Button>
            </SectionTitle>
            {activeEdges.length ? (
              <div className="card-edge-list">
                {activeEdges.map((edge) => {
                  const source = cardsById.get(edge.sourceId);
                  const target = cardsById.get(edge.targetId);
                  return (
                    <div className="card-edge-row" key={edge.id}>
                      <span className="card-edge-card">
                        {source ? displayText(source.title, locale) : "?"}
                      </span>
                      <span className="card-edge-label">
                        <Icon name="arrow" size={14} />
                        {displayText(edge.label, locale)}
                      </span>
                      <span className="card-edge-card">
                        {target ? displayText(target.title, locale) : "?"}
                      </span>
                      <IconButton
                        label={t("cardsDeleteEdge")}
                        icon="trash"
                        onClick={() => onDeleteEdge(edge)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="hint">{t("cardsNoEdges")}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
