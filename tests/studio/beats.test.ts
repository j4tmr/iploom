import { expect, test } from "bun:test";
import { normalizeBeats } from "../../apps/studio/src/core/beats.ts";
import { CHAPTER_LIMITS } from "../../apps/studio/src/core/types.ts";

test("keeps one trimmed beat per non-empty line", () => {
  expect(normalizeBeats("  Hero arrives \n\nVillain waits\n   \n")).toEqual([
    "Hero arrives",
    "Villain waits",
  ]);
  expect(normalizeBeats("single beat")).toEqual(["single beat"]);
  expect(normalizeBeats("")).toEqual([]);
});

test("accepts CRLF line endings", () => {
  expect(normalizeBeats("a\r\nb")).toEqual(["a", "b"]);
});

test("caps the beat count and each beat's length at the schema limits", () => {
  const longest = "x".repeat(CHAPTER_LIMITS.beatLength + 10);
  const raw = [
    longest,
    ...Array.from(
      { length: CHAPTER_LIMITS.beats + 5 },
      (_, index) => `beat ${index}`,
    ),
  ].join("\n");
  const beats = normalizeBeats(raw);
  expect(beats).toHaveLength(CHAPTER_LIMITS.beats);
  expect(beats[0]).toHaveLength(CHAPTER_LIMITS.beatLength);
  expect(beats).not.toContain("");
});
