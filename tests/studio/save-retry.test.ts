import { expect, test } from "bun:test";
import { retrySave } from "../../apps/studio/src/save-retry.ts";
import {
  STALE_WORKSPACE_MARKER,
  StaleWorkspaceSaveError,
  isStaleSaveError,
  mapSaveErrorFromIpc,
  markStaleWorkspaceMessage,
  stripStaleWorkspaceMarker,
} from "../../apps/studio/src/save-errors.ts";

const noSleep = async () => {};

test("retrySave resolves after a transient failure", async () => {
  let calls = 0;
  const result = await retrySave(
    async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
      return "saved";
    },
    { sleep: noSleep },
  );
  expect(result).toBe("saved");
  expect(calls).toBe(2);
});

test("retrySave rethrows the last error after exhausting attempts", async () => {
  let calls = 0;
  await expect(
    retrySave(
      async () => {
        calls += 1;
        throw new Error(`failure ${calls}`);
      },
      { attempts: 3, sleep: noSleep },
    ),
  ).rejects.toThrow("failure 3");
  expect(calls).toBe(3);
});

test("retrySave does not retry an error marked as permanent", async () => {
  let calls = 0;
  const permanent = Object.assign(new Error("stale browser revision"), {
    retryable: false,
  });
  await expect(
    retrySave(
      async () => {
        calls += 1;
        throw permanent;
      },
      { attempts: 5, sleep: noSleep },
    ),
  ).rejects.toThrow("stale browser revision");
  expect(calls).toBe(1);
});

test("retrySave stops when a newer save superseded it", async () => {
  let current = true;
  let calls = 0;
  await expect(
    retrySave(
      async () => {
        calls += 1;
        current = false;
        throw new Error("stale");
      },
      { attempts: 5, sleep: noSleep, isCurrent: () => current },
    ),
  ).rejects.toThrow("stale");
  expect(calls).toBe(1);
});

test("a marked stale save rejection stops retrying after the IPC round trip", async () => {
  // The renderer main world sees a plain Error that keeps only the message
  // (contextBridge drops the name and custom fields), wrapped by Electron's
  // "Error invoking remote method ..." prefix. Mapping happens there, not in
  // the preload world, and must strip both the prefix and the marker.
  const rejection = new Error(
    `Error invoking remote method 'iploom:save': Error: ${STALE_WORKSPACE_MARKER} ` +
      `Refusing to overwrite /tmp/workspace.json revision 13`,
  );
  const mapped = mapSaveErrorFromIpc(rejection);

  expect(mapped).toBeInstanceOf(StaleWorkspaceSaveError);
  expect((mapped as Error).name).toBe("StaleWorkspaceError");
  expect((mapped as { retryable?: boolean }).retryable).toBe(false);
  expect((mapped as Error).message).toBe(
    "Refusing to overwrite /tmp/workspace.json revision 13",
  );
  expect((mapped as Error).message).not.toContain(STALE_WORKSPACE_MARKER);

  let calls = 0;
  await expect(
    retrySave(
      async () => {
        calls += 1;
        throw mapped;
      },
      { attempts: 3, sleep: noSleep },
    ),
  ).rejects.toThrow(/revision 13/);
  expect(calls).toBe(1);
});

test("the transport marker can be stripped from any user-facing message", () => {
  expect(
    stripStaleWorkspaceMarker(`${STALE_WORKSPACE_MARKER} workspace is newer`),
  ).toBe("workspace is newer");
  expect(
    stripStaleWorkspaceMarker(
      `preload: ${STALE_WORKSPACE_MARKER} reload before saving`,
    ),
  ).toBe("reload before saving");
  expect(stripStaleWorkspaceMarker("unrelated failure")).toBe(
    "unrelated failure",
  );
});

test("ordinary IPC errors keep the transient retry behavior", async () => {
  const transient = new Error("Error invoking remote method 'iploom:save': EPIPE");
  expect(mapSaveErrorFromIpc(transient)).toBe(transient);

  let calls = 0;
  const result = await retrySave(
    async () => {
      calls += 1;
      if (calls < 2) throw transient;
      return "saved";
    },
    { sleep: noSleep },
  );
  expect(result).toBe("saved");
  expect(calls).toBe(2);
});

test("the stale marker is idempotent and detected on both sides of IPC", () => {
  const marked = markStaleWorkspaceMessage("workspace is newer on disk");
  expect(marked).toBe(`${STALE_WORKSPACE_MARKER} workspace is newer on disk`);
  expect(markStaleWorkspaceMessage(marked)).toBe(marked);

  expect(isStaleSaveError(new StaleWorkspaceSaveError(marked))).toBe(true);
  expect(isStaleSaveError(new Error(marked))).toBe(true);
  expect(isStaleSaveError(marked)).toBe(true);
  expect(isStaleSaveError(new Error("unrelated failure"))).toBe(false);
  expect(isStaleSaveError(undefined)).toBe(false);
});

test("retrySave uses its default timer sleep between attempts", async () => {
  let calls = 0;
  const result = await retrySave(
    async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
      return "saved";
    },
    { delayMs: 1 },
  );
  expect(result).toBe("saved");
  expect(calls).toBe(2);
});
