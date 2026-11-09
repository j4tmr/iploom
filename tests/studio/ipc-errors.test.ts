import { expect, test } from "bun:test";
import {
  unwrapIpcError,
  unwrapIpcErrorMessage,
} from "../../apps/studio/src/ipc-errors.ts";
import {
  STALE_WORKSPACE_MARKER,
  StaleWorkspaceSaveError,
  mapSaveErrorFromIpc,
} from "../../apps/studio/src/save-errors.ts";

const wrapped = (channel: string, message: string) =>
  `Error invoking remote method '${channel}': Error: ${message}`;

test("a load rejection arrives without the IPC wrapper", () => {
  const error = new Error(wrapped("iploom:load", "工作区读取失败"));
  const unwrapped = unwrapIpcError("iploom:load", error);

  expect(unwrapped).toBeInstanceOf(Error);
  expect((unwrapped as Error).message).toBe("工作区读取失败");
});

test("a runAi rejection keeps the localized AI failure sentence", () => {
  const message =
    "AI request timed out after 120 seconds waiting for the first byte";
  const error = new Error(wrapped("iploom:run-ai", message));

  expect((unwrapIpcError("iploom:run-ai", error) as Error).message).toBe(
    message,
  );
});

test("a non-stale save rejection keeps its transport message", () => {
  const error = new Error(wrapped("iploom:save", "EPIPE"));

  expect((unwrapIpcError("iploom:save", error) as Error).message).toBe("EPIPE");
});

test("a stale save rejection unwraps into the retryable renderer mapping", () => {
  const error = new Error(
    wrapped(
      "iploom:save",
      `${STALE_WORKSPACE_MARKER} Refusing to overwrite revision 13`,
    ),
  );
  const mapped = mapSaveErrorFromIpc(unwrapIpcError("iploom:save", error));

  expect(mapped).toBeInstanceOf(StaleWorkspaceSaveError);
  expect((mapped as { retryable?: boolean }).retryable).toBe(false);
  expect((mapped as Error).message).toBe("Refusing to overwrite revision 13");
  expect((mapped as Error).message).not.toContain(STALE_WORKSPACE_MARKER);
});

test("rejections without the wrapper pass through unchanged", () => {
  const error = new Error("EPIPE");
  expect(unwrapIpcError("iploom:save", error)).toBe(error);
  expect(unwrapIpcError("iploom:load", "boom")).toBe("boom");
});

test("a wrapper naming a different channel is left alone", () => {
  const error = new Error(wrapped("iploom:load", "unrelated"));
  expect(unwrapIpcError("iploom:save", error)).toBe(error);
});

test("the Error: name prefix is stripped once, not twice", () => {
  expect(
    unwrapIpcErrorMessage(
      "iploom:load",
      wrapped("iploom:load", "Error: bad state"),
    ),
  ).toBe("Error: bad state");
});
