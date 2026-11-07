import { describe, expect, test } from "bun:test";
import {
  countChapterWords,
  createDemoWorkspace,
  workWords,
  workspaceStats,
} from "../../apps/studio/src/core/factory.ts";
import { wordCount } from "../../apps/studio/src/core/word-count.ts";

const NOW = "2026-11-07T00:00:00.000Z";

describe("chapter word count cache", () => {
  test("reuses counts and notices content edits without a revision bump", () => {
    const chapter = {
      id: "chapter_word_cache_direct",
      revision: 4,
      content: "林舟 ab",
    };
    expect(countChapterWords(chapter)).toBe(3);

    // Same length and revision, different content: the cache must still
    // recompute instead of trusting the id.
    chapter.content = "林舟a b";
    expect(countChapterWords(chapter)).toBe(4);
    expect(wordCount(chapter.content)).toBe(4);
  });

  test("only recomputes the edited chapter of a work", () => {
    const workspace = createDemoWorkspace("zh-CN", NOW);
    const work = workspace.works[0]!;
    const before = workWords(work);

    // A keystroke replaces the workspace with a structured clone and bumps
    // the edited chapter's revision, exactly like `changeChapter` does.
    const next = structuredClone(workspace);
    const nextWork = next.works[0]!;
    const edited = nextWork.chapters[0]!;
    edited.content += "雨";
    edited.revision += 1;

    expect(workWords(nextWork)).toBe(before + 1);
  });

  test("a 300-chapter manuscript stays well under a frame budget per keystroke", () => {
    const chapterCount = 300;
    const chapterLength = 5_000;
    const sentence = "林舟走进钟楼，雨落在旧城的石阶上。";
    const prose = sentence
      .repeat(Math.ceil(chapterLength / sentence.length))
      .slice(0, chapterLength);

    const workspace = createDemoWorkspace("zh-CN", NOW);
    const work = workspace.works[0]!;
    const template = work.chapters[0]!;
    work.chapters = Array.from({ length: chapterCount }, (_, index) => ({
      ...structuredClone(template),
      id: `chapter_perf_${index + 1}`,
      number: index + 1,
      title: `性能章节 ${index + 1}`,
      content: prose,
      revision: 1,
    }));

    // 300 chapters x 5,000 characters = 1.5M characters, about 1.3M words.
    expect(workspaceStats(workspace).words).toBeGreaterThan(1_000_000);

    // Warm the cache the way the first render does.
    const baseline = workWords(work);

    const next = structuredClone(workspace);
    const nextWork = next.works[0]!;
    const edited = nextWork.chapters[chapterCount - 1]!;
    edited.content += "雨";
    edited.revision += 1;

    const started = performance.now();
    // What one keystroke renders: the status bar, sidebar and work header all
    // ask for the work total, and the chapter list asks for every chapter.
    let total = 0;
    for (let pass = 0; pass < 3; pass += 1) total = workWords(nextWork);
    for (const chapter of nextWork.chapters) countChapterWords(chapter);
    const elapsed = performance.now() - started;

    expect(total).toBe(baseline + 1);
    expect(elapsed).toBeLessThan(16);
  });
});
