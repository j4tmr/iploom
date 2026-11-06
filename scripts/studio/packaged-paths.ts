import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Select the distribution output, never an intermediate single-architecture app. */
export function packagedPaths() {
  const resources = process.platform === "darwin"
    ? resolve("release/mac-universal/IPloom Studio.app/Contents/Resources")
    : resolve("release/win-unpacked/resources");
  const executable = process.platform === "darwin"
    ? resolve("release/mac-universal/IPloom Studio.app/Contents/MacOS/IPloom Studio")
    : resolve("release/win-unpacked/IPloom Studio.exe");
  const mcpScript = join(resources, "bin", "iploom-mcp");
  if (![executable, mcpScript].every(existsSync)) {
    throw new Error(`Complete distribution package not found: ${executable}`);
  }
  return { executable, mcpScript };
}
