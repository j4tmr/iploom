import { expect, test } from "bun:test";
import {
  StaleBrowserWorkspaceError,
  browserSnapshotKey,
  browserWorkspaceKey,
  loadBrowserSnapshot,
  loadBrowserWorkspace,
  saveBrowserSnapshot,
  saveBrowserWorkspace,
} from "../../apps/studio/src/browser-workspace.ts";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";

function storageWith(raw: string | null = null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(browserWorkspaceKey, raw);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test("browser migrates v1 manuscripts without altering the stored original", () => {
  const original = createDemoWorkspace("en");
  const legacy = { ...original, schema_version: 1 } as Record<string, unknown>;
  delete legacy.workflowTasks;
  const raw = JSON.stringify(legacy);
  const storage = storageWith(raw);
  const { workspace } = loadBrowserWorkspace(storage, "en");
  expect(workspace.schema_version).toBe(7);
  expect(workspace.workflowTasks).toEqual([]);
  expect(workspace.works).toEqual(original.works);
  expect(workspace.revision).toBe(Number(legacy.revision) + 6);
  expect(storage.getItem(browserWorkspaceKey)).toBe(raw);
});

test.each(["{broken", "", "null", "{}", JSON.stringify({ ...createDemoWorkspace("en"), schema_version: 999 })])(
  "browser rejects invalid data without deleting it: %s", (raw) => {
    const storage = storageWith(raw);
    expect(() => loadBrowserWorkspace(storage, "en")).toThrow();
    expect(storage.getItem(browserWorkspaceKey)).toBe(raw);
  },
);

test("browser initializes only absent storage and round-trips valid data", () => {
  const storage = storageWith();
  const { workspace } = loadBrowserWorkspace(storage, "zh-CN");
  expect(workspace.settings.locale).toBe("zh-CN");
  // The initial demo is persisted right away, so the first destructive action
  // has a healthy workspace to snapshot instead of a null refusal.
  expect(JSON.parse(storage.getItem(browserWorkspaceKey)!)).toEqual(workspace);
  expect(saveBrowserSnapshot(storage)).toBe(browserSnapshotKey);
  expect(loadBrowserSnapshot(storage)?.workspace).toEqual(workspace);
  saveBrowserWorkspace(storage, workspace);
  expect(loadBrowserWorkspace(storage, "en").workspace).toEqual(workspace);
});

test("unwritable browser storage still opens the demo but cannot snapshot", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const { workspace } = loadBrowserWorkspace(storage, "en");
  expect(workspace.works.length).toBeGreaterThan(0);
  expect(saveBrowserSnapshot(storage)).toBeNull();
});

test("invalid saves cannot overwrite a valid manuscript", () => {
  const workspace = createDemoWorkspace("en");
  const original = JSON.stringify(workspace);
  const storage = storageWith(original);
  workspace.works[0]!.universeId = "missing";
  expect(() => saveBrowserWorkspace(storage, workspace)).toThrow();
  expect(storage.getItem(browserWorkspaceKey)).toBe(original);
});

test("browser demo reset keeps the previous workspace in one snapshot slot", () => {
  const workspace = createDemoWorkspace("en");
  const storage = storageWith(JSON.stringify(workspace));
  expect(saveBrowserSnapshot(storage)).toBe(browserSnapshotKey);
  const demo = createDemoWorkspace("zh-CN");
  // The demo reset path intentionally replaces the stored workspace even
  // though the fresh demo shares its revision.
  saveBrowserWorkspace(storage, demo, { allowRollback: true });
  expect(loadBrowserSnapshot(storage)?.workspace).toEqual(workspace);
  expect(
    JSON.parse(storage.getItem(browserWorkspaceKey)!).settings.locale,
  ).toBe("zh-CN");
});

test("an older browser revision cannot overwrite a newer stored workspace", () => {
  const base = createDemoWorkspace("en");
  const newer = structuredClone(base);
  newer.revision = base.revision + 5;
  const storage = storageWith(JSON.stringify(newer));
  const older = structuredClone(base);
  older.revision = base.revision + 1;

  expect(() => saveBrowserWorkspace(storage, older)).toThrow(
    StaleBrowserWorkspaceError,
  );
  // The newer workspace stays untouched, so the stale tab cannot roll it back.
  expect(storage.getItem(browserWorkspaceKey)).toBe(JSON.stringify(newer));
});

test("a stale browser save is marked non-retryable", () => {
  const base = createDemoWorkspace("en");
  const newer = structuredClone(base);
  newer.revision = base.revision + 5;
  const storage = storageWith(JSON.stringify(newer));

  try {
    saveBrowserWorkspace(storage, base);
    throw new Error("expected a stale save to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(StaleBrowserWorkspaceError);
    expect((error as { retryable?: boolean }).retryable).toBe(false);
  }
});

test("equal or newer browser revisions are accepted", () => {
  const base = createDemoWorkspace("en");
  const current = structuredClone(base);
  current.revision = base.revision + 3;
  const storage = storageWith(JSON.stringify(current));

  const equal = structuredClone(base);
  equal.revision = current.revision;
  saveBrowserWorkspace(storage, equal);
  expect(JSON.parse(storage.getItem(browserWorkspaceKey)!).revision).toBe(
    current.revision,
  );

  const newer = structuredClone(base);
  newer.revision = current.revision + 1;
  saveBrowserWorkspace(storage, newer);
  expect(JSON.parse(storage.getItem(browserWorkspaceKey)!).revision).toBe(
    newer.revision,
  );
});

test("a browser draft based on an older revision cannot overwrite an advanced tab", () => {
  const base = createDemoWorkspace("en");
  base.revision = 10;
  const storage = storageWith(JSON.stringify(base));

  // Tab B writes revision 11 with different content while tab A holds 10.
  const external = structuredClone(base);
  external.revision = 11;
  external.name = "tab B";
  storage.setItem(browserWorkspaceKey, JSON.stringify(external));

  // Tab A made two edits, so its draft revision is newer than the file.
  const draft = structuredClone(base);
  draft.revision = 12;
  draft.name = "tab A";
  expect(() =>
    saveBrowserWorkspace(storage, draft, { baseRevision: 10 }),
  ).toThrow(StaleBrowserWorkspaceError);
  expect(storage.getItem(browserWorkspaceKey)).toBe(JSON.stringify(external));
});

test("equal browser revisions with different content cannot overwrite each other", () => {
  const stored = createDemoWorkspace("en");
  stored.revision = 12;
  stored.name = "tab B";
  const storage = storageWith(JSON.stringify(stored));

  const draft = structuredClone(stored);
  draft.name = "tab A";
  expect(() =>
    saveBrowserWorkspace(storage, draft, { baseRevision: 11 }),
  ).toThrow(StaleBrowserWorkspaceError);
  expect(storage.getItem(browserWorkspaceKey)).toBe(JSON.stringify(stored));
});

test("browser multi-edit drafts save over the unchanged base but not an advanced one", () => {
  const base = createDemoWorkspace("en");
  base.revision = 10;
  const draft = structuredClone(base);
  draft.revision = 15;
  draft.name = "many edits";

  const unchanged = storageWith(JSON.stringify(base));
  saveBrowserWorkspace(unchanged, draft, { baseRevision: 10 });
  expect(JSON.parse(unchanged.getItem(browserWorkspaceKey)!).name).toBe(
    "many edits",
  );

  const advanced = structuredClone(base);
  advanced.revision = 11;
  advanced.name = "tab B";
  const storage = storageWith(JSON.stringify(advanced));
  expect(() =>
    saveBrowserWorkspace(storage, structuredClone(draft), { baseRevision: 10 }),
  ).toThrow(StaleBrowserWorkspaceError);
});

test("browser idempotent same-content re-saves accept an older base", () => {
  const stored = createDemoWorkspace("en");
  stored.revision = 12;
  const storage = storageWith(JSON.stringify(stored));
  saveBrowserWorkspace(storage, structuredClone(stored), { baseRevision: 10 });
  expect(JSON.parse(storage.getItem(browserWorkspaceKey)!).revision).toBe(12);
});

test("browser saves with a base equal to the stored revision are accepted", () => {
  const base = createDemoWorkspace("en");
  base.revision = 10;
  const storage = storageWith(JSON.stringify(base));
  const next = structuredClone(base);
  next.revision = 11;
  next.name = "next";
  saveBrowserWorkspace(storage, next, { baseRevision: 10 });
  expect(JSON.parse(storage.getItem(browserWorkspaceKey)!).name).toBe("next");
});

test("unreadable stored data cannot block a healthy save", () => {
  const storage = storageWith("{broken");
  const workspace = createDemoWorkspace("en");
  saveBrowserWorkspace(storage, workspace);
  expect(loadBrowserWorkspace(storage, "en").workspace).toEqual(workspace);
});

test("snapshot restore and demo reset may intentionally roll a revision back", () => {
  const base = createDemoWorkspace("en");
  const newer = structuredClone(base);
  newer.revision = base.revision + 9;
  const storage = storageWith(JSON.stringify(newer));

  saveBrowserWorkspace(storage, base, { allowRollback: true });
  expect(JSON.parse(storage.getItem(browserWorkspaceKey)!).revision).toBe(
    base.revision,
  );
});

test("browser never replaces a healthy snapshot with corrupt data", () => {
  const workspace = createDemoWorkspace("en");
  const storage = storageWith(JSON.stringify(workspace));
  saveBrowserSnapshot(storage);
  storage.setItem(browserWorkspaceKey, "{broken");
  expect(saveBrowserSnapshot(storage)).toBeNull();
  expect(loadBrowserSnapshot(storage)?.workspace).toEqual(workspace);
});
