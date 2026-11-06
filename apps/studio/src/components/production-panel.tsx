import { useEffect, useRef, useState } from "react";
import { bridge } from "../platform.ts";
import type { AiConfigInfo } from "../core/ai.ts";
import { createId, displayText } from "../core/factory.ts";
import { buildProductionPrompt, createProductionTasks, productionTemplates, resolveProductionScope, taskProductionPrompt, type ProductionScope, type ProductionTemplate } from "../core/production.ts";
import { standardRefsFor } from "../core/standards.ts";
import { MAX_WORKFLOW_RESULT_LENGTH } from "../core/types.ts";
import type { StudioWorkspace, UiLocale, WorkflowTask } from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { Button, Field, Select, TextArea } from "./ui.tsx";

export function ProductionPanel({ workspace, locale, t, aiInfo, onOpenSettings, context, onTasks, onStatus, onResult }: {
  workspace: StudioWorkspace; locale: UiLocale; t: Translate;
  aiInfo: AiConfigInfo | null;
  onOpenSettings: () => void;
  context: ProductionScope;
  onTasks: (tasks: WorkflowTask[]) => boolean;
  onStatus: (task: WorkflowTask, status: WorkflowTask["status"]) => void;
  onResult: (task: WorkflowTask, text: string) => boolean;
}) {
  const en = locale === "en";
  const [scope, setScope] = useState<ProductionScope>(context);
  const [template, setTemplate] = useState<ProductionTemplate>("world");
  const [taskId, setTaskId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const activeId = useRef("");
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [completedTask, setCompletedTask] = useState<WorkflowTask | null>(null);
  const work = workspace.works.find((item) => item.id === scope.workId);
  const universeId = work?.universeId ?? scope.universeId;
  const task = workspace.workflowTasks.find((item) => item.id === taskId);
  const blocked = Boolean(task && task.dependsOnIds.some((id) => workspace.workflowTasks.find((item) => item.id === id)?.status !== "done"));
  useEffect(() => { if (!activeId.current) { setScope(context); setPrompt(""); setTaskId(""); } }, [context.universeId, context.workId, context.chapterId, context.characterId]);
  useEffect(() => bridge.onAiProgress((progress) => { if (progress.id === activeId.current) setOutput(progress.text); }), []);
  useEffect(() => () => { if (activeId.current) void bridge.cancelAi(activeId.current); }, []);
  const reset = () => { setPrompt(""); setMessage(""); };
  const compose = () => { setPrompt(task ? taskProductionPrompt(workspace, task, locale) : buildProductionPrompt(workspace, template, scope, locale)); setMessage(""); };
  return <details className="production-panel" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>{en ? "AI production desk · prompts, live output and review" : "AI 制作台 · 提示词、实时工作与结果审阅"}{busy ? ` · ${en ? "Working" : "正在工作"}` : ""}{aiInfo && !aiInfo.configured ? ` · ${t("modelSetupTitle")}` : ""}</summary>
    {aiInfo && !aiInfo.configured ? <div className="production-model missing">
      <div>
        <strong>{t("modelSetupTitle")}</strong>
        <span>{t("modelSetupBody")}</span>
      </div>
      <Button onClick={onOpenSettings}>{t("openModelSettings")}</Button>
    </div> : aiInfo?.configured ? <div className="production-model">
      <span className="model-status-dot" />
      <span>{t("modelLabel")} <b>{aiInfo.model}</b></span>
      <code>{aiInfo.endpoint}</code>
    </div> : null}
    <p>{en ? "Select the production target, compose and edit its prompt, then explicitly send it to your configured model. Output is a draft specification, not rendered media." : "选择制作对象，生成并编辑对应提示词，再明确发送给已配置模型。产出为待审设计稿，不代表已生成图片或视频。"}</p>
    <fieldset disabled={busy} className="production-controls">
      <Field label={en ? "Existing workflow task" : "现有工作流任务"}><Select value={taskId} onChange={(e) => { setTaskId(e.target.value); reset(); }}><option value="">{en ? "New design" : "新建设计"}</option>{workspace.workflowTasks.map((item) => <option key={item.id} value={item.id}>{displayText(item.title, locale)} · {item.status}</option>)}</Select></Field>
      {!task ? <>
        <Field label={en ? "Template" : "制作模板"}><Select value={template} onChange={(e) => { setTemplate(e.target.value as ProductionTemplate); reset(); }}>{Object.entries(productionTemplates).map(([key, value]) => <option key={key} value={key}>{value[en ? 1 : 0]}</option>)}</Select></Field>
        <Field label={en ? "World" : "世界"}><Select value={universeId ?? ""} onChange={(e) => { setScope({ universeId: e.target.value }); reset(); }}><option value="">—</option>{workspace.universes.map((item) => <option key={item.id} value={item.id}>{displayText(item.name, locale)}</option>)}</Select></Field>
        <Field label={en ? "Novel" : "小说"}><Select value={scope.workId ?? ""} onChange={(e) => { setScope({ universeId, workId: e.target.value }); reset(); }}><option value="">—</option>{workspace.works.filter((item) => !universeId || item.universeId === universeId).map((item) => <option key={item.id} value={item.id}>{displayText(item.title, locale)}</option>)}</Select></Field>
        <Field label={en ? "Chapter" : "章节"}><Select value={scope.chapterId ?? ""} onChange={(e) => { setScope({ ...scope, chapterId: e.target.value }); reset(); }}><option value="">—</option>{work?.chapters.map((item) => <option key={item.id} value={item.id}>{item.number}. {item.title}</option>)}</Select></Field>
        <Field label={en ? "Character" : "人物"}><Select value={scope.characterId ?? ""} onChange={(e) => { setScope({ ...scope, characterId: e.target.value }); reset(); }}><option value="">{en ? "Relevant cast" : "相关人物"}</option>{workspace.characters.filter((item) => item.universeIds.includes(universeId ?? "")).map((item) => <option key={item.id} value={item.id}>{displayText(item.name, locale)}</option>)}</Select></Field>
      </> : null}
      <Button data-testid="production-compose" onClick={compose}>{en ? "Compose prompt" : "生成对应提示词"}</Button>
      {!task ? <Button disabled={!universeId} onClick={() => { try { const created = createProductionTasks(workspace, scope, locale); setMessage(onTasks(created) ? (en ? "Six dependent production tasks added to Workflow." : "已在工作流中建立六个有依赖关系的制作任务。") : (en ? "The production tasks were not saved." : "制作任务未能保存。")); } catch (error) { setMessage(String(error)); } }}>{en ? "Create production workflow" : "建立制作工作流"}</Button> : null}
    </fieldset>
    {prompt ? <Field label={en ? "Prompt sent to model (editable)" : "将发送给模型的提示词（可编辑）"}><TextArea rows={8} value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} /></Field> : null}
    {blocked ? <p role="status">{en ? "Approve dependency results before running this task." : "请先审阅并完成前置任务，再执行此任务。"}</p> : null}
    <div className="production-actions">
      <Button disabled={!prompt || busy} onClick={() => void bridge.copyText(prompt).catch((e) => setMessage(String(e)))}>{en ? "Copy prompt" : "复制提示词"}</Button>
      <Button data-testid="production-run" variant="primary" disabled={!prompt.trim() || prompt.length > 100_000 || busy || blocked} onClick={async () => {
        const info = await bridge.aiConfig().catch(() => null);
        if (!info?.configured) { setMessage(en ? "Configure a model in Settings first (desktop only)." : "请先在设置中配置模型（仅桌面版）。"); return; }
        if (!window.confirm(en ? `Send this prompt to ${info.endpoint} using ${info.model}? Provider charges may apply.` : `将此提示词发送至 ${info.endpoint}，使用 ${info.model}？服务商可能计费。`)) return;
        const id = createId("ai"); activeId.current = id; setBusy(true); setOutput(""); setCompletedTask(null);
        const label = task ? displayText(task.title, locale) : productionTemplates[template][en ? 1 : 0];
        setMessage(`${en ? "Working on" : "正在执行"}：${label}`);
        if (task && !onTasks([{ ...task, brief: en ? { ...task.brief, en: prompt } : { ...task.brief, zh: prompt }, deliverable: { ...task.deliverable, [en ? "en" : "zh"]: `Model: ${info.model}; source revision: ${workspace.revision}. ${en ? "Review the draft before completion." : "完成前请审阅设计稿。"}` }, status: "active" }])) {
          activeId.current = ""; setBusy(false);
          setMessage(en ? "This task changed while the panel was open and could not be marked active. Reopen it and try again." : "任务已发生变化，无法标记为进行中；请重新打开后再试。");
          return;
        }
        try {
          const text = await bridge.runAi({ id, prompt, label });
          setOutput(text);
          const current = workspaceRef.current;
          const resolved = resolveProductionScope(current, scope);
          if ((task && !current.workflowTasks.some((item) => item.id === task.id)) ||
              (scope.workId && !resolved.workId) ||
              (scope.chapterId && !resolved.chapterId) ||
              (scope.universeId && !resolved.universeId)) {
            throw new Error(en ? "The target was removed while running. Copy the result; it was not saved." : "执行期间目标已被删除，请复制结果保留，本次没有写入。");
          }
          if (text.length > MAX_WORKFLOW_RESULT_LENGTH) throw new Error(en ? "Output exceeds the saved-result limit; copy it before continuing." : "输出超过保存长度，请先复制保留。");
          const resultTask = task ?? { id: createId("task"), title: { zh: productionTemplates[template][0], en: productionTemplates[template][1] }, brief: { zh: en ? "" : prompt, en: en ? prompt : "" }, deliverable: { zh: "设计稿与提示词", en: "Design and prompts" }, result: { zh: "", en: "" }, kind: "adaptation" as const, status: "review" as const, universeId: resolved.universeId, workId: resolved.workId, chapterId: resolved.chapterId, characterIds: resolved.characterIds ?? [], dependsOnIds: [], standardRefs: standardRefsFor(current, resolved.universeId), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          if (!task && !onTasks([resultTask])) throw new Error(en ? "The result could not be saved to Workflow. Copy it before continuing." : "结果未能写入工作流，请先复制保留。");
          if (!onResult(resultTask, text)) throw new Error(en ? "The result was not saved; copy it before continuing." : "结果未能保存，请先复制保留。");
          onStatus(resultTask, "review"); setCompletedTask(resultTask);
          setMessage(en ? "Draft saved to Workflow for review. Source manuscript is unchanged." : "设计稿已保存到工作流，等待审阅；原稿未被覆盖。");
        } catch (error) { setMessage(String(error)); if (task) onStatus(task, task.status); }
        finally { activeId.current = ""; setBusy(false); }
      }}>{en ? "Send and run" : "发送并执行"}</Button>
      {busy ? <Button onClick={() => void bridge.cancelAi(activeId.current)}>{en ? "Cancel" : "取消"}</Button> : null}
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {prompt.length > 100_000 ? <p role="alert">{en ? "Prompt exceeds 100,000 characters. Narrow its scope or edit it before sending." : "提示词超过 10 万字符，请缩小范围或编辑后发送。"}</p> : null}
    {output ? <><Field label={en ? "Live draft / reviewed result" : "实时产出 / 待审结果"}><TextArea data-testid="production-output" rows={10} value={output} readOnly={busy} onChange={(e) => setOutput(e.target.value)} /></Field><Button onClick={() => void bridge.copyText(output)}>{en ? "Copy result" : "复制结果"}</Button>{completedTask && !busy ? <Button disabled={output.length > MAX_WORKFLOW_RESULT_LENGTH} onClick={() => { setMessage(onResult(completedTask, output) ? (en ? "Reviewed edits saved. Mark the task done in Workflow when ready." : "审阅修改已保存，确认后可在工作流标记完成。") : (en ? "The reviewed edits were not saved." : "审阅修改未能保存。")); }}>{en ? "Save reviewed edits" : "保存审阅修改"}</Button> : null}</> : null}
  </details>;
}
