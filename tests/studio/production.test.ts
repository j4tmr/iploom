import { expect, test } from "bun:test";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { buildManuscriptImport, manuscriptChunks, mergeManuscriptImport, parseAnalysis, splitManuscript, type ManuscriptAnalysis } from "../../apps/studio/src/core/manuscript.ts";
import { buildProductionPrompt, createProductionTasks, taskProductionPrompt } from "../../apps/studio/src/core/production.ts";
import { aiConfigSchema, runCompletion } from "../../apps/studio/src/node/ai-client.ts";
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

test("model cancellation is propagated to the request", async () => {
  const controller = new AbortController();
  const fetcher = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    expect(init?.signal).toBe(controller.signal);
    init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as typeof fetch;
  const pending = runCompletion(config, request, controller.signal, () => {}, fetcher);
  controller.abort();
  await expect(pending).rejects.toThrow("aborted");
});
