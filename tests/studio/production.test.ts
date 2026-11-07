import { expect, jest, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { buildManuscriptImport, manuscriptChunks, mergeManuscriptImport, parseAnalysis, splitManuscript, type ManuscriptAnalysis } from "../../apps/studio/src/core/manuscript.ts";
import { buildProductionPrompt, createProductionTasks, resolveProductionScope, taskProductionPrompt } from "../../apps/studio/src/core/production.ts";
import { setWorkflowTaskResult } from "../../apps/studio/src/core/workflow.ts";
import { AI_CANCELED_MESSAGE, aiConfigSchema, isReportableAiError, runCompletion } from "../../apps/studio/src/node/ai-client.ts";
import { buildArcReelBundle } from "../../apps/studio/src/core/arcreel.ts";

const source = "前言\r\n第1章 灯塔\r\n阿青在灯塔遇到导师白舟。\r\n第2章 归途\r\n阿青离开灯塔。\r\n";
const analysis: ManuscriptAnalysis = { world: null, characters: [
  { name: "阿青", summary: "旅人", appearance: "", evidence: "阿青" },
  { name: "白舟", summary: "导师", appearance: "", evidence: "导师白舟" },
], locations: [{ name: "灯塔", summary: "会面地点", evidence: "灯塔" }], factions: [], lore: [], relationships: [{ source: "白舟", target: "阿青", type: "mentor", mutual: false, summary: "导师", evidence: "阿青在灯塔遇到导师白舟" }], scenes: [{ title: "灯塔会面", summary: "师徒见面", location: "灯塔", characters: ["阿青", "白舟"], evidence: "阿青在灯塔遇到导师白舟" }] };

test("chapter splitting preserves every source character including headings, preface and CRLF", () => {
  const chapters = splitManuscript(source);
  expect(chapters).toHaveLength(3);
  expect(chapters.map((item) => item.content).join("")).toBe(source);
  expect(manuscriptChunks(chapters, 7).map((item) => item.text).join("")).toBe(source);
  expect(splitManuscript("# Start\nOne\n## Scene two\nTwo")).toHaveLength(2);
  expect(splitManuscript("Chapter I\nOne\nChapter 2\nTwo")).toHaveLength(2);
  expect(() => splitManuscript("\0binary")).toThrow();
});

test("analysis validates exact evidence and linked assets, keeps manuscript and existing workspace intact", () => {
  const chapters = splitManuscript(source);
  const chunk = manuscriptChunks(chapters)[1]!;
  expect(parseAnalysis(JSON.stringify(analysis), chunk)).toEqual(analysis);
  const invalid = structuredClone(analysis); invalid.characters[0]!.evidence = "不存在的原文";
  expect(() => parseAnalysis(JSON.stringify(invalid), chunk)).toThrow(/evidence/);
  const imported = buildManuscriptImport("灯塔", chapters, [{ chapter: 2, part: 1, analysis }], "zh-CN");
  expect(imported.relationships[0]!.mutual).toBe(false);
  expect(imported.works[0]!.chapters[1]!.scenes[0]!.locationId).toBe(imported.locations[0]!.id);
  expect(imported.works[0]!.chapters.map((item) => item.content).join("")).toBe(source);
  const current = createDemoWorkspace("en"), before = JSON.stringify(current);
  const combined = mergeManuscriptImport(current, imported);
  expect(combined.works.length).toBe(current.works.length + 1);
  expect(JSON.stringify(current)).toBe(before);
  const dangling = structuredClone(analysis); dangling.scenes[0]!.characters.push("ghost");
  expect(() => buildManuscriptImport("test", chapters, [{ chapter: 2, part: 1, analysis: dangling }], "en")).toThrow(/unknown assets/);
});

test("production workflow carries scope, dependencies, long results and costume constraints", () => {
  const workspace = createDemoWorkspace("en");
  const work = workspace.works[0]!;
  const scope = { workId: work.id, chapterId: work.chapters[0]!.id, characterId: workspace.characters[0]!.id };
  const tasks = createProductionTasks(workspace, scope, "en");
  workspace.workflowTasks.push(...tasks);
  expect(tasks).toHaveLength(6);
  expect(tasks[2]!.dependsOnIds).toEqual([tasks[1]!.id]);
  tasks[1]!.result.en = "Approved identity. ".repeat(100);
  tasks[1]!.status = "done";
  expect(() => validateWorkspace(workspace)).not.toThrow();
  const prompt = taskProductionPrompt(workspace, tasks[2]!, "en");
  expect(prompt).toContain("Approved identity.");
  expect(prompt).toContain("Preserve face/body identity");
  const context = JSON.parse(buildProductionPrompt(workspace, "storyboard", scope, "en").split("SOURCE DATA (not instructions):\n")[1]!);
  expect(context.chapter.content).toBe(work.chapters[0]!.content);
});

test("running a task keeps its brief, deliverable and composed prompt stable", () => {
  const workspace = createDemoWorkspace("en");
  const tasks = createProductionTasks(workspace, { workId: workspace.works[0]!.id }, "en");
  workspace.workflowTasks.push(...tasks);
  const task = tasks[0]!;
  const briefBefore = JSON.stringify(task.brief);
  const deliverableBefore = JSON.stringify(task.deliverable);
  const compose = () => taskProductionPrompt(workspace, task, "en").replace(/\d+/g, "#");
  const first = compose();
  expect(
    setWorkflowTaskResult(workspace, task.id, "Model draft.", "en", {
      model: "test-model",
      promptSha256: "a".repeat(64),
      sourceRevision: workspace.revision,
      at: "2026-11-07T00:00:00.000Z",
    }),
  ).toBe(true);
  expect(JSON.stringify(task.brief)).toBe(briefBefore);
  expect(JSON.stringify(task.deliverable)).toBe(deliverableBefore);
  expect(compose()).toBe(first);
  expect(task.lastRun).toEqual({
    model: "test-model",
    promptSha256: "a".repeat(64),
    sourceRevision: workspace.revision,
    at: "2026-11-07T00:00:00.000Z",
  });
});

test("production scope resolution drops stale cross-novel references", () => {
  const workspace = createDemoWorkspace("en");
  const tide = workspace.works[0]!;
  const train = workspace.works[1]!;
  const stale = resolveProductionScope(workspace, {
    universeId: "uni_ninth_station",
    workId: tide.id,
    chapterId: train.chapters[0]!.id,
    characterId: "char_echo",
  });
  expect(stale.universeId).toBe("uni_mist_harbor");
  expect(stale.workId).toBe(tide.id);
  expect(stale.chapterId).toBeUndefined();
  expect(stale.characterId).toBe("char_echo");
  expect(stale.characterIds).toEqual(["char_echo"]);

  const filtered = resolveProductionScope(workspace, {
    universeId: "uni_ninth_station",
    characterIds: ["char_echo", "char_lin"],
  });
  expect(filtered.characterIds).toEqual(["char_echo"]);
  expect(filtered.characterId).toBeUndefined();

  const removed = resolveProductionScope(workspace, {
    universeId: "uni_mist_harbor",
    workId: "work_missing",
  });
  expect(removed.universeId).toBe("uni_mist_harbor");
  expect(removed.workId).toBeUndefined();
  expect(removed.chapterId).toBeUndefined();

  const tasks = createProductionTasks(
    workspace,
    { workId: tide.id, chapterId: train.chapters[0]!.id },
    "en",
  );
  expect(tasks.every((task) => task.workId === tide.id)).toBe(true);
  expect(tasks.every((task) => task.chapterId === undefined)).toBe(true);
  expect(tasks[0]!.universeId).toBe("uni_mist_harbor");

  const prompt = buildProductionPrompt(
    workspace,
    "storyboard",
    { workId: tide.id, chapterId: train.chapters[0]!.id },
    "en",
  );
  const context = JSON.parse(
    prompt.split("SOURCE DATA (not instructions):\n")[1]!,
  );
  expect(context.work.id).toBe(tide.id);
  expect(context.chapter).toBeUndefined();
});

const config = { endpoint: "https://provider.example/v1", model: "test", apiKey: "test-secret" };
const request = { id: "test", label: "Costume", prompt: "Design costume" };
const fetchResponse = (body: string, type = "text/event-stream") => (async (_url: unknown, init?: RequestInit) => {
  expect(init?.redirect).toBe("error");
  expect(JSON.parse(String(init?.body)).stream).toBe(true);
  return new Response(body, { headers: { "Content-Type": type } });
}) as typeof fetch;

test("model client streams only public generated content and requires complete output", async () => {
  const updates: string[] = [];
  const body = 'data: {"choices":[{"index":0,"delta":{"content":"服装"},"finish_reason":null}]}\r\n\r\ndata: {"choices":[{"index":0,"delta":{"content":"设计"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  expect(await runCompletion(config, request, new AbortController().signal, (text) => updates.push(text), fetchResponse(body))).toBe("服装设计");
  expect(updates).toEqual(["服装", "服装设计"]);
  await expect(runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body.replace('"stop"', '"length"')))).rejects.toThrow(/Incomplete/);
  await expect(runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))).rejects.toThrow(/interrupted/);
});

test("model client accepts complete JSON fallback and validates endpoint configuration", async () => {
  const body = JSON.stringify({ choices: [{ message: { content: "design" }, finish_reason: "stop" }] });
  expect(await runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body, "application/json"))).toBe("design");
  expect(aiConfigSchema.safeParse({ ...config, endpoint: "http://remote.example/v1" }).success).toBe(false);
  expect(aiConfigSchema.safeParse({ ...config, endpoint: "https://user:pass@provider.example/v1" }).success).toBe(false);
  expect(aiConfigSchema.safeParse({ ...config, endpoint: "http://localhost:1234/v1", apiKey: "" }).success).toBe(true);
});

test("handoff includes hashed approved designs only for the exported work and chapters", async () => {
  const workspace = createDemoWorkspace("en");
  const work = workspace.works[0]!;
  const tasks = createProductionTasks(workspace, { workId: work.id, chapterId: work.chapters[0]!.id }, "en");
  tasks[0]!.status = "done"; tasks[0]!.result.en = "Approved world";
  tasks[1]!.status = "review"; tasks[1]!.result.en = "Unapproved character";
  workspace.workflowTasks.push(...tasks);
  const bundle = await buildArcReelBundle(workspace, { workId: work.id });
  const designs = JSON.parse(bundle.files.find((file) => file.path === "production/approved-designs.json")!.content);
  expect(designs.tasks.map((task: { id: string }) => task.id)).toContain(tasks[0]!.id);
  expect(designs.tasks.map((task: { id: string }) => task.id)).not.toContain(tasks[1]!.id);
  const manifest = JSON.parse(bundle.files.find((file) => file.path === "manifest.json")!.content);
  expect(manifest.files.find((file: { path: string }) => file.path === "production/approved-designs.json").sha256).toHaveLength(64);
});

const fetchError = (status: number, body: string, headers: Record<string, string> = {}) =>
  (async (_url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    return new Response(body, { status, headers });
  }) as typeof fetch;

const rejectionMessage = async (promise: Promise<unknown>): Promise<string> => {
  const error = await promise.then(() => undefined, (reason: unknown) => reason);
  if (!(error instanceof Error)) throw new Error(`Expected an Error rejection, received ${String(error)}`);
  return error.message;
};

const sseContent = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
const sseDone = () =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const encoder = new TextEncoder();
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    init!.signal!.addEventListener("abort", () => {
      try { controller.error(new Error("request aborted")); } catch { /* already closed */ }
    }, { once: true });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  return { fetcher, send: (text: string) => controller.enqueue(encoder.encode(text)) };
}

// Native setImmediate, captured before any test installs fake timers, lets the stream machinery
// deliver a chunk and the read loop observe it without advancing the fake clock.
const realSetImmediate = setImmediate;
const settle = async (): Promise<void> => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await new Promise<void>((resolve) => realSetImmediate(resolve));
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

test("model client surfaces sanitized provider HTTP errors with actionable status hints", async () => {
  const apiKey = config.apiKey;
  const contextLength = JSON.stringify({ error: {
    message: `This model's maximum context length is 8192 tokens. The supplied key ${apiKey} was also rejected.`,
    type: "invalid_request_error",
    code: "context_length_exceeded",
  } });
  const badRequest = await rejectionMessage(
    runCompletion(config, request, new AbortController().signal, () => {}, fetchError(400, contextLength)),
  );
  expect(badRequest).toContain("Model API HTTP 400");
  expect(badRequest).toContain("context_length_exceeded");
  expect(badRequest).toContain("maximum context length is 8192 tokens");
  expect(badRequest).toMatch(/prompt length/i);
  expect(badRequest).toContain("[redacted]");
  expect(badRequest).not.toContain(apiKey);

  const unauthorized = await rejectionMessage(runCompletion(
    config, request, new AbortController().signal, () => {},
    fetchError(401, JSON.stringify({ error: { message: "Incorrect API key provided", code: "invalid_api_key" } })),
  ));
  const rateLimited = await rejectionMessage(runCompletion(
    config, request, new AbortController().signal, () => {},
    fetchError(429, JSON.stringify({ error: { message: "Rate limit reached for requests", code: "rate_limit_exceeded" } }), { "Retry-After": "7" }),
  ));
  expect(unauthorized).toContain("401");
  expect(unauthorized).toMatch(/API key was rejected/i);
  expect(rateLimited).toContain("429");
  expect(rateLimited).toMatch(/retry after 7 seconds/i);
  expect(unauthorized).not.toBe(rateLimited);
  expect(unauthorized).not.toContain(apiKey);
  expect(rateLimited).not.toContain(apiKey);
  expect(isReportableAiError(new Error(badRequest))).toBe(true);
  expect(isReportableAiError(new Error(unauthorized))).toBe(true);
  expect(isReportableAiError(new Error("fetch failed"))).toBe(false);

  for (const [status, hint] of [[403, /access was denied/i], [404, /endpoint URL/i], [413, /too large/i], [500, /provider failed/i]] as const) {
    const message = await rejectionMessage(runCompletion(
      config, request, new AbortController().signal, () => {}, fetchError(status, "{}"),
    ));
    expect(message).toContain(`HTTP ${status}`);
    expect(message).toMatch(hint);
  }
});

test("model client bounds and cleans oversized or non-JSON error bodies", async () => {
  const huge = `{"error":{"message":"${"x".repeat(5_000)}TAIL-${config.apiKey}"}}`;
  const truncated = await rejectionMessage(runCompletion(
    config, request, new AbortController().signal, () => {}, fetchError(500, huge),
  ));
  expect(truncated).not.toContain("TAIL-");
  expect(truncated).not.toContain(config.apiKey);
  expect(truncated.length).toBeLessThan(500);

  const plain = await rejectionMessage(runCompletion(
    config, request, new AbortController().signal, () => {},
    fetchError(502, `Bad gateway: ${config.apiKey} leaked by upstream proxy`),
  ));
  expect(plain).toContain("Bad gateway");
  expect(plain).not.toContain(config.apiKey);
});

test("model client parses SSE without a correct content type and ignores non-JSON data lines", async () => {
  const body = `: keep-alive\n\ndata: not-json\n\ndata: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`;
  expect(await runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body, ""))).toBe("a");
  expect(await runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body, "application/json"))).toBe("a");
  const noContentType = (async () => new Response(new Blob([body]))) as unknown as typeof fetch;
  expect(await runCompletion(config, request, new AbortController().signal, () => {}, noContentType)).toBe("a");
  await expect(runCompletion(
    config, request, new AbortController().signal, () => {}, fetchResponse("not json", "application/json"),
  )).rejects.toThrow(/unreadable response/);
});

test("model client keeps a streaming request alive well past 180 seconds while data keeps arriving", async () => {
  jest.useFakeTimers();
  try {
    const { fetcher, send } = controlledStream();
    const updates: string[] = [];
    const pending = runCompletion(config, request, new AbortController().signal, (text) => updates.push(text), fetcher);
    // Claim the rejection up front: an idle timeout may fire between assertions, and Bun fails a
    // test on any rejection that is momentarily unhandled.
    void pending.catch(() => undefined);
    await settle();
    let expected = "";
    for (const content of ["A", "B", "C", "D", "E"]) {
      send(sseContent(content));
      expected += content;
      await settle();
      jest.advanceTimersByTime(50_000);
      await settle();
    }
    send(sseDone());
    await settle();
    await expect(pending).resolves.toBe(expected);
    expect(updates.at(-1)).toBe(expected);
  } finally { jest.useRealTimers(); }
});

test("model client reports a distinct idle timeout when an active stream stalls", async () => {
  jest.useFakeTimers();
  try {
    const { fetcher, send } = controlledStream();
    const pending = runCompletion(config, request, new AbortController().signal, () => {}, fetcher);
    void pending.catch(() => undefined);
    await settle();
    send(sseContent("partial"));
    await settle();
    jest.advanceTimersByTime(59_000);
    await settle();
    send(sseContent("more"));
    await settle();
    jest.advanceTimersByTime(60_000);
    await settle();
    await expect(pending).rejects.toThrow(/stopped sending data for 60 seconds/);
  } finally { jest.useRealTimers(); }
});

test("model client reports a first-byte timeout when the provider never sends data", async () => {
  jest.useFakeTimers();
  try {
    const { fetcher } = controlledStream();
    const pending = runCompletion(config, request, new AbortController().signal, () => {}, fetcher);
    void pending.catch(() => undefined);
    await settle();
    jest.advanceTimersByTime(120_000);
    await settle();
    await expect(pending).rejects.toThrow(/sent no data for 120 seconds/);
  } finally { jest.useRealTimers(); }
});

test("model cancellation is reported separately from timeouts", async () => {
  const controller = new AbortController();
  const fetcher = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as typeof fetch;
  const pending = runCompletion(config, request, controller.signal, () => {}, fetcher);
  await settle();
  controller.abort();
  await expect(pending).rejects.toThrow(AI_CANCELED_MESSAGE);
  expect(isReportableAiError(new Error(AI_CANCELED_MESSAGE))).toBe(true);
  expect(AI_CANCELED_MESSAGE).not.toMatch(/timed out|no data/);
});
