import { workspaceSchema } from "./schemas.ts";
import { migrateWorkspace } from "./migrations.ts";
import type { StudioWorkspace } from "./types.ts";

/** One validation failure with the location that caused it. */
export interface WorkspaceIssueDetail {
  /** Dotted path into the workspace, e.g. works.0.chapters.2.title. */
  path: string;
  /** Stable validator code such as too_small, invalid_type or custom. */
  code: string;
  /** Raw validator message, kept for technical detail. */
  message: string;
  minimum?: number;
  maximum?: number;
  origin?: string;
}

interface RawIssue {
  path?: PropertyKey[];
  code: string;
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
}

function describeIssue(issue: RawIssue): WorkspaceIssueDetail {
  const detail: WorkspaceIssueDetail = {
    path: (issue.path ?? []).map(String).join("."),
    code: issue.code,
    message: issue.message,
  };
  if (typeof issue.minimum === "number") detail.minimum = issue.minimum;
  if (typeof issue.maximum === "number") detail.maximum = issue.maximum;
  if (issue.origin) detail.origin = issue.origin;
  return detail;
}

export class WorkspaceValidationError extends Error {
  /** Human-readable one-line summaries, one per failed rule. */
  readonly issues: string[];
  /** The same failures with their structured location and rule. */
  readonly details: WorkspaceIssueDetail[];

  constructor(details: WorkspaceIssueDetail[]) {
    const issues = details.map(
      (detail) => `${detail.path || "<root>"}: ${detail.message}`,
    );
    super(issues.join("; "));
    this.name = "WorkspaceValidationError";
    this.issues = issues;
    this.details = details;
  }
}

export function validateWorkspace(value: unknown): StudioWorkspace {
  const parsed = workspaceSchema.safeParse(migrateWorkspace(value));
  if (parsed.success) return parsed.data as StudioWorkspace;
  throw new WorkspaceValidationError(
    (parsed.error.issues as unknown as RawIssue[]).map(describeIssue),
  );
}
