import { countWords, displayText } from "./factory.ts";
import type {
  SearchHit,
  StudioWorkspace,
  UiLocale,
} from "./types.ts";

function clean(value: string, locale: UiLocale): string {
  void locale;
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function bilingual(value: { zh: string; en: string }): string {
  return `${value.zh} ${value.en}`.trim();
}

function excerpt(value: string, query: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const lower = compact.toLocaleLowerCase();
  const index = lower.indexOf(query.toLocaleLowerCase());
  if (index < 0) return clean(compact, "zh-CN");
  const start = Math.max(0, index - 70);
  return `${start ? "…" : ""}${compact.slice(start, start + 190)}${
    start + 190 < compact.length ? "…" : ""
  }`;
}

function score(
  fields: Array<{ value: string; weight: number }>,
  query: string,
): number {
  const needle = query.toLocaleLowerCase();
  let total = 0;
  for (const field of fields) {
    const value = field.value.toLocaleLowerCase();
    if (!value) continue;
    if (value === needle) total += field.weight * 8;
    else if (value.startsWith(needle)) total += field.weight * 5;
    else if (value.includes(needle)) total += field.weight * 2;
  }
  return total;
}

export function searchWorkspace(
  workspace: StudioWorkspace,
  query: string,
  locale: UiLocale,
  limit = 40,
): SearchHit[] {
  const needle = query.trim();
  if (!needle) return [];
  const universeNames = new Map(
    workspace.universes.map((universe) => [
      universe.id,
      displayText(universe.name, locale),
    ]),
  );
  const hits: SearchHit[] = [];

  for (const universe of workspace.universes) {
    const title = displayText(universe.name, locale);
    const summary = displayText(universe.summary, locale);
    const rank = score(
      [
        { value: bilingual(universe.name), weight: 6 },
        {
          value: `${bilingual(universe.tagline)} ${displayText(
            universe.summary,
            locale,
          )} ${universe.summary.zh} ${universe.summary.en}`,
          weight: 3,
        },
        { value: [...universe.genres, ...universe.themes].join(" "), weight: 2 },
      ],
      needle,
    );
    if (rank)
      hits.push({
        kind: "universe",
        id: universe.id,
        universeId: universe.id,
        title,
        subtitle: displayText(universe.tagline, locale),
        excerpt: excerpt(summary, needle),
        score: rank,
      });
  }

  for (const work of workspace.works) {
    const title = displayText(work.title, locale);
    const rank =
      score(
        [
          { value: bilingual(work.title), weight: 6 },
          { value: bilingual(work.logline), weight: 3 },
          { value: work.synopsis, weight: 2 },
          { value: work.themes.join(" "), weight: 2 },
        ],
        needle,
      ) +
      work.chapters.reduce(
        (sum, chapter) =>
          sum +
          score(
            [
              { value: chapter.title, weight: 3 },
              { value: chapter.titleEn, weight: 3 },
              { value: chapter.summary, weight: 2 },
              { value: chapter.content, weight: 1 },
            ],
            needle,
          ) /
            10,
        0,
      );
    if (rank)
      hits.push({
        kind: "work",
        id: work.id,
        universeId: work.universeId,
        workId: work.id,
        title,
        subtitle: universeNames.get(work.universeId) ?? "",
        excerpt: excerpt(
          `${displayText(work.logline, locale)} ${work.synopsis}`,
          needle,
        ),
        score: rank,
      });

    for (const chapter of work.chapters) {
      const rank = score(
        [
          { value: chapter.title, weight: 5 },
          { value: chapter.titleEn, weight: 5 },
          { value: chapter.summary, weight: 3 },
          { value: chapter.outline, weight: 2 },
          { value: chapter.content, weight: 1.5 },
          { value: chapter.beats.join(" "), weight: 2 },
        ],
        needle,
      );
      if (rank)
        hits.push({
          kind: "chapter",
          id: chapter.id,
          universeId: work.universeId,
          workId: work.id,
          chapterId: chapter.id,
          title: `${chapter.number}. ${chapter.title}`,
          subtitle: `${title} · ${countWords(chapter.content)} words`,
          excerpt: excerpt(
            chapter.content || chapter.summary || chapter.outline,
            needle,
          ),
          score: rank,
        });
    }
  }

  for (const character of workspace.characters) {
    const title = displayText(character.name, locale);
    const rank = score(
      [
        { value: bilingual(character.name), weight: 6 },
        { value: bilingual(character.role), weight: 3 },
        {
          value: `${bilingual(character.summary)} ${character.appearance}`,
          weight: 2,
        },
        {
          value: [
            character.appearance,
            character.personality,
            character.motivation,
            character.tags.join(" "),
          ].join(" "),
          weight: 2,
        },
      ],
      needle,
    );
    if (rank)
      hits.push({
        kind: "character",
        id: character.id,
        universeId: character.universeIds[0] ?? "",
        title,
        subtitle: displayText(character.role, locale),
        excerpt: excerpt(
          `${displayText(character.summary, locale)} ${character.tags.join(" ")}`,
          needle,
        ),
        score: rank,
      });
  }

  for (const location of workspace.locations) {
    const title = displayText(location.name, locale);
    const rank = score(
      [
        { value: bilingual(location.name), weight: 6 },
        { value: bilingual(location.summary), weight: 2 },
        { value: `${location.atmosphere} ${location.visualPrompt}`, weight: 2 },
      ],
      needle,
    );
    if (rank)
      hits.push({
        kind: "location",
        id: location.id,
        universeId: location.universeId,
        title,
        subtitle: universeNames.get(location.universeId) ?? "",
        excerpt: excerpt(
          `${location.atmosphere} ${displayText(location.summary, locale)}`,
          needle,
        ),
        score: rank,
      });
  }

  for (const faction of workspace.factions) {
    const title = displayText(faction.name, locale);
    const rank = score(
      [
        { value: bilingual(faction.name), weight: 6 },
        { value: bilingual(faction.summary), weight: 2 },
        { value: `${faction.goal} ${faction.visualMotif}`, weight: 2 },
      ],
      needle,
    );
    if (rank)
      hits.push({
        kind: "faction",
        id: faction.id,
        universeId: faction.universeId,
        title,
        subtitle: universeNames.get(faction.universeId) ?? "",
        excerpt: excerpt(
          `${faction.goal} ${displayText(faction.summary, locale)}`,
          needle,
        ),
        score: rank,
      });
  }

  for (const lore of workspace.lore) {
    const title = displayText(lore.title, locale);
    const rank = score(
      [
        { value: bilingual(lore.title), weight: 6 },
        { value: lore.body, weight: 2 },
        { value: lore.category, weight: 1 },
      ],
      needle,
    );
    if (rank)
      hits.push({
        kind: "lore",
        id: lore.id,
        universeId: lore.universeId,
        title,
        subtitle: `${universeNames.get(lore.universeId) ?? ""} · ${lore.category}`,
        excerpt: excerpt(lore.body, needle),
        score: rank,
      });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
