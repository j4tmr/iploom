import { expect, test } from "bun:test";
import { NewerBrowserWorkspaceVersionError } from "../../apps/studio/src/browser-workspace.ts";
import { WORKSPACE_SCHEMA_VERSION } from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { describeResetFailure } from "../../apps/studio/src/workspace-errors.ts";

test("a newer-schema reset failure maps to the dedicated message, not the generic wrapper", () => {
  const foundVersion = WORKSPACE_SCHEMA_VERSION + 1;
  const error = new NewerBrowserWorkspaceVersionError(foundVersion);
  const en = translator("en");
  const zh = translator("zh-CN");

  // The raw error text also mentions a "newer IPloom Studio" and the version,
  // so assert the instruction only the dedicated mapping carries. The generic
  // wrapper would embed the whole raw message instead.
  expect(describeResetFailure(error, en)).toContain("Update the app first.");
  expect(describeResetFailure(error, en)).toContain(String(foundVersion));
  expect(describeResetFailure(error, en)).not.toBe(
    en("resetDemoFailed", { reason: error.message }),
  );

  expect(describeResetFailure(error, zh)).toContain("请先升级应用。");
  expect(describeResetFailure(error, zh)).toContain(String(foundVersion));
  expect(describeResetFailure(error, zh)).not.toBe(
    zh("resetDemoFailed", { reason: error.message }),
  );
});

test("other reset failures are wrapped with the failed action", () => {
  expect(describeResetFailure(new Error("disk is read-only"), translator("en")))
    .toBe("Could not load the demo workspace: disk is read-only");
  expect(describeResetFailure("offline", translator("zh-CN")))
    .toBe("无法载入演示工作区：offline");
});
