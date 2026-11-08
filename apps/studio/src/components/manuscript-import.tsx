import { useEffect, useRef, useState } from "react";
import { createId } from "../core/factory.ts";
import {
  analyzeManuscriptChunks,
  analysisPrompt,
  buildManuscriptImport,
  planManuscriptAnalysis,
  splitManuscript,
  type AnalyzedChunk,
  type ManuscriptAnalysisFailure,
} from "../core/manuscript.ts";
import type { StudioWorkspace, UiLocale } from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import { Button, Field, Modal, TextArea, TextInput } from "./ui.tsx";

type ChunkRef = { chapter: number; part: number };
const sameChunk = (left: ChunkRef, right: ChunkRef) =>
  left.chapter === right.chapter && left.part === right.part;

export function ManuscriptImport({
  locale,
  t,
  onClose,
  onImport,
}: {
  locale: UiLocale;
  t: Translate;
  onClose: () => void;
  onImport: (workspace: StudioWorkspace) => boolean | Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [results, setResults] = useState<AnalyzedChunk[]>([]);
  const [failures, setFailures] = useState<ManuscriptAnalysisFailure[]>([]);
  const [skipped, setSkipped] = useState<ChunkRef[]>([]);
  const active = useRef("");
  const canceled = useRef(false);
  useEffect(
    () =>
      bridge.onAiProgress((progress) => {
        if (progress.id === active.current) setOutput(progress.text);
      }),
    [],
  );
  useEffect(
    () => () => {
      canceled.current = true;
      if (active.current) void bridge.cancelAi(active.current);
    },
    [],
  );
  let chapters: ReturnType<typeof splitManuscript> = [],
    parseError = "";
  try {
    if (text) chapters = splitManuscript(text);
  } catch (error) {
    parseError = String(error);
  }
  const plan = planManuscriptAnalysis(chapters);
  const chunks = plan.chunks;
  const resetSource = (value: string) => {
    setText(value);
    setAnalysis("");
    setOutput("");
    setReviewed(false);
    setMessage("");
    setResults([]);
    setFailures([]);
    setSkipped([]);
  };
  const runAnalysis = async (
    previous: AnalyzedChunk[],
    skip: ChunkRef[],
    continueOnFailure: boolean,
  ) => {
    const nextSkipped = [...skipped];
    for (const item of skip)
      if (!nextSkipped.some((value) => sameChunk(value, item)))
        nextSkipped.push({ chapter: item.chapter, part: item.part });
    setSkipped(nextSkipped);
    const pending = chunks.filter(
      (chunk) =>
        !previous.some((value) => sameChunk(value, chunk)) &&
        !nextSkipped.some((value) => sameChunk(value, chunk)),
    );
    if (!pending.length) {
      setMessage(t("importNothingPending"));
      return;
    }
    const info = await bridge.aiConfig().catch(() => null);
    if (!info?.configured) {
      setMessage(t("importNeedModel"));
      return;
    }
    const already = previous.length
      ? t("importKeptSegments", { done: previous.length, total: chunks.length })
      : "";
    if (
      !window.confirm(
        t("importSendConfirm", {
          pending: pending.length,
          endpoint: info.endpoint,
          model: info.model,
        }) + already,
      )
    )
      return;
    canceled.current = false;
    setBusy(true);
    if (!previous.length) {
      setAnalysis("");
      setReviewed(false);
      setResults([]);
    }
    setFailures([]);
    try {
      const run = await analyzeManuscriptChunks(
        chapters,
        async (chunk) => {
          const id = createId("analyze");
          active.current = id;
          const index = chunks.findIndex((value) => sameChunk(value, chunk));
          const label = `${t("importAnalyzingLabel", { chapter: chunk.chapter })} · ${index + 1}/${chunks.length}`;
          setMessage(label);
          setOutput("");
          return (
            await bridge.runAi({
              id,
              label,
              prompt: analysisPrompt(chunk, locale),
            })
          ).text;
        },
        {
          previous,
          skip: nextSkipped,
          continueOnFailure,
          shouldStop: () => canceled.current,
        },
      );
      setResults(run.results);
      setFailures(run.failures);
      // A retry can complete segments the user never saw; rewritten JSON must be reviewed again.
      if (
        run.results.some(
          (value) => !previous.some((item) => sameChunk(item, value)),
        )
      ) {
        setAnalysis(JSON.stringify(run.results, null, 2));
        setReviewed(false);
      }
      if (canceled.current) {
        setMessage(t("importCanceled", { count: run.results.length }));
        return;
      }
      const skippedNote = nextSkipped.length
        ? t("importSkippedNote", { count: nextSkipped.length })
        : "";
      if (run.failures.length) {
        const failure = run.failures[0]!;
        setMessage(
          t("importFailure", {
            chapter: failure.chapter,
            part: failure.part,
            message: failure.message,
            done: run.results.length,
            total: chunks.length,
          }) + skippedNote,
        );
        return;
      }
      const ready = t("importReady");
      try {
        buildManuscriptImport(title, chapters, run.results, locale);
        setMessage(ready + skippedNote);
      } catch (error) {
        setMessage(`${ready}${skippedNote} ${String(error)}`);
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      active.current = "";
      setBusy(false);
    }
  };
  const locked = busy || importing;
  // The import handler persists a snapshot before merging, which can fail and
  // abort the import. Close only after it reports success so a failure keeps
  // the pasted manuscript, loaded file and analysis intact.
  const confirmImport = async () => {
    setImporting(true);
    try {
      const imported = buildManuscriptImport(
        title,
        chapters,
        analysis ? JSON.parse(analysis) : [],
        locale,
      );
      if (await onImport(imported)) {
        onClose();
        return;
      }
      setMessage(t("importFailed"));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setImporting(false);
    }
  };
  // Pasted text, a chosen file and an edited analysis are all real work that
  // the import dialog would drop on close, so confirm first (never while a
  // model request or import commit is running: closing is blocked, not confirmed).
  const requestClose = () => {
    if (locked) return;
    const dirty = Boolean(
      title.trim() || text.trim() || analysis.trim() || results.length,
    );
    if (dirty && !window.confirm(t("importDiscardConfirm"))) return;
    onClose();
  };
  return (
    <Modal
      open
      onClose={requestClose}
      wide
      closeLabel={t("close")}
      title={t("importTitle")}
      description={t("importLead")}
      footer={
        <>
          <Button disabled={locked} onClick={requestClose}>
            {t("close")}
          </Button>
          <Button
            data-testid="import-confirm"
            variant="primary"
            disabled={
              locked ||
              !title.trim() ||
              !chapters.length ||
              Boolean(parseError) ||
              (Boolean(analysis) && !reviewed)
            }
            onClick={() => {
              void confirmImport();
            }}
          >
            {analysis ? t("importButtonReviewed") : t("importButtonPlain")}
          </Button>
        </>
      }
    >
      <fieldset disabled={locked} className="production-controls">
        <Field label={t("importTitleField")}>
          <TextInput
            data-testid="import-title"
            value={title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("importChooseFile")}>
          <input
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (
                  !/\.(txt|md|markdown)$/i.test(file.name) ||
                  file.size > 8_000_000
                )
                  throw new Error(t("importFileTooLarge"));
                const bytes = new Uint8Array(await file.arrayBuffer());
                const encoding =
                  bytes[0] === 0xff && bytes[1] === 0xfe
                    ? "utf-16le"
                    : bytes[0] === 0xfe && bytes[1] === 0xff
                      ? "utf-16be"
                      : "utf-8";
                const decoded = new TextDecoder(encoding, {
                  fatal: true,
                }).decode(bytes);
                splitManuscript(decoded);
                resetSource(decoded);
                setTitle(file.name.replace(/\.[^.]+$/, ""));
              } catch {
                setMessage(t("importFileUnreadable"));
              }
            }}
          />
        </Field>
      </fieldset>
      <Field label={t("importSourceLabel")}>
        <TextArea
          data-testid="import-text"
          rows={8}
          value={text}
          disabled={locked}
          onChange={(e) => resetSource(e.target.value)}
        />
      </Field>
      {parseError ? <p role="alert">{parseError}</p> : null}
      <p>
        {t("importCounts", {
          chapters: chapters.length,
          requests: chunks.length,
        })}
      </p>
      {plan.block ? <p role="alert">{plan.block}</p> : null}
      {plan.warnings.length ? (
        <ul>
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>{t("importPreview")}</summary>
        <ol>
          {chapters.map((chapter) => {
            const detail = plan.chapters.find(
              (value) => value.number === chapter.number,
            );
            return (
              <li key={chapter.id}>
                {chapter.title} · {chapter.content.length}
                {detail
                  ? ` · ${t("importSegments", { count: detail.parts })}`
                  : ""}
              </li>
            );
          })}
        </ol>
      </details>
      <p>{t("importLeadBody")}</p>
      <Button
        disabled={
          locked || !chunks.length || Boolean(plan.block) || Boolean(parseError)
        }
        onClick={() => {
          void runAnalysis(results, [], false);
        }}
      >
        {t("importAnalyze")}
      </Button>
      {failures.length && !locked ? (
        <>
          <Button
            onClick={() => {
              void runAnalysis(results, [], false);
            }}
          >
            {t("importRetry")}
          </Button>
          <Button
            onClick={() => {
              void runAnalysis(results, failures, true);
            }}
          >
            {t("importSkip")}
          </Button>
        </>
      ) : null}
      {busy ? (
        <Button
          onClick={() => {
            canceled.current = true;
            if (active.current) void bridge.cancelAi(active.current);
          }}
        >
          {t("importCancelAnalysis")}
        </Button>
      ) : null}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {busy && output ? (
        <pre className="production-output">{output}</pre>
      ) : null}
      {analysis ? (
        <>
          <Field label={t("importReviewLabel")}>
            <TextArea
              rows={12}
              value={analysis}
              disabled={locked}
              onChange={(e) => {
                setAnalysis(e.target.value);
                setReviewed(false);
              }}
            />
          </Field>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={locked}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {t("importReviewConfirm")}
          </label>
        </>
      ) : null}
    </Modal>
  );
}
