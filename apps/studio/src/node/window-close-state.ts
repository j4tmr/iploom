/**
 * State for the save-before-close handshake. The main process owns one
 * `WindowCloseState` per `BrowserWindow`: approval must never outlive the
 * window it was granted to, or a later window (for example after macOS
 * re-activates the app) would skip the flush handshake and silently drop the
 * debounced autosave.
 */

export interface WindowCloseState {
  approved: boolean;
  inFlight: boolean;
}

/**
 * App-level quit flags. Unlike window approval, these intentionally span
 * windows: they describe the Electron `app` lifecycle itself.
 */
export interface QuitState {
  approved: boolean;
  inFlight: boolean;
}

export function createWindowCloseState(): WindowCloseState {
  return { approved: false, inFlight: false };
}

/** A `close` event must run the handshake unless this window already passed it. */
export function shouldRunCloseHandshake(
  state: WindowCloseState,
  webContentsDestroyed: boolean,
): boolean {
  return !state.approved && !webContentsDestroyed;
}

/** An unexpected renderer exit should prompt unless a close or quit is underway. */
export function shouldOfferCrashRecovery(
  state: WindowCloseState,
  quit: QuitState,
): boolean {
  return !state.approved && !state.inFlight && !quit.approved && !quit.inFlight;
}

/**
 * Starts a window-close or app-quit handshake. Returns false when that scope
 * already has one in flight, so repeated close/quit requests are ignored.
 * A window handshake never consumes the quit guard, and vice versa.
 */
export function beginCloseHandshake(
  state: WindowCloseState,
  quit: QuitState,
  quitting: boolean,
): boolean {
  const pending = quitting ? quit : state;
  if (pending.inFlight) return false;
  pending.inFlight = true;
  return true;
}

/**
 * Records that the window may close without another handshake. A quit
 * approval is app-wide; a window approval belongs to this window only.
 */
export function approveClose(
  state: WindowCloseState,
  quit: QuitState,
  quitting: boolean,
): void {
  state.approved = true;
  if (quitting) quit.approved = true;
}

/** Clears the in-flight guard when a handshake finishes without approving. */
export function finishCloseHandshake(
  state: WindowCloseState,
  quit: QuitState,
  quitting: boolean,
): void {
  if (quitting) quit.inFlight = false;
  else state.inFlight = false;
}
