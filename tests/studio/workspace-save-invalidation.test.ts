import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NewerBrowserWorkspaceVersionError } from "../../apps/studio/src/browser-workspace.ts";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import {
  WORKSPACE_SCHEMA_VERSION,
  type StudioWorkspace,
} from "../../apps/studio/src/core/types.ts";

const initial = createDemoWorkspace("en");
const savedRevisions: number[] = [];
let failNextSave = false;
let saveError: Error | null = null;
let resolveFirstSave: (() => void) | null = null;

mock.module("../../apps/studio/src/platform.ts", () => ({
  bridge: {
    load: async () => ({
      workspace: structuredClone(initial),
      path: "workspace.json",
      recoveredFromBackup: false,
    }),
    save: async (workspace: StudioWorkspace) => {
      savedRevisions.push(workspace.revision);
      resolveFirstSave?.();
      resolveFirstSave = null;
      if (saveError) throw saveError;
      if (failNextSave) {
        failNextSave = false;
        throw new Error("transient disk failure");
      }
      return { savedAt: new Date().toISOString() };
    },
    onFlushRequest: () => () => undefined,
    flushComplete: async () => undefined,
  },
  browserFallback: {},
}));

const { useStudioWorkspace } = await import(
  "../../apps/studio/src/use-studio-workspace.ts"
);

function resetBridge() {
  savedRevisions.length = 0;
  failNextSave = false;
  saveError = null;
  resolveFirstSave = null;
}

afterEach(() => {
  cleanup();
});

afterAll(() => {
  mock.restore();
});

test("replacing the workspace drops a retry left in backoff", async () => {
  resetBridge();
  failNextSave = true;
  const firstSaveStarted = new Promise<void>((resolve) => {
    resolveFirstSave = resolve;
  });

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  act(() => {
    result.current.mutate((draft) => {
      draft.name = "edited after load";
    });
  });
  const editedRevision = result.current.workspace!.revision;
  expect(editedRevision).toBe(initial.revision + 1);

  // Start the save now instead of waiting out the 450 ms autosave debounce.
  // The first attempt fails and enters retrySave's 500 ms backoff.
  let saveNowResult!: Promise<unknown>;
  act(() => {
    saveNowResult = result.current.saveNow().catch((error: unknown) => error);
  });
  await firstSaveStarted;
  expect(savedRevisions).toEqual([editedRevision]);

  // Give retrySave time to enter the backoff, then restore a snapshot.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const restored = createDemoWorkspace("en");
  restored.revision = 4;
  restored.name = "restored snapshot";
  act(() => {
    result.current.replaceWorkspace(restored);
  });

  // The superseded persist rejects, but it is not surfaced as a save error.
  expect(await saveNowResult).toBeInstanceOf(Error);

  // Past the backoff window the stale retry must never reach the bridge.
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(savedRevisions).toEqual([editedRevision]);
  expect(result.current.error).toBeNull();
  expect(result.current.saveState).toBe("saved");

  // savedRevision now tracks the restored revision: a flush is a no-op.
  await act(async () => {
    await result.current.saveNow();
  });
  expect(savedRevisions).toEqual([editedRevision]);
});

test("a non-retryable newer-schema save stays visible without retrying", async () => {
  resetBridge();
  saveError = new NewerBrowserWorkspaceVersionError(
    WORKSPACE_SCHEMA_VERSION + 1,
  );

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  act(() => {
    result.current.mutate((draft) => {
      draft.name = "edited after load";
    });
  });

  await act(async () => {
    await result.current.saveNow().catch(() => undefined);
  });

  expect(savedRevisions).toEqual([initial.revision + 1]);
  expect(result.current.saveState).toBe("error");
  expect(result.current.error).toContain("newer IPloom Studio");
});
