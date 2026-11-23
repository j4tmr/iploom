import { displayText } from "../core/factory.ts";
import type {
  FoundationCheckItem,
  FoundationCheckStatus,
  FoundationCheckTarget,
  FoundationHealthAxis,
  FoundationHealthMode,
  UniverseFoundationReport,
} from "../core/foundation-readiness.ts";
import { standardStatusLabel } from "../core/standards.ts";
import type {
  FoundationBypassRecord,
  FoundationCheckId,
  RuleStatus,
  RuleSystem,
  StudioWorkspace,
  UiLocale,
  WorkKind,
} from "../core/types.ts";
import { formatDate, type MessageKey, type Translate } from "../i18n.ts";
import { Icon } from "./icon.tsx";
import { Badge, Button, Modal, ProgressBar, SectionTitle } from "./ui.tsx";

const CHECK_LABEL_KEYS: Record<FoundationCheckId, MessageKey> = {
  summary: "foundationCheck_summary",
  activeRules: "foundationCheck_activeRules",
  cast: "foundationCheck_cast",
  locationsFactions: "foundationCheck_locationsFactions",
  items: "foundationCheck_items",
  canonStatus: "foundationCheck_canonStatus",
};

const CHECK_STATUS_TONE: Record<
  FoundationCheckStatus,
  "green" | "amber" | "neutral"
> = {
  done: "green",
  draft: "amber",
  missing: "neutral",
};

const CHECK_STATUS_KEY: Record<FoundationCheckStatus, MessageKey> = {
  done: "foundationCheckStatusDone",
  draft: "foundationCheckStatusDraft",
  missing: "foundationCheckStatusMissing",
};

const HEALTH_AXIS_KEYS: Record<FoundationHealthAxis, MessageKey> = {
  rules: "foundationHealthAxis_rules",
  abilities: "foundationHealthAxis_abilities",
  items: "foundationHealthAxis_items",
  nodes: "foundationHealthAxis_nodes",
};

const HEALTH_MODE_KEYS: Record<FoundationHealthMode, MessageKey> = {
  structured: "foundationHealthMode_structured",
  "prose-only": "foundationHealthMode_proseOnly",
  missing: "foundationHealthMode_missing",
};

const HEALTH_MODE_TONE: Record<
  FoundationHealthMode,
  "green" | "amber" | "neutral"
> = {
  structured: "green",
  "prose-only": "amber",
  missing: "neutral",
};

const RULE_STATUS_TONE: Record<RuleStatus, "green" | "amber" | "neutral"> = {
  active: "green",
  draft: "amber",
  disabled: "neutral",
};

export function foundationCheckLabel(
  id: FoundationCheckId,
  t: Translate,
): string {
  return t(CHECK_LABEL_KEYS[id]);
}

export function formatMissingItems(
  ids: readonly FoundationCheckId[],
  t: Translate,
): string {
  return ids.map((id) => foundationCheckLabel(id, t)).join(" · ");
}

export function foundationBadgeTone(
  report: Pick<UniverseFoundationReport, "complete" | "draftCount">,
): "green" | "amber" | "neutral" {
  if (report.complete) return "green";
  if (report.draftCount > 0) return "amber";
  return "neutral";
}

export function foundationBadgeLabel(
  report: Pick<UniverseFoundationReport, "complete" | "draftCount">,
  t: Translate,
): string {
  if (report.complete) return t("foundationChecklistReady");
  if (report.draftCount > 0) return t("foundationChecklistDrafts");
  return t("foundationChecklistIncomplete");
}

function checkItemDetail(item: FoundationCheckItem, t: Translate): string {
  switch (item.id) {
    case "summary":
      return item.status === "done"
        ? t("foundationDetailSummaryDone")
        : t("foundationDetailSummaryMissing");
    case "activeRules":
      if (item.status === "done") {
        return t("foundationDetailRulesActive", {
          active: item.counts.active ?? 0,
          draft: item.counts.draft ?? 0,
        });
      }
      if (item.status === "draft") {
        return t("foundationDetailRulesDraft", {
          draft: item.counts.draft ?? 0,
        });
      }
      return t("foundationDetailRulesMissing");
    case "cast":
      return t("foundationDetailCast", { count: item.counts.characters ?? 0 });
    case "locationsFactions":
      return t("foundationDetailAtlas", {
        locations: item.counts.locations ?? 0,
        factions: item.counts.factions ?? 0,
      });
    case "items":
      if (item.status === "draft") {
        return t("foundationDetailItemsDraft", {
          templates: item.counts.itemTemplates ?? 0,
        });
      }
      return t("foundationDetailItems", {
        objects: item.counts.storyObjects ?? 0,
        templates: item.counts.itemTemplates ?? 0,
      });
    case "canonStatus":
      if (item.status === "done") {
        return t("foundationDetailCanonDone", {
          canon: item.counts.canon ?? 0,
          proposed: item.counts.proposedEvents ?? 0,
        });
      }
      if (item.status === "draft") {
        return t("foundationDetailCanonDraft", {
          drafts: item.counts.draftFoundation ?? 0,
          proposed: item.counts.proposedEvents ?? 0,
        });
      }
      return t("foundationDetailCanonMissing");
  }
}

/**
 * Interactive foundation completeness checklist shown on the world overview
 * and foundation tabs. Every item jumps directly to the surface where the
 * author can complete or activate it.
 */
export function FoundationChecklistCard({
  report,
  t,
  onSelectTarget,
  compact = false,
}: {
  report: UniverseFoundationReport;
  t: Translate;
  onSelectTarget?: (target: FoundationCheckTarget) => void;
  compact?: boolean;
}) {
  return (
    <section
      className={`foundation-checklist-card ${compact ? "compact" : ""}`}
      data-testid="foundation-checklist"
    >
      <div className="foundation-checklist-head">
        <div>
          <span className="eyebrow">FOUNDATION CHECK / 基础检查</span>
          <h2>{t("foundationChecklistTitle")}</h2>
        </div>
        <div className="foundation-checklist-meta">
          <Badge tone={foundationBadgeTone(report)} dot>
            {foundationBadgeLabel(report, t)}
          </Badge>
          <span className="foundation-checklist-count">
            {t("foundationChecklistProgress", {
              done: report.completedCount,
              total: report.totalCount,
            })}
          </span>
        </div>
      </div>
      <ProgressBar
        value={report.completedCount}
        max={report.totalCount}
        color={report.complete ? "var(--accent)" : undefined}
      />
      <ul className="foundation-checklist-grid">
        {report.items.map((item) => {
          const content = (
            <>
              <span className={`foundation-check-dot ${item.status}`}>
                <Icon
                  name={item.status === "done" ? "check" : "layers"}
                  size={13}
                />
              </span>
              <span className="foundation-check-copy">
                <strong>{foundationCheckLabel(item.id, t)}</strong>
                <small>{checkItemDetail(item, t)}</small>
              </span>
              <Badge tone={CHECK_STATUS_TONE[item.status]}>
                {t(CHECK_STATUS_KEY[item.status])}
              </Badge>
            </>
          );
          return (
            <li key={item.id}>
              {onSelectTarget ? (
                <button
                  type="button"
                  className={`foundation-check-row ${item.status}`}
                  onClick={() => onSelectTarget(item.target)}
                >
                  {content}
                </button>
              ) : (
                <div className={`foundation-check-row ${item.status}`}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Prose-only vs structured health overview plus review/activation controls for
 * the world's structured rule systems (seeded as drafts by genre templates or
 * created via skills).
 */
export function FoundationHealthPanel({
  workspace,
  universeId,
  report,
  locale,
  t,
  onRuleSystemStatusChange,
  onDeleteRuleSystem,
}: {
  workspace: StudioWorkspace;
  universeId: string;
  report: UniverseFoundationReport;
  locale: UiLocale;
  t: Translate;
  onRuleSystemStatusChange?: (system: RuleSystem, status: RuleStatus) => void;
  onDeleteRuleSystem?: (system: RuleSystem) => void;
}) {
  const systems = workspace.ruleSystems.filter(
    (system) => system.universeId === universeId,
  );
  return (
    <section
      className="foundation-health-panel"
      data-testid="foundation-health"
    >
      <SectionTitle
        eyebrow="HEALTH / 结构健康"
        title={t("foundationHealthTitle")}
      />
      <p className="foundation-health-lead">{t("foundationHealthLead")}</p>
      <div className="foundation-health-grid">
        {report.health.map((entry) => (
          <article className="foundation-health-item" key={entry.axis}>
            <div className="foundation-health-item-head">
              <strong>{t(HEALTH_AXIS_KEYS[entry.axis])}</strong>
              <Badge tone={HEALTH_MODE_TONE[entry.mode]}>
                {t(HEALTH_MODE_KEYS[entry.mode])}
              </Badge>
            </div>
            <small>
              {t("foundationHealthCounts", {
                structured: entry.structuredCount,
                prose: entry.proseCount,
              })}
            </small>
          </article>
        ))}
      </div>

      <div className="foundation-rule-systems">
        <span className="eyebrow">{t("foundationRuleSystemsTitle")}</span>
        {systems.length ? (
          <div className="foundation-rule-system-list">
            {systems.map((system) => {
              const abilities = workspace.abilityTemplates.filter(
                (ability) => ability.ruleSystemId === system.id,
              );
              const items = workspace.itemStatTemplates.filter(
                (item) => item.ruleSystemId === system.id,
              );
              return (
                <article
                  className="foundation-rule-system-card"
                  key={system.id}
                  data-testid={`rule-system-${system.id}`}
                >
                  <div className="foundation-rule-system-head">
                    <div>
                      <strong>{displayText(system.title, locale)}</strong>
                      <small>
                        {t("foundationRuleSystemMeta", {
                          tiers: system.tiers.length,
                          attributes: system.attributes.length,
                          abilities: abilities.length,
                          items: items.length,
                        })}
                      </small>
                    </div>
                    <Badge tone={RULE_STATUS_TONE[system.status]} dot>
                      {standardStatusLabel(system.status, locale)}
                    </Badge>
                  </div>
                  {system.summary ? (
                    <p className="foundation-rule-system-summary">
                      {system.summary}
                    </p>
                  ) : null}
                  {onRuleSystemStatusChange || onDeleteRuleSystem ? (
                    <div className="foundation-rule-system-actions">
                      {onRuleSystemStatusChange ? (
                        system.status === "active" ? (
                          <Button
                            variant="ghost"
                            icon="close"
                            onClick={() =>
                              onRuleSystemStatusChange(system, "disabled")
                            }
                          >
                            {t("foundationDisable")}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            icon="check"
                            onClick={() =>
                              onRuleSystemStatusChange(system, "active")
                            }
                          >
                            {t("foundationActivate")}
                          </Button>
                        )
                      ) : null}
                      {onDeleteRuleSystem ? (
                        <Button
                          variant="danger"
                          icon="trash"
                          onClick={() => onDeleteRuleSystem(system)}
                        >
                          {t("delete")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="foundation-rule-systems-empty">
            {t("foundationRuleSystemsEmpty")}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Non-blocking warning banner used inside work/chapter creation modals and
 * inside WorkView to keep an unfinished or bypassed foundation visible.
 */
export function FoundationWarningBanner({
  report,
  bypass,
  locale,
  t,
  onOpenFoundation,
  mode = "create",
}: {
  report?: UniverseFoundationReport;
  bypass?: FoundationBypassRecord;
  locale: UiLocale;
  t: Translate;
  onOpenFoundation?: () => void;
  mode?: "create" | "work";
}) {
  const showIncomplete = Boolean(report && !report.complete);
  if (!showIncomplete && !bypass) return null;
  return (
    <div
      className="foundation-warning-banner"
      role="status"
      data-testid="foundation-warning-banner"
    >
      <div className="foundation-warning-copy">
        {showIncomplete && report ? (
          <p>
            {t(
              mode === "create"
                ? "foundationWarningIncomplete"
                : "foundationLiveReminder",
              {
                done: report.completedCount,
                total: report.totalCount,
                missing: formatMissingItems(report.incompleteIds, t),
              },
            )}
          </p>
        ) : null}
        {bypass ? (
          <small>
            {t("foundationBypassRecordedWork", {
              missing: formatMissingItems(bypass.missingItems, t),
              at: formatDate(bypass.at, locale),
            })}
          </small>
        ) : null}
      </div>
      {onOpenFoundation ? (
        <Button variant="ghost" icon="layers" onClick={onOpenFoundation}>
          {t("foundationWarningReviewAction")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Non-blocking writing gate opened when quick-building a novel or game in a
 * world whose foundation checklist is incomplete. The author can jump straight
 * to finishing the foundation or proceed deliberately with the state recorded.
 */
export function FoundationGateModal({
  open,
  kind,
  report,
  t,
  onClose,
  onFinishFoundation,
  onProceedAnyway,
}: {
  open: boolean;
  kind: WorkKind;
  report: UniverseFoundationReport;
  t: Translate;
  onClose: () => void;
  onFinishFoundation: () => void;
  onProceedAnyway: () => void;
}) {
  const unfinished = report.items.filter((item) => item.status !== "done");
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t("close")}
      title={t("foundationGateTitle")}
      description={t("foundationGateLead", {
        done: report.completedCount,
        total: report.totalCount,
      })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="secondary"
            icon="layers"
            onClick={onFinishFoundation}
          >
            {t("foundationGateFinishFirst")}
          </Button>
          <Button
            variant="primary"
            icon="arrow"
            data-testid="foundation-gate-proceed"
            onClick={onProceedAnyway}
          >
            {kind === "game"
              ? t("foundationGateProceedGame")
              : t("foundationGateProceedNovel")}
          </Button>
        </>
      }
    >
      <ul className="foundation-gate-list">
        {unfinished.map((item) => (
          <li key={item.id} className="foundation-gate-row">
            <div>
              <strong>{foundationCheckLabel(item.id, t)}</strong>
              <small>{checkItemDetail(item, t)}</small>
            </div>
            <Badge tone={CHECK_STATUS_TONE[item.status]}>
              {t(CHECK_STATUS_KEY[item.status])}
            </Badge>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
