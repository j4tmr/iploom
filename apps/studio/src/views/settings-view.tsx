import { useCallback, useEffect, useState } from "react";
import type { AiConfigInfo } from "../core/ai.ts";
import { MCP_TOOL_NAMES, mcpToolsNote } from "../core/mcp-tools.ts";
import type {
  StudioWorkspace,
  ThemeMode,
  UiLocale,
  WorkspaceSettings,
} from "../core/types.ts";
import { APP_VERSION } from "../core/version.ts";
import type { Translate } from "../i18n.ts";
import {
  bridge,
  type AppInfo,
  type WorkspaceSnapshotInfo,
} from "../platform.ts";
import { Icon } from "../components/icon.tsx";
import { AiSettings } from "../components/ai-settings.tsx";
import { UpdateSettings } from "../components/update-settings.tsx";
import { useToast } from "../components/use-toast.ts";
import {
  Button,
  Field,
  FieldGrid,
  SectionTitle,
  Select,
  Toast,
} from "../components/ui.tsx";

export function SettingsView({
  workspace,
  locale,
  t,
  path,
  aiInfo,
  onAiConfigured,
  onUpdateSettings,
  onResetDemo,
  onRestoreSnapshot,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  path: string;
  aiInfo: AiConfigInfo | null;
  onAiConfigured: (info: AiConfigInfo) => void;
  onUpdateSettings: (change: Partial<WorkspaceSettings>) => void;
  onResetDemo: () => Promise<void>;
  onRestoreSnapshot: (snapshotPath: string) => Promise<void>;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const { toast, notify } = useToast(2400);
  const [busy, setBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshotInfo[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  useEffect(() => {
    bridge
      .appInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const refreshSnapshots = useCallback(async () => {
    try {
      setSnapshots(await bridge.listSnapshots());
    } catch {
      setSnapshots([]);
    }
  }, []);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots]);

  const snapshotReason = (reason: string) =>
    reason === "before-reset-demo"
      ? t("snapshotReasonResetDemo")
      : reason === "before-delete-world"
        ? t("snapshotReasonDeleteWorld")
        : reason === "before-delete-novel"
          ? t("snapshotReasonDeleteNovel")
          : reason === "before-delete-chapter"
            ? t("snapshotReasonDeleteChapter")
            : reason === "before-import-novel"
              ? t("snapshotReasonImport")
              : reason === "before-restore"
                ? t("snapshotReasonRestore")
                : reason;

  const restoreSnapshot = async (snapshot: WorkspaceSnapshotInfo) => {
    if (!window.confirm(t("snapshotRestoreConfirm"))) return;
    setSnapshotBusy(true);
    try {
      await onRestoreSnapshot(snapshot.path);
      notify(t("snapshotRestored"));
      await refreshSnapshots();
    } catch (reason) {
      notify(
        reason instanceof Error ? reason.message : String(reason),
        "error",
      );
    } finally {
      setSnapshotBusy(false);
    }
  };

  const config = info?.mcp ? JSON.stringify(info.mcp, null, 2) : "";

  return (
    <div className="view settings-view">
      <header className="page-heading">
        <span className="eyebrow">PREFERENCES / 工作区</span>
        <h1>{t("settingsTitle")}</h1>
        <p>{t("settingsLead")}</p>
      </header>
      <div className="settings-layout">
        <AiSettings t={t} info={aiInfo} onConfigured={onAiConfigured} />
        <section className="settings-panel">
          <SectionTitle title={t("interfaceLanguage")} />
          <div className="segmented large">
            <button
              type="button"
              className={workspace.settings.locale === "zh-CN" ? "active" : ""}
              onClick={() => onUpdateSettings({ locale: "zh-CN" })}
            >
              中文
            </button>
            <button
              type="button"
              className={workspace.settings.locale === "en" ? "active" : ""}
              onClick={() => onUpdateSettings({ locale: "en" })}
            >
              English
            </button>
          </div>

          <SectionTitle title={t("theme")} />
          <div className="theme-options">
            {(
              [
                ["system", t("themeSystem"), "grid"],
                ["light", t("themeLight"), "sun"],
                ["dark", t("themeDark"), "moon"],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                type="button"
                key={value}
                className={`theme-option ${workspace.settings.theme === value ? "active" : ""}`}
                onClick={() => onUpdateSettings({ theme: value as ThemeMode })}
              >
                <span className={`theme-preview theme-preview-${value}`}>
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <Icon name={icon} size={15} />
                  {label}
                </span>
              </button>
            ))}
          </div>

          <FieldGrid>
            <Field label={t("aspectRatio")}>
              <Select
                value={workspace.settings.defaultAspectRatio}
                onChange={(event) =>
                  onUpdateSettings({
                    defaultAspectRatio: event.target
                      .value as WorkspaceSettings["defaultAspectRatio"],
                  })
                }
              >
                <option value="9:16">{t("aspectRatioVertical")}</option>
                <option value="16:9">{t("aspectRatioLandscape")}</option>
                <option value="1:1">{t("aspectRatioSquare")}</option>
              </Select>
            </Field>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={workspace.settings.exportApprovedOnly}
                onChange={(event) =>
                  onUpdateSettings({ exportApprovedOnly: event.target.checked })
                }
              />
              <span>
                <strong>{t("approvedOnly")}</strong>
                <small>{t("draftNote")}</small>
              </span>
            </label>
          </FieldGrid>
        </section>

        <section className="settings-panel mcp-settings-card">
          <div className="mcp-header">
            <span className="mcp-orb">
              <Icon name="terminal" size={22} />
            </span>
            <div>
              <span className="eyebrow">MODEL CONTEXT PROTOCOL</span>
              <h2>{t("mcpTitle")}</h2>
            </div>
          </div>
          <p>{t("mcpLead")}</p>
          <div className="tool-pills">
            {MCP_TOOL_NAMES.map((tool) => (
              <code key={tool}>{tool}</code>
            ))}
          </div>
          {info && !info.desktop ? (
            <p className="muted small">{t("browserPreview")}</p>
          ) : info?.desktop && !info.mcp ? (
            <div className="mcp-missing">
              <h3>{t("mcpMissingTitle")}</h3>
              <p>{t("mcpMissingLead")}</p>
              {info.mcpError ? (
                <p className="muted small">{info.mcpError}</p>
              ) : null}
            </div>
          ) : config ? (
            <div className="code-block">
              <div className="code-block-head">
                <span>{t("mcpConfig")}</span>
                <Button
                  variant="ghost"
                  icon="copy"
                  onClick={async () => {
                    await bridge.copyText(config);
                    notify(t("copied"));
                  }}
                >
                  {t("copyConfig")}
                </Button>
              </div>
              <pre>{config}</pre>
            </div>
          ) : null}
          <p className="muted small">{mcpToolsNote(locale)}</p>
        </section>

        <section className="settings-panel">
          <SectionTitle title={t("dataLocation")} />
          <div className="data-path">
            <Icon name="folder" size={19} />
            <code>{path || info?.workspacePath || "—"}</code>
            <Button
              variant="ghost"
              icon="external"
              onClick={() => void bridge.openFolder(path)}
            >
              {t("openFolder")}
            </Button>
          </div>
          <p className="muted small">{t("dataLocationNote")}</p>
          <div className="danger-row">
            <div>
              <strong>{t("resetDemo")}</strong>
              <p>{t("resetDemoNote")}</p>
            </div>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(t("resetDemoConfirm"))) return;
                setBusy(true);
                try {
                  await onResetDemo();
                  await refreshSnapshots();
                } catch (reason) {
                  notify(
                    reason instanceof Error ? reason.message : String(reason),
                    "error",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("resetDemo")}
            </Button>
          </div>
        </section>

        {info?.desktop ? (
          <section className="settings-panel">
            <SectionTitle title={t("snapshotsTitle")} />
            <p className="muted small">{t("snapshotsNote")}</p>
            {snapshots.length === 0 ? (
              <p className="muted small">{t("snapshotsEmpty")}</p>
            ) : (
              <ul className="snapshot-list">
                {snapshots.map((snapshot) => (
                  <li key={snapshot.path}>
                    <div>
                      <strong>{snapshotReason(snapshot.reason)}</strong>
                      <small>
                        {new Date(snapshot.createdAt).toLocaleString(locale)}
                        {" · "}
                        {Math.max(1, Math.round(snapshot.bytes / 1024))} KB
                      </small>
                    </div>
                    <Button
                      variant="ghost"
                      disabled={snapshotBusy}
                      onClick={() => void restoreSnapshot(snapshot)}
                    >
                      {t("snapshotRestore")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="data-path">
              <Icon name="folder" size={19} />
              <code>{info.snapshotDirectory}</code>
              <Button
                variant="ghost"
                icon="external"
                onClick={() => void bridge.openFolder(info.snapshotDirectory)}
              >
                {t("openFolder")}
              </Button>
            </div>
          </section>
        ) : null}

        <section className="settings-panel about-card">
          <div className="about-mark">界</div>
          <div>
            <h2>IPloom Studio</h2>
            <p>{t("aboutBody")}</p>
            <div className="about-meta">
              <span>
                {t("appVersion")} <b>{info?.version ?? APP_VERSION}</b>
              </span>
              <span>
                {t("platform")} <b>{info?.platform ?? navigator.platform}</b>
              </span>
              <span>{workspace.settings.locale}</span>
            </div>
            <Button
              icon="external"
              onClick={() =>
                void bridge.openExternal("https://github.com/j4tmr/iploom")
              }
            >
              {t("projectHome")}
            </Button>
          </div>
        </section>

        <UpdateSettings locale={locale} t={t} />
      </div>
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}
