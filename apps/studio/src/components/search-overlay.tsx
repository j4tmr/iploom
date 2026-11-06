import { useEffect, useMemo, useRef, useState } from "react";
import { searchWorkspace } from "../core/search.ts";
import type { SearchHit, StudioWorkspace, UiLocale } from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { Icon } from "./icon.tsx";

const kindLabels: Record<UiLocale, Record<SearchHit["kind"], string>> = {
  "zh-CN": {
    universe: "IP 宇宙",
    work: "小说",
    chapter: "章节",
    character: "人物",
    location: "地点",
  object: "物件",
    faction: "势力",
    lore: "设定",
  timeline: "时间线",
  },
  en: {
    universe: "IP world",
    work: "Novel",
    chapter: "Chapter",
    character: "Character",
    location: "Location",
  object: "Prop",
    faction: "Faction",
    lore: "Lore",
  timeline: "Timeline",
  },
};

export function SearchOverlay({
  open,
  workspace,
  locale,
  t,
  onClose,
  onSelect,
}: {
  open: boolean;
  workspace: StudioWorkspace;
  locale: UiLocale;
  t: Translate;
  onClose: () => void;
  onSelect: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => searchWorkspace(workspace, query, locale, 36),
    [locale, query, workspace],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

  useEffect(() => setActive(0), [query]);
  if (!open) return null;

  return (
    <div
      className="search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="command-palette" role="dialog" aria-modal="true">
        <div className="command-input-row">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("search")}
            aria-label={t("searchEverywhere")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => Math.min(results.length - 1, current + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(0, current - 1));
              } else if (event.key === "Enter" && results[active]) {
                event.preventDefault();
                onSelect(results[active]!);
                onClose();
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-results">
          {!query ? (
            <div className="command-hint">
              <Icon name="sparkles" size={18} />
              <p>{t("searchHint")}</p>
            </div>
          ) : !results.length ? (
            <div className="command-hint">
              <Icon name="search" size={18} />
              <p>{t("noResults")}</p>
            </div>
          ) : (
            results.map((hit, index) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                className={`command-result ${index === active ? "active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onSelect(hit);
                  onClose();
                }}
              >
                <span className={`result-kind result-${hit.kind}`}>
                  {kindLabels[locale][hit.kind]}
                </span>
                <span className="result-copy">
                  <strong>{hit.title}</strong>
                  <small>{hit.subtitle}</small>
                  <p>{hit.excerpt}</p>
                </span>
                <Icon name="arrow" size={16} />
              </button>
            ))
          )}
        </div>
        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span>{results.length} results</span>
        </footer>
      </section>
    </div>
  );
}
