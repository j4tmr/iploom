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
const flushCompletions: Array<{
  requestId: string;
  error?: string;
  workspace?: StudioWorkspace;
}> = [];
let failNextSave = false;
let saveError: Error | null = null;
let loadError: Error | null = null;
let failNextFlushComplete = false;
let resolveFirstSave: (() => void) | null = null;
type FlushListener = (requestId: string) => void | Promise<void>;
let flushListener: FlushListener | null = null;

// A single object serves as both `bridge` and `browserFallback`: the hook only
// differs between the two when it installs the beforeunload guard, and that is
// exactly the browser branch these tests need to exercise.
const mockBridge = {
  load: async () => {
    if (loadError) throw loadError;
    return {
      workspace: structuredClone(initial),
      path: "workspace.json",
      recoveredFromBackup: false,
    };
  },
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
  onFlushRequest: (listener: FlushListener) => {
    flushListener = listener;
    return () => {
      if (flushListener === listener) flushListener = null;
    };
  },
  flushComplete: async (
    requestId: string,
    error?: string,
    workspace?: StudioWorkspace,
  ) => {
    flushCompletions.push({ requestId, error, workspace });
    if (failNextFlushComplete) {
      failNextFlushComplete = false;
      throw new Error("flush acknowledgement failed");
    }
  },
};

mock.module("../../apps/studio/src/platform.ts", () => ({
  bridge: mockBridge,
  browserFallback: mockBridge,
}));

const { applyTheme, useStudioWorkspace } = await import(
  "../../apps/studio/src/use-studio-workspace.ts"
);

function resetBridge() {
  savedRevisions.length = 0;
  flushCompletions.length = 0;
  failNextSave = false;
  saveError = null;
  loadError = null;
  failNextFlushComplete = false;
  resolveFirstSave = null;
  flushListener = null;
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

test("a load failure surfaces as an error state", async () => {
  resetBridge();
  loadError = new Error("workspace file is unreadable");

  const { result } = renderHook(() => useStudioWorkspace());

  await waitFor(() => expect(result.current.saveState).toBe("error"));
  expect(result.current.error).toBe("workspace file is unreadable");
  expect(result.current.workspace).toBeNull();
});

test("autosave debounces, retries a transient failure, then marks the workspace saved", async () => {
  resetBridge();
  failNextSave = true;

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  act(() => {
    result.current.mutate((draft) => {
      draft.name = "autosaved";
    });
  });
  const revision = result.current.workspace!.revision;
  expect(result.current.saveState).toBe("pending");

  // The first attempt at the 450 ms debounce fails; retrySave succeeds on the
  // second attempt after its 500 ms backoff.
  await waitFor(() => expect(savedRevisions).toEqual([revision, revision]), {
    timeout: 3000,
  });
  await waitFor(() => expect(result.current.saveState).toBe("saved"));
  expect(result.current.error).toBeNull();
});

test("autosave failure is swallowed by the pending save task", async () => {
  resetBridge();

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  saveError = new NewerBrowserWorkspaceVersionError(
    WORKSPACE_SCHEMA_VERSION + 1,
  );
  act(() => {
    result.current.mutate((draft) => {
      draft.name = "autosave fails";
    });
  });

  await waitFor(() => expect(result.current.saveState).toBe("error"), {
    timeout: 2000,
  });
  expect(result.current.error).toContain("newer IPloom Studio");
});

test("applyChange refuses before load and applies a valid edit after load", async () => {
  resetBridge();

  const { result } = renderHook(() => useStudioWorkspace());

  // The load promise has not resolved yet, so there is no workspace to edit.
  const early = result.current.applyChange((draft) => {
    draft.name = "before load";
  });
  expect(early.ok).toBe(false);
  if (!early.ok) expect(early.error).toBe("workspace is not loaded");

  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  let applied!: ReturnType<typeof result.current.applyChange>;
  act(() => {
    applied = result.current.applyChange((draft) => {
      draft.name = "renamed workspace";
    });
  });
  expect(applied.ok).toBe(true);
  if (applied.ok) {
    expect(applied.workspace.name).toBe("renamed workspace");
    expect(applied.workspace.revision).toBe(initial.revision + 1);
  }
  expect(result.current.workspace!.name).toBe("renamed workspace");
});

test("flush requests save first and then acknowledge", async () => {
  resetBridge();

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));
  expect(flushListener).not.toBeNull();

  act(() => {
    result.current.mutate((draft) => {
      draft.name = "flushed";
    });
  });
  const revision = result.current.workspace!.revision;

  await act(async () => {
    await flushListener!("flush-ok");
  });

  expect(savedRevisions).toEqual([revision]);
  expect(flushCompletions).toHaveLength(1);
  expect(flushCompletions[0]?.requestId).toBe("flush-ok");
  expect(flushCompletions[0]?.error).toBeUndefined();
});

test("a failing flush reports the save error without rejecting", async () => {
  resetBridge();

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  act(() => {
    result.current.mutate((draft) => {
      draft.name = "flush failure";
    });
  });
  saveError = new NewerBrowserWorkspaceVersionError(
    WORKSPACE_SCHEMA_VERSION + 1,
  );
  // The acknowledgement failing too must not turn the flush into a rejection.
  failNextFlushComplete = true;

  await act(async () => {
    await flushListener!("flush-fail");
  });

  expect(flushCompletions).toHaveLength(1);
  expect(flushCompletions[0]?.requestId).toBe("flush-fail");
  expect(flushCompletions[0]?.error).toContain("newer IPloom Studio");
  expect(flushCompletions[0]?.workspace?.name).toBe("flush failure");
  expect(result.current.saveState).toBe("error");
});

test("setLocale updates the workspace locale", async () => {
  resetBridge();

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  act(() => {
    result.current.setLocale("zh-CN");
  });

  expect(result.current.workspace!.settings.locale).toBe("zh-CN");
  expect(result.current.workspace!.revision).toBe(initial.revision + 1);
});

test("a dirty browser workspace blocks tab close", async () => {
  resetBridge();

  const { result } = renderHook(() => useStudioWorkspace());
  await waitFor(() => expect(result.current.saveState).toBe("saved"));

  act(() => {
    result.current.mutate((draft) => {
      draft.name = "dirty";
    });
  });
  const dirtyEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirtyEvent);
  expect(dirtyEvent.defaultPrevented).toBe(true);

  // Replacing the workspace marks it saved, which must tear the guard down.
  act(() => {
    result.current.replaceWorkspace(createDemoWorkspace("en"));
  });
  const cleanEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanEvent);
  expect(cleanEvent.defaultPrevented).toBe(false);
});

test("applyTheme honours explicit modes and the system preference", () => {
  const element = document.createElement("div");

  applyTheme("dark", element);
  expect(element.dataset.theme).toBe("dark");
  expect(element.dataset.themeMode).toBe("dark");

  applyTheme("light", element);
  expect(element.dataset.theme).toBe("light");
  expect(element.dataset.themeMode).toBe("light");

  const originalMatchMedia = window.matchMedia;
  const setMatchMedia = (matches: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  };

  try {
    setMatchMedia(true);
    applyTheme("system", element);
    expect(element.dataset.theme).toBe("dark");
    expect(element.dataset.themeMode).toBe("system");

    setMatchMedia(false);
    applyTheme("system", element);
    expect(element.dataset.theme).toBe("light");
    expect(element.dataset.themeMode).toBe("system");
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});
