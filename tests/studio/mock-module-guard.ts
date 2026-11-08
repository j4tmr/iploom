import { mock } from "bun:test";

/**
 * Runtime backstop for the `mock.module` ban. The static half lives in
 * scripts/studio/verify-test-isolation.ts and runs in CI and `bun run check`.
 *
 * `mock.module` rewrites the module registry of the whole test process, and
 * `mock.restore()` cannot undo it, so one call poisons every test file that
 * runs later — and the file order differs between macOS and ubuntu. The static
 * scan reads every file the runner can discover, but it cannot see an aliased
 * or computed call. Replacing the property with a frozen throwing function
 * catches those at the moment they run.
 *
 * Inject fakes through parameters instead — see `WorkspacePlatform` in
 * apps/studio/src/use-studio-workspace.ts.
 */
Object.defineProperty(mock, "module", {
  configurable: false,
  writable: false,
  value: () => {
    throw new Error(
      "mock.module() is banned: it replaces a module for the rest of the " +
        "test process and mock.restore() cannot undo it, so the fake leaks " +
        "into every test file that runs later. Inject the fake through a " +
        "function parameter instead (see WorkspacePlatform in " +
        "apps/studio/src/use-studio-workspace.ts).",
    );
  },
});
