import { workspaceSchema } from "./schemas.ts";
import { migrateWorkspace } from "./migrations.ts";
import type { StudioWorkspace } from "./types.ts";

export class WorkspaceValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "WorkspaceValidationError";
    this.issues = issues;
  }
}

export function validateWorkspace(value: unknown): StudioWorkspace {
  const parsed = workspaceSchema.safeParse(migrateWorkspace(value));
  if (parsed.success) return parsed.data as StudioWorkspace;
  throw new WorkspaceValidationError(
    parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    ),
  );
}
