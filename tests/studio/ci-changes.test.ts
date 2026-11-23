import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyChangedFiles,
  detectPullRequestChangedFiles,
  formatGithubOutput,
  isDocsOnlyPath,
  normalizeChangedPath,
  requiresIntelSliceSmoke,
  resolveCiChangePlan,
} from "../../scripts/studio/ci-changes.ts";

test("normalizeChangedPath standardizes slashes and leading dot-slash", () => {
  expect(normalizeChangedPath("./docs\\releasing.md ")).toBe(
    "docs/releasing.md",
  );
  expect(normalizeChangedPath("   ")).toBe("");
});

test("docs and site allowlist excludes packaged legal resources", () => {
  expect(isDocsOnlyPath("README.md")).toBe(true);
  expect(isDocsOnlyPath("README.zh-CN.md")).toBe(true);
  expect(isDocsOnlyPath("docs/releasing.md")).toBe(true);
  expect(isDocsOnlyPath("site/index.html")).toBe(true);
  expect(isDocsOnlyPath("scripts/check-site.py")).toBe(true);
  expect(isDocsOnlyPath(".github/workflows/pages.yml")).toBe(true);
  expect(isDocsOnlyPath(".github/ISSUE_TEMPLATE/bug_report.yml")).toBe(true);

  expect(isDocsOnlyPath("THIRD_PARTY_NOTICES.md")).toBe(false);
  expect(isDocsOnlyPath("LICENSE")).toBe(false);
  expect(isDocsOnlyPath("apps/studio/src/app.tsx")).toBe(false);
  expect(isDocsOnlyPath("")).toBe(false);
});

test("Intel Rosetta smoke triggers on packaging, runtime, MCP and CI changes", () => {
  expect(requiresIntelSliceSmoke("package.json")).toBe(true);
  expect(requiresIntelSliceSmoke("bun.lock")).toBe(true);
  expect(requiresIntelSliceSmoke("apps/studio/electron/main.ts")).toBe(true);
  expect(requiresIntelSliceSmoke("apps/studio/mcp/server.ts")).toBe(true);
  expect(requiresIntelSliceSmoke("apps/studio/build/icon.icns")).toBe(true);
  expect(requiresIntelSliceSmoke("scripts/studio/package.ts")).toBe(true);
  expect(requiresIntelSliceSmoke(".github/workflows/studio-ci.yml")).toBe(true);
  expect(
    requiresIntelSliceSmoke(".github/actions/setup-studio/action.yml"),
  ).toBe(true);
  expect(requiresIntelSliceSmoke("THIRD_PARTY_NOTICES.md")).toBe(true);

  expect(requiresIntelSliceSmoke("apps/studio/src/app.tsx")).toBe(false);
  expect(requiresIntelSliceSmoke("tests/studio/cards.test.ts")).toBe(false);
  expect(requiresIntelSliceSmoke("")).toBe(false);
});

test("classifyChangedFiles distinguishes docs-only, app/test, and runtime PRs", () => {
  expect(
    classifyChangedFiles(["docs/releasing.md", "README.md", "site/style.css"]),
  ).toEqual({
    runDesktop: false,
    runIntelSmoke: false,
    reason: "docs-only",
  });

  expect(
    classifyChangedFiles([
      "apps/studio/src/views/cards-view.tsx",
      "tests/studio/cards.test.ts",
    ]),
  ).toEqual({
    runDesktop: true,
    runIntelSmoke: false,
    reason: "app-or-test-change",
  });

  expect(
    classifyChangedFiles([
      "apps/studio/src/app.tsx",
      "apps/studio/electron/main.ts",
    ]),
  ).toEqual({
    runDesktop: true,
    runIntelSmoke: true,
    reason: "packaging-or-runtime-change",
  });
});

test("classifyChangedFiles fails safe on non-PR events and empty diffs", () => {
  expect(classifyChangedFiles(["README.md"], { eventName: "push" })).toEqual({
    runDesktop: true,
    runIntelSmoke: true,
    reason: "event:push",
  });

  expect(classifyChangedFiles([], { eventName: "workflow_dispatch" })).toEqual({
    runDesktop: true,
    runIntelSmoke: true,
    reason: "event:workflow_dispatch",
  });

  expect(classifyChangedFiles([])).toEqual({
    runDesktop: true,
    runIntelSmoke: true,
    reason: "empty-diff-fallback",
  });
});

test("resolveCiChangePlan fails safe when git diff is unavailable", () => {
  expect(
    resolveCiChangePlan({
      eventName: "pull_request",
      readChangedFiles: () => null,
    }),
  ).toEqual({
    runDesktop: true,
    runIntelSmoke: true,
    reason: "git-diff-unavailable",
  });

  expect(
    resolveCiChangePlan({
      eventName: "push",
      readChangedFiles: () => {
        throw new Error("should not run git diff on push");
      },
    }),
  ).toEqual({
    runDesktop: true,
    runIntelSmoke: true,
    reason: "event:push",
  });

  expect(
    resolveCiChangePlan({
      eventName: "pull_request",
      readChangedFiles: () => ["docs/development.md"],
    }),
  ).toEqual({
    runDesktop: false,
    runIntelSmoke: false,
    reason: "docs-only",
  });
});

test("formatGithubOutput emits workflow output lines", () => {
  expect(
    formatGithubOutput({
      runDesktop: true,
      runIntelSmoke: false,
      reason: "app-or-test-change",
    }),
  ).toBe(
    "run_desktop=true\nrun_intel_smoke=false\nreason=app-or-test-change\n",
  );
});

test("detectPullRequestChangedFiles reads merge-commit diff and fails safe without second parent", () => {
  const repository = mkdtempSync(join(tmpdir(), "iploom-ci-changes-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });
  try {
    git("init", "-b", "main");
    writeFileSync(join(repository, "README.md"), "# Base\n", "utf8");
    git("add", "README.md");
    git("commit", "-m", "base");
    // Single-parent commit has no HEAD^2, so the detector fails safe with null.
    expect(detectPullRequestChangedFiles(repository)).toBeNull();

    git("checkout", "-b", "pr-branch");
    writeFileSync(join(repository, "说明.md"), "中文路径\n", "utf8");
    git("add", "说明.md");
    git("commit", "-m", "pr change");

    git("checkout", "main");
    git("merge", "--no-ff", "pr-branch", "-m", "merge pr");
    expect(detectPullRequestChangedFiles(repository)).toEqual(["说明.md"]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
