import "./dom-setup";
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "bun:test";
import { useToast } from "../../apps/studio/src/components/use-toast.ts";

test("notify shows a message and replaces the previous one", () => {
  const { result } = renderHook(() => useToast(10_000));
  act(() => result.current.notify("first"));
  expect(result.current.toast).toEqual({ message: "first", tone: "success" });
  // A second notify clears the first toast's timer, so it can never dismiss
  // the replacement early.
  act(() => result.current.notify("second", "error"));
  expect(result.current.toast).toEqual({ message: "second", tone: "error" });
  expect(result.current.toast?.tone).toBe("error");
});

test("dismiss clears the message and tolerates having no timer", () => {
  const { result } = renderHook(() => useToast(10_000));
  act(() => result.current.notify("hello"));
  act(() => result.current.dismiss());
  expect(result.current.toast).toBeNull();
  act(() => result.current.dismiss());
  expect(result.current.toast).toBeNull();
});

test("a toast dismisses itself after the given duration", async () => {
  const { result } = renderHook(() => useToast(5));
  act(() => result.current.notify("fleeting"));
  expect(result.current.toast).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(result.current.toast).toBeNull();
});
