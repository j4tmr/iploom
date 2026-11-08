import type { MainMessages } from "./messages.ts";

/**
 * Native dialog options for the main process, built from the injected
 * catalog. Kept as pure data (no `electron` import) so both locales and the
 * exact button order / default-cancel ids are unit-testable — the option
 * literals used to live inline in `main.ts`, where no test could reach them.
 *
 * The shape is structurally compatible with `Electron.MessageBoxOptions`;
 * `electron/main.ts` passes it straight to `dialog.showMessageBox`.
 */
export interface MainDialogOptions {
  type: "error" | "info";
  title: string;
  message: string;
  detail?: string;
  buttons: string[];
  defaultId: number;
  cancelId?: number;
  noLink: true;
}

/** Reload was refused because the renderer could not confirm its save. */
export function reloadCanceledDialog(
  detail: string,
  messages: MainMessages,
): MainDialogOptions {
  const { dialogs } = messages;
  return {
    type: "error",
    title: dialogs.reloadCanceledTitle,
    message: dialogs.reloadCanceledMessage,
    detail,
    buttons: [dialogs.ok],
    defaultId: 0,
    noLink: true,
  };
}

/** A close/quit save failed; response 1 = copy, 2 = exit, 3 = keep editing. */
export function closeFailureDialog(
  message: string,
  messages: MainMessages,
): MainDialogOptions {
  const { dialogs } = messages;
  return {
    type: "error",
    title: dialogs.closeFailedTitle,
    message,
    detail: dialogs.closeFailedDetail,
    buttons: [
      dialogs.retry,
      dialogs.closeFailedCopyAndExit,
      dialogs.closeFailedExitWithoutSaving,
      dialogs.keepEditing,
    ],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  };
}

/** "Save a copy" was chosen before the renderer had handed over the workspace. */
export function noRecoveryCopyDialog(
  messages: MainMessages,
): MainDialogOptions {
  const { dialogs } = messages;
  return {
    type: "error",
    title: dialogs.noRecoveryCopyTitle,
    message: dialogs.noRecoveryCopyMessage,
    buttons: [dialogs.retry, dialogs.keepEditing],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}

export function recoverySavedDialog(
  path: string,
  messages: MainMessages,
): MainDialogOptions {
  const { dialogs } = messages;
  return {
    type: "info",
    title: dialogs.recoverySavedTitle,
    message: dialogs.recoverySavedMessage(path),
    buttons: [dialogs.exit],
    defaultId: 0,
    noLink: true,
  };
}

export function recoveryFailedDialog(
  message: string,
  messages: MainMessages,
): MainDialogOptions {
  const { dialogs } = messages;
  return {
    type: "error",
    title: dialogs.recoveryFailedTitle,
    message,
    buttons: [dialogs.retry, dialogs.keepEditing],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}

/** The renderer process died; response 0 = reload, 1 = quit. */
export function rendererCrashDialog(
  reason: string,
  messages: MainMessages,
): MainDialogOptions {
  const { dialogs } = messages;
  return {
    type: "error",
    title: dialogs.crashTitle,
    message: dialogs.crashMessage(reason),
    detail: dialogs.crashDetail,
    buttons: [dialogs.reload, dialogs.quit],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}
