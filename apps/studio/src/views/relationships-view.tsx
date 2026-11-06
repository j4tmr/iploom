import { useEffect, useState } from "react";
import { buildRelationshipGraph } from "../core/graph.ts";
import { displayText } from "../core/factory.ts";
import type { Character, Relationship, StudioWorkspace, UiLocale } from "../core/types.ts";
import {
  relationshipLabels,
  relationStatusLabels,
  type Translate,
} from "../i18n.ts";
import { RelationshipCanvas } from "../components/relationship-graph.tsx";
import {
  Button,
  EmptyState,
  IconButton,
  SectionTitle,
  Select,
} from "../components/ui.tsx";

export function RelationshipsView({
  workspace,
  locale,
  t,
  initialUniverseId,
  onAddRelationship,
  onDeleteRelationship,
  onEditRelationship,
  onEditCharacter,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  initialUniverseId?: string;
  onAddRelationship: (universeId: string) => void;
  onDeleteRelationship: (id: string) => void;
  onEditRelationship: (relationship: Relationship) => void;
  onEditCharacter: (character: Character) => void;
}) {
  const [universeId, setUniverseId] = useState(
    initialUniverseId ?? workspace.universes[0]?.id ?? "",
  );
  useEffect(() => {
    if (initialUniverseId) setUniverseId(initialUniverseId);
  }, [initialUniverseId]);
  const universe = workspace.universes.find((item) => item.id === universeId);
  const graph = universe
    ? buildRelationshipGraph(workspace, universe.id, locale)
    : { universeId: "", nodes: [], edges: [], warnings: [] };
  const characters = workspace.characters.filter((character) =>
    character.universeIds.includes(universeId),
  );

  return (
    <div className="view relationships-view">
      <header className="page-heading split">
        <div>
          <span className="eyebrow">RELATIONSHIP INTELLIGENCE</span>
          <h1>{t("relationships")}</h1>
          <p>{t("clickNode")}</p>
        </div>
        <div className="page-heading-actions">
          <Select value={universeId} onChange={(event) => setUniverseId(event.target.value)}>
            {workspace.universes.map((item) => (
              <option value={item.id} key={item.id}>
                {displayText(item.name, locale)}
              </option>
            ))}
          </Select>
          <Button variant="primary" icon="plus" disabled={!universe} onClick={() => onAddRelationship(universeId)}>
            {t("addRelationship")}
          </Button>
        </div>
      </header>
      {!universe ? (
        <EmptyState icon="graph" title={t("emptyDashboard")}>{t("emptyDashboardLead")}</EmptyState>
      ) : (
        <div className="graph-layout large">
          <div className="graph-main">
            <RelationshipCanvas
              graph={graph}
              locale={locale}
              onNodeClick={(node) => {
                const character = characters.find((item) => item.id === node.id);
                if (character) onEditCharacter(character);
              }}
            />
          </div>
          <aside className="relation-sidebar">
            <SectionTitle title={universe ? displayText(universe.name, locale) : ""} />
            <div className="relation-summary">
              <span><strong>{graph.nodes.length}</strong>{t("characters")}</span>
              <span><strong>{graph.edges.length}</strong>{t("relationshipsCount")}</span>
            </div>
            <h3>{t("relationships")}</h3>
            {graph.edges.map((edge) => {
              const source = characters.find((item) => item.id === edge.source);
              const target = characters.find((item) => item.id === edge.target);
              return (
                <article className="relation-row" key={edge.id}>
                  <span className={`relation-dot ${edge.status}`} />
                  <div>
                    <strong>
                      {source ? displayText(source.name, locale) : edge.source}
                      <span className="relation-arrow">{edge.mutual ? "↔" : "→"}</span>
                      {target ? displayText(target.name, locale) : edge.target}
                    </strong>
                    <p>{relationshipLabels[locale][edge.type]} · {edge.label}</p>
                    <small>{relationStatusLabels[locale][edge.status]} · {edge.strength}/5</small>
                    {edge.notes ? <details><summary>{locale === "en" ? "Notes / source evidence" : "说明 / 原文依据"}</summary><p>{edge.notes}</p></details> : null}
                  </div>
                  <IconButton label={t("edit")} icon="edit" onClick={() => { const relationship = workspace.relationships.find((item) => item.id === edge.id); if (relationship) onEditRelationship(relationship); }} />
                  <IconButton label={t("delete")} icon="trash" onClick={() => onDeleteRelationship(edge.id)} />
                </article>
              );
            })}
            {!graph.edges.length ? <EmptyState icon="graph" title={t("noRelationships")}>{t("noRelationshipsLead")}</EmptyState> : null}
          </aside>
        </div>
      )}
    </div>
  );
}
