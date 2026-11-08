import { expect, mock, test } from "bun:test";
import { prepareSnapshot } from "../../apps/studio/src/snapshot-guard.ts";

test("prepareSnapshot saves pending edits before taking the snapshot", async () => {
  const calls: string[] = [];
  const prepared = await prepareSnapshot(
    async () => {
      calls.push("save");
    },
    async (reason) => {
      calls.push(`snapshot:${reason}`);
      return "/workspace/snapshots/workspace-1-0-manual.json";
    },
    "before-delete-world",
  );

  expect(prepared).toBe(true);
  expect(calls).toEqual(["save", "snapshot:before-delete-world"]);
});

test("a null snapshot is a failure, not a no-op success", async () => {
  const saveNow = mock(async () => {});
  const createSnapshot = mock(async () => null);

  expect(
    await prepareSnapshot(saveNow, createSnapshot, "before-delete-novel"),
  ).toBe(false);
  expect(saveNow).toHaveBeenCalledTimes(1);
  expect(createSnapshot).toHaveBeenCalledTimes(1);
});

test("save and snapshot errors reach the caller", async () => {
  await expect(
    prepareSnapshot(
      async () => {
        throw new Error("disk full");
      },
      async () => "/snapshot.json",
      "before-import-novel",
    ),
  ).rejects.toThrow("disk full");

  await expect(
    prepareSnapshot(
      async () => {},
      async () => {
        throw new Error("snapshot directory is not writable");
      },
      "before-import-novel",
    ),
  ).rejects.toThrow("snapshot directory is not writable");
});
