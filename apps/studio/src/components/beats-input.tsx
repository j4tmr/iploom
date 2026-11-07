import { useState } from "react";
import { normalizeBeats } from "../core/beats.ts";
import { TextArea } from "./ui.tsx";

/**
 * Beat editor backed by a textarea.
 *
 * The workspace stores `string[]`, but a textarea needs the text the user is
 * typing. Rendering `beats.join("\n")` straight from the normalized array
 * erased the newline the moment it was typed and trimmed trailing spaces
 * mid-word; here a local draft holds the raw text, the workspace receives the
 * normalized beats on every change, and blur collapses the draft to them.
 *
 * `null` means "not editing": the field shows the stored value and follows it
 * when something else (AI apply, import, restore) changes it. Key the component
 * by chapter id so a switch starts from the new chapter's beats.
 */
export function BeatsInput({
  value,
  onChange,
  rows = 5,
}: {
  value: string[];
  onChange: (beats: string[]) => void;
  rows?: number;
}) {
  const saved = value.join("\n");
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextArea
      rows={rows}
      value={draft ?? saved}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        onChange(normalizeBeats(raw));
      }}
      onBlur={() => {
        const beats = normalizeBeats(draft ?? saved);
        setDraft(null);
        onChange(beats);
      }}
    />
  );
}
