import { useMemo, useState } from "react";
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

export function CardsView({
  workspace,
  locale,
  t,
  onNewType,
  onEditType,
  onNewCard,
  onEditCard,
  onBatch,
  onNewEdge,
  onDeleteCard,
  onDeleteEdge,
  onOpenQuickStart,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onNewType: () => void;
  onEditType: (type: CardType) => void;
  onNewCard: (typeId: string) => void;
  onEditCard: (card: Card) => void;
  onBatch: (typeId: string) => void;
  onNewEdge: (defaultSourceId?: string) => void;
  onDeleteCard: (card: Card) => void;
  onDeleteEdge: (edge: CardEdge) => void;
  onOpenQuickStart: () => void;
}) {
  const [selectedTypeId, setSelectedTypeId] = useState(
    () => workspace.cardTypes[0]?.id ?? "",
  );
  const activeType =
    workspace.cardTypes.find((type) => type.id === selectedTypeId) ??
    workspace.cardTypes[0];
  const cardsById = useMemo(() => {
    const map = new Map<string, Card>();
    for (const card of workspace.cards) map.set(card.id, card);
    return map;
  }, [workspace.cards]);
  const activeCards = useMemo(
    () =>
      activeType
        ? workspace.cards.filter((card) => card.typeId === activeType.id)
        : [],
    [workspace.cards, activeType],
  );
  const activeCardIds = useMemo(
    () => new Set(activeCards.map((card) => card.id)),
    [activeCards],
  );
  const activeEdges = useMemo(
    () =>
      workspace.cardEdges.filter(
        (edge) =>
          activeCardIds.has(edge.sourceId) || activeCardIds.has(edge.targetId),
      ),
    [workspace.cardEdges, activeCardIds],
  );
  const relationCountFor = (cardId: string) =>
    workspace.cardEdges.filter(
      (edge) => edge.sourceId === cardId || edge.targetId === cardId,
    ).length;

  return (
    <div className="view cards-view">
      <section className="cards-head">
        <div>
          <span className="eyebrow">NODE SYSTEM / 节点系统</span>
          <h1>{t("cardsTitle")}</h1>
          <p>{t("cardsLead")}</p>
        </div>
        <div className="cards-head-actions">
          <Button
            icon="link"
            disabled={workspace.cards.length < 2}
            onClick={() => onNewEdge()}
          >
            {t("cardsNewEdge")}
          </Button>
          <Button variant="primary" icon="plus" onClick={onNewType}>
            {t("cardsNewType")}
          </Button>
        </div>
      </section>

      {!activeType ? (
        <EmptyState
          icon="layers"
          title={t("cardsEmptyTitle")}
          action={
            <div className="empty-action-row">
              <Button variant="primary" icon="plus" onClick={onNewType}>
                {t("cardsNewType")}
              </Button>
              <Button icon="sparkles" onClick={onOpenQuickStart}>
                {t("constructQuickStart")}
              </Button>
            </div>
          }
        >
          {t("cardsEmptyLead")}
        </EmptyState>
      ) : (
        <div className="cards-layout">
          <aside className="card-type-rail">
            {workspace.cardTypes.map((type) => {
              const count = workspace.cards.filter(
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
                disabled={workspace.cards.length < 2}
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
