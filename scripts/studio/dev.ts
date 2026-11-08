import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { context, type BuildContext, type Plugin } from "esbuild";
import { createServer, type ViteDevServer } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const studioRoot = join(repositoryRoot, "apps", "studio");
const outputRoot = join(repositoryRoot, "dist-studio");
const electronRoot = join(outputRoot, "electron");

type Target = "main" | "preload";

let electronProcess: ChildProcess | null = null;
let viteServer: ViteDevServer | null = null;
let contexts: BuildContext[] = [];
let shuttingDown = false;
let restartTimer: NodeJS.Timeout | undefined;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet<ChildProcess>();
const readyTargets = new Set<Target>();

function electronExecutable(): string {
  const require = createRequire(import.meta.url);
  const executable = require("electron") as string;
  if (!existsSync(executable)) {
    throw new Error(
      "Electron binary is unavailable. Run the existing dependency install so electron can download its runtime.",
    );
  }
  return executable;
}

function developmentOptions(
  target: Target,
  onBuilt: (target: Target) => void,
): Parameters<typeof context>[0] {
  const plugin: Plugin = {
    name: `iploom-${target}-watcher`,
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length) {
          console.error(`[studio] ${target} rebuild failed`);
          return;
        }
        onBuilt(target);
      });
    },
  };
  return {
    entryPoints: [join(studioRoot, "electron", `${target}.ts`)],
    outfile: join(electronRoot, `${target}.cjs`),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
    absWorkingDir: repositoryRoot,
    sourcemap: true,
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
    plugins: [plugin],
  };
}

function scheduleRestart(): void {
  if (shuttingDown) return;
  if (readyTargets.size < 2) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartQueue = restartQueue
      .then(async () => {
        if (shuttingDown) return;
        await stopElectron();
        startElectron();
      })
      .catch((error: unknown) => {
        console.error("[studio] Electron restart failed", error);
        void shutdown(1);
      });
  }, 180);
}

function markBuilt(target: Target): void {
  if (!readyTargets.has(target)) {
    readyTargets.add(target);
    console.log(`[studio] ${target} bundle ready`);
  }
  scheduleRestart();
}

function startElectron(): void {
  if (shuttingDown || !viteServer) return;
  const devUrl = viteServer.resolvedUrls?.local[0] ?? "http://127.0.0.1:5188/";
  const executable = electronExecutable();
  const processHandle = spawn(executable, [join(electronRoot, "main.cjs")], {
    stdio: "inherit",
    env: {
      ...process.env,
      IPLOOM_STUDIO_DEV_URL: devUrl,
      IPLOOM_STUDIO_WORKSPACE: resolve(
        repositoryRoot,
        ".studio",
        "workspace.json",
      ),
    },
  });
  electronProcess = processHandle;
  processHandle.once("error", (error) => {
    console.error("[studio] Electron failed to launch", error);
    void shutdown(1);
  });
  processHandle.once("exit", (code) => {
    if (electronProcess === processHandle) electronProcess = null;
    if (!shuttingDown && !expectedExits.has(processHandle)) {
      void shutdown(code ?? 0);
    }
  });
  console.log(`[studio] Electron launched against ${devUrl}`);
}

async function stopElectron(): Promise<void> {
  const processHandle = electronProcess;
  if (!processHandle || processHandle.exitCode !== null) {
    electronProcess = null;
    return;
  }
  expectedExits.add(processHandle);
  await new Promise<void>((resolveExit) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      resolveExit();
    };
    processHandle.once("exit", finish);
    forceTimer = setTimeout(() => {
      processHandle.kill("SIGKILL");
      finish();
    }, 3_000);
    forceTimer.unref();
    processHandle.kill();
  });
  if (electronProcess === processHandle) electronProcess = null;
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  await stopElectron();
  await Promise.allSettled(
    contexts.map((buildContext) => buildContext.dispose()),
  );
  if (viteServer) await viteServer.close().catch(() => undefined);
  process.exit(code);
}

async function main(): Promise<void> {
  viteServer = await createServer({
    configFile: join(studioRoot, "vite.config.ts"),
    clearScreen: false,
    server: { hmr: false },
  });
  await viteServer.listen();
  viteServer.printUrls();
  console.log(
    "[studio] React refresh is disabled to keep the production CSP active; refresh the Electron window after renderer edits.",
  );

  contexts = await Promise.all([
    context(developmentOptions("main", markBuilt)),
    context(developmentOptions("preload", markBuilt)),
  ]);
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

main().catch((error: unknown) => {
  console.error("[studio] Development launcher failed", error);
  void shutdown(1);
});
