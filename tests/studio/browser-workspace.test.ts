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
  saveBrowserWorkspace(storage, workspace);
  expect(loadBrowserWorkspace(storage, "en").workspace).toEqual(workspace);
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
  saveBrowserWorkspace(storage, demo);
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

test("legacy cross-universe references are repaired on browser load and stay saveable", () => {
  const legacy = createDemoWorkspace("en");
  const chapter = legacy.works.find(
    (work) => work.id === "work_last_train",
  )!.chapters[0]!;
  chapter.characterIds = ["char_echo", "char_lin"];
  chapter.locationId = "loc_old_tower";
  const raw = JSON.stringify(legacy);
  const storage = storageWith(raw);

  const { workspace } = loadBrowserWorkspace(storage, "en");
  const repaired = workspace.works.find(
    (work) => work.id === "work_last_train",
  )!.chapters[0]!;
  expect(repaired.characterIds).toEqual(["char_echo"]);
  expect(repaired.locationId).toBeUndefined();
  expect(workspace.revision).toBe(legacy.revision);
  // Opening the workspace does not rewrite the stored bytes by itself.
  expect(storage.getItem(browserWorkspaceKey)).toBe(raw);

  expect(saveBrowserSnapshot(storage)).toBe(browserSnapshotKey);
  const snapshot = loadBrowserSnapshot(storage)!.workspace;
  expect(
    snapshot.works.find((work) => work.id === "work_last_train")!.chapters[0]!
      .characterIds,
  ).toEqual(["char_echo"]);

  saveBrowserWorkspace(storage, workspace);
  const stored = JSON.parse(storage.getItem(browserWorkspaceKey)!) as {
    works: {
      id: string;
      chapters: { characterIds: string[]; locationId?: string }[];
    }[];
  };
  const storedChapter = stored.works.find(
    (work) => work.id === "work_last_train",
  )!.chapters[0]!;
  expect(storedChapter.characterIds).toEqual(["char_echo"]);
  expect("locationId" in storedChapter).toBe(false);
});
