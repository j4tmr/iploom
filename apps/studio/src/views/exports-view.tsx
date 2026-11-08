import { displayText } from "../core/factory.ts";
import type { StudioWorkspace, UiLocale } from "../core/types.ts";
import { formatDate, formatNumber, type Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import { Icon } from "../components/icon.tsx";
import { Button, EmptyState } from "../components/ui.tsx";

export function ExportsView({
  workspace,
  locale,
  t,
  onNotify,
  onOpenWork,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onNotify: (message: string) => void;
  onOpenWork: (workId: string) => void;
}) {
  const reveal = async (path: string) => {
    try {
      await bridge.openFolder(path);
    } catch {
      // The desktop bridge rejects paths outside the workspace's reveal allowlist
      // (an export can be written anywhere). Report it instead of swallowing it.
      onNotify(t("openFolderFailed"));
    }
  };
  const records = [...workspace.exports].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <div className="view exports-view">
      <header className="page-heading">
        <span className="eyebrow">ARCREEL / SCREEN HANDOFF</span>
        <h1>{t("exportCenter")}</h1>
        <p>{t("exportLead")}</p>
      </header>
      <div className="export-format-banner">
        <span className="style-orb">3D</span>
        <div>
          <strong>{t("style3d")}</strong>
          <p>{t("draftNote")}</p>
        </div>
        <code>iploom.arcreel/v1</code>
      </div>
      {!records.length ? (
        <EmptyState
          icon="package"
          title={t("noExports")}
          action={
            workspace.works[0] ? (
              <Button
                variant="primary"
                icon="book"
                onClick={() => onOpenWork(workspace.works[0]!.id)}
              >
                {t("openNovel")}
              </Button>
            ) : undefined
          }
        >
          {t("noExportsLead")}
        </EmptyState>
      ) : (
        <div className="export-history">
          {records.map((record) => {
            const work = workspace.works.find(
              (item) => item.id === record.workId,
            );
            const universe = work
              ? workspace.universes.find((item) => item.id === work.universeId)
              : undefined;
            return (
              <article className="export-record" key={record.id}>
                <span className="export-record-icon">
                  <Icon name="package" size={22} />
                </span>
                <div className="export-record-main">
                  <span className="eyebrow">
                    {universe ? displayText(universe.name, locale) : "ARCREEL"}
                  </span>
                  <h3>{record.workTitle}</h3>
                  <p>
                    {record.chapterIds.length} {t("chapters")} ·{" "}
                    {record.fileCount} {t("files")} ·{" "}
                    {formatNumber(record.bytes, locale)} B
                  </p>
                  {record.outputPath ? <code>{record.outputPath}</code> : null}
                </div>
                <div className="export-record-meta">
                  <span>{formatDate(record.createdAt, locale)}</span>
                  <small title={record.manifestSha256}>
                    {record.manifestSha256.slice(0, 12)}…
                  </small>
                </div>
                <div className="export-record-actions">
                  {record.outputPath ? (
                    <Button
                      variant="ghost"
                      icon="folder"
                      onClick={() => void reveal(record.outputPath!)}
                    >
                      {t("openFolder")}
                    </Button>
                  ) : null}
                  {work ? (
                    <Button
                      variant="ghost"
                      icon="arrow"
                      onClick={() => onOpenWork(work.id)}
                    >
                      {t("openNovel")}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
