import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { arcReelSlug } from "../core/arcreel.ts";
import { createEmptyWorkspace } from "../core/factory.ts";
import { validateWorkspace, WorkspaceValidationError } from "../core/validate.ts";
import { migrateWorkspace } from "../core/migrations.ts";
import {
  WORKSPACE_SCHEMA_VERSION,
  type ArcReelBundle,
  type StudioWorkspace,
} from "../core/types.ts";
import { parseArcReelBundle } from "./desktop-guards.ts";

export interface LoadedWorkspace {
  workspace: StudioWorkspace;
  path: string;
  recoveredFromBackup: boolean;
  /** Present when the operation stored a recoverable pre-change snapshot. */
  snapshotPath?: string | null;
  /** Present when an unreadable primary file was moved aside during recovery. */
  rejectedPath?: string | null;
  /** Validation detail for the quarantined primary file. */
  rejectedReason?: string | null;
}

/**
 * The desktop app and the MCP server are separate processes sharing one
 * workspace file. Saving an older revision after another process wrote a
 * newer one would roll the workspace back, so the write is refused instead
 * (and marked non-retryable: retrying cannot help).
 */
export class StaleWorkspaceError extends Error {
  readonly retryable = false;

  constructor(
    readonly path: string,
    readonly storedRevision: number,
    readonly incomingRevision: number,
    readonly baseRevision?: number,
  ) {
    super(
      storedRevision === incomingRevision
        ? `Refusing to overwrite ${path} revision ${storedRevision} with different ` +
            `content. Another process (for example the MCP server) changed the ` +
            `workspace. Reload the workspace to continue from the newer file; ` +
            `the file was left untouched.`
        : baseRevision != null && baseRevision < storedRevision
          ? `Refusing to overwrite ${path} revision ${storedRevision} with a draft ` +
            `based on revision ${baseRevision} (incoming revision ${incomingRevision}). ` +
            `Another process (for example the MCP server) changed the workspace. ` +
            `Reload the workspace to continue from the newer file; ` +
            `the file was left untouched.`
          : `Refusing to overwrite ${path} revision ${storedRevision} with older ` +
            `revision ${incomingRevision}. Another process (for example the MCP ` +
            `server) changed the workspace. Reload the workspace to continue from ` +
            `the newer file; the file was left untouched.`,
    );
    this.name = "StaleWorkspaceError";
  }
}

export class NewerWorkspaceVersionError extends Error {
  readonly path: string;
  readonly foundVersion: number;

  constructor(path: string, foundVersion: number) {
    super(
      `This workspace was created by a newer IPloom Studio (schema ${foundVersion}; ` +
        `this build supports ${WORKSPACE_SCHEMA_VERSION}). Update the app to open ${path}. ` +
        `The file was left untouched.`,
    );
    this.name = "NewerWorkspaceVersionError";
    this.path = path;
    this.foundVersion = foundVersion;
  }
}

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export interface RenameRetryOptions {
  attempts?: number;
  delayMs?: number;
  platform?: NodeJS.Platform;
  renameImpl?: (from: string, to: string) => Promise<void>;
}

/**
 * Windows can transiently fail a rename while Defender, the indexer or OneDrive
 * holds the file. Retry the transient codes a bounded number of times.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameRetryOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const attempts = options.attempts ?? (platform === "win32" ? 10 : 3);
  const delayMs = options.delayMs ?? 100;
  const renameImpl = options.renameImpl ?? rename;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await renameImpl(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        !code ||
        !RETRYABLE_RENAME_CODES.has(code) ||
        attempt >= attempts
      ) {
        throw error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
}

async function writeFileDurable(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is best-effort; some filesystems reject it.
  }
}

function schemaVersionOf(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const version = (value as { schema_version?: unknown }).schema_version;
  return typeof version === "number" && Number.isFinite(version)
    ? version
    : null;
}

const STALE_TEMP_MS = 5 * 60 * 1000;

function formatReadError(path: string, error: unknown): string {
  return `${path}: ${error instanceof Error ? error.message : String(error)}`;
}

function formatValidationError(path: string, error: unknown): string {
  return `${path}: ${
    error instanceof WorkspaceValidationError
      ? error.issues.slice(0, 5).join("; ")
      : error instanceof Error
        ? error.message
        : String(error)
  }`;
}

/**
 * Both sides are `validateWorkspace` output, so the comparison is against the
 * zod-canonical shape: unknown keys are stripped and defaults applied, meaning
 * an honest idempotent re-save compares equal regardless of the transport.
 */
function sameWorkspaceContent(
  left: StudioWorkspace,
  right: StudioWorkspace,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface WorkspaceSaveOptions {
  /** Snapshot restore and demo reset intentionally move the workspace backwards. */
  allowRollback?: boolean;
  /**
   * Revision of the last state this writer knows was persisted (optimistic
   * concurrency). An external writer may have advanced the file since then;
   * saving over it is only safe when the content is identical.
   */
  baseRevision?: number;
}

export interface WrittenBundle {
  directory: string;
  files: number;
  bytes: number;
}

export interface WorkspaceSnapshot {
  path: string;
  name: string;
  createdAt: string;
  bytes: number;
  reason: string;
}

/**
 * Snapshots are deliberately not rotated into `workspace.json.bak`: the single
 * `.bak` slot belongs to the last successful save, which is exactly what the
 * demo reset and renderer autosave overwrite. Snapshots live in their own
 * directory and are pruned by age and count instead.
 */
const SNAPSHOT_NAME = /^workspace-(\d+)-(\d+)-([a-z0-9-]{1,40})\.json$/;
const SNAPSHOT_REASON = /^[a-z0-9-]{1,40}$/;
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let snapshotSequence = 0;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function backupPath(path: string): string {
  return `${path}.bak`;
}

function safeBundlePath(value: string): string {
  const normalized = normalize(value).replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0")
  )
    throw new Error(`Unsafe export path: ${value}`);
  return normalized;
}

export class WorkspaceStore {
  readonly filePath: string;
  readonly snapshotDirectory: string;
  private saveQueue: Promise<void> = Promise.resolve();
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
    this.snapshotDirectory = join(dirname(this.filePath), "snapshots");
  }

  async ensure(): Promise<LoadedWorkspace> {
    if (await exists(this.filePath) || await exists(backupPath(this.filePath)))
      return this.load();
    const workspace = createEmptyWorkspace("My Story Multiverse");
    await this.save(workspace);
    return {
      workspace,
      path: this.filePath,
      recoveredFromBackup: false,
    };
  }

  async load(): Promise<LoadedWorkspace> {
    await this.cleanupStaleTemps();
    const errors: string[] = [];
    let primaryError: string | null = null;
    for (const [candidate, fromBackup] of [
      [this.filePath, false],
      [backupPath(this.filePath), true],
    ] as const) {
      if (!(await exists(candidate))) continue;
      let parsed: unknown;
      try {
        const raw = await readFile(candidate, "utf8");
        parsed = JSON.parse(raw);
      } catch (error) {
        const detail = formatReadError(candidate, error);
        errors.push(detail);
        if (!fromBackup) primaryError = detail;
        continue;
      }
      const version = schemaVersionOf(parsed);
      if (version !== null && version > WORKSPACE_SCHEMA_VERSION)
        throw new NewerWorkspaceVersionError(candidate, version);
      let workspace: StudioWorkspace;
      try {
        workspace = validateWorkspace(migrateWorkspace(parsed));
      } catch (error) {
        const detail = formatValidationError(candidate, error);
        errors.push(detail);
        if (!fromBackup) primaryError = detail;
        continue;
      }
      if (fromBackup) {
        const rejectedPath =
          primaryError === null
            ? null
            : await this.quarantinePrimary(primaryError);
        // Adopt the recovered copy as the new primary immediately. Without a
        // primary file the snapshot guard has nothing healthy to snapshot and
        // refuses every delete/import until an unrelated edit triggers a save.
        // Best-effort: a read-only workspace directory must still hand the
        // recovered workspace back to the editor.
        try {
          await this.save(workspace);
        } catch {
          // The next successful write path adopts the recovered state.
        }
        return {
          workspace,
          path: this.filePath,
          recoveredFromBackup: true,
          rejectedPath,
          rejectedReason: primaryError,
        };
      }
      return {
        workspace,
        path: this.filePath,
        recoveredFromBackup: false,
      };
    }
    throw new Error(
      `Workspace is missing or invalid. ${errors.join(" | ") || this.filePath}`,
    );
  }

  /**
   * Move an unreadable primary file out of the way before handing the `.bak`
   * back to the editor. Without this, the first autosave would silently
   * overwrite the newer file that this build could not read.
   */
  private async quarantinePrimary(reason: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const target = `${this.filePath}.rejected-${stamp}${
        attempt === 0 ? "" : `-${attempt}`
      }`;
      if (await exists(target)) continue;
      try {
        await renameWithRetry(this.filePath, target);
      } catch (error) {
        throw new Error(
          `Recovered from ${backupPath(this.filePath)}, but could not isolate the ` +
            `unreadable file ${this.filePath}: ${
              error instanceof Error ? error.message : String(error)
            }. ${reason}`,
        );
      }
      return target;
    }
    throw new Error(`Could not find a free name to isolate ${this.filePath}`);
  }

  private async cleanupStaleTemps(): Promise<void> {
    const directory = dirname(this.filePath);
    if (!(await exists(directory))) return;
    const prefix = `${basename(this.filePath)}.tmp-`;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const cutoff = Date.now() - STALE_TEMP_MS;
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
        .map(async (entry) => {
          const path = join(directory, entry.name);
          try {
            const info = await stat(path);
            if (info.mtimeMs < cutoff) await rm(path, { force: true });
          } catch {
            // A file that vanished mid-cleanup needs no further work.
          }
        }),
    );
  }

  async save(
    workspace: StudioWorkspace,
    options: WorkspaceSaveOptions = {},
  ): Promise<void> {
    const valid = validateWorkspace(workspace);
    const pending = this.saveQueue.then(() =>
      this.writeWorkspace(valid, options),
    );
    this.saveQueue = pending.catch(() => undefined);
    return pending;
  }

  /**
   * Serialize a read-modify-write cycle so concurrent MCP calls cannot lose
   * each other's changes. The workspace is reloaded inside the queue, the
   * mutator runs once, then the revision is bumped and the workspace saved.
   * A failed cycle must not poison the queue for later calls.
   */
  async update(
    mutator: (workspace: StudioWorkspace) => void,
  ): Promise<StudioWorkspace> {
    const pending = this.updateQueue.then(async () => {
      const { workspace } = await this.load();
      mutator(workspace);
      workspace.revision += 1;
      await this.save(workspace);
      return workspace;
    });
    this.updateQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async writeWorkspace(
    workspace: StudioWorkspace,
    options: WorkspaceSaveOptions,
  ): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const content = `${JSON.stringify(workspace, null, 2)}\n`;
    try {
      // Sync the new contents before it replaces the file a reader may open.
      await writeFileDurable(temp, content);
      if (await exists(this.filePath)) {
        const previous = await readFile(this.filePath, "utf8");
        let current: StudioWorkspace | null = null;
        try {
          current = validateWorkspace(migrateWorkspace(JSON.parse(previous)));
        } catch {
          // Saving over an unreadable primary file would destroy data that a
          // later build (or a manual repair) could still recover. `load()`
          // quarantines such files before returning the backup; reaching this
          // branch means the file changed after that check.
        }
        if (current === null) {
          throw new Error(
            `Refusing to overwrite unreadable workspace file ${this.filePath}. ` +
              `Reload the workspace so the file can be quarantined first.`,
          );
        }
        // The editor keeps the whole workspace in memory and autosaves it
        // without reloading while another process (the MCP server) may have
        // written a newer revision. Refusing here keeps that change instead of
        // silently rolling the file back. An equal revision is not proof that
        // the content is the same: an editor that loaded R and bumped its
        // local copy to R+1 would otherwise silently overwrite the external
        // writer's R+1. A `baseRevision` older than the file is the same
        // situation after several local edits (draft R+2 over an external
        // R+1), which revision ordering alone cannot detect. Only an identical
        // re-save (idempotent retry, lost response) passes.
        const identical = sameWorkspaceContent(current, workspace);
        const advancedSinceBase =
          options.baseRevision != null &&
          options.baseRevision < current.revision;
        if (
          !options.allowRollback &&
          (current.revision > workspace.revision ||
            (!identical &&
              (current.revision === workspace.revision || advancedSinceBase)))
        ) {
          throw new StaleWorkspaceError(
            this.filePath,
            current.revision,
            workspace.revision,
            options.baseRevision,
          );
        }
        // Renaming the previous primary keeps the `.bak` byte-identical to the
        // last good save without rewriting (and re-syncing) it.
        await renameWithRetry(this.filePath, backupPath(this.filePath));
      }
      await renameWithRetry(temp, this.filePath);
      await syncDirectory(dirname(this.filePath));
    } finally {
      await rm(temp, { force: true });
    }
  }

  /**
   * Write the in-memory workspace exactly as it is, without validation, so a
   * user whose saves keep failing can still leave the app with their data.
   */
  async saveRecoveryCopy(workspace: unknown): Promise<string> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const target = `${this.filePath}.unsaved-${stamp}${
        attempt === 0 ? "" : `-${attempt}`
      }`;
      try {
        await writeFileDurable(
          target,
          `${JSON.stringify(workspace, null, 2)}\n`,
        );
        return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new Error(`Could not find a free recovery-copy name for ${this.filePath}`);
  }

  /**
   * Copy the current workspace file into the snapshot directory. Returns null
   * when there is nothing healthy to snapshot, so a corrupted file can never
   * displace a good snapshot or block the caller.
   */
  async createSnapshot(reason = "manual"): Promise<string | null> {
    if (!SNAPSHOT_REASON.test(reason))
      throw new Error(`Unsafe snapshot reason: ${reason}`);
    await this.saveQueue;
    if (!(await exists(this.filePath))) return null;
    const raw = await readFile(this.filePath, "utf8");
    try {
      validateWorkspace(migrateWorkspace(JSON.parse(raw)));
    } catch {
      return null;
    }
    await mkdir(this.snapshotDirectory, { recursive: true });
    for (;;) {
      const target = join(
        this.snapshotDirectory,
        `workspace-${Date.now()}-${snapshotSequence++}-${reason}.json`,
      );
      try {
        await writeFile(target, raw, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        await this.pruneSnapshots();
        return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }

  async listSnapshots(): Promise<WorkspaceSnapshot[]> {
    if (!(await exists(this.snapshotDirectory))) return [];
    const entries = await readdir(this.snapshotDirectory, {
      withFileTypes: true,
    });
    const snapshots: {
      snapshot: WorkspaceSnapshot;
      time: number;
      sequence: number;
    }[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = SNAPSHOT_NAME.exec(entry.name);
      if (!match) continue;
      const path = join(this.snapshotDirectory, entry.name);
      snapshots.push({
        snapshot: {
          path,
          name: entry.name,
          createdAt: new Date(Number(match[1])).toISOString(),
          bytes: (await stat(path)).size,
          reason: match[3]!,
        },
        time: Number(match[1]),
        sequence: Number(match[2]),
      });
    }
    return snapshots
      .sort(
        (left, right) =>
          right.time - left.time || right.sequence - left.sequence,
      )
      .map((item) => item.snapshot);
  }

  /** Restore a snapshot, keeping the pre-restore state as another snapshot. */
  async restoreSnapshot(snapshotPath: string): Promise<LoadedWorkspace> {
    const target = resolve(snapshotPath);
    if (
      dirname(target) !== resolve(this.snapshotDirectory) ||
      !SNAPSHOT_NAME.test(basename(target))
    )
      throw new Error(`Not a workspace snapshot: ${snapshotPath}`);
    const raw = await readFile(target, "utf8");
    const workspace = validateWorkspace(migrateWorkspace(JSON.parse(raw)));
    await this.createSnapshot("before-restore");
    await this.save(workspace, { allowRollback: true });
    return {
      workspace,
      path: this.filePath,
      recoveredFromBackup: false,
    };
  }

  private async pruneSnapshots(): Promise<void> {
    const snapshots = await this.listSnapshots();
    const cutoff = Date.now() - SNAPSHOT_MAX_AGE_MS;
    await Promise.all(
      snapshots
        .filter(
          (snapshot, index) =>
            index >= MAX_SNAPSHOTS || Date.parse(snapshot.createdAt) < cutoff,
        )
        .map((snapshot) => rm(snapshot.path, { force: true })),
    );
  }

  async exportArcReel(
    bundleInput: ArcReelBundle,
    destinationRoot: string,
  ): Promise<WrittenBundle> {
    // Validate every field before creating anything. In particular the hash
    // and timestamp feed the directory name, so a compromised renderer could
    // otherwise escape the selected directory with `manifestSha256: "/../..//"`.
    const bundle = parseArcReelBundle(bundleInput);
    const destination = resolve(destinationRoot);
    const timestamp = bundle.generatedAt
      .replace(/[-:]/g, "")
      .replace(/\..+$/, "")
      .replace("T", "-");
    const baseDirectory = join(
      destination,
      `${arcReelSlug(bundle.workTitle)}-${timestamp}-${bundle.manifestSha256.slice(0, 8)}-arcreel`,
    );
    let directory = baseDirectory;
    for (let suffix = 2; await exists(directory); suffix += 1) {
      directory = `${baseDirectory}-${suffix}`;
    }
    // The package must stay exactly one level below the selected destination.
    if (dirname(directory) !== destination) {
      throw new Error("Export directory escapes the selected destination");
    }
    await mkdir(destination, { recursive: true });
    const staging = join(
      destination,
      `.iploom-staging-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const seen = new Set<string>();
    let bytes = 0;
    try {
      await mkdir(staging, { recursive: true });
      for (const file of bundle.files) {
        const relative = safeBundlePath(file.path);
        if (seen.has(relative))
          throw new Error(`Duplicate export file: ${relative}`);
        seen.add(relative);
        const target = resolve(staging, relative);
        if (target !== staging && !target.startsWith(`${staging}${sep}`))
          throw new Error(`Export path escapes package: ${relative}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content, "utf8");
        bytes += new TextEncoder().encode(file.content).byteLength;
      }
      await rename(staging, directory);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { directory, files: bundle.files.length, bytes };
  }
}

export function defaultWorkspacePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(
    environment.IPLOOM_STUDIO_WORKSPACE ??
      join(process.cwd(), ".studio", "workspace.json"),
  );
}
