import { CHAPTER_LIMITS } from "./types.ts";

/**
 * Turn the raw text of the beat editor into the stored beat list.
 *
 * One beat per non-empty line, each trimmed and capped at the schema limits.
 * The editor keeps the raw text in local state while typing and applies this
 * on change, so a half-typed `"a b\n"` is not rewritten to `"a b"` under the
 * caret — only what the workspace stores is normalized.
 */
export function normalizeBeats(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().slice(0, CHAPTER_LIMITS.beatLength))
    .filter(Boolean)
    .slice(0, CHAPTER_LIMITS.beats);
}
