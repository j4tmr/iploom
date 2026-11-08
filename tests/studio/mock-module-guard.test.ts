import "./mock-module-guard.ts";
import { expect, mock, test } from "bun:test";

type MockModule = (specifier: string, factory: () => object) => void;

test("mock.module is a frozen throwing replacement", () => {
  const descriptor = Object.getOwnPropertyDescriptor(mock, "module");
  // Check the replacement before touching it: if the guard ever disappears,
  // this fails here rather than performing a real process-wide module mock.
  expect(descriptor?.configurable).toBe(false);
  expect(descriptor?.writable).toBe(false);

  // biome-ignore lint/complexity/useLiteralKeys: a computed read is the alias path the guard closes
  const replace = (mock as unknown as Record<string, MockModule>)["module"]!;
  expect(() => replace("not-a-module", () => ({}))).toThrow(
    /mock\.module\(\) is banned/,
  );
});
