import type { z } from "zod";
import { createId } from "./factory.ts";
import { validateWorkspace } from "./validate.ts";
import type {
  AbilityTemplate,
  ItemStatTemplate,
  LocalizedText,
  RuleSystem,
  StudioWorkspace,
  UiLocale,
  WorkspaceStandard,
} from "./types.ts";

/**
 * Application-level skills are declarative, reviewable AI jobs: typed input
 * fields, one prompt builder, a strict output schema, semantic validation, an
 * explicit author review, and a registration step that appends only the
 * reviewed slice to the workspace.
 *
 * A skill never edits the workspace on its own view of the model output and
 * never activates what it registers. Story-world abilities are
 * `AbilityTemplate`; application skills are `AiSkill`, so the two never share a
 * name in code.
 */

export interface AiSkillInputOption {
  value: string;
  label: LocalizedText;
}

export interface AiSkillInputField {
  key: string;
  label: LocalizedText;
  kind: "text" | "select";
  required: boolean;
  maxLength: number;
  options?: readonly AiSkillInputOption[];
  placeholder?: LocalizedText;
}

export interface AiSkillContext {
  workspace: StudioWorkspace;
  locale: UiLocale;
  universeId: string;
  input: Readonly<Record<string, string>>;
}

/** A validation finding whose path is relative to the skill output. */
export interface AiSkillIssue {
  path: string;
  message: string;
}

export interface AiSkillReview {
  at: string;
  selection: unknown;
}

export type AiSkillRunStatus =
  | "draft"
  | "validated"
  | "reviewed"
  | "registered";

/**
 * One execution of a skill. `draft` holds the prompt only; `validated` holds a
 * schema- and semantics-checked output; `reviewed` holds the author's explicit
 * selection; `registered` is final and points at what was appended.
 */
export interface AiSkillRun {
  id: string;
  skillId: string;
  skillVersion: number;
  universeId: string;
  status: AiSkillRunStatus;
  input: Record<string, string>;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  rawOutput?: string;
  output?: unknown;
  issues: AiSkillIssue[];
  review?: AiSkillReview;
}

/** Records one registration appends to the workspace. */
export interface AiSkillApplyPlan {
  standards?: WorkspaceStandard[];
  ruleSystems?: RuleSystem[];
  abilityTemplates?: AbilityTemplate[];
  itemStatTemplates?: ItemStatTemplate[];
}

export interface AiSkillParseResult {
  value?: unknown;
  issues: AiSkillIssue[];
}

/** The type-erased contract the run state machine and a UI operate on. */
export interface AiSkill {
  readonly id: string;
  readonly version: number;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly scope: "universe";
  readonly inputFields: readonly AiSkillInputField[];
  buildPrompt(context: AiSkillContext): string;
  /** Parse raw model text and validate it against the output contract. */
  parse(raw: string, context: AiSkillContext): AiSkillParseResult;
  /** Turn the author's review choices into an explicit, validated selection. */
  normalizeSelection(
    output: unknown,
    selection: unknown,
    context: AiSkillContext,
  ): unknown;
  apply(
    context: AiSkillContext,
    output: unknown,
    selection: unknown,
    now: string,
  ): AiSkillApplyPlan;
}

/** The typed definition a concrete skill author writes. */
export interface TypedAiSkill<T> {
  readonly id: string;
  readonly version: number;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly scope: "universe";
  readonly inputFields: readonly AiSkillInputField[];
  readonly outputSchema: z.ZodType<T>;
  buildPrompt(context: AiSkillContext): string;
  validateOutput?(output: T, context: AiSkillContext): AiSkillIssue[];
  /**
   * Select what the author accepted. Must reject an ambiguous or impossible
   * selection; the normalized value is stored on the run as the audit trail.
   */
  normalizeSelection?(
    output: T,
    selection: unknown,
    context: AiSkillContext,
  ): unknown;
  apply(
    context: AiSkillContext,
    output: T,
    selection: unknown,
    now: string,
  ): AiSkillApplyPlan;
}

export class AiSkillRunError extends Error {
  readonly issues: AiSkillIssue[];

  constructor(issues: AiSkillIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path || "<output>"}: ${issue.message}`)
        .join("; "),
    );
    this.name = "AiSkillRunError";
    this.issues = issues;
  }
}

function zodIssues(error: z.ZodError): AiSkillIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Models wrap JSON in prose and fences; take the outermost object. */
function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("AI output did not contain a JSON object.");
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    throw new Error(
      "AI output is not valid JSON; review the raw text and retry.",
    );
  }
}

/** Attach schema and semantic checks to a typed skill definition. */
export function defineAiSkill<T>(definition: TypedAiSkill<T>): AiSkill {
  const readOutput = (value: unknown): T => {
    const parsed = definition.outputSchema.safeParse(value);
    if (!parsed.success) throw new AiSkillRunError(zodIssues(parsed.error));
    return parsed.data;
  };
  return {
    id: definition.id,
    version: definition.version,
    title: definition.title,
    summary: definition.summary,
    scope: definition.scope,
    inputFields: definition.inputFields,
    buildPrompt: definition.buildPrompt,
    parse(raw, context) {
      let value: unknown;
      try {
        value = extractJsonObject(raw);
      } catch (reason) {
        return { issues: [{ path: "", message: messageOf(reason) }] };
      }
      const parsed = definition.outputSchema.safeParse(value);
      if (!parsed.success) return { issues: zodIssues(parsed.error) };
      const issues = definition.validateOutput?.(parsed.data, context) ?? [];
      if (issues.length) return { issues };
      return { value: parsed.data, issues: [] };
    },
    normalizeSelection(output, selection, context) {
      const value = readOutput(output);
      return definition.normalizeSelection
        ? definition.normalizeSelection(value, selection, context)
        : selection;
    },
    apply(context, output, selection, now) {
      return definition.apply(context, readOutput(output), selection, now);
    },
  };
}

function resolveInput(
  fields: readonly AiSkillInputField[],
  raw: Record<string, string>,
  issues: AiSkillIssue[],
): Record<string, string> {
  const input: Record<string, string> = {};
  for (const field of fields) {
    const candidate = raw[field.key];
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (!value) {
      if (field.required)
        issues.push({ path: field.key, message: "required field is empty" });
      continue;
    }
    if (value.length > field.maxLength) {
      issues.push({
        path: field.key,
        message: `must be at most ${field.maxLength} characters`,
      });
      continue;
    }
    if (
      field.kind === "select" &&
      !(field.options ?? []).some((option) => option.value === value)
    ) {
      issues.push({
        path: field.key,
        message: `must be one of: ${(field.options ?? [])
          .map((option) => option.value)
          .join(", ")}`,
      });
      continue;
    }
    input[field.key] = value;
  }
  return input;
}

export interface AiSkillRunContext {
  skill: AiSkill;
  workspace: StudioWorkspace;
  universeId: string;
  locale: UiLocale;
}

function skillContext(
  context: AiSkillRunContext,
  run: AiSkillRun,
): AiSkillContext {
  return {
    workspace: context.workspace,
    locale: context.locale,
    universeId: context.universeId,
    input: run.input,
  };
}

function assertRunIdentity(context: AiSkillRunContext, run: AiSkillRun): void {
  if (run.skillId !== context.skill.id)
    throw new AiSkillRunError([
      { path: "skillId", message: "run belongs to a different skill" },
    ]);
  if (run.skillVersion !== context.skill.version)
    throw new AiSkillRunError([
      {
        path: "skillVersion",
        message: "the skill definition changed; start a new run",
      },
    ]);
  if (run.universeId !== context.universeId)
    throw new AiSkillRunError([
      { path: "universeId", message: "run belongs to a different universe" },
    ]);
}

export interface CreateAiSkillRunOptions {
  skill: AiSkill;
  workspace: StudioWorkspace;
  universeId: string;
  locale: UiLocale;
  input: Record<string, string>;
  /** Fixed timestamps and ids keep tests deterministic. */
  now?: string;
  id?: string;
}

/**
 * Validate the author's input and build the prompt. Nothing is persisted and no
 * model call is made here; the caller owns transport and storage.
 */
export function createAiSkillRun(options: CreateAiSkillRunOptions): AiSkillRun {
  const { skill, workspace, universeId, locale } = options;
  if (!workspace.universes.some((universe) => universe.id === universeId))
    throw new AiSkillRunError([
      { path: "universeId", message: "unknown universe" },
    ]);
  const issues: AiSkillIssue[] = [];
  const input = resolveInput(skill.inputFields, options.input, issues);
  if (issues.length) throw new AiSkillRunError(issues);
  const now = options.now ?? new Date().toISOString();
  const prompt = skill.buildPrompt({ workspace, locale, universeId, input });
  return {
    id: options.id ?? createId("skillrun"),
    skillId: skill.id,
    skillVersion: skill.version,
    universeId,
    status: "draft",
    input,
    prompt,
    createdAt: now,
    updatedAt: now,
    issues: [],
  };
}

/**
 * Validate raw model output. A failure returns the run to `draft` with issues
 * and no usable output; the raw text is kept so the author can retry or edit
 * their input. Success clears any earlier review.
 */
export function validateAiSkillOutput(
  context: AiSkillRunContext,
  run: AiSkillRun,
  rawOutput: string,
  now = new Date().toISOString(),
): AiSkillRun {
  assertRunIdentity(context, run);
  if (run.status === "registered")
    throw new AiSkillRunError([
      { path: "status", message: "a registered run is final" },
    ]);
  const result = context.skill.parse(rawOutput, skillContext(context, run));
  const next: AiSkillRun = {
    ...run,
    rawOutput,
    updatedAt: now,
    issues: result.issues,
    review: undefined,
  };
  if (result.issues.length || result.value === undefined) {
    next.status = "draft";
    next.issues =
      result.issues.length > 0
        ? result.issues
        : [{ path: "", message: "AI output was empty" }];
    delete next.output;
    return next;
  }
  next.status = "validated";
  next.output = result.value;
  return next;
}

/** Record the author's explicit selection over a validated output. */
export function reviewAiSkillRun(
  context: AiSkillRunContext,
  run: AiSkillRun,
  selection: unknown,
  now = new Date().toISOString(),
): AiSkillRun {
  assertRunIdentity(context, run);
  if (run.status !== "validated" || run.output === undefined)
    throw new AiSkillRunError([
      { path: "status", message: "only a validated run can be reviewed" },
    ]);
  const normalized = context.skill.normalizeSelection(
    run.output,
    selection,
    skillContext(context, run),
  );
  return {
    ...run,
    status: "reviewed",
    review: { at: now, selection: normalized },
    updatedAt: now,
  };
}

export interface AiSkillRegistration {
  run: AiSkillRun;
  workspace: StudioWorkspace;
}

/**
 * Append the reviewed slice to a clone of the workspace and validate the whole
 * result. The in-memory workspace is never mutated; a rejected registration
 * throws (including the workspace validator's own error) and leaves the caller
 * with the previous state.
 */
export function registerAiSkillRun(
  context: AiSkillRunContext,
  run: AiSkillRun,
  now = new Date().toISOString(),
): AiSkillRegistration {
  assertRunIdentity(context, run);
  if (run.status !== "reviewed" || !run.review)
    throw new AiSkillRunError([
      { path: "status", message: "only a reviewed run can be registered" },
    ]);
  const plan = context.skill.apply(
    skillContext(context, run),
    run.output,
    run.review.selection,
    now,
  );
  const draft = structuredClone(context.workspace);
  draft.standards.push(...(plan.standards ?? []));
  draft.ruleSystems.push(...(plan.ruleSystems ?? []));
  draft.abilityTemplates.push(...(plan.abilityTemplates ?? []));
  draft.itemStatTemplates.push(...(plan.itemStatTemplates ?? []));
  draft.revision = context.workspace.revision + 1;
  draft.updatedAt = now;
  const workspace = validateWorkspace(draft);
  return {
    run: { ...run, status: "registered", updatedAt: now },
    workspace,
  };
}
