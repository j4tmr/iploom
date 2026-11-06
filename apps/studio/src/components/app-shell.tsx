import { displayText, workWords } from "../core/factory.ts";
import type {
  StudioWorkspace,
  ThemeMode,
  UiLocale,
} from "../core/types.ts";
import { formatNumber, type Translate } from "../i18n.ts";
import type { SaveState } from "../use-studio-workspace.ts";
import type { StudioRoute } from "../routes.ts";
import { Icon, type IconName } from "./icon.tsx";
import { IconButton } from "./ui.tsx";

type NavItem = {
  route: StudioRoute["name"];
  label: string;
  icon: IconName;
};

export function Sidebar({
  workspace,
  route,
  locale,
  t,
  onNavigate,
}: {
  workspace: StudioWorkspace;
  route: StudioRoute;
  locale: UiLocale;
  t: Translate;
  onNavigate: (route: StudioRoute) => void;
}) {
  const nav: NavItem[] = [
    { route: "dashboard", label: t("dashboard"), icon: "grid" },
    { route: "library", label: t("library"), icon: "book" },
    { route: "cast", label: t("cast"), icon: "users" },
    { route: "graph", label: t("relationships"), icon: "graph" },
    { route: "timeline", label: t("timeline"), icon: "timeline" },
    { route: "workflow", label: t("workflow"), icon: "sparkles" },
    { route: "exports", label: t("exports"), icon: "package" },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">界</span>
        <span>
          <strong>IPloom</strong>
          <small>STUDIO</small>
        </span>
      </div>
      <button className="workspace-switcher" title={workspace.name}>
        <span className="workspace-avatar"><Icon name="layers" size={16} /></span>
        <span>
          <small>{t("workspace")}</small>
          <strong>{workspace.name}</strong>
        </span>
        <Icon name="chevron" size={14} />
      </button>
      <nav className="sidebar-nav" aria-label={t("workspace")}>
        {nav.map((item) => (
          <button
            key={item.route}
            data-route={item.route}
            className={route.name === item.route ? "active" : ""}
            onClick={() => onNavigate({ name: item.route } as StudioRoute)}
          >
            <Icon name={item.icon} size={18} />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-label">
        <span>{t("universes")}</span>
        <span>{workspace.universes.length}</span>
      </div>
      <div className="sidebar-worlds">
        {workspace.universes.map((universe) => {
          const count = workspace.works.filter(
            (work) => work.universeId === universe.id,
          ).length;
          return (
            <button
              key={universe.id}
              className={route.name === "universe" && route.id === universe.id ? "active" : ""}
              onClick={() => onNavigate({ name: "universe", id: universe.id })}
            >
              <span style={{ background: universe.accent }}>
                {displayText(universe.name, locale).slice(0, 1)}
              </span>
              <span>
                <strong>{displayText(universe.name, locale)}</strong>
                <small>{count} {t("novels")}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="sidebar-spacer" />
      <button
        className="sidebar-novel-count"
        onClick={() => onNavigate({ name: "library" })}
      >
        <span className="eyebrow">LIBRARY / 书架</span>
        <strong>{workspace.works.length}</strong>
        <small>{t("novels")} · {formatNumber(workspace.works.reduce((sum, work) => sum + workWords(work), 0), locale)} {t("words")}</small>
      </button>
      <button
        className={`sidebar-settings ${route.name === "settings" ? "active" : ""}`}
        onClick={() => onNavigate({ name: "settings" })}
      >
        <Icon name="settings" size={18} />
        {t("settings")}
      </button>
      <div className="sidebar-local">
        <span />
        {t("local")}
      </div>
    </aside>
  );
}

export function Topbar({
  eyebrow,
  title,
  locale,
  theme,
  t,
  saveState,
  onSearch,
  onSetLocale,
  onToggleTheme,
  onMcp,
}: {
  eyebrow: string;
  title: string;
  locale: UiLocale;
  theme: ThemeMode;
  t: Translate;
  saveState: SaveState;
  onSearch: () => void;
  onSetLocale: (locale: UiLocale) => void;
  onToggleTheme: () => void;
  onMcp: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="topbar-actions">
        <button className="search-trigger" onClick={onSearch}>
          <Icon name="search" size={17} />
          <span>{t("searchShort")}</span>
          <kbd>{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <div className={`save-indicator ${saveState}`}>
          <span />
          {saveState === "saving"
            ? t("saving")
            : saveState === "error"
              ? t("errorTitle")
              : t("saved")}
        </div>
        <div className="topbar-divider" />
        <IconButton
          label={t("switchLanguage")}
          icon="globe"
          onClick={() => onSetLocale(locale === "zh-CN" ? "en" : "zh-CN")}
          className="locale-button"
        />
        <span className="locale-code">{locale === "zh-CN" ? "中" : "EN"}</span>
        <IconButton
          label={t("switchTheme")}
          icon={theme === "dark" ? "sun" : "moon"}
          onClick={onToggleTheme}
        />
        <button className="mcp-button" onClick={onMcp}>
          <Icon name="terminal" size={16} />
          MCP
          <span className="online-dot" />
        </button>
      </div>
    </header>
  );
}
