import "./dom-setup";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult,
} from "@testing-library/react";
import { ProductionPanel } from "../../apps/studio/src/components/production-panel.tsx";
import type {
  AiCompletion,
  AiConfigInfo,
} from "../../apps/studio/src/core/ai.ts";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import type { WorkflowTask } from "../../apps/studio/src/core/types.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { bridge } from "../../apps/studio/src/platform.ts";

let restoreConfirm: (() => void) | null = null;

afterEach(() => {
  cleanup();
  // window is shared by every test file in the bun test process; a leftover
  // stub would change the dialogs of whatever file runs next.
  restoreConfirm?.();
  restoreConfirm = null;
});

const t = translator("en");
const aiInfo: AiConfigInfo = {
  endpoint: "http://127.0.0.1:11434",
  model: "test-model",
  configured: true,
};

function stubConfirm(answer: boolean) {
  // Keep the value from before the first stub of this test: a second stub
  // must not record the first fake as the thing to restore.
  if (!restoreConfirm) {
    const previous = window.confirm;
    restoreConfirm = () => {
      window.confirm = previous;
    };
  }
  const confirm = mock(() => answer);
  window.confirm = confirm as unknown as typeof window.confirm;
  return confirm;
}

function labeledSelect(view: RenderResult, label: string): HTMLSelectElement {
  return view.getByLabelText(label) as HTMLSelectElement;
}

/** Drain promise chains that use real timers (crypto.subtle, bridge mocks). */
async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

test("a run that ends after the context changed re-syncs the panel scope", async () => {
  stubConfirm(true);
  const resolvers: Array<(completion: AiCompletion) => void> = [];
  const spies = [
    spyOn(bridge, "aiConfig").mockResolvedValue(aiInfo),
    spyOn(bridge, "runAi").mockImplementation(
      () =>
        new Promise<AiCompletion>((resolve) => {
          resolvers.push(resolve);
        }),
    ),
    spyOn(bridge, "onAiProgress").mockReturnValue(() => undefined),
    spyOn(bridge, "cancelAi").mockResolvedValue(undefined),
  ];
  try {
    const workspace = createDemoWorkspace("en");
    const onTasks = mock((_tasks: WorkflowTask[]) => true);
    const view = render(
      <ProductionPanel
        workspace={workspace}
        locale="en"
        t={t}
        aiInfo={aiInfo}
        onOpenSettings={() => {}}
        context={{ universeId: "uni_mist_harbor", workId: "work_tide_clock" }}
        onTasks={onTasks}
        onStatus={() => {}}
        onResult={() => true}
      />,
    );

    const novel = labeledSelect(view, t("productionNovel"));
    const world = labeledSelect(view, t("productionWorld"));
    expect(novel.value).toBe("work_tide_clock");
    expect(world.value).toBe("uni_mist_harbor");

    fireEvent.click(view.getByTestId("production-compose"));
    const run = view.getByTestId("production-run") as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(run);
      await until(() => resolvers.length === 1);
    });

    // Navigate to another work while the run is in flight: the busy fieldset
    // keeps the controls alone, and the skipped context change must not be
    // applied mid-run either.
    view.rerender(
      <ProductionPanel
        workspace={workspace}
        locale="en"
        t={t}
        aiInfo={aiInfo}
        onOpenSettings={() => {}}
        context={{
          universeId: "uni_ninth_station",
          workId: "work_last_train",
        }}
        onTasks={onTasks}
        onStatus={() => {}}
        onResult={() => true}
      />,
    );
    expect(
      (view.container.querySelector("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(novel.value).toBe("work_tide_clock");

    await act(async () => {
      resolvers[0]!({ text: "a production draft" });
      await Promise.resolve();
    });
    await settle();

    // The finished run still belongs to the work it started on, but the panel
    // must pick up the context the user navigated to — otherwise compose and
    // create keep targeting the previous work forever.
    expect(onTasks).toHaveBeenCalledTimes(1);
    expect(onTasks.mock.calls[0]?.[0]?.[0]?.workId).toBe("work_tide_clock");
    expect(novel.value).toBe("work_last_train");
    expect(world.value).toBe("uni_ninth_station");
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
