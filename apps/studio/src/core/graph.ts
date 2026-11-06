import { displayText } from "./factory.ts";
import type {
  RelationshipEdge,
  RelationshipGraph,
  RelationshipNode,
  StudioWorkspace,
  UiLocale,
} from "./types.ts";

export function buildRelationshipGraph(
  workspace: StudioWorkspace,
  universeId: string,
  locale: UiLocale,
): RelationshipGraph {
  const universe = workspace.universes.find((item) => item.id === universeId);
  if (!universe) throw new Error(`Unknown universe: ${universeId}`);

  const nodes: RelationshipNode[] = workspace.characters
    .filter((character) => character.universeIds.includes(universeId))
    .map((character) => ({
      id: character.id,
      kind: "character",
      label: displayText(character.name, locale),
      secondary: displayText(character.role, locale),
      color: character.color,
      degree: 0,
    }));

  const edges: RelationshipEdge[] = workspace.relationships
    .filter((relationship) => relationship.universeId === universeId)
    .map((relationship) => ({
      id: relationship.id,
      source: relationship.sourceId,
      target: relationship.targetId,
      type: relationship.type,
      label: displayText(relationship.label, locale),
      strength: relationship.strength,
      status: relationship.status,
    }));

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const warnings: string[] = [];
  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      warnings.push(`Relation ${edge.id} references a character outside ${universeId}`);
      continue;
    }
    source.degree += 1;
    target.degree += 1;
  }

  return {
    universeId,
    nodes,
    edges: edges.filter(
      (edge) => nodesById.has(edge.source) && nodesById.has(edge.target),
    ),
    warnings,
  };
}

export interface GraphLayoutNode extends RelationshipNode {
  x: number;
  y: number;
  radius: number;
}

export function layoutRelationshipGraph(
  graph: RelationshipGraph,
  width: number,
  height: number,
): GraphLayoutNode[] {
  const count = graph.nodes.length;
  if (!count) return [];
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.max(70, Math.min(width, height) / 2 - 55);
  const orbit = count <= 5 ? maxRadius * 0.72 : maxRadius;
  return graph.nodes.map((node, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const ringJitter =
      count > 12 ? (index % 3) * Math.min(36, maxRadius * 0.12) : 0;
    return {
      ...node,
      x: centerX + Math.cos(angle) * (orbit - ringJitter),
      y: centerY + Math.sin(angle) * (orbit - ringJitter),
      radius: 22 + Math.min(12, node.degree * 2.4),
    };
  });
}
