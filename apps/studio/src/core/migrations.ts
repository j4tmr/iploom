import { WORKSPACE_SCHEMA_VERSION } from "./types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Upgrade known workspace versions before strict validation. */
export function migrateWorkspace(value: unknown): unknown {
  if (!record(value)) return value;
  if (value.schema_version === 1) {
    return {
      ...value,
      schema_version: WORKSPACE_SCHEMA_VERSION,
      workflowTasks: [],
      revision:
        typeof value.revision === "number" ? value.revision + 1 : value.revision,
    };
  }
  return value;
}
