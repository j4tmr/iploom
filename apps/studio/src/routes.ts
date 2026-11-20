/**
 * Every capability that reads or writes a single world lives on this tab bar,
 * inside that world's detail view. The sidebar only carries workspace-level
 * tools, so there is exactly one place to find a world-scoped domain.
 *
 * `workflow` is the world's agent handoff board: tasks, their briefs for an
 * external agent, and the results written back. `stories` is where a world's
 * novels and games are created and opened.
 */
export type UniverseTab =
  | "overview"
  | "nodes"
  | "cast"
  | "atlas"
  | "graph"
  | "timeline"
  | "foundation"
  | "stories"
  | "workflow";

export type StudioRoute =
  | { name: "dashboard" }
  | { name: "universe"; id: string; tab?: UniverseTab }
  | { name: "work"; workId: string }
  | { name: "settings" };
