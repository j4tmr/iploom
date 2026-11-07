import { describe, expect, test } from "bun:test";
import { formatDate, formatNumber } from "../../apps/studio/src/i18n.ts";

describe("i18n formatting helpers", () => {
  test("formatNumber groups digits for both locales", () => {
    expect(formatNumber(12345, "en")).toBe("12,345");
    expect(formatNumber(12345, "zh-CN")).toBe("12,345");
    expect(formatNumber(7, "en")).toBe("7");
  });

  test("formatDate renders a locale timestamp and keeps unparseable input", () => {
    expect(formatDate("2026-11-06T12:34:00.000Z", "en")).toMatch(/2026/);
    expect(formatDate("2026-11-06T12:34:00.000Z", "zh-CN")).toMatch(/2026/);
    expect(formatDate("not-a-date", "en")).toBe("not-a-date");
  });
});
