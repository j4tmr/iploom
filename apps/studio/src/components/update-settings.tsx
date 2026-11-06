import { useState } from "react";
import type { UiLocale } from "../core/types.ts";
import type { UpdateCheckResult } from "../core/updates.ts";
import { RELEASES_PAGE_URL } from "../core/updates.ts";
import { formatDate, type Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import { Button, SectionTitle } from "./ui.tsx";

function failureText(result: UpdateCheckResult, t: Translate): string {
  switch (result.reason) {
    case "timeout":
      return t("updateReasonTimeout");
    case "network":
      return t("updateReasonNetwork");
    case "http":
      return t("updateReasonHttp", { status: result.httpStatus ?? "?" });
    case "version":
      return t("updateReasonVersion");
    case "desktop-only":
      return t("updateReasonDesktopOnly");
    default:
      return "";
  }
}

export function UpdateSettings({ locale, t }: { locale: UiLocale; t: Translate }) {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const check = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await bridge.checkForUpdates());
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return <section className="settings-panel update-panel">
    <SectionTitle title={t("updateTitle")} />
    <p>{t("updateIdle")}</p>
    <div className="update-actions">
      <Button variant="primary" icon="download" disabled={busy} onClick={() => void check()}>
        {busy ? t("checkingUpdates") : t("checkUpdates")}
      </Button>
      <Button variant="ghost" icon="external" onClick={() => void bridge.openExternal(RELEASES_PAGE_URL)}>
        {t("openReleases")}
      </Button>
    </div>
    {result ? <div className="update-status" data-status={result.status}>
      {result.status === "update-available" && result.latest ? <>
        <strong>{t("updateAvailable", { version: result.latest.version })}</strong>
        <div className="update-actions">
          <Button variant="ghost" icon="external" onClick={() => void bridge.openExternal(result.latest!.notesUrl)}>
            {t("releaseNotes")}
          </Button>
          {result.download ? <Button icon="download" onClick={() => void bridge.openExternal(result.download!.url)}>
            {t("downloadForPlatform")}
          </Button> : null}
        </div>
        {result.download
          ? <code className="update-asset">{result.download.name}</code>
          : <p className="muted small">{t("downloadNotAvailable")}</p>}
      </> : null}
      {result.status === "up-to-date"
        ? <strong>{result.latest
            ? t("updateCurrent", { version: result.currentVersion })
            : t("updateNoRelease")}</strong>
        : null}
      {result.status === "unavailable" ? <>
        <strong>{t("updateUnavailable")}</strong>
        <p className="muted small">{failureText(result, t)}</p>
      </> : null}
      <p className="muted small">{t("checkedAt", { time: formatDate(result.checkedAt, locale) })}</p>
    </div> : null}
    {error ? <p role="alert" className="muted small">{t("updateUnavailable")} {error}</p> : null}
    {result && result.recent.length > 0 ? <div className="release-block">
      <span className="field-label">{t("recentReleases")}</span>
      <ul className="release-list">
        {result.recent.map((item) => <li key={item.tag}>
          <button className="release-link" onClick={() => void bridge.openExternal(item.notesUrl)}>
            <strong>v{item.version}</strong>
            <span>{formatDate(item.publishedAt, locale)}</span>
          </button>
        </li>)}
      </ul>
    </div> : null}
    <p className="muted small">{t("updateTrustNote")}</p>
  </section>;
}
