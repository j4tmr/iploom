/**
 * Every capability that reads or writes a single world lives on this tab bar,
 * inside that world's detail view. The sidebar only carries workspace-level
 * tools, so there is exactly one place to find a world-scoped domain.
 */
export type UniverseTab =
  | "overview"
  | "nodes"
  | "cast"
  | "atlas"
  | "graph"
  | "timeline"
  | "foundation"
  | "stories";

export type StudioRoute =
  | { name: "dashboard" }
  | { name: "library" }
  | { name: "universe"; id: string; tab?: UniverseTab }
  | { name: "work"; workId: string }
  | { name: "workflow" }
  | { name: "exports" }
  | { name: "settings" };
