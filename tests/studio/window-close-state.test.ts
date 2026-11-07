import { describe, expect, test } from "bun:test";
import {
  approveClose,
  beginCloseHandshake,
  createWindowCloseState,
  finishCloseHandshake,
  shouldOfferCrashRecovery,
  shouldRunCloseHandshake,
  type QuitState,
} from "../../apps/studio/src/node/window-close-state.ts";

function freshQuit(): QuitState {
  return { approved: false, inFlight: false };
}

describe("window close state", () => {
  test("a re-created window never inherits a previous window's approval", () => {
    const first = createWindowCloseState();
    const quit = freshQuit();
    expect(beginCloseHandshake(first, quit, false)).toBe(true);
    approveClose(first, quit, false);
    expect(shouldRunCloseHandshake(first, false)).toBe(false);

    // macOS `activate` creates a new window after the first one closed. Its
    // close handler must run the flush handshake again instead of trusting
    // module-level approval left behind by the previous window.
    const second = createWindowCloseState();
    expect(shouldRunCloseHandshake(second, false)).toBe(true);
    expect(shouldOfferCrashRecovery(second, quit)).toBe(true);
    expect(beginCloseHandshake(second, quit, false)).toBe(true);
    expect(second.approved).toBe(false);
  });

  test("only one window-close handshake runs at a time", () => {
    const state = createWindowCloseState();
    const quit = freshQuit();
    expect(beginCloseHandshake(state, quit, false)).toBe(true);
    expect(beginCloseHandshake(state, quit, false)).toBe(false);
    expect(state.inFlight).toBe(true);
    expect(quit.inFlight).toBe(false);

    finishCloseHandshake(state, quit, false);
    expect(state.inFlight).toBe(false);
    expect(beginCloseHandshake(state, quit, false)).toBe(true);
  });

  test("quit and window handshakes keep independent in-flight guards", () => {
    const state = createWindowCloseState();
    const quit = freshQuit();
    expect(beginCloseHandshake(state, quit, true)).toBe(true);
    expect(quit.inFlight).toBe(true);
    expect(state.inFlight).toBe(false);
    expect(beginCloseHandshake(state, quit, true)).toBe(false);

    finishCloseHandshake(state, quit, true);
    expect(quit.inFlight).toBe(false);
    expect(state.inFlight).toBe(false);
    expect(quit.approved).toBe(false);
  });

  test("quit approval is app-wide while window approval stays local", () => {
    const first = createWindowCloseState();
    const quit = freshQuit();
    approveClose(first, quit, false);
    expect(first.approved).toBe(true);
    expect(quit.approved).toBe(false);

    const second = createWindowCloseState();
    approveClose(second, quit, true);
    expect(second.approved).toBe(true);
    expect(quit.approved).toBe(true);
  });

  test("crash recovery is suppressed only while a handshake is underway", () => {
    const state = createWindowCloseState();
    const quit = freshQuit();
    expect(shouldOfferCrashRecovery(state, quit)).toBe(true);

    beginCloseHandshake(state, quit, false);
    expect(shouldOfferCrashRecovery(state, quit)).toBe(false);
    finishCloseHandshake(state, quit, false);
    expect(shouldOfferCrashRecovery(state, quit)).toBe(true);

    beginCloseHandshake(state, quit, true);
    expect(shouldOfferCrashRecovery(state, quit)).toBe(false);
    finishCloseHandshake(state, quit, true);
    expect(shouldOfferCrashRecovery(state, quit)).toBe(true);

    approveClose(state, quit, true);
    expect(shouldOfferCrashRecovery(state, quit)).toBe(false);
  });

  test("approval and a destroyed renderer both skip the close handshake", () => {
    const approved = createWindowCloseState();
    approveClose(approved, freshQuit(), false);
    expect(shouldRunCloseHandshake(approved, false)).toBe(false);
    expect(shouldOfferCrashRecovery(approved, freshQuit())).toBe(false);

    expect(shouldRunCloseHandshake(createWindowCloseState(), true)).toBe(false);
    expect(shouldRunCloseHandshake(createWindowCloseState(), false)).toBe(true);
  });
});
