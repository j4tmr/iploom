import { expect, test } from "bun:test";
import { browserWorkspaceKey, loadBrowserWorkspace, saveBrowserWorkspace } from "../../apps/studio/src/browser-workspace.ts";
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
  expect(workspace.schema_version).toBe(3);
  expect(workspace.workflowTasks).toEqual([]);
  expect(workspace.works).toEqual(original.works);
  expect(workspace.revision).toBe(Number(legacy.revision) + 2);
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
