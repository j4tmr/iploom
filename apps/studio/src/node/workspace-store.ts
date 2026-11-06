import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { createEmptyWorkspace } from "../core/factory.ts";
import { validateWorkspace, WorkspaceValidationError } from "../core/validate.ts";
import type { ArcReelBundle, StudioWorkspace } from "../core/types.ts";

export interface LoadedWorkspace {
  workspace: StudioWorkspace;
  path: string;
  recoveredFromBackup: boolean;
}

export interface WrittenBundle {
  directory: string;
  files: number;
  bytes: number;
}

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
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "iploom"
  );
}

export class WorkspaceStore {
  readonly filePath: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  async ensure(): Promise<LoadedWorkspace> {
    if (await exists(this.filePath)) return this.load();
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

  private async writeWorkspace(workspace: StudioWorkspace): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const content = `${JSON.stringify(workspace, null, 2)}\n`;
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
    if (await exists(this.filePath)) {
      await copyFile(this.filePath, backupPath(this.filePath));
    }
    await rename(temp, this.filePath);
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
