import { useEffect, useRef, useState } from "react";
import { createId } from "../core/factory.ts";
import { analyzeManuscriptChunks, analysisPrompt, buildManuscriptImport, planManuscriptAnalysis, splitManuscript, type AnalyzedChunk, type ManuscriptAnalysisFailure } from "../core/manuscript.ts";
import type { StudioWorkspace, UiLocale } from "../core/types.ts";
import { bridge } from "../platform.ts";
import { Button, Field, Modal, TextArea, TextInput } from "./ui.tsx";

type ChunkRef = { chapter: number; part: number };
const sameChunk = (left: ChunkRef, right: ChunkRef) => left.chapter === right.chapter && left.part === right.part;

export function ManuscriptImport({ locale, onClose, onImport }: { locale: UiLocale; onClose: () => void; onImport: (workspace: StudioWorkspace) => void }) {
  const en = locale === "en";
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [results, setResults] = useState<AnalyzedChunk[]>([]);
  const [failures, setFailures] = useState<ManuscriptAnalysisFailure[]>([]);
  const [skipped, setSkipped] = useState<ChunkRef[]>([]);
  const active = useRef("");
  const canceled = useRef(false);
  useEffect(() => bridge.onAiProgress((progress) => { if (progress.id === active.current) setOutput(progress.text); }), []);
  useEffect(() => () => { canceled.current = true; if (active.current) void bridge.cancelAi(active.current); }, []);
  let chapters: ReturnType<typeof splitManuscript> = [], parseError = "";
  try { if (text) chapters = splitManuscript(text); } catch (error) { parseError = String(error); }
  const plan = planManuscriptAnalysis(chapters);
  const chunks = plan.chunks;
  const resetSource = (value: string) => {
    setText(value); setAnalysis(""); setOutput(""); setReviewed(false); setMessage("");
    setResults([]); setFailures([]); setSkipped([]);
  };
  const runAnalysis = async (previous: AnalyzedChunk[], skip: ChunkRef[], continueOnFailure: boolean) => {
    const nextSkipped = [...skipped];
    for (const item of skip) if (!nextSkipped.some((value) => sameChunk(value, item))) nextSkipped.push({ chapter: item.chapter, part: item.part });
    setSkipped(nextSkipped);
    const pending = chunks.filter((chunk) => !previous.some((value) => sameChunk(value, chunk)) && !nextSkipped.some((value) => sameChunk(value, chunk)));
    if (!pending.length) { setMessage(en ? "Every segment already has a result or was skipped. Edit the manuscript to start over." : "所有片段均已有结果或已被跳过；修改原稿可重新分析。"); return; }
    const info = await bridge.aiConfig().catch(() => null);
    if (!info?.configured) { setMessage(en ? "Configure a model in desktop Settings first." : "请先在桌面版设置中配置模型。"); return; }
    const already = previous.length ? (en ? ` ${previous.length}/${chunks.length} finished segments are kept and will not be sent again.` : ` 已保留 ${previous.length}/${chunks.length} 个完成片段，不会重复发送。`) : "";
    if (!window.confirm((en ? `Send ${pending.length} segments to ${info.endpoint} (${info.model})? Provider charges may apply.` : `将 ${pending.length} 段原稿发送至 ${info.endpoint}（${info.model}）？服务商可能计费。`) + already)) return;
    canceled.current = false; setBusy(true);
    if (!previous.length) { setAnalysis(""); setReviewed(false); setResults([]); }
    setFailures([]);
    try {
      const run = await analyzeManuscriptChunks(chapters, async (chunk) => {
        const id = createId("analyze"); active.current = id;
        const index = chunks.findIndex((value) => sameChunk(value, chunk));
        const label = `${en ? "Analyzing chapter" : "正在分析章节"} ${chunk.chapter} · ${index + 1}/${chunks.length}`;
        setMessage(label); setOutput("");
        return bridge.runAi({ id, label, prompt: analysisPrompt(chunk, locale) });
      }, { previous, skip: nextSkipped, continueOnFailure, shouldStop: () => canceled.current });
      setResults(run.results);
      setFailures(run.failures);
      // A retry can complete segments the user never saw; rewritten JSON must be reviewed again.
      if (run.results.some((value) => !previous.some((item) => sameChunk(item, value)))) {
        setAnalysis(JSON.stringify(run.results, null, 2));
        setReviewed(false);
      }
      if (canceled.current) {
        setMessage(en ? `Analysis canceled. ${run.results.length} finished segments were kept.` : `分析已取消；已保留 ${run.results.length} 个完成片段。`);
        return;
      }
      const skippedNote = nextSkipped.length ? (en ? ` ${nextSkipped.length} skipped segments are excluded from the import.` : ` 已跳过 ${nextSkipped.length} 个片段，不会写入导入结果。`) : "";
      if (run.failures.length) {
        const failure = run.failures[0]!;
        setMessage((en ? `Chapter ${failure.chapter}, part ${failure.part} failed: ${failure.message} ${run.results.length}/${chunks.length} segments finished. Retry the failed segment without resending finished ones, or skip it and continue.` : `第 ${failure.chapter} 章第 ${failure.part} 块失败：${failure.message} 已完成 ${run.results.length}/${chunks.length} 块。可重试失败片段（不会重发已完成片段），或跳过失败片段继续。`) + skippedNote);
        return;
      }
      const ready = en ? "Analysis ready. Review names, directional relationships, scenes and source quotations before importing." : "分析完成。请审阅人物名、关系方向、场景及原文依据，再确认导入。";
      try {
        buildManuscriptImport(title, chapters, run.results, locale);
        setMessage(ready + skippedNote);
      } catch (error) {
        setMessage(`${ready}${skippedNote} ${String(error)}`);
      }
    } catch (error) { setMessage(String(error)); }
    finally { active.current = ""; setBusy(false); }
  };
  // Pasted text, a chosen file and an edited analysis are all real work that
  // the import dialog would drop on close, so confirm first (never while a
  // model request is running: closing is blocked, not confirmed).
  const requestClose = () => {
    if (busy) return;
    const dirty = Boolean(title.trim() || text.trim() || analysis.trim() || results.length);
    if (dirty && !window.confirm(en ? "This import has text or analysis that will not be kept. Close anyway?" : "这次导入的原文或分析尚未导入，关闭后会丢失。确定关闭？")) return;
    onClose();
  };
  return <Modal open onClose={requestClose} wide title={en ? "Import existing novel" : "导入已有小说"} description={en ? "TXT / Markdown or pasted text. Word, EPUB and PDF: export to plain text first. Import creates a new world and novel without overwriting existing work." : "支持 TXT / Markdown 或粘贴文本。Word、EPUB、PDF 请先导出纯文本；导入会新建世界与小说，不覆盖已有作品。"} footer={<>
    <Button disabled={busy} onClick={requestClose}>{en ? "Close" : "关闭"}</Button>
    <Button data-testid="import-confirm" variant="primary" disabled={busy || !title.trim() || !chapters.length || Boolean(parseError) || (Boolean(analysis) && !reviewed)} onClick={() => {
      try { const imported = buildManuscriptImport(title, chapters, analysis ? JSON.parse(analysis) : [], locale); onImport(imported); onClose(); } catch (error) { setMessage(String(error)); }
    }}>{analysis ? (en ? "Import reviewed assets and manuscript" : "导入已审阅资产与原稿") : (en ? "Import manuscript only" : "仅导入原稿")}</Button>
  </>}>
    <fieldset disabled={busy} className="production-controls">
      <Field label={en ? "Novel title / new world" : "小说标题 / 新世界名称"}><TextInput data-testid="import-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={en ? "Choose TXT / Markdown" : "选择 TXT / Markdown 文件"}><input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        try {
          if (!/\.(txt|md|markdown)$/i.test(file.name) || file.size > 8_000_000) throw new Error(en ? "Use TXT/Markdown under 8 MB." : "请选择 8 MB 以内的 TXT/Markdown。");
          const bytes = new Uint8Array(await file.arrayBuffer());
          const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
          const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
          splitManuscript(decoded); resetSource(decoded); setTitle(file.name.replace(/\.[^.]+$/, ""));
        } catch { setMessage(en ? "Cannot read this file. Convert it to UTF-8 TXT/Markdown (up to 2 million characters)." : "无法读取此文件，请转换为 UTF-8 TXT/Markdown（不超过 200 万字符）。"); }
      }} /></Field>
    </fieldset>
    <Field label={en ? "Original manuscript (editable before import)" : "原稿（导入前可编辑）"}><TextArea data-testid="import-text" rows={8} value={text} disabled={busy} onChange={(e) => resetSource(e.target.value)} /></Field>
    {parseError ? <p role="alert">{parseError}</p> : null}
    <p>{en ? "Chapters / model requests" : "章节 / 模型请求数"}：{chapters.length} / {chunks.length}</p>
    {plan.block ? <p role="alert">{plan.block}</p> : null}
    {plan.warnings.length ? <ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    <details><summary>{en ? "Chapter preview" : "章节拆分预览"}</summary><ol>{chapters.map((chapter) => { const detail = plan.chapters.find((value) => value.number === chapter.number); return <li key={chapter.id}>{chapter.title} · {chapter.content.length}{detail ? ` · ${detail.parts} ${en ? "segments" : "块"}` : ""}</li>; })}</ol></details>
    <p>{en ? "Analysis sends each manuscript segment to your configured model. Maximum 40 requests per import; larger novels can be split or imported without AI. Finished segments are kept if a later one fails or you cancel. All returned assets require exact source quotations and your review." : "分析会将原稿分段发送给已配置模型。每次最多 40 个请求；更长小说可拆分，或先不使用 AI 导入。后续片段失败或取消时会保留已完成片段。资产须包含原文依据，并由你审阅。"}</p>
    <Button disabled={busy || !chunks.length || Boolean(plan.block) || Boolean(parseError)} onClick={() => { void runAnalysis(results, [], false); }}>{en ? "Analyze world, cast and scenes" : "自动分析世界、人物关系与场景"}</Button>
    {failures.length && !busy ? <>
      <Button onClick={() => { void runAnalysis(results, [], false); }}>{en ? "Retry failed segments" : "重试失败片段"}</Button>
      <Button onClick={() => { void runAnalysis(results, failures, true); }}>{en ? "Skip failed and continue" : "跳过失败片段并继续"}</Button>
    </> : null}
    {busy ? <Button onClick={() => { canceled.current = true; if (active.current) void bridge.cancelAi(active.current); }}>{en ? "Cancel" : "取消分析"}</Button> : null}
    <p role="status" aria-live="polite">{message}</p>
    {busy && output ? <pre className="production-output">{output}</pre> : null}
    {analysis ? <><Field label={en ? "Review / edit extracted assets and evidence" : "审阅 / 编辑资产与依据"}><TextArea rows={12} value={analysis} onChange={(e) => { setAnalysis(e.target.value); setReviewed(false); }} /></Field><label className="toggle-row"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />{en ? "I reviewed asset identities, relationships, scenes and source quotations." : "已审阅资产身份、关系、场景及原文依据。"}</label></> : null}
  </Modal>;
}
