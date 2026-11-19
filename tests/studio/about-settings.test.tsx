import "./dom-setup";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AboutSettings } from "../../apps/studio/src/components/about-settings.tsx";
import type { UpdateCheckResult } from "../../apps/studio/src/core/updates.ts";
import { translator } from "../../apps/studio/src/i18n.ts";
import { bridge, type AppInfo } from "../../apps/studio/src/platform.ts";

afterEach(cleanup);

const mockAppInfo: AppInfo = {
  version: "0.11.0",
  platform: "darwin",
  workspacePath: "/path/to/workspace.json",
  snapshotDirectory: "/path/to/snapshots",
  desktop: true,
  mcp: null,
  mcpError: null,
  mcpBinary: null,
};

describe("AboutSettings component", () => {
  test("renders version, platform metadata, and links", () => {
    const t = translator("zh-CN");
    const view = render(
      <AboutSettings info={mockAppInfo} locale="zh-CN" t={t} />,
    );

    expect(view.getByText("v0.11.0")).toBeTruthy();
    expect(view.getByText(t("appModeDesktop"))).toBeTruthy();
    expect(view.getByText("darwin")).toBeTruthy();
    expect(view.getByText(t("projectHome"))).toBeTruthy();
    expect(view.getByText(t("openReleases"))).toBeTruthy();
  });

  test("scrolls the panel into view whenever the focus signal changes", async () => {
    const t = translator("zh-CN");
    const scrolled: Element[] = [];
    const prototype = Element.prototype as unknown as {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    };
    const original = prototype.scrollIntoView;
    prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };

    try {
      const view = render(
        <AboutSettings
          info={mockAppInfo}
          locale="zh-CN"
          t={t}
          focusSignal={1}
        />,
      );

      // Mounting with an armed signal (menu click from another route) scrolls
      // on a later frame, after the route-change reset to the top; layout
      // changes while Settings loads may re-align the panel.
      await waitFor(() => expect(scrolled.length).toBeGreaterThanOrEqual(1));
      expect(scrolled[0]?.classList.contains("about-panel")).toBe(true);
      const alignedOnce = scrolled.length;

      // A second menu click while Settings is already open scrolls again.
      view.rerender(
        <AboutSettings
          info={mockAppInfo}
          locale="zh-CN"
          t={t}
          focusSignal={2}
        />,
      );
      await waitFor(() => expect(scrolled.length).toBeGreaterThan(alignedOnce));
      expect(
        scrolled[scrolled.length - 1]?.classList.contains("about-panel"),
      ).toBe(true);
    } finally {
      if (original) prototype.scrollIntoView = original;
      else delete prototype.scrollIntoView;
    }
  });

  test("does not scroll without a focus signal", async () => {
    const t = translator("zh-CN");
    const prototype = Element.prototype as unknown as {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    };
    const original = prototype.scrollIntoView;
    let calls = 0;
    prototype.scrollIntoView = () => {
      calls += 1;
    };

    try {
      render(<AboutSettings info={mockAppInfo} locale="zh-CN" t={t} />);
      // Give any queued frame a chance to run before asserting nothing happened.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(0);
    } finally {
      if (original) prototype.scrollIntoView = original;
      else delete prototype.scrollIntoView;
    }
  });

  test("checks updates and renders available update with download button", async () => {
    const t = translator("en");
    const openedUrls: string[] = [];
    const prevOpenExternal = bridge.openExternal;
    const prevCheckForUpdates = bridge.checkForUpdates;

    const availableResult: UpdateCheckResult = {
      status: "update-available",
      currentVersion: "0.11.0",
      checkedAt: "2026-11-19T10:00:00.000Z",
      latest: {
        version: "0.12.0",
        tag: "studio-v0.12.0",
        notesUrl: "https://github.com/j4tmr/iploom/releases/tag/studio-v0.12.0",
        publishedAt: "2026-11-19T09:00:00.000Z",
      },
      download: {
        name: "IPloom-Studio-0.12.0-darwin-universal.dmg",
        url: "https://github.com/j4tmr/iploom/releases/download/studio-v0.12.0/IPloom-Studio-0.12.0-darwin-universal.dmg",
        kind: "dmg",
      },
      recent: [
        {
          version: "0.12.0",
          tag: "studio-v0.12.0",
          notesUrl:
            "https://github.com/j4tmr/iploom/releases/tag/studio-v0.12.0",
          publishedAt: "2026-11-19T09:00:00.000Z",
        },
      ],
    };

    bridge.checkForUpdates = async () => availableResult;
    bridge.openExternal = async (url: string) => {
      openedUrls.push(url);
    };

    try {
      const view = render(
        <AboutSettings info={mockAppInfo} locale="en" t={t} />,
      );

      const checkBtn = view.getByRole("button", { name: t("checkUpdates") });
      fireEvent.click(checkBtn);

      await waitFor(() =>
        expect(
          view.getByText(t("updateAvailable", { version: "0.12.0" })),
        ).toBeTruthy(),
      );

      const downloadBtn = view.getByRole("button", {
        name: t("downloadForPlatform"),
      });
      fireEvent.click(downloadBtn);
      expect(openedUrls).toContain(availableResult.download!.url);

      expect(
        view.getByText("IPloom-Studio-0.12.0-darwin-universal.dmg"),
      ).toBeTruthy();
    } finally {
      bridge.openExternal = prevOpenExternal;
      bridge.checkForUpdates = prevCheckForUpdates;
    }
  });

  test("handles up-to-date state correctly", async () => {
    const t = translator("zh-CN");
    const prevCheckForUpdates = bridge.checkForUpdates;

    const upToDateResult: UpdateCheckResult = {
      status: "up-to-date",
      currentVersion: "0.11.0",
      checkedAt: "2026-11-19T10:00:00.000Z",
      latest: {
        version: "0.11.0",
        tag: "studio-v0.11.0",
        notesUrl: "https://github.com/j4tmr/iploom/releases/tag/studio-v0.11.0",
        publishedAt: "2026-11-19T09:00:00.000Z",
      },
      recent: [],
    };

    bridge.checkForUpdates = async () => upToDateResult;

    try {
      const view = render(
        <AboutSettings info={mockAppInfo} locale="zh-CN" t={t} />,
      );

      const checkBtn = view.getByRole("button", { name: t("checkUpdates") });
      fireEvent.click(checkBtn);

      await waitFor(() =>
        expect(
          view.getByText(t("updateCurrent", { version: "0.11.0" })),
        ).toBeTruthy(),
      );
    } finally {
      bridge.checkForUpdates = prevCheckForUpdates;
    }
  });

  test("handles update failure or unavailable state gracefully", async () => {
    const t = translator("zh-CN");
    const prevCheckForUpdates = bridge.checkForUpdates;

    const unavailableResult: UpdateCheckResult = {
      status: "unavailable",
      reason: "network",
      currentVersion: "0.11.0",
      checkedAt: "2026-11-19T10:00:00.000Z",
      recent: [],
    };

    bridge.checkForUpdates = async () => unavailableResult;

    try {
      const view = render(
        <AboutSettings info={mockAppInfo} locale="zh-CN" t={t} />,
      );

      const checkBtn = view.getByRole("button", { name: t("checkUpdates") });
      fireEvent.click(checkBtn);

      await waitFor(() =>
        expect(view.getByText(t("updateUnavailable"))).toBeTruthy(),
      );
      expect(view.getByText(t("updateReasonNetwork"))).toBeTruthy();
    } finally {
      bridge.checkForUpdates = prevCheckForUpdates;
    }
  });
});
