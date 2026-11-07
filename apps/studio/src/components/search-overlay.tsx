import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isComposingEvent, overlayStack } from "../core/overlay-stack.ts";
import { searchWorkspace } from "../core/search.ts";
import type { SearchHit, StudioWorkspace, UiLocale } from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { Icon } from "./icon.tsx";
import { useOverlayLayer } from "./use-overlay-layer.ts";

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
  const generatedId = useId().replaceAll(":", "");
  const listId = `${generatedId}-results`;
  const optionId = (index: number) => `${generatedId}-option-${index}`;
  const results = useMemo(
    () => searchWorkspace(workspace, query, locale, { limit: 36 }).hits,
    [locale, query, workspace],
  );

  // The palette sits on the shared overlay stack, so Escape only closes the
  // palette even when a dialog opened below it stays mounted.
  const layer = useOverlayLayer(open, {
    onEscape: onClose,
    onBackdrop: onClose,
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);
  // Hand focus back to whatever opened the palette. Without this a palette
  // opened above a dialog drops focus on <body> when it closes, and the
  // dialog's Tab trap (bound to the dialog element) can no longer see the key.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);
  // Keep the highlighted result inside the scroll viewport while the query
  // changes. `block: "nearest"` scrolls only when it has actually left it.
  // The result set is a dependency too: new results re-render the list while
  // `setActive(0)` bails at index 0, so otherwise the list keeps its old
  // scroll offset and the highlighted first result can sit out of view.
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(optionId(active))
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, results]);
  if (!open) return null;

  return (
    <div
      className="search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          overlayStack.handleBackdrop(layer);
        }
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("searchDialogLabel")}
      >
        <div className="command-input-row">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("search")}
            aria-label={t("searchEverywhere")}
            role="combobox"
            aria-expanded={Boolean(query && results.length)}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              results[active] ? optionId(active) : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter while an IME candidate window is open commits the
              // candidate; it must not also open the highlighted result.
              if (
                isComposingEvent({
                  isComposing: event.nativeEvent.isComposing,
                  keyCode: event.keyCode,
                })
              ) {
                return;
              }
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
        <div
          className="command-results"
          id={listId}
          role={query && results.length ? "listbox" : undefined}
          aria-label={query && results.length ? t("searchDialogLabel") : undefined}
        >
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
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
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
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("searchNavigate")}</span>
          <span><kbd>↵</kbd> {t("searchOpen")}</span>
          <span>{t("searchResultCount", { count: results.length })}</span>
        </footer>
      </section>
    </div>
  );
}
