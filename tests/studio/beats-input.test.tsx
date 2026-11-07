import "./dom-setup";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { BeatsInput } from "../../apps/studio/src/components/beats-input.tsx";

afterEach(cleanup);

function Harness({
  initial,
  onStore,
}: {
  initial: string[];
  onStore: (beats: string[]) => void;
}) {
  const [beats, setBeats] = useState(initial);
  return (
    <BeatsInput
      value={beats}
      onChange={(next) => {
        setBeats(next);
        onStore(next);
      }}
    />
  );
}

test("typing a newline at the end of a beat keeps it in the field", () => {
  const stored: string[][] = [];
  const view = render(
    <Harness initial={[]} onStore={(beats) => stored.push(beats)} />,
  );
  const field = view.getByRole("textbox") as HTMLTextAreaElement;

  fireEvent.change(field, { target: { value: "a b" } });
  expect(field.value).toBe("a b");

  // The workspace gets the normalized list, but the field must keep the
  // newline the user just typed so the caret can move to the next beat.
  fireEvent.change(field, { target: { value: "a b\n" } });
  expect(field.value).toBe("a b\n");
  expect(stored.at(-1)).toEqual(["a b"]);

  // A trailing space is likewise part of what the user is typing.
  fireEvent.change(field, { target: { value: "a b\nc " } });
  expect(field.value).toBe("a b\nc ");
  expect(stored.at(-1)).toEqual(["a b", "c"]);
});

test("blur collapses the draft to the normalized list", () => {
  const stored: string[][] = [];
  const view = render(
    <Harness initial={[]} onStore={(beats) => stored.push(beats)} />,
  );
  const field = view.getByRole("textbox") as HTMLTextAreaElement;

  fireEvent.change(field, {
    target: { value: "  Hero arrives  \n\nVillain waits\n" },
  });
  fireEvent.blur(field);

  expect(field.value).toBe("Hero arrives\nVillain waits");
  expect(stored.at(-1)).toEqual(["Hero arrives", "Villain waits"]);
});

test("stored beats arriving from outside replace an idle field", () => {
  const view = render(<BeatsInput value={["first"]} onChange={() => {}} />);
  const field = view.getByRole("textbox") as HTMLTextAreaElement;
  expect(field.value).toBe("first");

  view.rerender(<BeatsInput value={["first", "second"]} onChange={() => {}} />);
  expect(field.value).toBe("first\nsecond");
});
