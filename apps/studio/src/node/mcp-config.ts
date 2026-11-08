import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { McpClientConfig } from "../platform.ts";

export interface ElectronMcpConfigInput {
  executable: string;
  mcpScript: string;
  workspacePath: string;
}

export function createElectronMcpConfig(
  input: ElectronMcpConfigInput,
): McpClientConfig {
  return {
    mcpServers: {
      "iploom-studio": {
        command: input.executable,
        args: [input.mcpScript, "--workspace", input.workspacePath],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    },
  };
}

export interface McpFsOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Injected for tests; defaults to node:fs existsSync. */
  exists?: (path: string) => boolean;
}

export interface McpBinaryOptions extends McpFsOptions {
  /** Packaged: process.resourcesPath. Dev: the built `dist-studio` directory. */
  resourcesRoot: string;
}

/** Env override first, then `<root>/bin/iploom-mcp`, then `<root>/iploom-mcp`. */
export function resolveMcpBinary(options: McpBinaryOptions): string | null {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const override = env.IPLOOM_MCP_BINARY?.trim();
  const candidates = [
    ...(override ? [override] : []),
    join(options.resourcesRoot, "bin", "iploom-mcp"),
    join(options.resourcesRoot, "iploom-mcp"),
  ];
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export interface BunBinaryOptions extends McpFsOptions {
  /** Extra directories to probe after the well-known ones; default PATH split. */
  pathEnv?: string;
}

/** An absolute bun path, or null. Never returns a bare "bun". */
export function resolveBunBinary(
  options: BunBinaryOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const name = platform === "win32" ? "bun.exe" : "bun";
  const candidates: string[] = [];
  if (env.BUN_INSTALL) candidates.push(join(env.BUN_INSTALL, "bin", name));
  const home = env.HOME ?? env.USERPROFILE ?? "";
  if (home) candidates.push(join(home, ".bun", "bin", name));
  candidates.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`);
  const pathEnv = options.pathEnv ?? env.PATH ?? "";
  for (const directory of pathEnv.split(delimiter)) {
    if (directory) candidates.push(join(directory, name));
  }
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export interface McpClientConfigOptions extends McpBinaryOptions {
  executable: string;
  workspacePath: string;
  /**
   * Absolute paths that may contain apps/studio/mcp/server.ts in a dev
   * checkout, in priority order.
   */
  sourceCandidates: readonly string[];
  pathEnv?: string;
}

export interface McpClientConfigState {
  config: McpClientConfig | null;
  /** Human-readable reason config is null; null when config is present. */
  error: string | null;
  /** The bundled binary path when one was found, else null. */
  binary: string | null;
}

export function mcpClientConfigState(
  options: McpClientConfigOptions,
): McpClientConfigState {
  const exists = options.exists ?? existsSync;
  const binary = resolveMcpBinary(options);
  if (binary) {
    return {
      config: createElectronMcpConfig({
        executable: options.executable,
        mcpScript: binary,
        workspacePath: options.workspacePath,
      }),
      error: null,
      binary,
    };
  }
  const source = options.sourceCandidates.find((candidate) =>
    exists(candidate),
  );
  if (!source) {
    return {
      config: null,
      error: "Bundled MCP server is missing from this installation.",
      binary: null,
    };
  }
  const bun = resolveBunBinary(options);
  if (!bun) {
    return {
      config: null,
      error:
        "The development MCP server needs Bun, but no Bun executable was found.",
      binary: null,
    };
  }
  return {
    config: {
      mcpServers: {
        "iploom-studio": {
          command: bun,
          args: [source, "--workspace", options.workspacePath],
        },
      },
    },
    error: null,
    binary: null,
  };
}
