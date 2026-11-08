import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keeps the test process free of `mock.module(...)`.
 *
 * Bun resolves `mock.module` against the registry of the whole test process,
 * and `mock.restore()` does not undo it. Every test file that runs after the
 * mocking file therefore sees the fake, so one file can poison unrelated files
 * depending on the order the runner happens to pick — macOS and ubuntu even
 * order test files differently. That is exactly how the bridge failures of
 * 2026-11-08 happened. Inject fakes through parameters instead — see
 * `WorkspacePlatform` in apps/studio/src/use-studio-workspace.ts.
 *
 * The scan is deliberately stricter than a grep:
 *
 * - every file is parsed with `Bun.Transpiler` first, so comments disappear and
 *   JSX text becomes a string literal before the scan;
 * - a lexer then blanks string, template and regular-expression literals, so a
 *   test that merely explains the rule (in a comment, a snapshot string or
 *   `expect(...).not.toContain("mock.module(")`) does not fail the check;
 * - the scanned set is what the runner can actually load, not just `tests/`:
 *   every source file under `tests/`, every `preload` from `bunfig.toml`, and
 *   every `*.test.*` / `*_test.*` / `*.spec.*` / `*_spec.*` file elsewhere in
 *   the repository (Bun filters by path substring, so a test outside `tests/`
 *   still runs when its path contains the filter);
 * - a file that is not valid UTF-8 fails instead of being scanned as mojibake
 *   (UTF-16 used to make a call invisible);
 * - a symlink under `tests/` fails, because the scan does not follow links.
 *
 * An aliased or computed call (`const m = mock; m.module(...)`) cannot be seen
 * by a static scan. The preload `tests/studio/mock-module-guard.ts` closes that
 * gap at runtime: it replaces `mock.module` with a throwing function that
 * `mock.restore()` cannot undo.
 */
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const testsRoot = join(repositoryRoot, "tests");
const bunfigPath = join(repositoryRoot, "bunfig.toml");

// Every extension Bun's test runner discovers, matched case-insensitively so a
// case-insensitive checkout cannot hide a file behind a `.TS` name.
const sourceExtensions = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
// Bun discovers `*.test.*`, `*_test.*`, `*.spec.*` and `*_spec.*` files.
const testFilePattern =
  /(?:\.test|_test|\.spec|_spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
// A call, not a write: the runtime guard uses `Object.defineProperty(mock, ...)`.
// `\??\.` also covers optional chaining, `mock?.module(...)`, which calls the
// same process-wide function.
const forbiddenCall = /\bmock\s*\??\.\s*module\s*\(/;
// Build output and tool state never contain files the runner loads.
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".bun-install-cache",
  "coverage",
  "dist",
  "out",
  "release",
]);

function fail(message: string): never {
  throw new Error(message);
}

/** Read a file as UTF-8, refusing formats the scan would mis-read. */
function readSource(path: string): string {
  const displayPath = relative(repositoryRoot, path);
  const bytes = readFileSync(path);
  if (bytes.includes(0)) {
    fail(
      `${displayPath} is not UTF-8 text: it contains NUL bytes, which is how ` +
        "a UTF-16 file looks to a byte reader. Bun still executes such a " +
        "file, but this scan cannot read it, so a mock.module(...) call would " +
        "stay invisible. Save the file as UTF-8.",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(
      `${displayPath} is not valid UTF-8. Save it as UTF-8 so the isolation ` +
        "scan can read the same text Bun executes.",
    );
  }
}

type SourceLoader = "ts" | "tsx" | "js" | "jsx";

function loaderFor(path: string): SourceLoader {
  const extension = extname(path).slice(1).toLowerCase();
  if (extension === "tsx") return "tsx";
  if (extension === "jsx") return "jsx";
  if (extension === "js" || extension === "mjs" || extension === "cjs") {
    return "js";
  }
  return "ts";
}

function transform(source: string, loader: SourceLoader): string {
  return new Bun.Transpiler({ loader }).transformSync(source);
}

/**
 * Parse the file the way Bun does, so the scan sees code and nothing else:
 * comments are gone and JSX text has become a plain string literal.
 */
function transpileSource(path: string, source: string): string {
  const loader = loaderFor(path);
  try {
    return transform(source, loader);
  } catch (error) {
    // Bun also runs JSX inside `.js`/`.ts` files; retry with the JSX loader
    // before reporting a syntax error the runner would not hit.
    if (loader === "js" || loader === "ts") {
      try {
        return transform(source, loader === "js" ? "jsx" : "tsx");
      } catch {
        // Fall through to the original error.
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `cannot parse ${relative(repositoryRoot, path)}: ${reason}\n\n` +
        "The isolation scan parses every test source file before looking for " +
        "mock.module(...). Fix the syntax error, or update " +
        "scripts/studio/verify-test-isolation.ts if the file is not " +
        "JavaScript or TypeScript.",
    );
  }
}

type TokenKind =
  | "identifier"
  | "number"
  | "string"
  | "regex"
  | "punctuator"
  | null;

// A `/` after one of these starts a regular expression, not a division.
const regexPrecedingKeywords = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function regexAllowed(kind: TokenKind, text: string): boolean {
  if (kind === null) return true;
  if (kind === "identifier") return regexPrecedingKeywords.has(text);
  if (kind === "punctuator") {
    // After a value a `/` can only be division: `)` `]` `}` `++` `--` `.`.
    // Treating an ambiguous `}` as division can only make regex text visible
    // to the scan, never hide a call, so it errs toward failing loudly.
    return !(
      text === ")" ||
      text === "]" ||
      text === "}" ||
      text === "++" ||
      text === "--" ||
      text === "."
    );
  }
  return false;
}

/** Index just past the closing slash, or -1 when this is not a regex literal. */
function regexEnd(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\n") return -1;
    if (char === "\\") {
      if (source[index + 1] === "\n") return -1;
      index += 2;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return index + 1;
    index += 1;
  }
  return -1;
}

const identifierStart = /[A-Za-z_$]/;
const identifierPart = /[A-Za-z0-9_$]/;
const digit = /[0-9]/;
const numberPart = /[0-9A-Za-z._$]/;

/**
 * Blank comments and literals while keeping line breaks and everything else.
 *
 * A literal that fails to close is emitted as raw text instead of being
 * blanked: hiding real code is worse than scanning a little noise.
 */
function stripNonCode(source: string): string {
  let code = "";
  let index = 0;
  let template = false;
  // Brace depth of each active `${ ... }` inside template literals.
  const interpolations: number[] = [];
  let lastKind: TokenKind = null;
  let lastText = "";

  const blank = (char: string) => {
    code += char === "\n" ? "\n" : " ";
  };

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (template) {
      if (char === "\\") {
        blank(char);
        if (next !== undefined) blank(next);
        index += 2;
        continue;
      }
      if (char === "`") {
        code += "`";
        index += 1;
        template = false;
        lastKind = "string";
        lastText = "`";
        continue;
      }
      if (char === "$" && next === "{") {
        code += "${";
        index += 2;
        interpolations.push(0);
        template = false;
        lastKind = null;
        lastText = "";
        continue;
      }
      blank(char);
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blank(char);
      blank(next);
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        blank(source[index]!);
        index += 1;
      }
      if (index < source.length) {
        blank("*");
        blank("/");
        index += 2;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index]!;
        if (current === "\\") {
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          closed = true;
          break;
        }
        if (current === "\n") break;
        index += 1;
      }
      if (closed) {
        code += quote;
        for (let cursor = start + 1; cursor < index - 1; cursor += 1) {
          blank(source[cursor]!);
        }
        code += quote;
      } else {
        code += source.slice(start, index);
      }
      lastKind = "string";
      lastText = quote;
      continue;
    }

    if (char === "`") {
      code += "`";
      index += 1;
      template = true;
      continue;
    }

    if (char === "/" && regexAllowed(lastKind, lastText)) {
      const end = regexEnd(source, index);
      if (end >= 0) {
        for (let cursor = index; cursor < end; cursor += 1) {
          blank(source[cursor]!);
        }
        index = end;
        lastKind = "regex";
        lastText = "/";
        continue;
      }
      code += "/";
      index += 1;
      lastKind = "punctuator";
      lastText = "/";
      continue;
    }

    if (identifierStart.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && identifierPart.test(source[index]!)) {
        index += 1;
      }
      const word = source.slice(start, index);
      code += word;
      lastKind = "identifier";
      lastText = word;
      continue;
    }

    if (digit.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && numberPart.test(source[index]!)) {
        index += 1;
      }
      const word = source.slice(start, index);
      code += word;
      lastKind = "number";
      lastText = word;
      continue;
    }

    if (char === "{") {
      const depth = interpolations.length - 1;
      if (depth >= 0) {
        interpolations[depth] = (interpolations[depth] ?? 0) + 1;
      }
      code += "{";
      index += 1;
      lastKind = "punctuator";
      lastText = "{";
      continue;
    }

    if (char === "}") {
      if (
        interpolations.length > 0 &&
        interpolations[interpolations.length - 1] === 0
      ) {
        interpolations.pop();
        code += "}";
        index += 1;
        template = true;
        continue;
      }
      const depth = interpolations.length - 1;
      if (depth >= 0) {
        interpolations[depth] = (interpolations[depth] ?? 0) - 1;
      }
      code += "}";
      index += 1;
      lastKind = "punctuator";
      lastText = "}";
      continue;
    }

    if ((char === "+" || char === "-") && next === char) {
      code += char + char;
      index += 2;
      lastKind = "punctuator";
      lastText = char + char;
      continue;
    }

    code += char;
    index += 1;
    lastKind = "punctuator";
    lastText = char;
  }

  return code;
}

function isInsideTests(path: string): boolean {
  const relativePath = relative(testsRoot, path);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

function walk(
  directory: string,
  options: { testFilesOnly: boolean; failOnSymlink: boolean },
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...walk(path, options));
      continue;
    }
    if (entry.isSymbolicLink()) {
      if (options.failOnSymlink) {
        // `isFile()` and `isDirectory()` are both false for a link, so the
        // scan would silently skip whatever the runner loads through it.
        fail(
          `symlink under tests/: ${relative(repositoryRoot, path)}\n\n` +
            "The isolation scan does not follow links. Replace it with a real " +
            "file or extend scripts/studio/verify-test-isolation.ts.",
        );
      }
      // Outside `tests/` a link is only scanned when it is a test file; the
      // runtime guard in tests/studio/mock-module-guard.ts still covers it.
      continue;
    }
    if (!entry.isFile()) continue;
    if (options.testFilesOnly) {
      if (testFilePattern.test(entry.name)) files.push(path);
    } else if (sourceExtensions.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/** Preload scripts the runner evaluates before every test file. */
function bunfigPreloads(): string[] {
  if (!existsSync(bunfigPath)) return [];
  const config = readFileSync(bunfigPath, "utf8").replace(/^\s*#.*$/gm, "");
  const entries: string[] = [];
  const array = /\bpreload\s*=\s*\[([\s\S]*?)\]/.exec(config);
  if (array) {
    for (const match of array[1]!.matchAll(/["']([^"']+)["']/g)) {
      entries.push(match[1]!);
    }
  } else {
    const single = /\bpreload\s*=\s*["']([^"']+)["']/.exec(config);
    if (single) entries.push(single[1]!);
  }
  return entries.map((entry) => resolve(repositoryRoot, entry));
}

if (!existsSync(testsRoot)) fail("tests/ directory is missing");

const testTreeFiles = walk(testsRoot, {
  testFilesOnly: false,
  failOnSymlink: true,
});
// A renamed directory or a broken extension filter must not turn the guard
// into a silent no-op that keeps CI green.
if (testTreeFiles.length === 0) fail("no source files found under tests/");

// Bun filters by path substring, so a test file outside `tests/` still runs
// when its path contains the positional filter. Scan every one of them.
const strayTestFiles = walk(repositoryRoot, {
  testFilesOnly: true,
  failOnSymlink: false,
}).filter((path) => !isInsideTests(path));

const preloadFiles = bunfigPreloads().filter((path) => !isInsideTests(path));
const files = [
  ...new Set([...testTreeFiles, ...strayTestFiles, ...preloadFiles]),
];

const offenders = files.filter((path) =>
  forbiddenCall.test(stripNonCode(transpileSource(path, readSource(path)))),
);

if (offenders.length > 0) {
  const list = offenders
    .map((path) => `  ${relative(repositoryRoot, path)}`)
    .join("\n");
  fail(
    `mock.module(...) found in:\n${list}\n\n` +
      "Bun applies mock.module process-wide and mock.restore() cannot undo " +
      "it, so the fake leaks into every test file that runs later in the " +
      "same process. Inject the fake through a function parameter instead " +
      "(see WorkspacePlatform in apps/studio/src/use-studio-workspace.ts).",
  );
}

console.log(
  `[studio] test isolation verified: ${files.length} files scanned, no mock.module(...) calls`,
);
