import { expect, test } from "bun:test";
import { retrySave } from "../../apps/studio/src/save-retry.ts";

const noSleep = async () => {};

test("retrySave resolves after a transient failure", async () => {
  let calls = 0;
  const result = await retrySave(
    async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
      return "saved";
    },
    { sleep: noSleep },
  );
  expect(result).toBe("saved");
  expect(calls).toBe(2);
});

test("retrySave rethrows the last error after exhausting attempts", async () => {
  let calls = 0;
  await expect(
    retrySave(
      async () => {
        calls += 1;
        throw new Error(`failure ${calls}`);
      },
      { attempts: 3, sleep: noSleep },
    ),
  ).rejects.toThrow("failure 3");
  expect(calls).toBe(3);
});

test("retrySave does not retry an error marked as permanent", async () => {
  let calls = 0;
  const permanent = Object.assign(new Error("stale browser revision"), {
    retryable: false,
  });
  await expect(
    retrySave(
      async () => {
        calls += 1;
        throw permanent;
      },
      { attempts: 5, sleep: noSleep },
    ),
  ).rejects.toThrow("stale browser revision");
  expect(calls).toBe(1);
});

test("retrySave stops when a newer save superseded it", async () => {
  let current = true;
  let calls = 0;
  await expect(
    retrySave(
      async () => {
        calls += 1;
        current = false;
        throw new Error("stale");
      },
      { attempts: 5, sleep: noSleep, isCurrent: () => current },
    ),
  ).rejects.toThrow("stale");
  expect(calls).toBe(1);
});

test("retrySave uses its default timer sleep between attempts", async () => {
  let calls = 0;
  const result = await retrySave(
    async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
      return "saved";
    },
    { delayMs: 1 },
  );
  expect(result).toBe("saved");
  expect(calls).toBe(2);
});
