import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { deleteUniverseFromDraft } from "../../apps/studio/src/core/integrity.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";

const NOW = "2026-11-07T00:00:00.000Z";

async function storeInTemp(): Promise<WorkspaceStore> {
  const directory = await mkdtemp(join(tmpdir(), "iploom-store-"));
  return new WorkspaceStore(join(directory, "workspace.json"));
}

function workspaceTitled(title: string) {
  const workspace = createDemoWorkspace("en", NOW);
  workspace.works[0]!.title.zh = title;
  return workspace;
}

async function storedTitle(path: string): Promise<string> {
  return JSON.parse(await readFile(path, "utf8")).works[0].title.zh;
}

test("demo reset keeps the user workspace recoverable despite the renderer autosave", async () => {
  const store = await storeInTemp();
  await store.save(workspaceTitled("我的小说"));
  const snapshotPath = await store.createSnapshot("before-reset-demo");
  const demo = createDemoWorkspace("en", NOW);
  await store.save(demo);
  // The renderer used to schedule one more save right after a reset; both the
  // main file and its single `.bak` slot end up holding the demo data.
  await store.save(demo);

  expect(snapshotPath).not.toBeNull();
  expect(await storedTitle(snapshotPath!)).toBe("我的小说");
  expect(await storedTitle(store.filePath)).not.toBe("我的小说");
  const snapshots = await store.listSnapshots();
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]!.reason).toBe("before-reset-demo");
  expect(snapshots[0]!.path).toBe(snapshotPath!);
});

test("a snapshot taken before a delete survives later autosaves", async () => {
  const store = await storeInTemp();
  await store.save(workspaceTitled("保留"));
  expect(await store.createSnapshot("before-delete-world")).not.toBeNull();

  const deleted = await store.update((workspace) => {
    deleteUniverseFromDraft(workspace, workspace.universes[0]!.id);
  });
  for (let index = 0; index < 10; index += 1) {
    deleted.works[0]!.title.zh = `编辑 ${index}`;
    deleted.revision += 1;
    await store.save(deleted);
  }

  const [snapshot] = await store.listSnapshots();
  const raw = JSON.parse(await readFile(snapshot!.path, "utf8"));
  expect(raw.universes.length).toBeGreaterThan(
    JSON.parse(await readFile(store.filePath, "utf8")).universes.length,
  );
});

test("restoring a snapshot keeps a pre-restore copy and returns the restored workspace", async () => {
  const store = await storeInTemp();
  await store.save(workspaceTitled("第一版"));
  await store.createSnapshot("before-import-novel");
  await store.save(workspaceTitled("第二版"));

  const snapshot = (await store.listSnapshots())[0]!;
  const restored = await store.restoreSnapshot(snapshot.path);
  expect(restored.workspace.works[0]!.title.zh).toBe("第一版");
  expect(restored.recoveredFromBackup).toBe(false);
  expect(await storedTitle(store.filePath)).toBe("第一版");
  expect((await store.listSnapshots()).map((item) => item.reason)).toEqual([
    "before-restore",
    "before-import-novel",
  ]);
});

test("snapshot pruning keeps the newest twenty", async () => {
  const store = await storeInTemp();
  await store.save(workspaceTitled("bounded"));
  for (let index = 0; index < 23; index += 1) {
    await store.createSnapshot(`manual-${index}`);
  }
  const snapshots = await store.listSnapshots();
  expect(snapshots).toHaveLength(20);
  expect(snapshots.some((item) => item.reason === "manual-0")).toBe(false);
  expect(snapshots.some((item) => item.reason === "manual-2")).toBe(false);
  expect(snapshots.some((item) => item.reason === "manual-3")).toBe(true);
  expect(snapshots.some((item) => item.reason === "manual-22")).toBe(true);
});

test("restoring only accepts files inside the snapshot directory", async () => {
  const store = await storeInTemp();
  await store.save(workspaceTitled("safe"));
  await expect(store.restoreSnapshot(store.filePath)).rejects.toThrow(/snapshot/);
  await expect(
    store.restoreSnapshot(join(store.snapshotDirectory, "..", "workspace.json")),
  ).rejects.toThrow(/snapshot/);
});

test("a corrupt workspace file never replaces a good snapshot", async () => {
  const store = await storeInTemp();
  await store.save(workspaceTitled("healthy"));
  await writeFile(store.filePath, "{broken", "utf8");
  expect(await store.createSnapshot("before-delete-world")).toBeNull();
  expect(await store.listSnapshots()).toHaveLength(0);
});

test("a legacy workspace with cross-universe refs loads repaired and saves", async () => {
  const store = await storeInTemp();
  const legacy = createDemoWorkspace("en", NOW);
  const legacyChapter = legacy.works.find(
    (work) => work.id === "work_last_train",
  )!.chapters[0]!;
  legacyChapter.characterIds = ["char_echo", "char_lin"];
  legacyChapter.locationId = "loc_old_tower";
  await writeFile(
    store.filePath,
    `${JSON.stringify(legacy, null, 2)}\n`,
    "utf8",
  );

  const loaded = await store.load();
  expect(loaded.recoveredFromBackup).toBe(false);
  expect(loaded.workspace.revision).toBe(legacy.revision);
  const repairedChapter = loaded.workspace.works.find(
    (work) => work.id === "work_last_train",
  )!.chapters[0]!;
  expect(repairedChapter.characterIds).toEqual(["char_echo"]);
  expect(repairedChapter.locationId).toBeUndefined();
  // Snapshotting must accept the legacy primary file as healthy.
  expect(await store.createSnapshot("legacy")).not.toBeNull();

  loaded.workspace.revision += 1;
  await store.save(loaded.workspace);
  const stored = JSON.parse(await readFile(store.filePath, "utf8")) as {
    revision: number;
    works: {
      id: string;
      chapters: { characterIds: string[]; locationId?: string }[];
    }[];
  };
  expect(stored.revision).toBe(loaded.workspace.revision);
  const storedChapter = stored.works.find(
    (work) => work.id === "work_last_train",
  )!.chapters[0]!;
  expect(storedChapter.characterIds).toEqual(["char_echo"]);
  expect("locationId" in storedChapter).toBe(false);
});
