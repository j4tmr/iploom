import { expect, test } from "bun:test";
import { NewerBrowserWorkspaceVersionError } from "../../apps/studio/src/browser-workspace.ts";
import { WORKSPACE_SCHEMA_VERSION } from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { describeResetFailure } from "../../apps/studio/src/workspace-errors.ts";

test("a newer-schema reset failure is explained in both locales", () => {
  const foundVersion = WORKSPACE_SCHEMA_VERSION + 1;
  const error = new NewerBrowserWorkspaceVersionError(foundVersion);

  const en = describeResetFailure(error, translator("en"));
  expect(en).toContain("newer IPloom Studio");
  expect(en).toContain(String(foundVersion));

  const zh = describeResetFailure(error, translator("zh-CN"));
  expect(zh).toContain("更新版本的 IPloom Studio");
  expect(zh).toContain(String(foundVersion));
});

test("other reset failures are wrapped with the failed action", () => {
  expect(describeResetFailure(new Error("disk is read-only"), translator("en")))
    .toBe("Could not load the demo workspace: disk is read-only");
  expect(describeResetFailure("offline", translator("zh-CN")))
    .toBe("无法载入演示工作区：offline");
});
