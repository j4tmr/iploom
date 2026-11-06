import type {
  LocalizedText,
  StandardKind,
  StandardRef,
  StandardStatus,
  StudioWorkspace,
  UiLocale,
  WorkspaceStandard,
} from "./types.ts";

/**
 * Foundation standards are the project's shared rules for AI work. They are
 * deliberately genre-neutral: novels, games, settings and any other text-based
 * project use the same registration, applicability and prompt injection path.
 */

export const STANDARD_KINDS: StandardKind[] = [
  "style",
  "format",
  "naming",
  "numeric",
  "entity-prompt",
  "continuity",
];

const KIND_RANK = new Map(
  STANDARD_KINDS.map((kind, index) => [kind, index] as const),
);

const KIND_LABELS: Record<StandardKind, LocalizedText> = {
  style: { zh: "语言风格", en: "Style" },
  format: { zh: "交付格式", en: "Format" },
  naming: { zh: "命名规则", en: "Naming" },
  numeric: { zh: "数值规则", en: "Numeric" },
  "entity-prompt": { zh: "实体提示词", en: "Entity prompt" },
  continuity: { zh: "连贯与正典", en: "Continuity" },
};

const STATUS_LABELS: Record<StandardStatus, LocalizedText> = {
  draft: { zh: "草稿", en: "Draft" },
  active: { zh: "生效", en: "Active" },
  disabled: { zh: "停用", en: "Disabled" },
};

export function standardKindLabel(
  kind: StandardKind,
  locale: UiLocale,
): string {
  const label = KIND_LABELS[kind] ?? { zh: kind, en: kind };
  return locale === "en" ? label.en : label.zh;
}

export function standardStatusLabel(
  status: StandardStatus,
  locale: UiLocale,
): string {
  const label = STATUS_LABELS[status] ?? { zh: status, en: status };
  return locale === "en" ? label.en : label.zh;
}

export function standardTitle(
  standard: Pick<WorkspaceStandard, "title">,
  locale: UiLocale,
): string {
  return locale === "en"
    ? standard.title.en.trim() || standard.title.zh.trim()
    : standard.title.zh.trim() || standard.title.en.trim();
}

export function standardBody(
  standard: Pick<WorkspaceStandard, "body">,
  locale: UiLocale,
): string {
  return locale === "en"
    ? standard.body.en.trim() || standard.body.zh.trim()
    : standard.body.zh.trim() || standard.body.en.trim();
}

function baseline(
  id: string,
  kind: StandardKind,
  title: LocalizedText,
  body: LocalizedText,
  now: string,
): WorkspaceStandard {
  return {
    id,
    title,
    kind,
    body,
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Deterministic project-wide rules every new workspace starts from. */
export function createBaselineStandards(now: string): WorkspaceStandard[] {
  return [
    baseline(
      "std_baseline_language",
      "style",
      { zh: "输出语言与专名一致", en: "Output language and names" },
      {
        zh: "所有产出使用项目当前语言；专有名词、角色名、地名与登记名称完全一致，首次出现的外文名保留原文并给出译名，之后只使用登记写法。不得在同一份交付物里混用语言或临时改名。",
        en: "Write every deliverable in the project language. Proper nouns, character names, places and registered terms must match the project exactly; keep the original spelling of a foreign term on first use and register one translation afterwards. Never mix languages or rename entities inside one deliverable.",
      },
      now,
    ),
    baseline(
      "std_baseline_canon",
      "continuity",
      { zh: "正典与提案分离", en: "Canon vs. proposal separation" },
      {
        zh: "已登记且被确认的内容是正典，只能引用不得改写；新想法一律标为「提案」，写清依据、影响范围与需要确认的问题。发现冲突时先报告冲突，不得静默覆盖既有设定。",
        en: "Registered, confirmed content is canon: cite it, never rewrite it. Mark every new idea as PROPOSED with its evidence, blast radius and open questions. When two facts conflict, report the conflict instead of silently overwriting established material.",
      },
      now,
    ),
    baseline(
      "std_baseline_text_source",
      "continuity",
      { zh: "文字层是唯一事实源", en: "Text is the source of truth" },
      {
        zh: "小说章节、游戏场景、设定与提示词都先以文字登记并审阅；图片、音频、视频、代码等下游产物必须从已确认的文字条目派生，并标注来源条目 ID。不得绕过文字层直接生成下游内容，也不得让下游产物反向改写文字正典。",
        en: "Novel chapters, game scenes, settings and prompts are registered and reviewed as text first. Images, audio, video, code and other downstream artifacts must derive from confirmed text entries and cite their source IDs. Never bypass the text layer to generate downstream content, and never let a downstream artifact rewrite the text canon.",
      },
      now,
    ),
    baseline(
      "std_baseline_entity_prompt",
      "entity-prompt",
      { zh: "实体提示词统一模板", en: "Unified entity prompt template" },
      {
        zh: "每个角色、地点、物件或阵营的提示词必须使用同一结构，且顺序固定：1) 身份 Identity；2) 声音 Voice；3) 外观 Appearance；4) 约束 Constraints；5) 输出骨架 Output skeleton。不得省略小节或另起格式；数值与单位引用已登记的数值规则，缺失信息标「待定」，不得编造。",
        en: "Every character, location, object or faction prompt uses the same structure in the same order: 1) Identity; 2) Voice; 3) Appearance; 4) Constraints; 5) Output skeleton. Do not omit sections or invent a different layout. Cite registered numeric rules for values and units; mark missing facts as TBD instead of inventing them.",
      },
      now,
    ),
    baseline(
      "std_baseline_numeric",
      "numeric",
      { zh: "数值记法与取整", en: "Numeric notation and rounding" },
      {
        zh: "数值必须带单位并沿用项目登记的单位制；同一量在全文使用同一精度，默认保留两位小数，百分比写作 0–100%。任何推导都要写出公式与来源，不得凭印象编造数值；无法确定时给出区间并标「待核验」。",
        en: "Always attach units and use the project's registered unit system. Keep one precision per quantity across the deliverable (two decimals by default; percentages on a 0–100 scale). Show the formula and source for any derivation; never invent a number. When uncertain, give a range and mark it NEEDS VERIFICATION.",
      },
      now,
    ),
    baseline(
      "std_baseline_format",
      "format",
      { zh: "交付物格式", en: "Deliverable format" },
      {
        zh: "交付物使用 Markdown：二级标题分节，结构化数据用表格，实体引用保留稳定 ID，结尾列出「未决问题」和「本次改动」。不要用总结代替可执行内容，也不要声称已经生成或导出了媒体文件。",
        en: "Deliverables use Markdown: H2 sections, tables for structured data, stable IDs on entity references, and a closing list of open questions and changes made. Do not replace actionable content with a summary, and never claim that media files were generated or exported.",
      },
      now,
    ),
  ];
}

function compareStandards(a: WorkspaceStandard, b: WorkspaceStandard): number {
  const rank = (KIND_RANK.get(a.kind) ?? 99) - (KIND_RANK.get(b.kind) ?? 99);
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Active standards that apply to a scope: project-wide rules plus rules scoped
 * to the selected universe. Order is stable (kind, then id) for prompt diffs.
 */
export function applicableStandards(
  workspace: Pick<StudioWorkspace, "standards">,
  universeId?: string,
): WorkspaceStandard[] {
  return workspace.standards
    .filter(
      (standard) =>
        standard.status === "active" &&
        (!standard.universeId || standard.universeId === universeId),
    )
    .slice()
    .sort(compareStandards);
}

export function standardRefsFor(
  workspace: Pick<StudioWorkspace, "standards">,
  universeId?: string,
): StandardRef[] {
  return applicableStandards(workspace, universeId).map((standard) => ({
    id: standard.id,
    version: standard.version,
  }));
}

export function standardRefLabel(ref: StandardRef): string {
  return `${ref.id} · v${ref.version}`;
}

/**
 * Deterministic Markdown block injected into composed prompts. Each applied
 * standard is identified by title, kind, id and the version it was read from.
 */
export function standardsPromptSection(
  workspace: Pick<StudioWorkspace, "standards">,
  universeId: string | undefined,
  locale: UiLocale,
): string[] {
  const standards = applicableStandards(workspace, universeId);
  if (!standards.length) return [];
  const zh = locale === "zh-CN";
  return [
    "",
    `## ${zh ? "基础规则（项目标准）" : "Foundation standards"}`,
    "",
    zh
      ? "以下规则已登记并在本项目生效，按其编号与版本执行；与任务描述冲突时先报告冲突。"
      : "These registered standards are active for this project. Apply them by id and version; report a conflict instead of silently resolving it.",
    "",
    ...standards.flatMap((standard) => [
      `- **${standardTitle(standard, locale)}** — ${standard.kind} · \`${standard.id}\` · v${standard.version}`,
      ...standardBody(standard, locale)
        .split(/\n{1,}/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `  ${line}`),
    ]),
  ];
}

export interface StandardCandidate {
  kind: StandardKind;
  title: LocalizedText;
  body: LocalizedText;
}

export const MAX_STANDARD_CANDIDATES = 12;

function premiseLines(
  workspace: Pick<StudioWorkspace, "name" | "universes" | "works">,
  locale: UiLocale,
): string[] {
  const zh = locale === "zh-CN";
  const lines: string[] = [`- ${zh ? "项目" : "Project"}: ${workspace.name}`];
  for (const universe of workspace.universes.slice(0, 8)) {
    lines.push(
      `- ${zh ? "世界" : "World"} **${standardTitle({ title: universe.name }, locale)}** (${universe.genres.join(" / ") || "—"}): ${standardBody({ body: universe.summary }, locale).slice(0, 600)}`,
    );
  }
  for (const work of workspace.works.slice(0, 8)) {
    lines.push(
      `- ${zh ? "作品" : "Work"} **${standardTitle({ title: work.title }, locale)}**: ${standardBody({ body: work.logline }, locale).slice(0, 400)} — ${work.synopsis.slice(0, 800)}`,
    );
  }
  return lines;
}

/**
 * Asks a model to propose project foundation standards from the registered
 * premise. The response is a candidate list only; nothing is saved until the
 * user reviews and registers it.
 */
export function buildStandardDraftPrompt(
  workspace: Pick<
    StudioWorkspace,
    "name" | "universes" | "works" | "standards"
  >,
  locale: UiLocale,
): string {
  const zh = locale === "zh-CN";
  const existing = workspace.standards.filter(
    (standard) => standard.status !== "disabled",
  );
  const kinds = STANDARD_KINDS.map(
    (kind) => `${kind} (${standardKindLabel(kind, locale)})`,
  ).join(", ");
  return [
    zh
      ? "# 起草项目基础规则（候选）"
      : "# Draft project foundation standards (candidates)",
    "",
    zh
      ? "你是这个项目的总编辑。请根据下面已登记的项目前提，提出可长期复用的基础规则候选。项目不限于小说：游戏场景、设定集、剧本或任何文字型项目都使用同一套规则。"
      : "You are the editor-in-chief for this project. From the registered premise below, propose durable foundation-standard candidates. The project is not limited to novels: game scenes, setting bibles, scripts and any text-based project use the same rules.",
    "",
    zh ? "## 项目前提" : "## Project premise",
    "",
    ...premiseLines(workspace, locale),
    "",
    zh ? "## 现有规则（不得重复）" : "## Existing standards (do not duplicate)",
    "",
    ...(existing.length
      ? existing.map(
          (standard) =>
            `- ${standard.kind}: ${standardTitle(standard, locale)} — ${standardBody(standard, locale).slice(0, 240)}`,
        )
      : [zh ? "- 暂无。" : "- None yet."]),
    "",
    zh ? "## 输出要求" : "## Output requirements",
    "",
    zh
      ? `只输出一个 JSON 数组，不要解释、不要 Markdown 代码块。数组包含 3 到 6 个对象，每个对象形如：{"kind":"style","title":{"zh":"…","en":"…"},"body":{"zh":"…","en":"…"}}。kind 必须是其中之一：${kinds}。`
      : `Return only a JSON array, with no explanation and no Markdown fence. It holds 3 to 6 objects shaped like: {"kind":"style","title":{"zh":"…","en":"…"},"body":{"zh":"…","en":"…"}}. kind must be one of: ${kinds}.`,
    "",
    zh
      ? "规则要可直接执行：说明必须做什么、不得做什么、冲突时如何报告，并覆盖所有体裁。至少要有一条约束实体提示词结构一致，一条约束数值与单位，一条约束文字层与下游产物的关系。标题不超过 40 字，正文不超过 600 字。不要编造项目里没有的事实。"
      : "Each rule must be directly executable: state what is required, what is forbidden, and how to report conflicts, and keep it genre-neutral. Include at least one rule fixing a consistent entity-prompt structure, one for numbers and units, and one for how text relates to downstream artifacts. Titles stay under 60 characters, bodies under 800 characters. Do not invent facts the project does not contain.",
  ].join("\n");
}

/**
 * Parses a model's candidate list defensively. Returns only well-formed,
 * deduplicated candidates; invalid items are dropped instead of guessed at.
 */
export function parseStandardCandidates(raw: string): StandardCandidate[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("AI output did not contain a standards array.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("AI output is not valid JSON; review and retry.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("AI output did not contain a standards array.");
  }
  const seen = new Set<string>();
  const candidates: StandardCandidate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const kind = record.kind;
    if (!STANDARD_KINDS.includes(kind as StandardKind)) continue;
    const title = record.title;
    const body = record.body;
    if (!title || typeof title !== "object" || !body || typeof body !== "object")
      continue;
    const localized = (value: unknown) => {
      const text = value as Record<string, unknown>;
      return {
        zh: typeof text.zh === "string" ? text.zh.trim().slice(0, 500) : "",
        en: typeof text.en === "string" ? text.en.trim().slice(0, 500) : "",
      };
    };
    const nextTitle = localized(title);
    const nextBody = {
      zh:
        typeof (body as Record<string, unknown>).zh === "string"
          ? ((body as Record<string, unknown>).zh as string)
              .trim()
              .slice(0, 20_000)
          : "",
      en:
        typeof (body as Record<string, unknown>).en === "string"
          ? ((body as Record<string, unknown>).en as string)
              .trim()
              .slice(0, 20_000)
          : "",
    };
    if ((!nextTitle.zh && !nextTitle.en) || (!nextBody.zh && !nextBody.en))
      continue;
    const key = `${kind as StandardKind}:${(nextTitle.zh || nextTitle.en).toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      kind: kind as StandardKind,
      title: nextTitle,
      body: nextBody,
    });
    if (candidates.length >= MAX_STANDARD_CANDIDATES) break;
  }
  return candidates;
}
