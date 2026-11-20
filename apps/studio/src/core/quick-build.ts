import { applyConstruct } from "./cards.ts";
import { createId, emptyChapter, localized } from "./factory.ts";
import type {
  StoryWork,
  StudioWorkspace,
  UiLocale,
  WorkKind,
} from "./types.ts";

/** The built-in pack a game quick build stamps as that work's node board. */
export const GAME_CONSTRUCT_ID = "looter";

/**
 * Create a work of one kind inside a world, ready to work in.
 *
 * A novel starts with its first empty chapter, so "开始写小说" lands in the
 * manuscript instead of an empty shell. A game starts with its own node pack
 * (scoped to the work, not shared with the world), so "做游戏" lands on a node
 * board with the starter types and sample cards already in place.
 *
 * Runs inside the caller's draft mutation and returns the created work, or
 * throws when the change cannot be completed so the whole edit is rejected
 * instead of leaving a half-built work behind.
 */
export function quickBuildWork(
  draft: StudioWorkspace,
  universeId: string,
  kind: WorkKind,
  locale: UiLocale,
  now = new Date().toISOString(),
): StoryWork {
  if (!draft.universes.some((universe) => universe.id === universeId))
    throw new Error("unknown world");
  const work: StoryWork = {
    id: createId("work"),
    universeId,
    kind,
    title:
      kind === "game"
        ? localized("未命名游戏", "Untitled game")
        : localized("未命名小说", "Untitled novel"),
    logline: localized("", ""),
    synopsis: "",
    status: "concept",
    language: locale,
    genre: "",
    themes: [],
    targetWords: kind === "novel" ? 120_000 : 20_000,
    coverColor: kind === "game" ? "#6f5a2f" : "#2f7567",
    chapters:
      kind === "novel"
        ? [
            emptyChapter({
              title: locale === "en" ? "Chapter 1" : "第一章",
              number: 1,
              status: "outline",
              now,
            }),
          ]
        : [],
    createdAt: now,
    updatedAt: now,
  };
  draft.works.push(work);
  draft.lastOpenedWorkId = work.id;
  if (kind === "game") {
    const applied = applyConstruct(
      draft,
      GAME_CONSTRUCT_ID,
      universeId,
      now,
      work.id,
    );
    if (applied.status !== "applied")
      throw new Error(`node pack was not applied: ${applied.status}`);
  }
  return work;
}

/** Works of a world, optionally narrowed to one kind. */
export function worksOfKind(
  workspace: Pick<StudioWorkspace, "works">,
  universeId: string,
  kind?: WorkKind,
): StoryWork[] {
  return workspace.works.filter(
    (work) => work.universeId === universeId && (!kind || work.kind === kind),
  );
}
