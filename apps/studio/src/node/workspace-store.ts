import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { createEmptyWorkspace } from "../core/factory.ts";
import { validateWorkspace, WorkspaceValidationError } from "../core/validate.ts";
import { migrateWorkspace } from "../core/migrations.ts";
import type { ArcReelBundle, StudioWorkspace } from "../core/types.ts";

export interface LoadedWorkspace {
  workspace: StudioWorkspace;
  path: string;
  recoveredFromBackup: boolean;
  /** Present when the operation stored a recoverable pre-change snapshot. */
  snapshotPath?: string | null;
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

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "iploom"
  );
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
    const errors: string[] = [];
    for (const [candidate, fromBackup] of [
      [this.filePath, false],
      [backupPath(this.filePath), true],
    ] as const) {
      if (!(await exists(candidate))) continue;
      try {
        const raw = await readFile(candidate, "utf8");
        return {
          workspace: validateWorkspace(JSON.parse(raw)),
          path: this.filePath,
          recoveredFromBackup: fromBackup,
        };
      } catch (error) {
        errors.push(
          `${candidate}: ${
            error instanceof WorkspaceValidationError
              ? error.issues.slice(0, 5).join("; ")
              : error instanceof Error
                ? error.message
                : String(error)
          }`,
        );
      }
    }
    throw new Error(
      `Workspace is missing or invalid. ${errors.join(" | ") || this.filePath}`,
    );
  }

  async save(workspace: StudioWorkspace): Promise<void> {
    const valid = validateWorkspace(workspace);
    const pending = this.saveQueue.then(() => this.writeWorkspace(valid));
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

  private async writeWorkspace(workspace: StudioWorkspace): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const backupTemp = `${temp}.bak`;
    const content = `${JSON.stringify(workspace, null, 2)}\n`;
    try {
      await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
      if (await exists(this.filePath)) {
        const previous = await readFile(this.filePath, "utf8");
        let healthy = false;
        try {
          validateWorkspace(migrateWorkspace(JSON.parse(previous)));
          healthy = true;
        } catch {
          // A recovered workspace must not replace its good backup with corruption.
        }
        if (healthy) {
          await writeFile(backupTemp, previous, { encoding: "utf8", mode: 0o600 });
          await rename(backupTemp, backupPath(this.filePath));
        }
      }
      await rename(temp, this.filePath);
    } finally {
      await Promise.all([temp, backupTemp].map((path) => rm(path, { force: true })));
    }
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
    await this.save(workspace);
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
    bundle: ArcReelBundle,
    destinationRoot: string,
  ): Promise<WrittenBundle> {
    await mkdir(destinationRoot, { recursive: true });
    const timestamp = bundle.generatedAt
      .replace(/[-:]/g, "")
      .replace(/\..+$/, "")
      .replace("T", "-");
    const baseDirectory = join(
      destinationRoot,
      `${slug(bundle.workTitle)}-${timestamp}-${bundle.manifestSha256.slice(0, 8)}-arcreel`,
    );
    let directory = baseDirectory;
    for (let suffix = 2; await exists(directory); suffix += 1) {
      directory = `${baseDirectory}-${suffix}`;
    }
    const staging = join(
      destinationRoot,
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
