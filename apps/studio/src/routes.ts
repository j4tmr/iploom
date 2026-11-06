export type StudioRoute =
  | { name: "dashboard" }
  | { name: "library" }
  | { name: "universe"; id: string; tab?: "overview" | "cast" | "atlas" | "graph" | "stories" }
  | { name: "work"; workId: string }
  | { name: "cast"; universeId?: string }
  | { name: "graph"; universeId?: string }
  | { name: "timeline"; universeId?: string }
  | { name: "workflow" }
  | { name: "foundation" }
  | { name: "exports" }
  | { name: "settings" };

export function routeKey(route: StudioRoute): string {
  switch (route.name) {
    case "universe":
      return `universe:${route.id}:${route.tab ?? "overview"}`;
    case "work":
      return `work:${route.workId}`;
    case "cast":
      return `cast:${route.universeId ?? "all"}`;
    case "graph":
      return `graph:${route.universeId ?? "all"}`;
    case "timeline":
      return `timeline:${route.universeId ?? "all"}`;
    default:
      return route.name;
  }
}
