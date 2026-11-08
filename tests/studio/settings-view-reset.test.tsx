import "./dom-setup";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { SettingsView } from "../../apps/studio/src/views/settings-view.tsx";
import { describeResetFailure } from "../../apps/studio/src/workspace-errors.ts";

afterEach(cleanup);

const t = translator("en");

test("a failed demo reset surfaces an error toast and re-enables the button", async () => {
  const previousConfirm = window.confirm;
  window.confirm = (() => true) as typeof window.confirm;
  let resetCalls = 0;
  const onResetDemo = async () => {
    resetCalls += 1;
    // Exactly what app.tsx rethrows after translating the bridge failure.
    throw new Error(describeResetFailure(new Error("reset refused"), t));
  };

  try {
    const view = render(
      <SettingsView
        workspace={createDemoWorkspace("en")}
        locale="en"
        t={t}
        path="workspace.json"
        aiInfo={null}
        onAiConfigured={() => {}}
        onUpdateSettings={() => {}}
        onResetDemo={onResetDemo}
        onRestoreSnapshot={async () => {}}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: t("resetDemo") }));
    await waitFor(() => expect(resetCalls).toBe(1));

    const toast = await view.findByText(
      "Could not load the demo workspace: reset refused",
    );
    expect(toast.className).toContain("toast-error");
    await waitFor(() =>
      expect(
        (
          view.getByRole("button", {
            name: t("resetDemo"),
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  } finally {
    window.confirm = previousConfirm;
  }
});
