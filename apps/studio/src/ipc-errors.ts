/**
 * Electron's `ipcRenderer.invoke` wraps every main-process rejection in
 * `Error invoking remote method '<channel>': Error: <message>` before it
 * crosses the contextBridge. The wrapper is untranslated English, so after
 * the main-process localization work it would surround localized copy with
 * English boilerplate. The preload bridge unwraps the wrapper once, for every
 * channel, and rethrows a plain Error carrying the original message.
 */
const IPC_INVOKE_PREFIX = "Error invoking remote method ";
const ERROR_NAME_PREFIX = "Error: ";

/** Strip Electron's invoke wrapper for `channel` from an error message. */
export function unwrapIpcErrorMessage(
  channel: string,
  message: string,
): string {
  const prefix = `${IPC_INVOKE_PREFIX}'${channel}': `;
  if (!message.startsWith(prefix)) return message;
  const rest = message.slice(prefix.length);
  return rest.startsWith(ERROR_NAME_PREFIX)
    ? rest.slice(ERROR_NAME_PREFIX.length)
    : rest;
}

/**
 * The rejection the preload world rethrows for `channel`. Errors without
 * Electron's wrapper (and non-Error rejections) pass through unchanged so
 * renderer-side mapping such as the stale-save marker keeps working.
 */
export function unwrapIpcError(channel: string, error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const message = unwrapIpcErrorMessage(channel, error.message);
  return message === error.message ? error : new Error(message);
}
