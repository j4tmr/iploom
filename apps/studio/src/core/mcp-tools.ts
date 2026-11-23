import type { UiLocale } from "./types.ts";

/** How a tool touches data. Reads never write; writes change the workspace. */
export type McpToolAccess = "read" | "write";

export interface McpToolDefinition {
  readonly name: string;
  readonly access: McpToolAccess;
}

/**
 * The MCP tool registry, in `tools/list` order. The stdio server registers
 * exactly this list, and both in-app settings surfaces render it, so the tool
 * names and the counts in their copy can never drift apart.
 */
export const MCP_TOOLS = [
  { name: "list_story_worlds", access: "read" },
  { name: "get_story_world", access: "read" },
  { name: "list_novels", access: "read" },
  { name: "get_novel", access: "read" },
  { name: "get_chapter", access: "read" },
  { name: "search_ip", access: "read" },
  { name: "get_relationship_graph", access: "read" },
  { name: "list_timeline_events", access: "read" },
  { name: "list_workflow_tasks", access: "read" },
  { name: "get_workflow_brief", access: "read" },
  { name: "get_workflow_result", access: "read" },
  { name: "list_standards", access: "read" },
  { name: "get_standard", access: "read" },
  { name: "list_card_types", access: "read" },
  { name: "list_cards", access: "read" },
  { name: "list_rule_systems", access: "read" },
  { name: "get_rule_system", access: "read" },
  { name: "check_rule_consistency", access: "read" },
  { name: "create_standard", access: "write" },
  { name: "update_standard", access: "write" },
  { name: "create_timeline_event", access: "write" },
  { name: "update_timeline_event", access: "write" },
  { name: "save_workflow_result", access: "write" },
  { name: "create_rule_system", access: "write" },
  { name: "update_rule_system", access: "write" },
  { name: "upsert_ability_template", access: "write" },
  { name: "upsert_item_stat_template", access: "write" },
  { name: "set_entity_rule_binding", access: "write" },
] as const satisfies readonly McpToolDefinition[];

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];

export const MCP_TOOL_NAMES: readonly McpToolName[] = MCP_TOOLS.map(
  (tool) => tool.name,
);

function namesWithAccess(access: McpToolAccess): readonly McpToolName[] {
  return MCP_TOOLS.filter((tool) => tool.access === access).map(
    (tool) => tool.name,
  );
}

export const MCP_READ_TOOL_NAMES = namesWithAccess("read");
export const MCP_WRITE_TOOL_NAMES = namesWithAccess("write");

export const MCP_TOOL_COUNTS = {
  total: MCP_TOOL_NAMES.length,
  read: MCP_READ_TOOL_NAMES.length,
  write: MCP_WRITE_TOOL_NAMES.length,
} as const;

export function mcpToolsNote(locale: UiLocale): string {
  const { read, write } = MCP_TOOL_COUNTS;
  if (locale === "en") {
    return `${read} read-only query tools + ${write} workspace ${
      write === 1 ? "writer" : "writers"
    }.`;
  }
  return `${read} 个只读查询工具 + ${write} 个工作区写入工具。`;
}
