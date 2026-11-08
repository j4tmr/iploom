import "./dom-setup";
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { bridge } from "../../apps/studio/src/platform.ts";
import { ExportsView } from "../../apps/studio/src/views/exports-view.tsx";

const originalOpenFolder = bridge.openFolder;

afterEach(() => {
  cleanup();
  bridge.openFolder = originalOpenFolder;
});

function exportRecord(
  workspace: ReturnType<typeof createDemoWorkspace>,
  overrides: { id: string; createdAt: string; workTitle: string },
) {
  return {
    workId: workspace.works[0]!.id,
    chapterIds: [],
    fileCount: 1,
    bytes: 10,
    manifestSha256: "a".repeat(64),
    outputPath: "/outside/reveal/arcreel",
    ...overrides,
  };
}

function workspaceWithExport() {
  const workspace = createDemoWorkspace("en");
  workspace.exports.push(
    exportRecord(workspace, {
      id: "export_test",
      createdAt: "2026-11-07T00:00:00.000Z",
      workTitle: workspace.works[0]!.title.en,
    }),
  );
  return workspace;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a rejected reveal reports a localized error instead of failing silently", async () => {
  bridge.openFolder = mock(async () => {
    throw new Error("Path is outside this workspace's known locations");
  });
  const onNotify = mock(() => {});
  const view = render(
    <ExportsView
      workspace={workspaceWithExport()}
      locale="en"
      t={translator("en")}
      onNotify={onNotify}
      onOpenWork={() => {}}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Show in folder" }));
  await settle();

  expect(onNotify).toHaveBeenCalledTimes(1);
  expect(onNotify).toHaveBeenCalledWith(
    translator("en")("openFolderFailed"),
  );
});

test("a successful reveal does not report an error", async () => {
  const openFolder = mock(async () => {});
  bridge.openFolder = openFolder;
  const onNotify = mock(() => {});
  const view = render(
    <ExportsView
      workspace={workspaceWithExport()}
      locale="en"
      t={translator("en")}
      onNotify={onNotify}
      onOpenWork={() => {}}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Show in folder" }));
  await settle();

  expect(openFolder).toHaveBeenCalledWith("/outside/reveal/arcreel");
  expect(onNotify).not.toHaveBeenCalled();
});

test("records are listed newest first", () => {
  const workspace = createDemoWorkspace("en");
  workspace.exports.push(
    exportRecord(workspace, {
      id: "export_older",
      createdAt: "2026-11-01T00:00:00.000Z",
      workTitle: "Older export",
    }),
    exportRecord(workspace, {
      id: "export_newer",
      createdAt: "2026-11-05T00:00:00.000Z",
      workTitle: "Newer export",
    }),
  );
  const view = render(
    <ExportsView
      workspace={workspace}
      locale="en"
      t={translator("en")}
      onNotify={() => {}}
      onOpenWork={() => {}}
    />,
  );
  expect(
    view
      .getAllByRole("heading", { level: 3 })
      .map((element) => element.textContent),
  ).toEqual(["Newer export", "Older export"]);
});

test("an empty history offers opening the first novel", () => {
  const workspace = createDemoWorkspace("en");
  const onOpenWork = mock(() => {});
  const view = render(
    <ExportsView
      workspace={workspace}
      locale="en"
      t={translator("en")}
      onNotify={() => {}}
      onOpenWork={onOpenWork}
    />,
  );
  fireEvent.click(
    view.getByRole("button", { name: translator("en")("openNovel") }),
  );
  expect(onOpenWork).toHaveBeenCalledWith(workspace.works[0]!.id);
});
