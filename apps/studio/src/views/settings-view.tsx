import { useEffect, useState } from "react";
import type { AiConfigInfo } from "../core/ai.ts";
import type {
  StudioWorkspace,
  ThemeMode,
  UiLocale,
  WorkspaceSettings,
} from "../core/types.ts";
import { APP_VERSION } from "../core/version.ts";
import type { Translate } from "../i18n.ts";
import { bridge, type AppInfo } from "../platform.ts";
import { Icon } from "../components/icon.tsx";
import { AiSettings } from "../components/ai-settings.tsx";
import { UpdateSettings } from "../components/update-settings.tsx";
import {
  Button,
  Field,
  FieldGrid,
  SectionTitle,
  Select,
  Toast,
} from "../components/ui.tsx";

const mcpTools = [
  "list_story_worlds",
  "get_story_world",
  "list_novels",
  "get_novel",
  "get_chapter",
  "search_ip",
  "get_relationship_graph",
  "list_workflow_tasks",
  "get_workflow_brief",
  "list_standards",
  "get_standard",
  "create_standard",
  "update_standard",
  "export_arcreel_bundle",
];

export function SettingsView({
  workspace,
  locale,
  t,
  path,
  aiInfo,
  onAiConfigured,
  onUpdateSettings,
  onResetDemo,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  path: string;
  aiInfo: AiConfigInfo | null;
  onAiConfigured: (info: AiConfigInfo) => void;
  onUpdateSettings: (change: Partial<WorkspaceSettings>) => void;
  onResetDemo: () => Promise<void>;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bridge.appInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  const config = info
    ? JSON.stringify(info.mcp, null, 2)
    : JSON.stringify(
        {
          mcpServers: {
            "iploom-studio": {
              command: "iploom-mcp",
              args: ["--workspace", path],
            },
          },
        },
        null,
        2,
      );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  };

  return (
    <div className="view settings-view">
      <header className="page-heading">
        <span className="eyebrow">PREFERENCES / 工作区</span>
        <h1>{t("settingsTitle")}</h1>
        <p>{t("settingsLead")}</p>
      </header>
      <div className="settings-layout">
        <AiSettings locale={locale} t={t} info={aiInfo} onConfigured={onAiConfigured} />
        <section className="settings-panel">
          <SectionTitle title={t("interfaceLanguage")} />
          <div className="segmented large">
            <button
              className={workspace.settings.locale === "zh-CN" ? "active" : ""}
              onClick={() => onUpdateSettings({ locale: "zh-CN" })}
            >
              中文
            </button>
            <button
              className={workspace.settings.locale === "en" ? "active" : ""}
              onClick={() => onUpdateSettings({ locale: "en" })}
            >
              English
            </button>
          </div>

          <SectionTitle title={t("theme")} />
          <div className="theme-options">
            {([
              ["system", t("themeSystem"), "grid"],
              ["light", t("themeLight"), "sun"],
              ["dark", t("themeDark"), "moon"],
            ] as const).map(([value, label, icon]) => (
              <button
                key={value}
                className={`theme-option ${workspace.settings.theme === value ? "active" : ""}`}
                onClick={() => onUpdateSettings({ theme: value as ThemeMode })}
              >
                <span className={`theme-preview theme-preview-${value}`}>
                  <i /><i /><i />
                </span>
                <span><Icon name={icon} size={15} />{label}</span>
              </button>
            ))}
          </div>

          <FieldGrid>
            <Field label={t("aspectRatio")}>
              <Select
                value={workspace.settings.defaultAspectRatio}
                onChange={(event) =>
                  onUpdateSettings({
                    defaultAspectRatio: event.target.value as WorkspaceSettings["defaultAspectRatio"],
                  })
                }
              >
                <option value="9:16">9:16 · Vertical</option>
                <option value="16:9">16:9 · Landscape</option>
                <option value="1:1">1:1 · Square</option>
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
            <span className="mcp-orb"><Icon name="terminal" size={22} /></span>
            <div>
              <span className="eyebrow">MODEL CONTEXT PROTOCOL</span>
              <h2>{t("mcpTitle")}</h2>
            </div>
          </div>
          <p>{t("mcpLead")}</p>
          <div className="tool-pills">
            {mcpTools.map((tool) => <code key={tool}>{tool}</code>)}
          </div>
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
          <p className="muted small">{t("mcpToolsNote")}</p>
        </section>

        <section className="settings-panel">
          <SectionTitle title={t("dataLocation")} />
          <div className="data-path">
            <Icon name="folder" size={19} />
            <code>{path || info?.workspacePath || "—"}</code>
            <Button variant="ghost" icon="external" onClick={() => void bridge.openFolder(path)}>
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
                  notify(t("saved"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("resetDemo")}
            </Button>
          </div>
        </section>

        <section className="settings-panel about-card">
          <div className="about-mark">界</div>
          <div>
            <h2>IPloom Studio</h2>
            <p>{t("aboutBody")}</p>
            <div className="about-meta">
              <span>{t("appVersion")} <b>{info?.version ?? APP_VERSION}</b></span>
              <span>{t("platform")} <b>{info?.platform ?? navigator.platform}</b></span>
              <span>{workspace.settings.locale}</span>
            </div>
            <Button
              icon="external"
              onClick={() => void bridge.openExternal("https://github.com/j4tmr/iploom")}
            >
              {t("projectHome")}
            </Button>
          </div>
        </section>

        <UpdateSettings locale={locale} t={t} />
      </div>
      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}
