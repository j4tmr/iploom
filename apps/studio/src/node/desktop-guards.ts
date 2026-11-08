import { realpath, stat } from "node:fs/promises";
import { basename, dirname, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ARC_REEL_SCHEMA, type ArcReelBundle } from "../core/types.ts";
import { englishMainMessages, type MainMessages } from "./messages.ts";

/**
 * Pure policy shared by the Electron main process, the MCP server and tests.
 * Nothing here imports Electron, so every CI platform can exercise the guards
 * (including the Windows path folding branch) without launching the app.
 */

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Hard ceilings applied before an exported ArcReel package touches the disk. */
export const ARC_REEL_EXPORT_LIMITS = {
  maxFiles: 2_048,
  /** UTF-8 bytes per file; the largest chapter cap is 2M characters. */
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxPathLength: 512,
} as const;

const BLOCKED_SHELL_EXTENSIONS = /\.(?:app|pkg|bundle)$/i;

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === "win32" ? win32 : posix;
}

/** Resolves a path and folds case on Windows, where the filesystem is case-insensitive. */
export function canonicalPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const absolute = pathApi(platform).resolve(value);
  return platform === "win32" ? absolute.toLowerCase() : absolute;
}

/** True when `child` is `parent` itself or lives below it; `/a/b` is not within `/a/bc`. */
export function isWithin(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const api = pathApi(platform);
  const path = api.relative(
    canonicalPath(parent, platform),
    canonicalPath(child, platform),
  );
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${api.sep}`) && !api.isAbsolute(path))
  );
}

/** The development renderer URL must be an explicit loopback HTTP origin. */
export function parseDevUrl(
  raw: string | undefined | null,
  packaged: boolean,
): URL | null {
  if (packaged) return null;
  const value = raw?.trim();
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "IPLOOM_STUDIO_DEV_URL must be a loopback HTTP URL in development",
    );
  }
  return url;
}

export interface RendererTrustOptions {
  rendererRoot: string;
  devOrigin?: URL | string | null;
  platform?: NodeJS.Platform;
}

/**
 * Accepts the packaged renderer's own files, or the configured dev origin.
 * A `file:` URL with any host (`file://host/...`) is never trusted, and the
 * decoded path must stay inside the renderer root.
 */
export function isTrustedRendererUrl(
  value: string,
  options: RendererTrustOptions,
): boolean {
  try {
    const target = new URL(value);
    if (options.devOrigin) {
      const dev =
        typeof options.devOrigin === "string"
          ? new URL(options.devOrigin)
          : options.devOrigin;
      return target.origin === dev.origin;
    }
    if (target.protocol !== "file:" || target.hostname) return false;
    return isWithin(
      options.rendererRoot,
      fileURLToPath(target),
      options.platform,
    );
  } catch {
    return false;
  }
}

/** Only credential-free HTTP(S) links may leave the app through the OS. */
export function safeExternalUrl(value: string): URL | null {
  try {
    if (value.length > 8_192) return null;
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Application bundles would be launched by the OS when revealed, so never let one through. */
export function isBlockedShellTarget(value: string): boolean {
  return BLOCKED_SHELL_EXTENSIONS.test(value.replace(/[\\/]+$/, ""));
}

/**
 * Resolves as much of `value` as currently exists, then re-joins the missing
 * suffix. This lets a not-yet-created export directory be checked against the
 * real path of its nearest existing ancestor, so a symlinked ancestor cannot
 * smuggle a write outside the allowed root.
 */
export async function realPathWithExistingAncestor(
  value: string,
): Promise<string> {
  let current = resolve(value);
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return resolve(real, ...missing.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(value);
    missing.push(basename(current));
    current = parent;
  }
}

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const nonNegativeInt = z.number().int().nonnegative();

const arcReelFileSchema = z
  .object({
    path: z.string().min(1).max(ARC_REEL_EXPORT_LIMITS.maxPathLength),
    content: z.string().max(ARC_REEL_EXPORT_LIMITS.maxFileBytes),
    mediaType: z.enum(["application/json", "text/markdown", "text/plain"]),
  })
  .strict();

const arcReelChapterPreviewSchema = z
  .object({
    chapterId: identifier,
    number: nonNegativeInt,
    title: z.string().max(1_000),
    status: z.enum(["idea", "outline", "draft", "revised", "approved"]),
    words: nonNegativeInt,
    sceneCount: nonNegativeInt,
    shotCount: nonNegativeInt,
  })
  .strict();

/**
 * Full validation of a bundle arriving over IPC. The renderer can be
 * compromised, so nothing in the payload is trusted: identifiers, hash,
 * timestamp, file paths and the total size are all checked before export.
 */
export const arcReelBundleSchema = z
  .object({
    schema: z.literal(ARC_REEL_SCHEMA),
    generatedAt: z.string().datetime({ offset: true }),
    workspaceRevision: nonNegativeInt,
    universeId: identifier,
    workId: identifier,
    workTitle: z.string().max(500),
    workLanguage: z.enum(["zh-CN", "en"]),
    aspectRatio: z.string().regex(/^\d{1,3}:\d{1,3}$/),
    style: z.literal("stylized-3d-animation"),
    chapters: z.array(arcReelChapterPreviewSchema).max(10_000),
    totalWords: nonNegativeInt,
    totalScenes: nonNegativeInt,
    totalShots: nonNegativeInt,
    warnings: z.array(z.string().max(2_000)).max(1_000),
    files: z
      .array(arcReelFileSchema)
      .min(1)
      .max(ARC_REEL_EXPORT_LIMITS.maxFiles),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const encoder = new TextEncoder();
    let total = 0;
    for (const file of bundle.files) {
      total += encoder.encode(file.content).byteLength;
      if (total > ARC_REEL_EXPORT_LIMITS.maxTotalBytes) {
        ctx.addIssue({
          code: "custom",
          message: "ArcReel export exceeds the total size limit",
        });
        return;
      }
    }
  });

/** Parses an untrusted ArcReel bundle without echoing any payload back in errors. */
export function parseArcReelBundle(
  value: unknown,
  messages: MainMessages["guards"] = englishMainMessages.guards,
): ArcReelBundle {
  const parsed = arcReelBundleSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length
      ? messages.invalidArcReelBundleAt(issue.path.join("."))
      : "";
    throw new Error(messages.invalidArcReelBundle(where));
  }
  return parsed.data;
}

export interface RevealDependencies {
  allowedFolders: Iterable<string>;
  showItemInFolder: (path: string) => void;
  platform?: NodeJS.Platform;
  stat?: (path: string) => Promise<{
    isFile(): boolean;
    isDirectory(): boolean;
  }>;
  realpath?: (path: string) => Promise<string>;
  messages?: MainMessages["guards"];
}

/**
 * Reveals a file or folder in the OS file manager, but only when its real
 * path (symlinks resolved) stays inside a location the main process created.
 * The renderer can write `workspace.exports[].outputPath`, so that data is
 * never used to widen this list. Application bundles are refused outright:
 * revealing a `.app` can launch it.
 */
export async function revealKnownPath(
  value: string,
  deps: RevealDependencies,
): Promise<string> {
  const messages = deps.messages ?? englishMainMessages.guards;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(messages.revealPathMustBeString);
  }
  const platform = deps.platform ?? process.platform;
  const target = canonicalPath(value, platform);
  const allowedFolders = [...deps.allowedFolders];
  // Reject anything outside the allowlist before touching the filesystem.
  // stat/realpath first would turn the differing errors into a filesystem
  // existence/type oracle, and on Windows a UNC path would make the main
  // process authenticate to an attacker-chosen SMB server. The post-realpath
  // check below still catches paths that escape through a symlink.
  if (!allowedFolders.some((folder) => isWithin(folder, target, platform))) {
    throw new Error(messages.revealOutsideKnownLocations);
  }
  if (isBlockedShellTarget(target)) {
    throw new Error(messages.revealBlockedBundle);
  }
  const fileStat = deps.stat ?? stat;
  let info: { isFile(): boolean; isDirectory(): boolean };
  try {
    info = await fileStat(target);
  } catch {
    throw new Error(messages.revealPathDoesNotExist);
  }
  if (!info.isFile() && !info.isDirectory()) {
    throw new Error(messages.revealNotFileOrDirectory);
  }
  const fileRealpath = deps.realpath ?? realpath;
  let real: string;
  try {
    real = await fileRealpath(target);
  } catch {
    throw new Error(messages.revealNotAccessible);
  }
  if (isBlockedShellTarget(real)) {
    throw new Error(messages.revealBlockedBundle);
  }
  const allowed = await Promise.all(
    allowedFolders.map(async (folder) => {
      try {
        return isWithin(
          await fileRealpath(canonicalPath(folder, platform)),
          real,
          platform,
        );
      } catch {
        return false;
      }
    }),
  );
  if (!allowed.some(Boolean)) {
    throw new Error(messages.revealOutsideKnownLocations);
  }
  deps.showItemInFolder(real);
  return real;
}

/**
 * The only workspace-derived locations the main process reveals: the directory
 * holding workspace.json and the snapshot directory. Export records are
 * deliberately excluded because the renderer controls them.
 */
export function workspaceRevealFolders(
  workspaceFile: string,
  snapshotDirectory: string,
): string[] {
  return [
    canonicalPath(dirname(workspaceFile)),
    canonicalPath(snapshotDirectory),
  ];
}
