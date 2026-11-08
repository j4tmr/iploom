import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { deleteUniverseFromDraft } from "../../apps/studio/src/core/integrity.ts";
import {
  StaleWorkspaceError,
  WorkspaceStore,
} from "../../apps/studio/src/node/workspace-store.ts";

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
  // Demo reset intentionally moves the revision backwards (as the main process
  // does), and the renderer's extra save is an identical re-save of it.
  await store.save(demo, { allowRollback: true });
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
  const second = workspaceTitled("第二版");
  second.revision += 1;
  await store.save(second);

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
  await expect(store.restoreSnapshot(store.filePath)).rejects.toThrow(
    /snapshot/,
  );
  await expect(
    store.restoreSnapshot(
      join(store.snapshotDirectory, "..", "workspace.json"),
    ),
  ).rejects.toThrow(/snapshot/);
});

test("a corrupt workspace file never replaces a good snapshot", async () => {
  const store = await storeInTemp();
  await store.save(workspaceTitled("healthy"));
  await writeFile(store.filePath, "{broken", "utf8");
  expect(await store.createSnapshot("before-delete-world")).toBeNull();
  expect(await store.listSnapshots()).toHaveLength(0);
});

test("an older revision cannot overwrite a newer workspace file", async () => {
  const store = await storeInTemp();
  const newer = workspaceTitled("MCP 更新");
  newer.revision = 13;
  await store.save(newer);
  const before = await readFile(store.filePath, "utf8");

  const stale = workspaceTitled("编辑器旧稿");
  stale.revision = 12;
  const error: unknown = await store.save(stale).catch((reason) => reason);

  expect(error).toBeInstanceOf(StaleWorkspaceError);
  expect((error as StaleWorkspaceError).storedRevision).toBe(13);
  expect((error as StaleWorkspaceError).incomingRevision).toBe(12);
  expect((error as StaleWorkspaceError).retryable).toBe(false);
  expect((error as Error).message).toContain("revision 13");
  expect((error as Error).message).toContain("revision 12");
  expect((error as Error).message).toMatch(/reload/i);
  // The rejected save must not rotate the newer workspace into `.bak` either.
  expect(await readFile(store.filePath, "utf8")).toBe(before);
});

test("a same-content retry at an equal revision saves, newer revisions still save", async () => {
  const store = await storeInTemp();
  const base = workspaceTitled("base");
  base.revision = 13;
  await store.save(base);

  // Retrying the exact save that may already have landed must not error.
  await store.save(structuredClone(base));
  expect(await storedTitle(store.filePath)).toBe("base");

  const newer = workspaceTitled("newer");
  newer.revision = 14;
  await store.save(newer);
  expect(await storedTitle(store.filePath)).toBe("newer");
});

test("an equal-revision draft cannot overwrite an external writer's content", async () => {
  const store = await storeInTemp();
  const base = workspaceTitled("base");
  base.revision = 12;
  await store.save(base);

  // The MCP server bumps the shared file to revision 13.
  const external = await store.update((workspace) => {
    workspace.name = "MCP edit";
  });
  expect(external.revision).toBe(13);

  // The editor loaded revision 12 and its own edit also produces revision 13,
  // but with different content. Accepting it would erase the external change.
  const draft = workspaceTitled("editor draft");
  draft.revision = 13;
  const error: unknown = await store.save(draft).catch((reason) => reason);

  expect(error).toBeInstanceOf(StaleWorkspaceError);
  expect((error as StaleWorkspaceError).storedRevision).toBe(13);
  expect((error as StaleWorkspaceError).incomingRevision).toBe(13);
  expect((error as StaleWorkspaceError).retryable).toBe(false);
  expect((error as Error).message).toMatch(/different content/i);
  expect((error as Error).message).toMatch(/reload/i);
  expect(JSON.parse(await readFile(store.filePath, "utf8")).name).toBe(
    "MCP edit",
  );
});

test("a draft based on an older revision cannot overwrite an advanced file", async () => {
  const store = await storeInTemp();
  const base = workspaceTitled("base");
  base.revision = 10;
  await store.save(base);

  // The MCP server writes revision 11 while the editor still holds revision 10.
  const external = await store.update((workspace) => {
    workspace.name = "MCP edit";
  });
  expect(external.revision).toBe(11);

  // Two keystrokes later the editor's draft is revision 12 — newer than the
  // file — so revision ordering alone would accept it.
  const draft = workspaceTitled("editor draft");
  draft.revision = 12;
  const error: unknown = await store
    .save(draft, { baseRevision: 10 })
    .catch((reason) => reason);

  expect(error).toBeInstanceOf(StaleWorkspaceError);
  expect((error as StaleWorkspaceError).storedRevision).toBe(11);
  expect((error as StaleWorkspaceError).incomingRevision).toBe(12);
  expect((error as StaleWorkspaceError).baseRevision).toBe(10);
  expect((error as StaleWorkspaceError).retryable).toBe(false);
  expect((error as Error).message).toMatch(/based on revision 10/);
  expect((error as Error).message).toMatch(/reload/i);
  expect(JSON.parse(await readFile(store.filePath, "utf8")).name).toBe(
    "MCP edit",
  );
});

test("several edits from a base save over an unchanged file but not over an advanced one", async () => {
  const unchanged = await storeInTemp();
  const base = workspaceTitled("base");
  base.revision = 10;
  await unchanged.save(base);

  const draft = workspaceTitled("editor draft with several edits");
  draft.revision = 15;
  await unchanged.save(draft, { baseRevision: 10 });
  expect(await storedTitle(unchanged.filePath)).toBe(
    "editor draft with several edits",
  );

  const advanced = await storeInTemp();
  await advanced.save(structuredClone(base));
  await advanced.update((workspace) => {
    workspace.name = "MCP edit";
  });
  const rejected: unknown = await advanced
    .save(structuredClone(draft), { baseRevision: 10 })
    .catch((reason) => reason);
  expect(rejected).toBeInstanceOf(StaleWorkspaceError);
  expect(JSON.parse(await readFile(advanced.filePath, "utf8")).name).toBe(
    "MCP edit",
  );
});

test("a normal save with a base equal to the on-disk revision is accepted", async () => {
  const store = await storeInTemp();
  const base = workspaceTitled("base");
  base.revision = 10;
  await store.save(base);

  const next = workspaceTitled("next");
  next.revision = 11;
  await store.save(next, { baseRevision: 10 });
  expect(await storedTitle(store.filePath)).toBe("next");
});

test("idempotent same-content re-saves pass even when the base is older", async () => {
  const store = await storeInTemp();
  const base = workspaceTitled("base");
  base.revision = 12;
  await store.save(base);

  // A lost response after this exact save: the retry still cites revision 10
  // as its base, but the file already holds byte-identical content.
  await store.save(structuredClone(base), { baseRevision: 10 });
  expect(await storedTitle(store.filePath)).toBe("base");
});

test("baseRevision does not relax the guard against older incoming revisions", async () => {
  const store = await storeInTemp();
  const current = workspaceTitled("current");
  current.revision = 20;
  await store.save(current);

  const older = workspaceTitled("older");
  older.revision = 12;
  const error: unknown = await store
    .save(structuredClone(older), { baseRevision: 20 })
    .catch((reason) => reason);
  expect(error).toBeInstanceOf(StaleWorkspaceError);
});

test("allowRollback lets an intentional restore move the revision backwards", async () => {
  const store = await storeInTemp();
  const current = workspaceTitled("current");
  current.revision = 20;
  await store.save(current);

  const restored = workspaceTitled("restored");
  restored.revision = 12;
  await store.save(restored, { allowRollback: true });
  expect(await storedTitle(store.filePath)).toBe("restored");
});

test("update still performs a serialized read-modify-write", async () => {
  const store = await storeInTemp();
  const base = workspaceTitled("base");
  base.revision = 5;
  await store.save(base);

  const updated = await store.update((workspace) => {
    workspace.name = "via update";
  });

  expect(updated.revision).toBe(6);
  const loaded = await store.load();
  expect(loaded.workspace.name).toBe("via update");
  expect(loaded.workspace.revision).toBe(6);
});

test("ensure writes a primary file so a new workspace can snapshot", async () => {
  const store = await storeInTemp();
  const loaded = await store.ensure();

  expect(loaded.path).toBe(store.filePath);
  expect((await readFile(store.filePath, "utf8")).length).toBeGreaterThan(0);
  expect(await store.createSnapshot("before-delete-world")).not.toBeNull();
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
