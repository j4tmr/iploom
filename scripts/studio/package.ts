import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const directoryOnly = process.argv.slice(2);
if (directoryOnly.some((arg) => arg !== "--dir")) {
  throw new Error("Only --dir is supported");
}
const target = process.platform === "darwin"
  ? ["--mac", "--universal"]
  : process.platform === "win32"
    ? ["--win", "--x64"]
    : null;
if (!target) throw new Error("Package on a macOS or Windows host");
const require = createRequire(import.meta.url);
const result = spawnSync("node", [
  require.resolve("electron-builder/out/cli/cli.js"),
  "--config", "scripts/studio/electron-builder.mjs",
  ...target,
  ...directoryOnly,
], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
