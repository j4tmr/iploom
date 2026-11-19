import { useEffect, useRef, useState } from "react";
import type { UiLocale } from "../core/types.ts";
import type { UpdateCheckResult } from "../core/updates.ts";
import { RELEASES_PAGE_URL } from "../core/updates.ts";
import { APP_VERSION } from "../core/version.ts";
import { formatDate, type Translate } from "../i18n.ts";
import { bridge, type AppInfo } from "../platform.ts";
import { Badge, Button, SectionTitle } from "./ui.tsx";

function failureText(result: UpdateCheckResult, t: Translate): string {
  switch (result.reason) {
    case "timeout":
      return t("updateReasonTimeout");
    case "network":
      return t("updateReasonNetwork");
    case "http":
      return t("updateReasonHttp", { status: result.httpStatus ?? "?" });
    case "response":
      return t("updateReasonResponse");
    case "version":
      return t("updateReasonVersion");
    case "desktop-only":
      return t("updateReasonDesktopOnly");
    default:
      return "";
  }
}

export function AboutSettings({
  info,
  locale,
  t,
  focusSignal = 0,
}: {
  info: AppInfo | null;
  locale: UiLocale;
  t: Translate;
  /** Incremented by the native menu; every change scrolls the panel into view. */
  focusSignal?: number;
}) {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!focusSignal) return;
    // Two things can undo the scroll: App's route effect resets the scroll to
    // the top after this component's effects run, and the settings panels above
    // this one grow while the app info and snapshots load. Re-align once per
    // frame while the page settles for a moment.
    let frame = 0;
    let alive = true;
    const align = () => {
      frame = 0;
      if (!alive) return;
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const schedule = () => {
      if (alive && !frame) frame = requestAnimationFrame(align);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    const timer = window.setTimeout(() => observer.disconnect(), 1500);
    return () => {
      alive = false;
      observer.disconnect();
      window.clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [focusSignal]);

  const displayVersion = info?.version ?? APP_VERSION;
  const isDesktop =
    info?.desktop ?? (typeof window !== "undefined" && Boolean(window.iploom));
  const platformLabel =
    info?.platform ??
    (typeof navigator !== "undefined" ? navigator.platform : "desktop");

  const check = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await bridge.checkForUpdates());
    } catch (reason) {
      setResult(null);
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-panel about-panel" ref={panelRef}>
      <div className="about-hero">
        <div className="about-mark" aria-hidden="true">
          界
        </div>
        <div className="about-hero-main">
          <div className="about-title-row">
            <h2>IPloom Studio</h2>
            <Badge tone="blue">v{displayVersion}</Badge>
            <Badge tone="neutral">
              {isDesktop ? t("appModeDesktop") : t("appModeBrowser")}
            </Badge>
          </div>
          <p className="about-hero-lead">{t("aboutBody")}</p>
          <div className="about-meta">
            <span>
              {t("platform")} <b>{platformLabel}</b>
            </span>
            <span>
              {t("appVersion")} <b>{displayVersion}</b>
            </span>
            <span>{locale}</span>
          </div>
          <div className="about-actions">
            <Button
              variant="ghost"
              icon="external"
              onClick={() =>
                void bridge.openExternal("https://github.com/j4tmr/iploom")
              }
            >
              {t("projectHome")}
            </Button>
            <Button
              variant="ghost"
              icon="external"
              onClick={() => void bridge.openExternal(RELEASES_PAGE_URL)}
            >
              {t("openReleases")}
            </Button>
          </div>
        </div>
      </div>

      <div className="about-update-section">
        <SectionTitle title={t("updateTitle")} />
        <p className="muted small">{t("updateIdle")}</p>
        <div className="update-actions">
          <Button
            variant="primary"
            icon="download"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy
              ? t("checkingUpdates")
              : result
                ? t("recheckUpdates")
                : t("checkUpdates")}
          </Button>
        </div>

        {result ? (
          <div className="update-status" data-status={result.status}>
            {result.status === "update-available" && result.latest ? (
              <>
                <strong>
                  {t("updateAvailable", { version: result.latest.version })}
                </strong>
                <div className="update-actions">
                  {result.download ? (
                    <Button
                      variant="primary"
                      icon="download"
                      onClick={() =>
                        void bridge.openExternal(result.download!.url)
                      }
                    >
                      {t("downloadForPlatform")}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    icon="external"
                    onClick={() =>
                      void bridge.openExternal(result.latest!.notesUrl)
                    }
                  >
                    {t("releaseNotes")}
                  </Button>
                </div>
                {result.download ? (
                  <code className="update-asset">{result.download.name}</code>
                ) : (
                  <p className="muted small">{t("downloadNotAvailable")}</p>
                )}
              </>
            ) : null}

            {result.status === "up-to-date" ? (
              <strong>
                {result.latest
                  ? t("updateCurrent", { version: result.currentVersion })
                  : t("updateNoRelease")}
              </strong>
            ) : null}

            {result.status === "unavailable" ? (
              <>
                <strong>{t("updateUnavailable")}</strong>
                <p className="muted small">{failureText(result, t)}</p>
              </>
            ) : null}

            <p className="muted small">
              {t("checkedAt", { time: formatDate(result.checkedAt, locale) })}
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="muted small">
            {t("updateUnavailable")} {error}
          </p>
        ) : null}

        {result && result.recent.length > 0 ? (
          <div className="release-block">
            <span className="field-label">{t("recentReleases")}</span>
            <ul className="release-list">
              {result.recent.map((item) => (
                <li key={item.tag}>
                  <button
                    type="button"
                    className="release-link"
                    onClick={() => void bridge.openExternal(item.notesUrl)}
                  >
                    <strong>v{item.version}</strong>
                    {item.publishedAt ? (
                      <span>{formatDate(item.publishedAt, locale)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="muted small update-trust">{t("updateTrustNote")}</p>
      </div>
    </section>
  );
}
