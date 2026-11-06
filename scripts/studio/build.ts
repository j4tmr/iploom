import { existsSync, readFileSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const studioRoot = join(repositoryRoot, "apps", "studio");
const outputRoot = join(repositoryRoot, "dist-studio");
const electronRoot = join(outputRoot, "electron");
const rendererRoot = join(outputRoot, "renderer");
const appRoot = join(outputRoot, "app");
const mcpRoot = join(outputRoot, "bin");
const mcpEntry = join(studioRoot, "mcp", "server.ts");
const mcpOutput = join(mcpRoot, "iploom-mcp");

interface BuildOptions {
  rendererOnly: boolean;
  requireMcp: boolean;
}

interface PackageMetadata {
  version: string;
  author?: string;
  description?: string;
  license?: string;
}

function parseOptions(argv: string[]): BuildOptions {
  const flags = new Set(argv);
  const supported = new Set(["--renderer-only", "--mcp-binary"]);
  for (const flag of flags) {
    if (!supported.has(flag)) throw new Error(`Unknown build flag: ${flag}`);
  }
  const rendererOnly = flags.has("--renderer-only");
  const requireMcp = flags.has("--mcp-binary");
  if (rendererOnly && requireMcp) {
    throw new Error("--renderer-only and --mcp-binary cannot be combined");
  }
  return { rendererOnly, requireMcp };
}

function readPackageMetadata(): PackageMetadata {
  return JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as PackageMetadata;
}

async function buildElectronAssets(): Promise<void> {
  await rm(electronRoot, { recursive: true, force: true });
  await mkdir(electronRoot, { recursive: true });

  const common = {
    bundle: true,
    platform: "node" as const,
    format: "cjs" as const,
    target: "node22",
    external: ["electron"],
    absWorkingDir: repositoryRoot,
    sourcemap: true,
    minify: true,
    legalComments: "none" as const,
    define: { "process.env.NODE_ENV": '"production"' },
  };

  await Promise.all([
    build({
      ...common,
      entryPoints: [join(studioRoot, "electron", "main.ts")],
      outfile: join(electronRoot, "main.cjs"),
      banner: { js: "// IPloom Studio Electron main process" },
    }),
    build({
      ...common,
      entryPoints: [join(studioRoot, "electron", "preload.ts")],
      outfile: join(electronRoot, "preload.cjs"),
      banner: { js: "// IPloom Studio preload bridge" },
    }),
  ]);
}

async function buildMcp(): Promise<boolean> {
  if (!existsSync(mcpEntry)) return false;
  await rm(mcpRoot, { recursive: true, force: true });
  await mkdir(mcpRoot, { recursive: true });
  await build({
    entryPoints: [mcpEntry],
    outfile: mcpOutput,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    absWorkingDir: repositoryRoot,
    sourcemap: false,
    minify: true,
    legalComments: "none",
    define: { "import.meta.main": "true" },
    banner: { js: "#!/usr/bin/env node\n// IPloom Studio MCP server" },
    logLevel: "info",
  });
  if (process.platform !== "win32") await chmod(mcpOutput, 0o755);
  await writeFile(
    join(mcpRoot, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
    "utf8",
  );
  if (process.platform === "win32") {
    await writeFile(
      join(mcpRoot, "iploom-mcp.cmd"),
      [
        "@echo off",
        "setlocal",
        'set "ELECTRON_EXE=%~dp0..\\..\\IPloom Studio.exe"',
        'if exist "%ELECTRON_EXE%" (',
        '  set "ELECTRON_RUN_AS_NODE=1"',
        '  "%ELECTRON_EXE%" "%~dp0iploom-mcp" %*',
        "  exit /b %ERRORLEVEL%",
        ")",
        'node "%~dp0iploom-mcp" %*',
        "exit /b %ERRORLEVEL%",
        "",
      ].join("\r\n"),
      "utf8",
    );
  }
  return true;
}

async function prepareAppDirectory(): Promise<void> {
  const metadata = readPackageMetadata();
  await rm(appRoot, { recursive: true, force: true });
  await mkdir(appRoot, { recursive: true });
  await Promise.all([
    cp(rendererRoot, join(appRoot, "renderer"), { recursive: true }),
    cp(electronRoot, join(appRoot, "electron"), { recursive: true }),
    existsSync(mcpRoot)
      ? cp(mcpRoot, join(appRoot, "bin"), { recursive: true })
      : Promise.resolve(),
  ]);
  const appPackage = {
    name: "iploom-studio",
    productName: "IPloom Studio",
    version: metadata.version,
    description:
      metadata.description ??
      "IPloom Studio — build story universes, novels and 3D screen handoffs.",
    author: metadata.author ?? "j4tmr",
    license: metadata.license ?? "MIT",
    homepage: "https://github.com/j4tmr/iploom",
    repository: {
      type: "git",
      url: "https://github.com/j4tmr/iploom.git",
    },
    private: true,
    type: "commonjs",
    main: "electron/main.cjs",
  };
  await writeFile(
    join(appRoot, "package.json"),
    `${JSON.stringify(appPackage, null, 2)}\n`,
    "utf8",
  );
}

async function requireFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Expected a non-empty build artifact: ${path}`);
  }
}

function displayPath(path: string): string {
  return path.startsWith(repositoryRoot)
    ? path.slice(repositoryRoot.length + 1)
    : path;
}

async function main(): Promise<void> {
  const { rendererOnly, requireMcp } = parseOptions(process.argv.slice(2));
  if (requireMcp && !existsSync(mcpEntry)) {
    throw new Error(`Required MCP entry is missing: ${displayPath(mcpEntry)}`);
  }

  console.log("[studio] Building renderer with Vite");
  await buildRenderer({
    configFile: join(studioRoot, "vite.config.ts"),
    mode: "production",
    logLevel: "info",
  });
  await requireFile(join(rendererRoot, "index.html"));

  if (rendererOnly) {
    console.log(`[studio] Renderer ready: ${displayPath(rendererRoot)}`);
    return;
  }

  console.log("[studio] Bundling Electron main and preload with esbuild");
  await buildElectronAssets();
  await Promise.all([
    requireFile(join(electronRoot, "main.cjs")),
    requireFile(join(electronRoot, "preload.cjs")),
  ]);

  const hasMcp = await buildMcp();
  if (!hasMcp && requireMcp) {
    throw new Error(`Required MCP entry is missing: ${displayPath(mcpEntry)}`);
  }
  if (hasMcp) {
    await requireFile(mcpOutput);
    console.log(`[studio] MCP bundle ready: ${displayPath(mcpOutput)}`);
  } else {
    console.log(
      "[studio] MCP source not present; skipping dist-studio/bin/iploom-mcp",
    );
  }

  await prepareAppDirectory();
  const appPackage = JSON.parse(
    await readFile(join(appRoot, "package.json"), "utf8"),
  ) as { version?: string };
  console.log(
    `[studio] Electron app directory ready: ${displayPath(appRoot)} (v${appPackage.version})`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("[studio] Build failed", error);
    process.exitCode = 1;
  });
}
