import { NewerBrowserWorkspaceVersionError } from "./browser-workspace.ts";
import type { Translate } from "./i18n.ts";

/**
 * A demo reset is refused when the browser workspace was written by a newer
 * build. That error is English-only, so translate the case the writer can act
 * on and wrap anything else with the action that failed.
 */
export function describeResetFailure(reason: unknown, t: Translate): string {
  if (reason instanceof NewerBrowserWorkspaceVersionError) {
    return t("resetDemoNewerSchema", { version: reason.foundVersion });
  }
  return t("resetDemoFailed", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
}
