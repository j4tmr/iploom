import { useEffect, useRef, useState } from "react";
import { bridge } from "../platform.ts";
import type { AiConfigInfo, AiUsage } from "../core/ai.ts";
import { createId, displayText } from "../core/factory.ts";
import { sha256Text } from "../core/hash.ts";
import {
  buildProductionPrompt,
  createProductionTasks,
  effectiveProductionTemplate,
  productionTemplates,
  resolveProductionScope,
  taskProductionPrompt,
  type ProductionScope,
  type ProductionTemplate,
} from "../core/production.ts";
import { standardRefsFor } from "../core/standards.ts";
import {
  MAX_AI_PROMPT_LENGTH,
  MAX_WORKFLOW_RESULT_LENGTH,
} from "../core/types.ts";
import type {
  StudioWorkspace,
  UiLocale,
  WorkflowTask,
  WorkflowTaskRunMeta,
} from "../core/types.ts";
import { workflowResultReplaceConfirm } from "../core/workflow.ts";
import {
  formatNumber,
  productionTemplateLabels,
  type Translate,
} from "../i18n.ts";
import { Button, Field, Select, TextArea } from "./ui.tsx";
import { statusText } from "../views/workflow-view.tsx";

export function ProductionPanel({
  workspace,
  locale,
  t,
  aiInfo,
  onOpenSettings,
  context,
  onTasks,
  onStatus,
  onResult,
}: {
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  aiInfo: AiConfigInfo | null;
  onOpenSettings: () => void;
  context: ProductionScope;
  onTasks: (tasks: WorkflowTask[]) => boolean;
  onStatus: (task: WorkflowTask, status: WorkflowTask["status"]) => void;
  onResult: (
    task: WorkflowTask,
    text: string,
    run?: WorkflowTaskRunMeta,
  ) => boolean;
}) {
  const [scope, setScope] = useState<ProductionScope>(context);
  const [template, setTemplate] = useState<ProductionTemplate>("world");
  const [taskId, setTaskId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [usage, setUsage] = useState<AiUsage>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const activeId = useRef("");
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const latestContext = useRef(context);
  latestContext.current = context;
  const appliedContext = useRef(context);
  const [completedTask, setCompletedTask] = useState<WorkflowTask | null>(null);
  const work = workspace.works.find((item) => item.id === scope.workId);
  const universeId = work?.universeId ?? scope.universeId;
  const task = workspace.workflowTasks.find((item) => item.id === taskId);
  const blocked = Boolean(
    task?.dependsOnIds.some(
      (id) =>
        workspace.workflowTasks.find((item) => item.id === id)?.status !==
        "done",
    ),
  );
  const applyContext = (next: ProductionScope) => {
    appliedContext.current = next;
    setScope(next);
    setPrompt("");
    setTaskId("");
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope fields are the actual trigger; `context` is rebuilt every render and depending on its identity would reset the prompt in a loop
  useEffect(() => {
    if (!activeId.current) applyContext(context);
  }, [
    context.universeId,
    context.workId,
    context.chapterId,
    context.characterId,
  ]);
  useEffect(
    () =>
      bridge.onAiProgress((progress) => {
        if (progress.id === activeId.current) setOutput(progress.text);
      }),
    [],
  );
  useEffect(
    () => () => {
      if (activeId.current) void bridge.cancelAi(activeId.current);
    },
    [],
  );
  const reset = () => {
    setPrompt("");
    setMessage("");
    setUsage(undefined);
  };
  const compose = () => {
    setPrompt(
      task
        ? taskProductionPrompt(workspace, task, locale)
        : buildProductionPrompt(workspace, template, scope, locale),
    );
    setMessage("");
  };
  const usageInput = usage?.prompt_tokens ?? usage?.input_tokens;
  const usageOutput = usage?.completion_tokens ?? usage?.output_tokens;
  const usageTotal =
    usage?.total_tokens ??
    (typeof usageInput === "number" && typeof usageOutput === "number"
      ? usageInput + usageOutput
      : undefined);
  const usageValues = {
    input:
      typeof usageInput === "number" ? formatNumber(usageInput, locale) : "—",
    output:
      typeof usageOutput === "number" ? formatNumber(usageOutput, locale) : "—",
  };
  const usageMessage = usage
    ? typeof usageTotal === "number"
      ? t("productionUsageTotal", {
          ...usageValues,
          total: formatNumber(usageTotal, locale),
        })
      : t("productionUsage", usageValues)
    : "";
  return (
    <details
      className="production-panel"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {t("productionSummary")}
        {busy ? ` · ${t("productionWorking")}` : ""}
        {aiInfo && !aiInfo.configured ? ` · ${t("modelSetupTitle")}` : ""}
      </summary>
      {aiInfo && !aiInfo.configured ? (
        <div className="production-model missing">
          <div>
            <strong>{t("modelSetupTitle")}</strong>
            <span>{t("modelSetupBody")}</span>
          </div>
          <Button onClick={onOpenSettings}>{t("openModelSettings")}</Button>
        </div>
      ) : aiInfo?.configured ? (
        <div className="production-model">
          <span className="model-status-dot" />
          <span>
            {t("modelLabel")} <b>{aiInfo.model}</b>
          </span>
          <code>{aiInfo.endpoint}</code>
        </div>
      ) : null}
      <p>{t("productionLead")}</p>
      <fieldset disabled={busy} className="production-controls">
        <Field label={t("productionExistingTask")}>
          <Select
            value={taskId}
            onChange={(e) => {
              setTaskId(e.target.value);
              reset();
            }}
          >
            <option value="">{t("productionNewDesign")}</option>
            {workspace.workflowTasks.map((item) => (
              <option key={item.id} value={item.id}>
                {displayText(item.title, locale)} · {statusText(t, item.status)}
              </option>
            ))}
          </Select>
        </Field>
        {!task ? (
          <>
            <Field label={t("productionTemplate")}>
              <Select
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value as ProductionTemplate);
                  reset();
                }}
              >
                {Object.entries(productionTemplates).map(([key]) => (
                  <option key={key} value={key}>
                    {
                      productionTemplateLabels[locale][
                        key as ProductionTemplate
                      ]
                    }
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("productionWorld")}>
              <Select
                value={universeId ?? ""}
                onChange={(e) => {
                  setScope({ universeId: e.target.value });
                  reset();
                }}
              >
                <option value="">—</option>
                {workspace.universes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {displayText(item.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("productionNovel")}>
              <Select
                value={scope.workId ?? ""}
                onChange={(e) => {
                  setScope({ universeId, workId: e.target.value });
                  reset();
                }}
              >
                <option value="">—</option>
                {workspace.works
                  .filter(
                    (item) => !universeId || item.universeId === universeId,
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {displayText(item.title, locale)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t("productionChapter")}>
              <Select
                value={scope.chapterId ?? ""}
                onChange={(e) => {
                  setScope({ ...scope, chapterId: e.target.value });
                  reset();
                }}
              >
                <option value="">—</option>
                {work?.chapters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number}. {item.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("productionCharacter")}>
              <Select
                value={scope.characterId ?? ""}
                onChange={(e) => {
                  setScope({ ...scope, characterId: e.target.value });
                  reset();
                }}
              >
                <option value="">{t("productionRelevantCast")}</option>
                {workspace.characters
                  .filter((item) => item.universeIds.includes(universeId ?? ""))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {displayText(item.name, locale)}
                    </option>
                  ))}
              </Select>
            </Field>
          </>
        ) : null}
        <Button data-testid="production-compose" onClick={compose}>
          {t("productionCompose")}
        </Button>
        {!task ? (
          <Button
            disabled={!universeId}
            onClick={() => {
              try {
                const created = createProductionTasks(workspace, scope, locale);
                setMessage(
                  onTasks(created)
                    ? t("productionTasksAdded")
                    : t("productionTasksNotSaved"),
                );
              } catch (error) {
                setMessage(String(error));
              }
            }}
          >
            {t("productionCreateWorkflow")}
          </Button>
        ) : null}
      </fieldset>
      {task ? (
        <p>
          {t("productionEffectiveTemplate")}:{" "}
          <b>
            {
              productionTemplateLabels[locale][
                effectiveProductionTemplate(task)
              ]
            }
          </b>
        </p>
      ) : null}
      {prompt ? (
        <Field label={t("productionPromptLabel")}>
          <TextArea
            rows={8}
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </Field>
      ) : null}
      {blocked ? <p role="status">{t("productionDependencyBlocker")}</p> : null}
      <div className="production-actions">
        <Button
          disabled={!prompt || busy}
          onClick={() =>
            void bridge.copyText(prompt).catch((e) => setMessage(String(e)))
          }
        >
          {t("productionCopyPrompt")}
        </Button>
        <Button
          data-testid="production-run"
          variant="primary"
          disabled={
            !prompt.trim() ||
            prompt.length > MAX_AI_PROMPT_LENGTH ||
            busy ||
            blocked
          }
          onClick={async () => {
            const info = await bridge.aiConfig().catch(() => null);
            if (!info?.configured) {
              setMessage(t("productionConfigureFirst"));
              return;
            }
            if (
              !window.confirm(
                t("productionSendConfirm", {
                  endpoint: info.endpoint,
                  model: info.model,
                }),
              )
            )
              return;
            if (
              task &&
              workflowResultReplaceConfirm(task) &&
              !window.confirm(
                t("productionRerunConfirm", {
                  title: displayText(task.title, locale),
                }),
              )
            )
              return;
            const runMeta: WorkflowTaskRunMeta = {
              model: info.model,
              promptSha256: await sha256Text(prompt),
              sourceRevision: workspace.revision,
              at: new Date().toISOString(),
            };
            const id = createId("ai");
            activeId.current = id;
            setBusy(true);
            setOutput("");
            setUsage(undefined);
            setCompletedTask(null);
            const label = task
              ? displayText(task.title, locale)
              : productionTemplateLabels[locale][template];
            setMessage(t("productionWorkingOn", { label }));
            if (
              task &&
              !workspaceRef.current.workflowTasks.some(
                (item) => item.id === task.id,
              )
            ) {
              activeId.current = "";
              setBusy(false);
              setMessage(t("productionTaskChanged"));
              return;
            }
            if (task) onStatus(task, "active");
            try {
              const completion = await bridge.runAi({ id, prompt, label });
              const text = completion.text;
              setUsage(completion.usage);
              setOutput(text);
              const current = workspaceRef.current;
              const resolved = resolveProductionScope(current, scope);
              if (
                (task &&
                  !current.workflowTasks.some((item) => item.id === task.id)) ||
                (scope.workId && !resolved.workId) ||
                (scope.chapterId && !resolved.chapterId) ||
                (scope.universeId && !resolved.universeId)
              ) {
                throw new Error(t("productionTargetRemoved"));
              }
              if (text.length > MAX_WORKFLOW_RESULT_LENGTH)
                throw new Error(t("productionOutputTooLong"));
              const resultTask = task ?? {
                id: createId("task"),
                title: {
                  zh: productionTemplates[template][0],
                  en: productionTemplates[template][1],
                },
                brief: {
                  zh: productionTemplates[template][2],
                  en: productionTemplates[template][2],
                },
                deliverable: { zh: "设计稿与提示词", en: "Design and prompts" },
                result: { zh: "", en: "" },
                kind: "adaptation" as const,
                template,
                status: "review" as const,
                universeId: resolved.universeId,
                workId: resolved.workId,
                chapterId: resolved.chapterId,
                characterIds: resolved.characterIds ?? [],
                dependsOnIds: [],
                standardRefs: standardRefsFor(current, resolved.universeId),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              if (!task && !onTasks([resultTask]))
                throw new Error(t("productionResultNotSavedToWorkflow"));
              if (!onResult(resultTask, text, runMeta))
                throw new Error(t("productionResultNotSaved"));
              onStatus(resultTask, "review");
              setCompletedTask(resultTask);
              setMessage(t("productionDraftSaved"));
            } catch (error) {
              setMessage(String(error));
              if (task) onStatus(task, task.status);
            } finally {
              activeId.current = "";
              setBusy(false);
              // Every context change that arrived while this run held `activeId`
              // was skipped by the effect above; replay the latest one now so the
              // panel does not keep composing and creating tasks for the scope the
              // user navigated away from.
              const latest = latestContext.current;
              const applied = appliedContext.current;
              if (
                latest.universeId !== applied.universeId ||
                latest.workId !== applied.workId ||
                latest.chapterId !== applied.chapterId ||
                latest.characterId !== applied.characterId
              ) {
                applyContext(latest);
              }
            }
          }}
        >
          {t("productionSendRun")}
        </Button>
        {busy ? (
          <Button onClick={() => void bridge.cancelAi(activeId.current)}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {usageMessage ? <p>{usageMessage}</p> : null}
      {prompt.length > MAX_AI_PROMPT_LENGTH ? (
        <p role="alert">
          {t("productionPromptTooLong", {
            limit: formatNumber(MAX_AI_PROMPT_LENGTH, locale),
          })}
        </p>
      ) : null}
      {output ? (
        <>
          <Field label={t("productionLiveOutput")}>
            <TextArea
              data-testid="production-output"
              rows={10}
              value={output}
              readOnly={busy}
              onChange={(e) => setOutput(e.target.value)}
            />
          </Field>
          <Button onClick={() => void bridge.copyText(output)}>
            {t("productionCopyResult")}
          </Button>
          {completedTask && !busy ? (
            <Button
              disabled={output.length > MAX_WORKFLOW_RESULT_LENGTH}
              onClick={() => {
                setMessage(
                  onResult(completedTask, output)
                    ? t("productionReviewedSaved")
                    : t("productionReviewedNotSaved"),
                );
              }}
            >
              {t("productionSaveReviewed")}
            </Button>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
