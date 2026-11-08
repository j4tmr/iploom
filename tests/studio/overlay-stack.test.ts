import { expect, test } from "bun:test";
import {
  OverlayStack,
  attachOverlayKeyboard,
  isComposingEvent,
} from "../../apps/studio/src/core/overlay-stack.ts";

function keyEvent(
  key: string,
  extra: { isComposing?: boolean; keyCode?: number } = {},
) {
  const calls = { prevented: 0, stopped: 0 };
  return {
    event: {
      key,
      ...extra,
      preventDefault: () => {
        calls.prevented += 1;
      },
      stopPropagation: () => {
        calls.stopped += 1;
      },
    },
    calls,
  };
}

test("Escape closes only the topmost overlay", () => {
  const stack = new OverlayStack();
  const closed: string[] = [];
  stack.push({ onEscape: () => closed.push("dialog") });
  stack.push({ onEscape: () => closed.push("palette") });

  const { event, calls } = keyEvent("Escape");
  expect(stack.handleKeydown(event)).toBe(true);

  // The palette sits above the dialog, so it must win and swallow the event
  // before the dialog's own listener can see it.
  expect(closed).toEqual(["palette"]);
  expect(calls.prevented).toBe(1);
  expect(calls.stopped).toBe(1);
  // The stack never unmounts anything by itself; the layer owner decides that.
  expect(stack.size).toBe(2);
});

test("releasing the top layer hands Escape back to the layer below", () => {
  const stack = new OverlayStack();
  const closed: string[] = [];
  stack.push({ onEscape: () => closed.push("dialog") });
  const release = stack.push({ onEscape: () => closed.push("palette") });

  release();
  expect(stack.handleKeydown(keyEvent("Escape").event)).toBe(true);
  expect(closed).toEqual(["dialog"]);
});

test("Escape is left to the app when no overlay is open", () => {
  const stack = new OverlayStack();
  const { event, calls } = keyEvent("Escape");
  expect(stack.handleKeydown(event)).toBe(false);
  expect(calls.prevented).toBe(0);
  expect(calls.stopped).toBe(0);
});

test("non-Escape keys are never consumed by an open overlay", () => {
  const stack = new OverlayStack();
  let closed = 0;
  stack.push({ onEscape: () => (closed += 1) });
  const { event, calls } = keyEvent("Enter");
  expect(stack.handleKeydown(event)).toBe(false);
  expect(closed).toBe(0);
  expect(calls.prevented).toBe(0);
});

test("Escape during IME composition is swallowed without closing the overlay", () => {
  const stack = new OverlayStack();
  let closed = 0;
  stack.push({ onEscape: () => (closed += 1) });

  // Safari reports `isComposing`; Chrome/Electron may only report keyCode 229.
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    expect(isComposingEvent(extra)).toBe(true);
    const composed = keyEvent("Escape", extra);
    expect(stack.handleKeydown(composed.event)).toBe(true);
    expect(composed.calls.prevented).toBe(0);
  }
  expect(closed).toBe(0);
});

test("a backdrop click belongs to the topmost layer only", () => {
  const stack = new OverlayStack();
  let dialog = 0;
  let palette = 0;
  const dialogLayer = { onBackdrop: () => (dialog += 1) };
  const paletteLayer = { onBackdrop: () => (palette += 1) };
  stack.push(dialogLayer);
  stack.push(paletteLayer);

  expect(stack.handleBackdrop(dialogLayer)).toBe(false);
  expect(dialog).toBe(0);
  expect(stack.handleBackdrop(paletteLayer)).toBe(true);
  expect(palette).toBe(1);
});

test("a backdrop click with no overlay open is ignored", () => {
  const stack = new OverlayStack();
  expect(stack.handleBackdrop({ onBackdrop: () => undefined })).toBe(false);
});

test("releasing twice is harmless and never removes another layer", () => {
  const stack = new OverlayStack();
  const first = { onEscape: () => undefined };
  const second = { onEscape: () => undefined };
  stack.push(first);
  const release = stack.push(second);

  release();
  release();

  expect(stack.size).toBe(1);
  expect(stack.top()).toBe(first);
});

test("a layer without handlers still consumes Escape", () => {
  const stack = new OverlayStack();
  stack.push({});
  const { event, calls } = keyEvent("Escape");
  expect(stack.handleKeydown(event)).toBe(true);
  expect(calls.prevented).toBe(1);
});

test("attachOverlayKeyboard listens in capture phase and detaches cleanly", () => {
  const stack = new OverlayStack();
  let closed = 0;
  stack.push({ onEscape: () => (closed += 1) });

  type Listener = (event: unknown) => void;
  const listeners = new Map<string, { listener: Listener; capture: unknown }>();
  const target = {
    addEventListener: (type: string, listener: Listener, capture?: unknown) => {
      listeners.set(type, { listener, capture });
    },
    removeEventListener: (type: string, listener: Listener) => {
      const stored = listeners.get(type);
      if (stored?.listener === listener) listeners.delete(type);
    },
  };

  const detach = attachOverlayKeyboard(
    stack,
    target as unknown as Pick<
      Window,
      "addEventListener" | "removeEventListener"
    >,
  );
  const registered = listeners.get("keydown");
  expect(registered?.capture).toBe(true);

  registered!.listener({
    key: "Escape",
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });
  expect(closed).toBe(1);

  detach();
  expect(listeners.has("keydown")).toBe(false);
});
