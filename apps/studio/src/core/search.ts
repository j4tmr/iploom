import { countWords, displayText } from "./factory.ts";
import { timelineAnchorLabel } from "./timeline.ts";
import type {
  LocalizedText,
  SearchHit,
  StudioWorkspace,
  UiLocale,
} from "./types.ts";

interface Field {
  value: string;
  weight: number;
}

/**
 * NFKC folds full-width letters, digits and spaces onto their ASCII forms, so
 * `Ｌｉｎ` reaches the same field text as `lin`. Collapsing whitespace makes
 * `lin  zhou` split into the same terms as `lin zhou`, and case folding keeps
 * the tiers case-insensitive.
 */
function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

/**
 * Chinese and English are separate fields so each language can reach the exact
 * and prefix tiers on its own; a combined `zh en` string could only ever match
 * it as a substring.
 */
function localized(value: LocalizedText, weight: number): Field[] {
  return [
    { value: normalize(value.zh), weight },
    { value: normalize(value.en), weight },
  ];
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query);
  return normalized ? normalized.split(" ") : [];
}

function firstMatch(haystack: string, terms: string[]): number {
  let index = -1;
  for (const term of terms) {
    const found = haystack.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  return index;
}

function excerpt(value: string, terms: string[]): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  // Case folding alone locates the term in the original text, which keeps the
  // excerpt readable. Only a query that needs NFKC (e.g. `Ｌｉｎ`) falls back to
  // the normalized string; NFKC is length-preserving for full-width forms.
  let index = firstMatch(compact.toLocaleLowerCase(), terms);
  if (index < 0) index = firstMatch(normalize(compact), terms);
  if (index < 0) return clean(compact);
  const start = Math.max(0, index - 70);
  return `${start ? "…" : ""}${compact.slice(start, start + 190)}${
    start + 190 < compact.length ? "…" : ""
  }`;
}

function tier(value: string, needle: string): number {
  if (value === needle) return 8;
  if (value.startsWith(needle)) return 5;
  if (value.includes(needle)) return 2;
  return 0;
}

/**
 * The whole query is scored as a phrase, so a multi-word value such as the
 * English name `Lin Zhou` still reaches the exact tier. Each term then
 * scores on its own as well, letting a multi-word query span entities: `林舟 钟楼`
 * matches the character and the tower even though no single record contains
 * both. A field takes the stronger of the two so one match is never double
 * counted.
 */
function score(fields: Field[], terms: string[]): number {
  const phrase = terms.join(" ");
  let total = 0;
  for (const field of fields) {
    if (!field.value) continue;
    let best = tier(field.value, phrase);
    if (terms.length > 1) {
      let termScore = 0;
      for (const term of terms) termScore += tier(field.value, term);
      if (termScore > best) best = termScore;
    }
    total += best * field.weight;
  }
  return total;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** Keep only hits inside this story world. Characters match any membership. */
  universeId?: string;
  kind?: SearchHit["kind"];
}

export interface SearchResults {
  hits: SearchHit[];
  /** Number of in-scope hits before the offset/limit window is applied. */
  total: number;
  /** True when hits exist after the returned window. */
  truncated: boolean;
}

/**
 * A total order, not just a score: paginating a ties-only score would let the
 * same record land on two pages (or none) when the sort order shifts.
 */
function compareHits(a: SearchHit, b: SearchHit): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The scope filters run while hits are collected, before the ranking window,
 * so a hit from another world or kind can never crowd an in-scope hit out of
 * the first page.
 */
export function searchWorkspace(
  workspace: StudioWorkspace,
  query: string,
  locale: UiLocale,
  options: SearchOptions = {},
): SearchResults {
  const terms = queryTerms(query);
  const hits: SearchHit[] = [];
  const inScope = (hit: SearchHit): boolean => {
    if (options.kind && hit.kind !== options.kind) return false;
    if (options.universeId) {
      const universes = hit.universeIds ?? [hit.universeId];
      if (!universes.includes(options.universeId)) return false;
    }
    return true;
  };
  const add = (hit: SearchHit): void => {
    if (inScope(hit)) hits.push(hit);
  };
  if (!terms.length) return { hits, total: 0, truncated: false };
  const universeNames = new Map(
    workspace.universes.map((universe) => [
      universe.id,
      displayText(universe.name, locale),
    ]),
  );

  for (const universe of workspace.universes) {
    const title = displayText(universe.name, locale);
    const summary = displayText(universe.summary, locale);
    const rank = score(
      [
        ...localized(universe.name, 6),
        ...localized(universe.tagline, 3),
        ...localized(universe.summary, 3),
        {
          value: normalize([...universe.genres, ...universe.themes].join(" ")),
          weight: 2,
        },
      ],
      terms,
    );
    if (rank)
      add({
        kind: "universe",
        id: universe.id,
        universeId: universe.id,
        title,
        subtitle: displayText(universe.tagline, locale),
        excerpt: excerpt(summary, terms),
        score: rank,
      });
  }

  for (const work of workspace.works) {
    const title = displayText(work.title, locale);
    const rank =
      score(
        [
          ...localized(work.title, 6),
          ...localized(work.logline, 3),
          { value: normalize(work.synopsis), weight: 2 },
          { value: normalize(work.themes.join(" ")), weight: 2 },
        ],
        terms,
      ) +
      work.chapters.reduce(
        (sum, chapter) =>
          sum +
          score(
            [
              { value: normalize(chapter.title), weight: 3 },
              { value: normalize(chapter.titleEn), weight: 3 },
              { value: normalize(chapter.summary), weight: 2 },
              { value: normalize(chapter.content), weight: 1 },
            ],
            terms,
          ) /
            10,
        0,
      );
    if (rank)
      add({
        kind: "work",
        id: work.id,
        universeId: work.universeId,
        workId: work.id,
        title,
        subtitle: universeNames.get(work.universeId) ?? "",
        excerpt: excerpt(
          `${displayText(work.logline, locale)} ${work.synopsis}`,
          terms,
        ),
        score: rank,
      });

    for (const chapter of work.chapters) {
      const rank = score(
        [
          { value: normalize(chapter.title), weight: 5 },
          { value: normalize(chapter.titleEn), weight: 5 },
          { value: normalize(chapter.summary), weight: 3 },
          { value: normalize(chapter.outline), weight: 2 },
          { value: normalize(chapter.content), weight: 1.5 },
          { value: normalize(chapter.beats.join(" ")), weight: 2 },
        ],
        terms,
      );
      if (rank)
        add({
          kind: "chapter",
          id: chapter.id,
          universeId: work.universeId,
          workId: work.id,
          chapterId: chapter.id,
          title: `${chapter.number}. ${chapter.title}`,
          subtitle: `${title} · ${countWords(chapter.content)} words`,
          excerpt: excerpt(
            chapter.content || chapter.summary || chapter.outline,
            terms,
          ),
          score: rank,
        });
    }
  }

  for (const character of workspace.characters) {
    const title = displayText(character.name, locale);
    const rank = score(
      [
        ...localized(character.name, 6),
        ...localized(character.role, 3),
        ...localized(character.summary, 2),
        { value: normalize(character.appearance), weight: 2 },
        {
          value: normalize(
            [
              character.personality,
              character.motivation,
              character.tags.join(" "),
            ].join(" "),
          ),
          weight: 2,
        },
      ],
      terms,
    );
    if (rank)
      add({
        kind: "character",
        id: character.id,
        universeId: character.universeIds[0] ?? "",
        universeIds: [...character.universeIds],
        title,
        subtitle: displayText(character.role, locale),
        excerpt: excerpt(
          `${displayText(character.summary, locale)} ${character.tags.join(" ")}`,
          terms,
        ),
        score: rank,
      });
  }

  for (const location of workspace.locations) {
    const title = displayText(location.name, locale);
    const rank = score(
      [
        ...localized(location.name, 6),
        ...localized(location.summary, 2),
        {
          value: normalize(`${location.atmosphere} ${location.visualPrompt}`),
          weight: 2,
        },
      ],
      terms,
    );
    if (rank)
      add({
        kind: "location",
        id: location.id,
        universeId: location.universeId,
        title,
        subtitle: universeNames.get(location.universeId) ?? "",
        excerpt: excerpt(
          `${location.atmosphere} ${displayText(location.summary, locale)}`,
          terms,
        ),
        score: rank,
      });
  }

  for (const faction of workspace.factions) {
    const title = displayText(faction.name, locale);
    const rank = score(
      [
        ...localized(faction.name, 6),
        ...localized(faction.summary, 2),
        {
          value: normalize(`${faction.goal} ${faction.visualMotif}`),
          weight: 2,
        },
      ],
      terms,
    );
    if (rank)
      add({
        kind: "faction",
        id: faction.id,
        universeId: faction.universeId,
        title,
        subtitle: universeNames.get(faction.universeId) ?? "",
        excerpt: excerpt(
          `${faction.goal} ${displayText(faction.summary, locale)}`,
          terms,
        ),
        score: rank,
      });
  }

  for (const lore of workspace.lore) {
    const title = displayText(lore.title, locale);
    const rank = score(
      [
        ...localized(lore.title, 6),
        { value: normalize(lore.body), weight: 2 },
        { value: normalize(lore.category), weight: 1 },
      ],
      terms,
    );
    if (rank)
      add({
        kind: "lore",
        id: lore.id,
        universeId: lore.universeId,
        title,
        subtitle: `${universeNames.get(lore.universeId) ?? ""} · ${lore.category}`,
        excerpt: excerpt(lore.body, terms),
        score: rank,
      });
  }

  for (const object of workspace.storyObjects) {
    const title = displayText(object.name, locale);
    const rank = score(
      [
        ...localized(object.name, 6),
        ...localized(object.summary, 3),
        {
          value: normalize(`${object.visualPrompt} ${object.sourceNotes}`),
          weight: 2,
        },
      ],
      terms,
    );
    if (rank)
      add({
        kind: "object",
        id: object.id,
        universeId: object.universeId,
        title,
        subtitle: `${universeNames.get(object.universeId) ?? ""} · ${displayText(object.category, locale)}`,
        excerpt: excerpt(
          `${displayText(object.summary, locale)} ${object.sourceNotes}`,
          terms,
        ),
        score: rank,
      });
  }

  for (const event of workspace.timelineEvents) {
    const title = displayText(event.title, locale);
    const rank = score(
      [
        ...localized(event.title, 6),
        {
          value: normalize(
            `${event.storyTime} ${event.stateBefore} ${event.stateAfter}`,
          ),
          weight: 3,
        },
        {
          value: normalize(`${event.evidence} ${event.productionPrompt}`),
          weight: 2,
        },
      ],
      terms,
    );
    if (rank)
      add({
        kind: "timeline",
        id: event.id,
        universeId: event.universeId,
        workId: event.workId,
        chapterId: event.chapterId,
        title,
        subtitle: `${universeNames.get(event.universeId) ?? ""} · ${timelineAnchorLabel(workspace, event, locale)}`,
        excerpt: excerpt(
          `${event.stateBefore} → ${event.stateAfter} ${event.evidence}`,
          terms,
        ),
        score: rank,
      });
  }

  const limit = Math.max(0, Math.trunc(options.limit ?? 40));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  hits.sort(compareHits);
  const page = hits.slice(offset, offset + limit);
  return {
    hits: page,
    total: hits.length,
    truncated: offset + page.length < hits.length,
  };
}
