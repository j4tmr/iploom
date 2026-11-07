import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packagedPaths } from "./packaged-paths.ts";

interface SmokeOptions {
  packaged: boolean;
  appPath: string;
  arch: string | null;
}

function parseOptions(args: string[]): SmokeOptions {
  let packaged = false;
  let appPath = "dist-studio/app";
  let arch: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--packaged") packaged = true;
    else if (argument === "--app") {
      const value = args[index + 1];
      if (!value) throw new Error("--app requires a path");
      appPath = value;
      index += 1;
    } else if (argument === "--arch") {
      const value = args[index + 1];
      if (!value) throw new Error("--arch requires a value");
      arch = value;
      index += 1;
    } else {
      throw new Error(`Unknown smoke option: ${argument}`);
    }
  }
  if (arch !== null) {
    if (arch !== "x86_64" && arch !== "arm64") {
      throw new Error(`Unsupported architecture: ${arch}`);
    }
    if (!packaged) throw new Error("--arch requires --packaged");
    if (process.platform !== "darwin") {
      throw new Error("--arch is only supported on macOS");
    }
  }
  return { packaged, appPath: resolve(appPath), arch };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const temporary = mkdtempSync(join(tmpdir(), "iploom-studio-smoke-"));
  const screenshot = process.env.IPLOOM_STUDIO_SMOKE_SCREENSHOT
    ? resolve(process.env.IPLOOM_STUDIO_SMOKE_SCREENSHOT)
    : undefined;
  const saveMarker = "smoke-close-save-verified";
  const modelServer = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const output =
      "Smoke production design: stylized 3D costume continuity. ".repeat(20);
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: output.slice(0, 80) }, finish_reason: null }] })}\n\n`,
    );
    setTimeout(
      () =>
        response.end(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: output.slice(80) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        ),
      150,
    );
  });
  await new Promise<void>((resolveServer) =>
    modelServer.listen(0, "127.0.0.1", resolveServer),
  );
  const modelAddress = modelServer.address();
  if (!modelAddress || typeof modelAddress === "string")
    throw new Error("Mock model failed to start");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    IPLOOM_STUDIO_SMOKE: "1",
    IPLOOM_STUDIO_WORKSPACE: join(temporary, "workspace.json"),
    IPLOOM_STUDIO_SMOKE_SAVE_MARKER: saveMarker,
    IPLOOM_STUDIO_SMOKE_AI_ENDPOINT: `http://127.0.0.1:${modelAddress.port}/v1`,
    // The app scales its in-renderer deadlines up for the Rosetta run.
    ...(options.arch ? { IPLOOM_STUDIO_SMOKE_ARCH: options.arch } : {}),
    ...(screenshot ? { IPLOOM_STUDIO_SMOKE_SCREENSHOT: screenshot } : {}),
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  let command: string;
  let args: string[];
  if (options.packaged) {
    const { executable } = packagedPaths();
    if (options.arch) {
      command = "/usr/bin/arch";
      args = [`-${options.arch}`, executable];
      console.log(
        `[smoke] launching packaged ${executable} as ${options.arch}`,
      );
    } else {
      command = executable;
      args = process.platform === "linux" ? ["--no-sandbox"] : [];
      console.log(`[smoke] launching packaged ${executable}`);
    }
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
      // Rosetta translates the whole Electron runtime on the first Intel-slice
      // launch, and every step is slower under translation, so that run needs
      // a much larger budget. This is a backstop, not a step deadline: it has
      // to stay above the worst-case sum of the app's own deadlines (see
      // IPLOOM_STUDIO_SMOKE_ARCH in the Electron main process: 120 s shell +
      // 60 s workflow + 7 x 90 s scenario steps + 30 s save + 8 s flush =
      // 848 s) plus the cold translation, so a slow run reports its real
      // failing step instead of being killed here. Native budgets sum to 91 s.
      const timer = setTimeout(
        () => {
          child.kill("SIGKILL");
          reject(new Error("Desktop smoke test timed out"));
        },
        options.arch ? 1_100_000 : 120_000,
      );
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
    const persisted = readFileSync(join(temporary, "workspace.json"), "utf8");
    if (!persisted.includes(saveMarker)) {
      throw new Error(
        "Desktop smoke did not persist the workflow result during close",
      );
    }
    if (
      !persisted.includes("smoke-import-novel") ||
      !persisted.includes("Smoke production design")
    )
      throw new Error("Import or streamed production result was not persisted");
    console.log("[smoke] close-time workspace save verified");
  } finally {
    modelServer.closeAllConnections();
    await new Promise<void>((resolveClose) =>
      modelServer.close(() => resolveClose()),
    );
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("[smoke] failed", error);
    process.exitCode = 1;
  });
}
