import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packagedPaths } from "./packaged-paths.ts";

interface SmokeOptions {
  packaged: boolean;
  appPath: string;
}

function parseOptions(args: string[]): SmokeOptions {
  let packaged = false;
  let appPath = "dist-studio/app";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--packaged") packaged = true;
    else if (argument === "--app") {
      const value = args[index + 1];
      if (!value) throw new Error("--app requires a path");
      appPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown smoke option: ${argument}`);
    }
  }
  return { packaged, appPath: resolve(appPath) };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const temporary = mkdtempSync(join(tmpdir(), "iploom-studio-smoke-"));
  const screenshot = process.env.IPLOOM_STUDIO_SMOKE_SCREENSHOT
    ? resolve(process.env.IPLOOM_STUDIO_SMOKE_SCREENSHOT)
    : undefined;
  const saveMarker = "smoke-close-save-verified";
  const modelServer = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    request.resume();
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const output = "Smoke production design: stylized 3D costume continuity. ".repeat(20);
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: output.slice(0, 80) }, finish_reason: null }] })}\n\n`);
    setTimeout(() => response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: output.slice(80) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`), 150);
  });
  await new Promise<void>((resolveServer) => modelServer.listen(0, "127.0.0.1", resolveServer));
  const modelAddress = modelServer.address();
  if (!modelAddress || typeof modelAddress === "string") throw new Error("Mock model failed to start");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    IPLOOM_STUDIO_SMOKE: "1",
    IPLOOM_STUDIO_WORKSPACE: join(temporary, "workspace.json"),
    IPLOOM_STUDIO_SMOKE_SAVE_MARKER: saveMarker,
    IPLOOM_STUDIO_SMOKE_AI_ENDPOINT: `http://127.0.0.1:${modelAddress.port}/v1`,
    ...(screenshot ? { IPLOOM_STUDIO_SMOKE_SCREENSHOT: screenshot } : {}),
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  let command: string;
  let args: string[];
  if (options.packaged) {
    const { executable } = packagedPaths();
    command = executable;
    args = process.platform === "linux" ? ["--no-sandbox"] : [];
    console.log(`[smoke] launching packaged ${executable}`);
  } else {
    const require = createRequire(import.meta.url);
    command = require("electron") as string;
    args = [
      options.appPath,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ];
    console.log(`[smoke] launching ${command} ${args.join(" ")}`);
  }

  try {
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      const child = spawn(command, args, {
        env: environment,
        stdio: "inherit",
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Desktop smoke test timed out"));
      }, 60_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (signal) reject(new Error(`Desktop smoke exited via ${signal}`));
        else resolveExit(code ?? 1);
      });
    });
    if (exitCode !== 0) throw new Error(`Desktop smoke exited ${exitCode}`);
    const persisted = readFileSync(
      join(temporary, "workspace.json"),
      "utf8",
    );
    if (!persisted.includes(saveMarker)) {
      throw new Error(
        "Desktop smoke did not persist the workflow result during close",
      );
    }
    if (!persisted.includes("smoke-import-novel") || !persisted.includes("Smoke production design")) throw new Error("Import or streamed production result was not persisted");
    console.log("[smoke] close-time workspace save verified");
  } finally {
    modelServer.closeAllConnections();
    await new Promise<void>((resolveClose) => modelServer.close(() => resolveClose()));
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("[smoke] failed", error);
    process.exitCode = 1;
  });
}
