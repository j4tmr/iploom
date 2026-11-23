import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export interface CiChangePlan {
  runDesktop: boolean;
  runIntelSmoke: boolean;
  reason: string;
}

const DOCS_ONLY_EXACT_FILES = new Set([
  "README.md",
  "README.zh-CN.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  ".github/pull_request_template.md",
  ".github/workflows/pages.yml",
  "scripts/check-site.py",
]);

const DOCS_ONLY_PREFIXES = ["docs/", "site/", ".github/ISSUE_TEMPLATE/"];

const INTEL_SMOKE_EXACT_FILES = new Set([
  "package.json",
  "bun.lock",
  ".bun-version",
  ".node-version",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "apps/studio/vite.config.ts",
  ".github/workflows/studio-ci.yml",
  ".github/workflows/studio-release.yml",
]);

const INTEL_SMOKE_PREFIXES = [
  "apps/studio/electron/",
  "apps/studio/build/",
  "apps/studio/mcp/",
  "scripts/studio/",
  ".github/actions/",
];

export function normalizeChangedPath(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isDocsOnlyPath(filePath: string): boolean {
  const normalized = normalizeChangedPath(filePath);
  if (normalized.length === 0) return false;
  if (DOCS_ONLY_EXACT_FILES.has(normalized)) return true;
  return DOCS_ONLY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function requiresIntelSliceSmoke(filePath: string): boolean {
  const normalized = normalizeChangedPath(filePath);
  if (normalized.length === 0) return false;
  if (INTEL_SMOKE_EXACT_FILES.has(normalized)) return true;
  return INTEL_SMOKE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function classifyChangedFiles(
  files: readonly string[],
  options: { eventName?: string } = {},
): CiChangePlan {
  const eventName = options.eventName ?? "pull_request";
  if (eventName !== "pull_request") {
    return {
      runDesktop: true,
      runIntelSmoke: true,
      reason: `event:${eventName}`,
    };
  }

  const normalized = files
    .map(normalizeChangedPath)
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    return {
      runDesktop: true,
      runIntelSmoke: true,
      reason: "empty-diff-fallback",
    };
  }

  const runDesktop = normalized.some((file) => !isDocsOnlyPath(file));
  if (!runDesktop) {
    return {
      runDesktop: false,
      runIntelSmoke: false,
      reason: "docs-only",
    };
  }

  const runIntelSmoke = normalized.some((file) =>
    requiresIntelSliceSmoke(file),
  );
  return {
    runDesktop: true,
    runIntelSmoke,
    reason: runIntelSmoke
      ? "packaging-or-runtime-change"
      : "app-or-test-change",
  };
}

export function detectPullRequestChangedFiles(cwd?: string): string[] | null {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^2"], {
      cwd,
      stdio: "ignore",
    });
    const output = execFileSync(
      "git",
      ["-c", "core.quotepath=false", "diff", "--name-only", "HEAD^1", "HEAD"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return output
      .split(/\r?\n/)
      .map(normalizeChangedPath)
      .filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

export function formatGithubOutput(plan: CiChangePlan): string {
  return [
    `run_desktop=${plan.runDesktop}`,
    `run_intel_smoke=${plan.runIntelSmoke}`,
    `reason=${plan.reason}`,
    "",
  ].join("\n");
}

export function resolveCiChangePlan(options: {
  eventName?: string;
  readChangedFiles?: () => string[] | null;
}): CiChangePlan {
  const eventName = options.eventName ?? "pull_request";
  if (eventName !== "pull_request") {
    return classifyChangedFiles([], { eventName });
  }
  const files = (options.readChangedFiles ?? detectPullRequestChangedFiles)();
  if (!files) {
    return {
      runDesktop: true,
      runIntelSmoke: true,
      reason: "git-diff-unavailable",
    };
  }
  return classifyChangedFiles(files, { eventName });
}

if (import.meta.main) {
  const plan = resolveCiChangePlan({
    eventName: process.env.GITHUB_EVENT_NAME ?? "pull_request",
  });
  const formatted = formatGithubOutput(plan);
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, formatted, "utf8");
  }
  console.log(
    `[ci-changes] run_desktop=${plan.runDesktop} run_intel_smoke=${plan.runIntelSmoke} (${plan.reason})`,
  );
}
