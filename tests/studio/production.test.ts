import { expect, jest, test } from "bun:test";
import { createDemoWorkspace, emptyChapter } from "../../apps/studio/src/core/factory.ts";
import { validateWorkspace } from "../../apps/studio/src/core/validate.ts";
import { analyzeManuscriptChunks, buildManuscriptImport, insertChapterInOrder, manuscriptChunks, mergeManuscriptImport, parseAnalysis, planManuscriptAnalysis, splitManuscript, type ManuscriptAnalysis } from "../../apps/studio/src/core/manuscript.ts";
import { CHAPTER_LIMITS, MAX_AI_PROMPT_LENGTH } from "../../apps/studio/src/core/types.ts";
import { buildProductionPrompt, createProductionTasks, effectiveProductionTemplate, productionTemplates, resolveProductionScope, taskProductionPrompt } from "../../apps/studio/src/core/production.ts";
import { buildWorkflowBrief, setWorkflowTaskResult } from "../../apps/studio/src/core/workflow.ts";
import { AI_CANCELED_MESSAGE, aiConfigSchema, isReportableAiError, runCompletion } from "../../apps/studio/src/node/ai-client.ts";
import { buildArcReelBundle } from "../../apps/studio/src/core/arcreel.ts";

const source = "前言\r\n第1章 灯塔\r\n阿青在灯塔遇到导师白舟。\r\n第2章 归途\r\n阿青离开灯塔。\r\n";
const analysis: ManuscriptAnalysis = { world: null, characters: [
  { name: "阿青", summary: "旅人", appearance: "", evidence: "阿青" },
  { name: "白舟", summary: "导师", appearance: "", evidence: "导师白舟" },
], locations: [{ name: "灯塔", summary: "会面地点", evidence: "灯塔" }], factions: [], lore: [], relationships: [{ source: "白舟", target: "阿青", type: "mentor", mutual: false, summary: "导师", evidence: "阿青在灯塔遇到导师白舟" }], scenes: [{ title: "灯塔会面", summary: "师徒见面", location: "灯塔", characters: ["阿青", "白舟"], evidence: "阿青在灯塔遇到导师白舟" }] };

const minimalAnalysis: ManuscriptAnalysis = { world: null, characters: [{ name: "阿青", summary: "", appearance: "", evidence: "阿青" }], locations: [], factions: [], lore: [], relationships: [], scenes: [] };

test("chapter splitting preserves every source character including headings, preface and CRLF", () => {
  const chapters = splitManuscript(source);
  expect(chapters).toHaveLength(3);
  expect(chapters.map((item) => item.content).join("")).toBe(source);
  expect(manuscriptChunks(chapters, 7).map((item) => item.text).join("")).toBe(source);
  // A single top-level heading followed by a deeper one is a document title plus a
  // chapter, not two chapters. The title text stays in the first chapter's slice.
  const titled = splitManuscript("# Start\nOne\n## Scene two\nTwo");
  expect(titled).toHaveLength(1);
  expect(titled[0]!.content).toBe("# Start\nOne\n## Scene two\nTwo");
  expect(splitManuscript("Chapter I\nOne\nChapter 2\nTwo")).toHaveLength(2);
  expect(() => splitManuscript("\0binary")).toThrow();
});

test("heading recognition normalizes markdown, full-width digits and spaces without inventing prefaces", () => {
  const cases: Array<[string, string[]]> = [
    ["# 第一章 灯塔\n正文", ["第一章 灯塔"]],
    ["## Scene two\nTwo", ["Scene two"]],
    ["第１章　灯塔\n正文", ["第1章 灯塔"]],
    ["第 1 章 灯塔\n正文", ["第1章 灯塔"]],
    ["\n \n第1章 灯塔\n正文", ["第1章 灯塔"]],
    ["﻿第1章 灯塔\r\n正文", ["第1章 灯塔"]],
    ["第1章\n正文\n第二节课我们去了灯塔。", ["第1章"]],
    ["第一章 他走了。\n正文", ["正文 / Manuscript"]],
    ["序章 雪夜\n...\n楔子\n...\n尾声\n...", ["序章 雪夜", "楔子", "尾声"]],
    ["Prologue\n...\nChapter One\n...\nEpilogue\n...", ["Prologue", "Chapter One", "Epilogue"]],
    ["Chapter I\nOne\nChapter 2\nTwo", ["Chapter I", "Chapter 2"]],
  ];
  for (const [text, titles] of cases) expect(splitManuscript(text).map((chapter) => chapter.title)).toEqual(titles);
});

test("titled roman-numeral chapters split while invalid numerals stay prose", () => {
  const cases: Array<[string, string[]]> = [
    ["Chapter IV: The Storm\nOne\nChapter 2: The Flood\nTwo", ["Chapter IV The Storm", "Chapter 2 The Flood"]],
    ["Chapter XII Return Home\nOne", ["Chapter XII Return Home"]],
    ["Chapter MIX\nOne", ["Chapter MIX"]],
    ["Chapter Vv\nOne", ["正文 / Manuscript"]],
  ];
  for (const [text, titles] of cases) expect(splitManuscript(text).map((chapter) => chapter.title)).toEqual(titles);
  const text = "Chapter IV: The Storm\nOne\nChapter XII Return Home\nTwo";
  expect(splitManuscript(text).map((chapter) => chapter.content).join("")).toBe(text);
});

test("chinese chapter markers need a boundary, so ordinary prose stays prose", () => {
  const cases: Array<[string, string[]]> = [
    ["第三回合开始了\n正文", ["正文 / Manuscript"]],
    ["第一回眸一笑百媚生\n正文", ["正文 / Manuscript"]],
    ["第十回合\n正文", ["正文 / Manuscript"]],
    ["第一章 起点\n正文\n第二章：归途\n正文", ["第一章 起点", "第二章 归途"]],
    ["第一章、归途\n正文", ["第一章 归途"]],
    ["第一章，归途\n正文", ["第一章 归途"]],
    ["第一章·归途\n正文", ["第一章 归途"]],
    ["第一章-归途\n正文", ["第一章 归途"]],
    ["第一章\n正文", ["第一章"]],
  ];
  for (const [text, titles] of cases) {
    expect(splitManuscript(text).map((chapter) => chapter.title)).toEqual(titles);
  }
});

test("chinese chapter titles bounded by brackets or quotes still split", () => {
  const cases: Array<[string, string[]]> = [
    ["第一章（上）\n甲\n第二章（下）\n乙", ["第一章 (上)", "第二章 (下)"]],
    ["第一章(上)\n甲\n第二章(下)\n乙", ["第一章 (上)", "第二章 (下)"]],
    ["第一章【风起】\n甲\n第二章【云涌】\n乙", ["第一章 【风起】", "第二章 【云涌】"]],
    ["第一章「风起」\n甲\n第二章「云涌」\n乙", ["第一章 「风起」", "第二章 「云涌」"]],
    ["第一章『风起』\n甲\n第二章『云涌』\n乙", ["第一章 『风起』", "第二章 『云涌』"]],
    ["第一章《风起》\n甲\n第二章《云涌》\n乙", ["第一章 《风起》", "第二章 《云涌》"]],
    ["第一章“风起”\n甲\n第二章“云涌”\n乙", ["第一章 “风起”", "第二章 “云涌”"]],
  ];
  for (const [text, titles] of cases) {
    const chapters = splitManuscript(text);
    expect(chapters.map((chapter) => chapter.title)).toEqual(titles);
    expect(chapters.map((chapter) => chapter.content).join("")).toBe(text);
  }
});

test("markdown heading levels separate the document title from chapters", () => {
  const text = "# My Novel\n## Chapter 1\nOne\n### A scene\nStill chapter one\n## Chapter 2\nTwo";
  const chapters = splitManuscript(text);
  expect(chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
  expect(chapters.map((chapter) => chapter.content).join("")).toBe(text);

  const repeatedTopLevel = "# Chapter One\nText\n### Subscene\nMore\n# Chapter Two\nEnd";
  const split = splitManuscript(repeatedTopLevel);
  expect(split.map((chapter) => chapter.title)).toEqual(["Chapter One", "Chapter Two"]);
  expect(split.map((chapter) => chapter.content).join("")).toBe(repeatedTopLevel);

  // A lone heading level is still a chapter; the title rule needs a deeper level.
  expect(splitManuscript("# Only Chapter\nText").map((chapter) => chapter.title)).toEqual(["Only Chapter"]);
});

test("volume headings keep deeper chinese chapter headings as chapter boundaries", () => {
  const text = "# 第一卷\n## 第一章\n甲\n## 第二章\n乙\n# 第二卷\n## 第三章\n丙";
  const chapters = splitManuscript(text);
  expect(chapters.map((chapter) => chapter.title)).toEqual([
    "第一卷",
    "第一章",
    "第二章",
    "第二卷",
    "第三章",
  ]);
  expect(chapters.map((chapter) => chapter.content).join("")).toBe(text);
});

test("fenced code blocks never split chapters on heading-like comments", () => {
  const cases: Array<[string, string[]]> = [
    [
      "# My Novel\n## Chapter 1\n```bash\n# install dependencies\n# run the app\n```\n## Chapter 2\nThe end.",
      ["Chapter 1", "Chapter 2"],
    ],
    ["# One\n  ~~~~bash\n  # still code\n  ```\n  # still code too\n  ~~~~\n# Two", ["One", "Two"]],
    ["# One\n````markdown\n```bash\n# still code\n```\n````\n# Two", ["One", "Two"]],
    ["# One\n````\n```\n# still code\n# Two\n````\n# Three", ["One", "Three"]],
    ["# One\n~~~\n```\n# still code\n~~~\n# Two", ["One", "Two"]],
  ];
  for (const [text, titles] of cases) {
    const chapters = splitManuscript(text);
    expect(chapters.map((chapter) => chapter.title)).toEqual(titles);
    expect(chapters.map((chapter) => chapter.content).join("")).toBe(text);
  }
});

test("inline code that resembles a fence does not swallow later headings", () => {
  const inline = "# One\n```json``` is inline\n# Two";
  const chapters = splitManuscript(inline);
  expect(chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
  expect(chapters.map((chapter) => chapter.content).join("")).toBe(inline);

  // A real fenced block still hides heading-like lines inside it.
  const fenced = splitManuscript("# One\n```ts\n# still code\n```\n# Two");
  expect(fenced.map((chapter) => chapter.title)).toEqual(["One", "Two"]);

  // Tilde fences may contain backticks in their info string, so this one still opens.
  const tilde = splitManuscript("# One\n~~~`ts`\n# still code\n~~~\n# Two");
  expect(tilde.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
});

test("new chapters are inserted by number without renumbering the existing ones", () => {
  const chapters = [
    emptyChapter({ title: "One", number: 1 }),
    emptyChapter({ title: "Three", number: 3 }),
  ];
  insertChapterInOrder(chapters, emptyChapter({ title: "Two", number: 2 }));
  insertChapterInOrder(chapters, emptyChapter({ title: "Four", number: 4 }));
  expect(chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3, 4]);
  expect(chapters.map((chapter) => chapter.title)).toEqual([
    "One",
    "Two",
    "Three",
    "Four",
  ]);
});

test("chunks never split surrogate pairs or start or end with a lone surrogate", () => {
  const text = "a".repeat(7) + "😀".repeat(100) + "尾";
  const chunks = manuscriptChunks(splitManuscript(text), 8);
  expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
  for (const chunk of chunks) {
    const first = chunk.text.charCodeAt(0);
    const last = chunk.text.charCodeAt(chunk.text.length - 1);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  }
  const tight = "😀😀尾";
  const oneCharacterChunks = manuscriptChunks(splitManuscript(tight), 1);
  expect(oneCharacterChunks.map((chunk) => chunk.text).join("")).toBe(tight);
  for (const chunk of oneCharacterChunks) {
    const first = chunk.text.charCodeAt(0);
    const last = chunk.text.charCodeAt(chunk.text.length - 1);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  }
});

test("analysis preflight blocks over-limit runs before any request and warns about long chapters", () => {
  const blocked = planManuscriptAnalysis(splitManuscript("字".repeat(400_000)));
  expect(blocked.requestCount).toBeGreaterThan(40);
  expect(blocked.block).toContain("40");
  const warned = planManuscriptAnalysis(splitManuscript("字".repeat(100_000)));
  expect(warned.requestCount).toBeLessThanOrEqual(40);
  expect(warned.warnings).toHaveLength(1);
});

test("a 300k-character manuscript imports within schema limits", () => {
  const text = "阿青。".repeat(100_000);
  const chapters = splitManuscript(text);
  const plan = planManuscriptAnalysis(chapters);
  expect(plan.block).toBe("");
  expect(plan.requestCount).toBeLessThanOrEqual(40);
  const analyzed = plan.chunks.map((chunk) => ({ chapter: chunk.chapter, part: chunk.part, analysis: minimalAnalysis }));
  const workspace = buildManuscriptImport("长夜", chapters, analyzed, "zh-CN");
  expect(() => validateWorkspace(workspace)).not.toThrow();
  const chapter = workspace.works[0]!.chapters[0]!;
  expect(chapter.content).toBe(text);
  expect(chapter.adaptationNotes.length).toBeLessThanOrEqual(CHAPTER_LIMITS.adaptationNotes);
  expect(chapter.characterIds.length).toBeLessThanOrEqual(100);
  expect(chapter.scenes.length).toBeLessThanOrEqual(100);
});

test("import caps cast links and scenes with review notices instead of failing validation", () => {
  const chapter = splitManuscript("第1章 长\n" + "阿青。".repeat(3_000))[0]!;
  const parts = manuscriptChunks([chapter]);
  expect(parts).toHaveLength(2);
  const analysisFor = (prefix: string): ManuscriptAnalysis => ({
    world: null,
    characters: Array.from({ length: 80 }, (_, index) => ({ name: `${prefix}${index}`, summary: "", appearance: "", evidence: "阿青" })),
    locations: [], factions: [], lore: [], relationships: [],
    scenes: Array.from({ length: 60 }, (_, index) => ({ title: `${prefix}场景${index}`, summary: "", location: "", characters: [], evidence: "阿青" })),
  });
  const workspace = buildManuscriptImport("长章", [chapter], parts.map((part) => ({ chapter: 1, part: part.part, analysis: analysisFor(`P${part.part}_`) })), "zh-CN");
  const imported = workspace.works[0]!.chapters[0]!;
  expect(imported.characterIds).toHaveLength(100);
  expect(imported.scenes).toHaveLength(100);
  expect(imported.adaptationNotes.length).toBeLessThanOrEqual(CHAPTER_LIMITS.adaptationNotes);
  expect(imported.adaptationNotes).toContain("100");
  expect(workspace.characters).toHaveLength(160);
});

test("failed analysis chunk keeps completed results and retry resumes at the failed chunk", async () => {
  const chapters = splitManuscript("第1章 测试\n" + "阿青。".repeat(12_000));
  const chunks = manuscriptChunks(chapters);
  expect(chunks).toHaveLength(5);
  const calls: string[] = [];
  let failed = false;
  const analyze = async (chunk: { chapter: number; part: number }) => {
    calls.push(`${chunk.chapter}:${chunk.part}`);
    if (chunk.part === 3 && !failed) { failed = true; throw new Error("quota exceeded"); }
    return JSON.stringify(minimalAnalysis);
  };
  const first = await analyzeManuscriptChunks(chapters, analyze);
  expect(first.results.map((item) => item.part)).toEqual([1, 2]);
  expect(first.failures).toEqual([{ chapter: 1, part: 3, message: "quota exceeded" }]);
  expect(calls).toEqual(["1:1", "1:2", "1:3"]);
  const resumed = await analyzeManuscriptChunks(chapters, analyze, { previous: first.results });
  expect(resumed.results.map((item) => item.part)).toEqual([1, 2, 3, 4, 5]);
  expect(resumed.failures).toEqual([]);
  expect(calls.slice(3)).toEqual(["1:3", "1:4", "1:5"]);
  let sent = 0;
  const canceled = await analyzeManuscriptChunks(chapters, async () => { sent += 1; return JSON.stringify(minimalAnalysis); }, { shouldStop: () => sent >= 2 });
  expect(canceled.results).toHaveLength(2);
  expect(canceled.failures).toHaveLength(0);
});

test("analysis parsing accepts prose-wrapped JSON, rejects one-character evidence and clips overlong fields", () => {
  const chapters = splitManuscript(source);
  const chunk = manuscriptChunks(chapters)[1]!;
  expect(parseAnalysis("Here is the JSON:\n```json\n" + JSON.stringify(analysis) + "\n```\nDone.", chunk)).toEqual(analysis);
  const tiny = structuredClone(analysis);
  tiny.characters[0]!.evidence = "阿";
  expect(() => parseAnalysis(JSON.stringify(tiny), chunk)).toThrow(/evidence/);
  const long = structuredClone(analysis);
  long.characters[0]!.summary = "长".repeat(700);
  long.characters[0]!.name = "名".repeat(150);
  const clipped = parseAnalysis(JSON.stringify(long), chunk);
  expect([...clipped.characters[0]!.summary]).toHaveLength(500);
  expect(clipped.characters[0]!.summary.endsWith("…")).toBe(true);
  expect([...clipped.characters[0]!.name]).toHaveLength(100);
});

test("title and clipping limits count UTF-16 units so astral text still satisfies the schema", () => {
  const emoji = "😀";
  expect(splitManuscript(`# ${emoji.repeat(150)}\nOne`)[0]!.title).toBe(emoji.repeat(150));
  expect(splitManuscript(`# ${emoji.repeat(151)}\nOne`)[0]!.title).toBe("正文 / Manuscript");
  const chapters = splitManuscript(source);
  const chunk = manuscriptChunks(chapters)[1]!;
  const long = structuredClone(analysis);
  long.characters[0]!.summary = emoji.repeat(300);
  long.characters[0]!.name = `a${emoji.repeat(60)}`;
  const clipped = parseAnalysis(JSON.stringify(long), chunk);
  const summary = clipped.characters[0]!.summary;
  expect(summary.length).toBe(499);
  expect(summary.endsWith("…")).toBe(true);
  const beforeMark = summary.charCodeAt(summary.length - 2);
  expect(beforeMark >= 0xd800 && beforeMark <= 0xdbff).toBe(false);
  const kept = clipped.characters[0]!.name;
  expect(kept.length).toBe(99);
  const lastUnit = kept.charCodeAt(kept.length - 1);
  expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff).toBe(false);
});

test("unlisted relationship endpoints fail with a readable message while the reviewed JSON remains available", () => {
  const chapters = splitManuscript(source);
  const broken = structuredClone(analysis);
  broken.characters = broken.characters.filter((character) => character.name !== "白舟");
  const reviewed = JSON.stringify([{ chapter: 2, part: 1, analysis: broken }], null, 2);
  expect(reviewed).toContain("白舟");
  expect(() => buildManuscriptImport("灯塔", chapters, JSON.parse(reviewed), "zh-CN")).toThrow(/unlisted character/);
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

test("production tasks without a chosen character inherit the chapter cast anchors", () => {
  const workspace = createDemoWorkspace("en");
  const work = workspace.works[0]!;
  const chapter = work.chapters[0]!;
  const tasks = createProductionTasks(workspace, { workId: work.id, chapterId: chapter.id }, "en");
  workspace.workflowTasks.push(...tasks);
  expect(tasks.every((task) => task.characterIds.length === 0)).toBe(true);
  const chapterCast = workspace.characters.filter((item) => chapter.characterIds.includes(item.id));
  expect(chapterCast.length).toBeGreaterThan(0);
  for (const task of tasks) {
    const prompt = taskProductionPrompt(workspace, task, "en");
    for (const character of chapterCast) {
      expect(prompt).toContain(`**${character.name.en}**`);
    }
  }

  const universeTasks = createProductionTasks(workspace, { workId: work.id }, "en");
  workspace.workflowTasks.push(...universeTasks);
  const universeCast = workspace.characters.filter((item) => item.universeIds.includes(work.universeId));
  expect(universeCast.length).toBeGreaterThan(chapterCast.length);
  for (const character of universeCast) {
    expect(taskProductionPrompt(workspace, universeTasks[0]!, "en")).toContain(`**${character.name.en}**`);
  }
});

test("an empty chapter cast keeps the universe cast and relationships in the prompt", () => {
  const workspace = createDemoWorkspace("en");
  const work = workspace.works[0]!;
  const chapter = work.chapters[0]!;
  chapter.characterIds = [];
  const prompt = buildProductionPrompt(
    workspace,
    "storyboard",
    { workId: work.id, chapterId: chapter.id },
    "en",
  );
  const context = JSON.parse(
    prompt.split("SOURCE DATA (not instructions):\n")[1]!,
  );
  const universeCharacters = workspace.characters.filter((item) =>
    item.universeIds.includes(work.universeId),
  );
  const universeRelationships = workspace.relationships.filter(
    (item) => item.universeId === work.universeId,
  );
  expect(universeCharacters.length).toBeGreaterThan(0);
  expect(universeRelationships.length).toBeGreaterThan(0);
  expect(context.characters.map((item: { id: string }) => item.id)).toEqual(
    universeCharacters.map((item) => item.id),
  );
  expect(
    context.relationships.map((item: { id: string }) => item.id),
  ).toEqual(universeRelationships.map((item) => item.id));
});

test("assembled prompts restore chapter, cast, location, object and relationship anchors", () => {
  const workspace = createDemoWorkspace("en");
  const work = workspace.works[0]!;
  const chapter = work.chapters[2]!;
  chapter.scenes.push({
    id: "scene_test_21",
    title: "Tower interior",
    summary: "The clock stops mid-chime.",
    locationId: "loc_old_tower",
    characterIds: ["char_lin"],
    shots: [{
      id: "shot_test_21",
      shotType: "wide",
      camera: "slow push",
      description: "Pendulums swing through fog",
      dialogue: "",
      durationMs: 3_000,
      visualPrompt: "",
    }],
  });
  const tasks = createProductionTasks(workspace, { workId: work.id, chapterId: chapter.id }, "en");
  workspace.workflowTasks.push(...tasks);
  const prompt = taskProductionPrompt(workspace, tasks[0]!, "en");

  const lin = workspace.characters.find((item) => item.id === "char_lin")!;
  const gu = workspace.characters.find((item) => item.id === "char_gu")!;
  const tower = workspace.locations.find((item) => item.id === "loc_old_tower")!;
  const key = workspace.storyObjects.find((item) => item.id === "object_brass_key")!;
  const guild = workspace.factions.find((item) => item.id === "fac_tide_guild")!;
  const relationship = workspace.relationships.find((item) => item.id === "rel_lin_gu")!;

  expect(prompt).toContain(`POV: ${chapter.pov}`);
  expect(prompt).toContain(`Location: \`${chapter.locationId}\``);
  expect(prompt).toContain(`Adaptation notes**: ${chapter.adaptationNotes}`);
  expect(prompt).toContain("**Scenes**:");
  expect(prompt).toContain("- 1. Tower interior (`scene_test_21`): The clock stops mid-chime.");
  expect(prompt).toContain("Shot 1 (wide · slow push): Pendulums swing through fog");

  expect(prompt).toContain(`- **${lin.name.en}** (${lin.role.en}; \`char_lin\`)`);
  expect(prompt).toContain(`Look: ${lin.appearance}`);
  expect(prompt).toContain(`Personality: ${lin.personality}`);
  expect(prompt).toContain(`Voice: ${lin.voice}`);
  expect(prompt).toContain(`Secret (continuity only; never state it outright): ${lin.secret}`);
  expect(prompt).toContain(`**${tower.name.en}** (\`loc_old_tower\`)`);
  expect(prompt).toContain(`Atmosphere: ${tower.atmosphere}`);
  expect(prompt).toContain(`Visual anchor: ${tower.visualPrompt}`);
  expect(prompt).toContain(`**${key.name.en}** (\`object_brass_key\`, ${key.category.en})`);
  expect(prompt).toContain(`Visual anchor: ${key.visualPrompt}`);
  expect(prompt).toContain(`Visual motif: ${guild.visualMotif}`);
  expect(prompt).toContain(
    `${lin.name.en} → ${gu.name.en}: ${relationship.label.en} ` +
    `[${relationship.type}, ${relationship.status}, ${relationship.strength}/5, one-way] — ${relationship.notes}`,
  );
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

test("renaming a production task keeps its stage template instructions", () => {
  const workspace = createDemoWorkspace("en");
  const tasks = createProductionTasks(workspace, { workId: workspace.works[0]!.id }, "en");
  workspace.workflowTasks.push(...tasks);
  const costume = tasks[2]!;
  expect(costume.template).toBe("costume");
  const instruction = (prompt: string) =>
    prompt.split("\n").find((line) => line.startsWith("Task: "));
  const before = taskProductionPrompt(workspace, costume, "en");
  expect(instruction(before)).toBe(`Task: ${productionTemplates.costume[2]}`);

  costume.title = { zh: "人物服装 v2", en: "Costume design v2" };
  const after = taskProductionPrompt(workspace, costume, "en");
  expect(instruction(after)).toBe(instruction(before));
  expect(after).toContain("Design named costume variants");
  expect(after).not.toContain(productionTemplates.review[2]);
  expect(effectiveProductionTemplate(costume)).toBe("costume");
});

test("legacy workspaces without templates still validate and infer each stage", () => {
  const workspace = createDemoWorkspace("en");
  const tasks = createProductionTasks(workspace, { workId: workspace.works[0]!.id }, "en");
  for (const task of tasks) task.dependsOnIds = [];

  // The English title was the original signal, so it outranks copied brief text.
  tasks[2]!.title = { zh: "服装设计 v1", en: productionTemplates.costume[1] };
  tasks[2]!.brief = { zh: productionTemplates.scene[2], en: productionTemplates.scene[2] };
  tasks[2]!.kind = "character";
  // Copied brief text distinguishes stages whose kinds are identical.
  tasks[3]!.title = { zh: "场景草案", en: "Scene draft" };
  tasks[3]!.brief = { zh: productionTemplates.scene[2], en: productionTemplates.scene[2] };
  tasks[3]!.kind = "character";
  tasks[4]!.title = { zh: "分镜草案", en: "Board draft" };
  tasks[4]!.brief = { zh: productionTemplates.storyboard[2], en: productionTemplates.storyboard[2] };
  tasks[4]!.kind = "adaptation";
  tasks[5]!.title = { zh: "审查草案", en: "Review draft" };
  tasks[5]!.brief = { zh: "人工撰写的审查说明。", en: "Hand-written review notes." };
  tasks[5]!.kind = "review";
  const ambiguous = structuredClone(tasks[1]!);
  ambiguous.id = "task_ambiguous_legacy";
  ambiguous.title = { zh: "未知阶段", en: "Unknown stage" };
  ambiguous.brief = { zh: "没有阶段说明。", en: "No stage hint." };
  ambiguous.kind = "adaptation";
  delete ambiguous.template;
  for (const task of tasks) delete task.template;
  workspace.workflowTasks = [...tasks, ambiguous];
  workspace.revision = 40;
  const legacy = structuredClone(workspace) as unknown as Record<string, unknown>;
  legacy.schema_version = 6;

  const migrated = validateWorkspace(legacy);
  expect(migrated.schema_version).toBe(7);
  expect(migrated.revision).toBe(41);
  expect(migrated.workflowTasks.map((task) => task.template)).toEqual([
    "world",
    "character",
    "costume",
    "scene",
    "storyboard",
    "review",
    undefined,
  ]);
});

test("approved ancestors reach downstream prompts and unfinished outputs stay out", () => {
  const workspace = createDemoWorkspace("en");
  const work = workspace.works[0]!;
  const tasks = createProductionTasks(workspace, { workId: work.id, chapterId: work.chapters[0]!.id }, "en");
  workspace.workflowTasks.push(...tasks);
  const markers = [
    "WORLD_RESULT_21",
    "CHARACTER_RESULT_21",
    "COSTUME_RESULT_21",
    "SCENE_RESULT_21",
    "STORYBOARD_RESULT_21",
  ];
  tasks.slice(0, 5).forEach((task, index) => {
    task.status = "done";
    task.result = { zh: markers[index]!, en: markers[index]! };
  });

  const review = taskProductionPrompt(workspace, tasks[5]!, "en");
  for (const marker of markers) {
    expect(review.split(marker)).toHaveLength(2);
  }
  const order = markers.map((marker) => review.indexOf(marker));
  expect(order).toEqual([...order].sort((left, right) => left - right));
  expect(review).toContain("APPROVED DEPENDENCY OUTPUTS");
  expect(review).toContain("### Costume design");

  tasks[3]!.status = "active";
  const storyboard = taskProductionPrompt(workspace, tasks[4]!, "en");
  for (const marker of markers.slice(0, 3)) {
    expect(storyboard.split(marker)).toHaveLength(2);
  }
  expect(storyboard).not.toContain(markers[3]!);
  expect(storyboard).not.toContain(markers[4]!);

  for (const locale of ["en", "zh-CN"] as const) {
    const demo = createDemoWorkspace(locale);
    for (const demoWork of demo.works) {
      const demoTasks = createProductionTasks(demo, { workId: demoWork.id }, locale);
      demo.workflowTasks.push(...demoTasks);
      for (const task of [...demo.workflowTasks]) {
        expect(taskProductionPrompt(demo, task, locale).length).toBeLessThan(100_000);
      }
    }
  }
});

test("brief dependency wording follows blockers and only queued tasks show readiness", () => {
  const workspace = createDemoWorkspace("en");
  const chapter = workspace.workflowTasks.find((task) => task.id === "task_chapter_three")!;
  const world = workspace.workflowTasks.find((task) => task.id === "task_world_rules")!;

  const queued = buildWorkflowBrief(workspace, chapter.id, "en");
  expect(queued).toContain("1 dependency task(s) remain open");
  expect(queued).toContain("Ready to start: no");

  world.status = "done";
  chapter.status = "active";
  const active = buildWorkflowBrief(workspace, chapter.id, "en");
  expect(active).toContain("All dependencies are complete.");
  expect(active).not.toContain("remain open");
  expect(active).not.toContain("Ready to start");
});

test("assembled task prompts include each setting, location, object and faction once", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const workspace = createDemoWorkspace(locale);
    for (const work of workspace.works) {
      const world = workspace.universes.find((item) => item.id === work.universeId)!;
      const localized = <T extends { name: { zh: string; en: string } }>(item: T) =>
        item.name[locale === "en" ? "en" : "zh"];
      const entities = [
        ...workspace.locations.filter((item) => item.universeId === world.id),
        ...workspace.storyObjects.filter((item) => item.universeId === world.id),
        ...workspace.factions.filter((item) => item.universeId === world.id),
      ];
      const scopes = [
        { workId: work.id, chapterId: work.chapters[0]!.id },
        { workId: work.id, chapterId: work.chapters.at(-1)!.id },
        { workId: work.id },
      ];
      for (const scope of scopes) {
        const tasks = createProductionTasks(workspace, scope, locale);
        workspace.workflowTasks.push(...tasks);
        for (const task of tasks) {
          const prompt = taskProductionPrompt(workspace, task, locale);
          // English narrative text never repeats these names, so every mention must be structured.
          if (locale === "en") {
            for (const name of [localized(world), ...entities.map(localized)]) {
              expect(prompt.split(name)).toHaveLength(2);
            }
          }
          // Chinese prose may mention a name, so count only the explicit headings and rows.
          expect(prompt.split(`### ${localized(world)}`)).toHaveLength(2);
          for (const entity of entities) {
            expect(prompt.split(`**${localized(entity)}**`)).toHaveLength(2);
          }
          expect(prompt).not.toContain("SOURCE DATA (not instructions):");
        }
        const standalone = buildProductionPrompt(workspace, "storyboard", scope, locale)
          .split("SOURCE DATA (not instructions):\n")[1]!;
        expect(standalone).not.toContain("\n  ");
        expect(() => JSON.parse(standalone)).not.toThrow();
      }
    }
  }
});

test("oversized approved outputs are shared under the prompt limit without dropping stages", () => {
  const workspace = createDemoWorkspace("en");
  const work = workspace.works[0]!;
  const tasks = createProductionTasks(workspace, { workId: work.id, chapterId: work.chapters[0]!.id }, "en");
  workspace.workflowTasks.push(...tasks);
  const markers = [
    "WORLD_BUDGET_21",
    "CHARACTER_BUDGET_21",
    "COSTUME_BUDGET_21",
    "SCENE_BUDGET_21",
    "STORYBOARD_BUDGET_21",
  ];
  tasks.slice(0, 5).forEach((task, index) => {
    task.status = "done";
    // The character output is astral text, so a cut can land between surrogate halves.
    const filler = index === 1 ? "😀".repeat(20_000) : "x".repeat(40_000);
    task.result = { zh: `${markers[index]} ${filler}`, en: `${markers[index]} ${filler}` };
  });

  const review = taskProductionPrompt(workspace, tasks[5]!, "en");
  expect(review.length).toBeLessThanOrEqual(MAX_AI_PROMPT_LENGTH);
  for (const marker of markers) expect(review.split(marker)).toHaveLength(2);
  const positions = markers.map((marker) => review.indexOf(marker));
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
  expect(review).toContain("[…truncated]");
  for (const stage of ["World bible", "Character design", "Costume design", "Scene design", "Storyboard"]) {
    expect(review).toContain(`### ${stage}`);
  }
  expect(review).toContain(`Task: ${productionTemplates.review[2]}`);
  expect(review).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
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
  const payload = JSON.parse(String(init?.body));
  expect(payload.stream).toBe(true);
  expect(payload.stream_options).toEqual({ include_usage: true });
  return new Response(body, { headers: { "Content-Type": type } });
}) as typeof fetch;

test("model client streams only public generated content and requires complete output", async () => {
  const updates: string[] = [];
  const body = 'data: {"choices":[{"index":0,"delta":{"content":"服装"},"finish_reason":null}]}\r\n\r\ndata: {"choices":[{"index":0,"delta":{"content":"设计"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  expect((await runCompletion(config, request, new AbortController().signal, (text) => updates.push(text), fetchResponse(body))).text).toBe("服装设计");
  expect(updates).toEqual(["服装", "服装设计"]);
  await expect(runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body.replace('"stop"', '"length"')))).rejects.toThrow(/Incomplete/);
  await expect(runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))).rejects.toThrow(/interrupted/);
});

test("model client returns provider-reported usage from the stream", async () => {
  const usage = { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 };
  const body = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "design" }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ choices: [], usage })}`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  await expect(
    runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body)),
  ).resolves.toEqual({ text: "design", usage });
});

test("model client retries once without stream_options only when the provider names the parameter", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  let calls = 0;
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: {
        message: "Unrecognized request argument supplied: stream_options",
        type: "invalid_request_error",
      } }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(sseContent("retried") + sseDone(), { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;

  await expect(
    runCompletion(config, request, new AbortController().signal, () => {}, fetcher),
  ).resolves.toEqual({ text: "retried" });
  expect(bodies).toHaveLength(2);
  expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
  expect(bodies[1]!.stream_options).toBeUndefined();
  expect(bodies[1]!.messages).toEqual(bodies[0]!.messages);
  expect(bodies[1]!.model).toBe(config.model);

  let unrelatedCalls = 0;
  const unrelated = (async (_url: unknown, _init?: RequestInit) => {
    unrelatedCalls += 1;
    return new Response(JSON.stringify({ error: {
      message: "Unsupported model parameter",
      code: "invalid_request_error",
    } }), { status: 400, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const message = await rejectionMessage(
    runCompletion(config, request, new AbortController().signal, () => {}, unrelated),
  );
  expect(unrelatedCalls).toBe(1);
  expect(message).toContain("HTTP 400");
});

test("model client accepts complete JSON fallback and validates endpoint configuration", async () => {
  const body = JSON.stringify({ choices: [{ message: { content: "design" }, finish_reason: "stop" }] });
  expect((await runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body, "application/json"))).text).toBe("design");
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
  expect((await runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body, ""))).text).toBe("a");
  expect((await runCompletion(config, request, new AbortController().signal, () => {}, fetchResponse(body, "application/json"))).text).toBe("a");
  const noContentType = (async () => new Response(new Blob([body]))) as unknown as typeof fetch;
  expect((await runCompletion(config, request, new AbortController().signal, () => {}, noContentType)).text).toBe("a");
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
    await expect(pending).resolves.toEqual({ text: expected });
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
