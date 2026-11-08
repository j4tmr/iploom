import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const packageVersion = readVersion(join(repositoryRoot, "package.json"));
const args = process.argv.slice(2);
const mode = args[0];

function readVersion(path: string): string {
  const metadata = JSON.parse(readFileSync(path, "utf8")) as {
    version?: unknown;
  };
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Missing version in ${path}`);
  }
  return metadata.version;
}

function fail(message: string): never {
  throw new Error(message);
}

function requireFile(relativePath: string, minimumBytes = 1): string {
  const path = join(repositoryRoot, relativePath);
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info?.isFile()) fail(`Missing file: ${relativePath}`);
  if (info.size < minimumBytes) {
    fail(`File is too small (${info.size} bytes): ${relativePath}`);
  }
  return path;
}

function requireText(relativePath: string, text: string): void {
  const source = readFileSync(join(repositoryRoot, relativePath), "utf8");
  if (!source.includes(text)) {
    fail(`${relativePath} does not contain ${JSON.stringify(text)}`);
  }
}

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function verifyInputs(): void {
  const buildArtifacts = [
    "dist-studio/electron/main.cjs",
    "dist-studio/electron/preload.cjs",
    "dist-studio/bin/iploom-mcp",
    "dist-studio/app/bin/iploom-mcp",
    "dist-studio/bin/package.json",
    "dist-studio/app/package.json",
    "dist-studio/app/renderer/index.html",
  ];
  for (const artifact of buildArtifacts) requireFile(artifact);

  for (const icon of [
    "apps/studio/build/icon.icns",
    "apps/studio/build/icon.ico",
    "apps/studio/build/icon.png",
  ]) {
    requireFile(icon, 1_000);
  }

  for (const script of [
    "dist-studio/electron/main.cjs",
    "dist-studio/electron/preload.cjs",
    "dist-studio/bin/iploom-mcp",
  ]) {
    try {
      execFileSync("node", ["--check", requireFile(script)], {
        stdio: "pipe",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      fail(`node --check failed for ${script}: ${detail}`);
    }
  }

  requireText("dist-studio/app/renderer/index.html", "Content-Security-Policy");
  requireText("dist-studio/electron/main.cjs", "ELECTRON_RUN_AS_NODE");

  const builtVersion = readVersion(
    join(repositoryRoot, "dist-studio/app/package.json"),
  );
  if (builtVersion !== packageVersion) {
    fail(
      `dist-studio/app/package.json says ${builtVersion}, package.json says ${packageVersion}`,
    );
  }

  console.log(
    `[studio] Release inputs verified for IPloom Studio ${packageVersion}`,
  );
}

function verifyDocs(): void {
  // A bumped version must ship user-facing notes. The release workflow also
  // asserts this, but checking here makes `bun run check` fail on the pull
  // request that bumps the version instead of at tag time.
  requireFile(`docs/release-notes/${packageVersion}.md`, 200);

  const versionReferences = [
    /studio-v(\d+\.\d+\.\d+)/g,
    /IPloom-Studio-(\d+\.\d+\.\d+)/g,
  ];
  const headings: Record<string, RegExp> = {
    "README.md": /Current release \*\*(\d+\.\d+\.\d+)\*\*/,
    "README.zh-CN.md": /当前发行版 \*\*(\d+\.\d+\.\d+)\*\*/,
    "site/index.html": /当前发行版\s+(\d+\.\d+\.\d+)/,
  };

  for (const [document, heading] of Object.entries(headings)) {
    const source = readFileSync(join(repositoryRoot, document), "utf8");
    let referenceCount = 0;
    for (const pattern of versionReferences) {
      for (const match of source.matchAll(pattern)) {
        referenceCount += 1;
        if (match[1] !== packageVersion) {
          fail(
            `${document} references version ${match[1]}, expected ${packageVersion}`,
          );
        }
      }
    }
    if (referenceCount === 0) {
      fail(`${document} has no download version references`);
    }
    const headingMatch = source.match(heading);
    if (!headingMatch?.[1]) {
      fail(`${document} has no current-release version heading`);
    }
    if (headingMatch[1] !== packageVersion) {
      fail(
        `${document} headline says ${headingMatch[1]}, expected ${packageVersion}`,
      );
    }
  }

  console.log(
    `[studio] README, README.zh-CN and site/index.html all reference ${packageVersion}`,
  );
}

function verifyMacApplication(): void {
  requireFile("apps/studio/build/icon.icns", 1_000);
  // The bundle executable is a small launcher; the Electron runtime lives in
  // Electron Framework. Both have to carry the Intel and Apple Silicon slices.
  const binaries = [
    requireFile(
      "release/mac-universal/IPloom Studio.app/Contents/MacOS/IPloom Studio",
      10_000,
    ),
    requireFile(
      "release/mac-universal/IPloom Studio.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
      50_000_000,
    ),
  ];
  for (const binary of binaries) {
    const architectures = execFileSync("lipo", ["-archs", binary], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/);
    for (const architecture of ["arm64", "x86_64"]) {
      if (!architectures.includes(architecture)) {
        fail(`macOS bundle is missing the ${architecture} slice in ${binary}`);
      }
    }
  }
}

function verifyWindowsApplication(): void {
  requireFile("apps/studio/build/icon.ico", 1_000);
  requireFile("release/win-unpacked/IPloom Studio.exe", 1_000_000);
}

function verifyPackages(platform: string): void {
  if (platform === "darwin") {
    verifyMacApplication();
    const dmg = requireFile(
      `release/IPloom-Studio-${packageVersion}-darwin-universal.dmg`,
      1_000_000,
    );
    const zip = requireFile(
      `release/IPloom-Studio-${packageVersion}-darwin-universal.zip`,
      1_000_000,
    );
    execFileSync("hdiutil", ["verify", dmg], { stdio: "inherit" });
    execFileSync("unzip", ["-t", zip], { stdio: "ignore" });
  } else if (platform === "win32") {
    verifyWindowsApplication();
    requireFile(
      `release/IPloom-Studio-${packageVersion}-win32-x64.exe`,
      10_000_000,
    );
  } else {
    fail(`Unsupported platform: ${platform}`);
  }
  console.log(`[studio] ${platform} packages verified`);
}

function verifyDirectory(platform: string): void {
  if (platform === "darwin") {
    verifyMacApplication();
  } else if (platform === "win32") {
    verifyWindowsApplication();
  } else {
    fail(`Unsupported platform: ${platform}`);
  }
  console.log(`[studio] ${platform} unpacked application verified`);
}

if (mode === "inputs") {
  verifyInputs();
} else if (mode === "docs") {
  verifyDocs();
} else if (mode === "package" || mode === "dir") {
  const platform = optionValue("--platform");
  if (!platform) fail(`${mode} requires --platform darwin|win32`);
  if (mode === "package") verifyPackages(platform);
  else verifyDirectory(platform);
} else {
  fail(
    "Usage: verify-release-inputs.ts inputs | docs | package|dir --platform darwin|win32",
  );
}
