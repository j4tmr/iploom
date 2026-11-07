import { expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { WORKSPACE_SCHEMA_VERSION } from "../../apps/studio/src/core/types.ts";
import {
  NewerWorkspaceVersionError,
  renameWithRetry,
  WorkspaceStore,
} from "../../apps/studio/src/node/workspace-store.ts";
import { workspaceMeta } from "../../apps/studio/mcp/server.ts";

const NOW = "2026-11-07T00:00:00.000Z";

async function storeInTemp(): Promise<WorkspaceStore> {
  const directory = await mkdtemp(join(tmpdir(), "iploom-reliability-"));
  return new WorkspaceStore(join(directory, "workspace.json"));
}

function named(name: string) {
  const workspace = createDemoWorkspace("en", NOW);
  workspace.name = name;
  return workspace;
}

/** Save twice so the `.bak` slot holds a valid previous workspace. */
async function saveTwice(store: WorkspaceStore) {
  const older = named("older");
  older.revision = 1;
  await store.save(older);
  const newer = named("newer");
  newer.revision = 2;
  await store.save(newer);
}

test("a newer schema version fails fast and leaves both files untouched", async () => {
  const store = await storeInTemp();
  await saveTwice(store);
  const future = JSON.stringify({
    schema_version: WORKSPACE_SCHEMA_VERSION + 1,
    marker: "from the future",
  });
  await writeFile(store.filePath, future, "utf8");
  const backupBefore = await readFile(`${store.filePath}.bak`, "utf8");

  const failure = store.load();
  await expect(failure).rejects.toBeInstanceOf(NewerWorkspaceVersionError);
  await expect(failure).rejects.toThrow(/newer IPloom Studio/i);

  expect(await readFile(store.filePath, "utf8")).toBe(future);
  expect(await readFile(`${store.filePath}.bak`, "utf8")).toBe(backupBefore);
  const names = await readdir(join(store.filePath, ".."));
  expect(names.some((name) => name.includes(".rejected-"))).toBe(false);
});

test("a corrupt primary is quarantined before the backup is handed back", async () => {
  const store = await storeInTemp();
  await saveTwice(store);
  await writeFile(store.filePath, "{not json", "utf8");

  const loaded = await store.load();
  expect(loaded.recoveredFromBackup).toBe(true);
  expect(loaded.workspace.name).toBe("older");
  expect(loaded.rejectedPath).toBeTruthy();
  expect(loaded.rejectedReason).toContain("workspace.json");
  expect(await readFile(loaded.rejectedPath!, "utf8")).toBe("{not json");

  // The recovery must not be overwritten by the next save, and the quarantine
  // file must survive it as well.
  loaded.workspace.name = "repaired";
  loaded.workspace.revision += 1;
  await store.save(loaded.workspace);
  expect(JSON.parse(await readFile(store.filePath, "utf8")).name).toBe(
    "repaired",
  );
  expect(await readFile(loaded.rejectedPath!, "utf8")).toBe("{not json");
});

test("recovering from the backup restores a primary file for snapshots", async () => {
  const store = await storeInTemp();
  await saveTwice(store);
  await writeFile(store.filePath, "{not json", "utf8");

  const loaded = await store.load();
  expect(loaded.recoveredFromBackup).toBe(true);
  // The recovered workspace is adopted as the new primary immediately;
  // otherwise nothing is persisted and the snapshot guard refuses the next
  // delete/import until an unrelated edit happens to trigger a save.
  expect(JSON.parse(await readFile(store.filePath, "utf8")).name).toBe("older");
  expect(await store.createSnapshot("before-delete-world")).not.toBeNull();
});

test("a read-only directory still hands back a recovered backup", async () => {
  const store = await storeInTemp();
  await saveTwice(store);
  await rm(store.filePath);
  const directory = join(store.filePath, "..");
  await chmod(directory, 0o555);
  try {
    // Adopting the recovered copy as the new primary is best-effort: the
    // directory rejects the write, but the workspace must still be returned.
    const loaded = await store.load();
    expect(loaded.recoveredFromBackup).toBe(true);
    expect(loaded.workspace.name).toBe("older");
    expect(loaded.path).toBe(store.filePath);
  } finally {
    await chmod(directory, 0o755);
  }
});

test("saving refuses to overwrite an unreadable primary file", async () => {
  const store = await storeInTemp();
  await store.save(named("healthy"));
  await writeFile(store.filePath, "{externally broken", "utf8");

  await expect(store.save(named("replacement"))).rejects.toThrow(
    /Refusing to overwrite unreadable workspace file/,
  );
  expect(await readFile(store.filePath, "utf8")).toBe("{externally broken");
});

test("renameWithRetry retries transient Windows codes and reports attempts", async () => {
  const attempts: string[] = [];
  let failures = 2;
  await renameWithRetry("from", "to", {
    platform: "win32",
    delayMs: 0,
    renameImpl: async () => {
      attempts.push("call");
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      }
    },
  });
  expect(attempts).toHaveLength(3);

  await expect(
    renameWithRetry("from", "to", {
      platform: "win32",
      attempts: 2,
      delayMs: 0,
      renameImpl: async () => {
        throw Object.assign(new Error("still locked"), { code: "EBUSY" });
      },
    }),
  ).rejects.toThrow(/still locked/);

  await expect(
    renameWithRetry("from", "to", {
      platform: "win32",
      delayMs: 0,
      renameImpl: async () => {
        throw Object.assign(new Error("bad path"), { code: "ENOENT" });
      },
    }),
  ).rejects.toThrow(/bad path/);
});

test("loading removes stale temporary files but keeps fresh ones", async () => {
  const store = await storeInTemp();
  await store.save(named("kept"));
  const directory = join(store.filePath, "..");
  const stale = `${store.filePath}.tmp-stale`;
  const fresh = `${store.filePath}.tmp-fresh`;
  await writeFile(stale, "old", "utf8");
  await writeFile(fresh, "new", "utf8");
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  await utimes(stale, tenMinutesAgo, tenMinutesAgo);

  await store.load();
  const names = await readdir(directory);
  expect(names.includes("workspace.json.tmp-stale")).toBe(false);
  expect(names.includes("workspace.json.tmp-fresh")).toBe(true);
  expect(await stat(fresh)).toBeTruthy();
});

test("saveRecoveryCopy writes the in-memory workspace without validation", async () => {
  const store = await storeInTemp();
  const unsaved = { schema_version: 1, note: "not a valid workspace" };
  const first = await store.saveRecoveryCopy(unsaved);
  const second = await store.saveRecoveryCopy(unsaved);
  expect(first).not.toBe(second);
  expect(first).toContain(".unsaved-");
  expect(JSON.parse(await readFile(first, "utf8"))).toEqual(unsaved);
  expect(JSON.parse(await readFile(second, "utf8"))).toEqual(unsaved);
});

test("workspaceMeta exposes recovery and quarantine details", () => {
  const workspace = named("meta");
  const healthy = workspaceMeta({
    workspace,
    path: "/tmp/workspace.json",
    recoveredFromBackup: false,
  });
  expect(healthy.recovered_from_backup).toBe(false);
  expect("rejected_primary_file" in healthy).toBe(false);

  const recovered = workspaceMeta({
    workspace,
    path: "/tmp/workspace.json",
    recoveredFromBackup: true,
    rejectedPath: "/tmp/workspace.json.rejected-1",
    rejectedReason: "SyntaxError",
  }) as unknown as Record<string, unknown>;
  expect(recovered.recovered_from_backup).toBe(true);
  expect(recovered.rejected_primary_file).toBe(
    "/tmp/workspace.json.rejected-1",
  );
  expect(recovered.rejected_primary_reason).toBe("SyntaxError");
});
