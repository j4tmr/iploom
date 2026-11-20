import { useMemo, useState } from "react";
import { appliedConstructs, BUILT_IN_CONSTRUCTS } from "../core/cards.ts";
import { displayText } from "../core/factory.ts";
import type {
  Card,
  CardEdge,
  CardField,
  CardType,
  StudioWorkspace,
  UiLocale,
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

function fieldValueLabel(
  field: CardField,
  values: Record<string, number | string>,
): string | null {
  const value = values[field.key];
  if (value === undefined || value === "") return null;
  return `${value}${field.unit ? ` ${field.unit}` : ""}`;
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
  const preview = type.fields
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
  onBatch,
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
  onBatch: (typeId: string) => void;
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
  const activeType =
    universeTypes.find((type) => type.id === selectedTypeId) ??
    universeTypes[0];
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
                  <i style={{ background: type.color }} />
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
                {displayText(activeType.name, locale).slice(0, 1)}
              </span>
              <div className="card-type-copy">
                <h2>{displayText(activeType.name, locale)}</h2>
                <p>{displayText(activeType.summary, locale)}</p>
              </div>
              <div className="card-type-actions">
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

            {activeCards.length ? (
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
