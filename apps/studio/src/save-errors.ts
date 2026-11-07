/**
 * Electron IPC preserves only an Error's message string, so a save refused
 * because the on-disk workspace is newer must carry this marker in its
 * message. The renderer maps it back to a non-retryable error (`retrySave`
 * inspects `retryable`), and the reload handshake uses it to adopt the newer
 * file instead of cancelling the reload.
 */
export const STALE_WORKSPACE_MARKER = "[IPLOOM_STALE_WORKSPACE]";

export function markStaleWorkspaceMessage(message: string): string {
  return message.includes(STALE_WORKSPACE_MARKER)
    ? message
    : `${STALE_WORKSPACE_MARKER} ${message}`;
}

export function isStaleWorkspaceMessage(value: unknown): boolean {
  return typeof value === "string" && value.includes(STALE_WORKSPACE_MARKER);
}

/** Non-retryable stale-save error rebuilt on the renderer side of IPC. */
export class StaleWorkspaceSaveError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "StaleWorkspaceError";
  }
}

/**
 * Rebuild the stale-save error that `ipcRenderer.invoke` flattened into a
 * plain Error (it drops the name and custom fields). Unrelated errors pass
 * through untouched so `retrySave` keeps its transient-failure behavior.
 */
export function mapSaveErrorFromIpc(error: unknown): unknown {
  if (!(error instanceof Error) || !isStaleWorkspaceMessage(error.message))
    return error;
  const marker = error.message.indexOf(STALE_WORKSPACE_MARKER);
  return new StaleWorkspaceSaveError(error.message.slice(marker));
}

/** True for the stale-save error on either side of the IPC boundary. */
export function isStaleSaveError(error: unknown): boolean {
  return (
    error instanceof StaleWorkspaceSaveError ||
    (error instanceof Error && isStaleWorkspaceMessage(error.message)) ||
    isStaleWorkspaceMessage(error)
  );
}
