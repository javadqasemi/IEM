import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { navigate } from "@/core/router";
import { search, type SearchEntry } from "../lib/navigation";

/**
 * Ctrl/Cmd + K: go anywhere you are offered, by typing (P1B).
 *
 * ---
 *
 * **Destinations only, no records.** It searches workspaces, pages, settings
 * sections and content types by name and alias. A record search would need
 * every module's row-level scope applied server-side, and a palette that
 * listed a project the reader cannot open would be a disclosure by
 * autocomplete. That is later work, and it belongs on the server.
 *
 * **It cannot see more than the rail.** `entries` is `searchIndex`, built from
 * the same `isOffered` filter as the menu; nothing here filters again or
 * differently, so there is no second rule to drift.
 *
 * **A native modal `<dialog>`,** for the same reasons `Modal` is one: the
 * platform traps focus, makes the page behind inert, and closes on Escape.
 * The input is a combobox that owns a listbox, and the highlighted option is
 * `aria-activedescendant` rather than moved focus — the caret stays in the box
 * while the arrows move the selection, which is what a screen reader expects
 * of this pattern.
 */
export function CommandPalette({
  open,
  onClose,
  entries,
  recent,
}: {
  open: boolean;
  onClose: () => void;
  entries: SearchEntry[];
  /** Shown before anything is typed. Already filtered to what is offered. */
  recent: SearchEntry[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const labelId = useId();

  const results = useMemo(
    () => (query.trim() ? search(entries, query) : recent),
    [entries, recent, query],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setIndex(0);
      el.showModal();
      // Focus after the dialog is in the top layer, or the browser moves it
      // to the first focusable element itself.
      requestAnimationFrame(() => input.current?.focus());
    }
    if (!open && el.open) el.close();
  }, [open]);

  const go = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    onClose();
    navigate(entry.to);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIndex(Math.max(0, results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[index]);
    }
  };

  const optionId = (i: number) => `${listId}-option-${i}`;
  const heading = query.trim() ? (results.length ? "Treffer" : "Keine Treffer") : "Zuletzt besucht";

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onClose={() => {
        onClose();
        returnTo.current?.focus?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="mt-[12vh] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-lg bg-surface p-0 text-ink shadow-card ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
    >
      <h2 id={labelId} className="sr-only">
        Navigation durchsuchen
      </h2>
      <div className="flex items-center gap-2 border-b border-line px-4">
        <svg
          width="15"
          height="15"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden
          className="shrink-0 text-muted"
        >
          <path d="M8 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM11.5 11.5 14.5 14.5" />
        </svg>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(index) : undefined}
          aria-label="Seite oder Bereich suchen"
          value={query}
          onChange={(e) => {
            // A new result list starts at its first row.
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Seite oder Bereich suchen …"
          autoComplete="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted sm:inline">
          Esc
        </kbd>
      </div>

      <p className="px-4 pb-1 pt-3 text-[11px] font-medium tracking-wide text-muted" aria-live="polite">
        {heading}
      </p>
      <ul id={listId} role="listbox" aria-label={heading} className="max-h-[50vh] overflow-y-auto px-2 pb-2">
        {results.map((entry, i) => (
          <li
            key={entry.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === index}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => {
              // Keep focus in the input; the click itself navigates.
              e.preventDefault();
              go(entry);
            }}
            className={cn(
              "flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-3 py-2",
              i === index ? "bg-surface-2 text-ink" : "text-ink",
            )}
          >
            <span className="min-w-0 truncate text-[14px] font-medium">{entry.label}</span>
            <span className="shrink-0 truncate text-[12px] text-muted">{entry.context}</span>
          </li>
        ))}
        {query.trim() && !results.length ? (
          <li className="px-3 py-2 text-[13px] text-muted" role="presentation">
            Nichts gefunden. Suchen Sie nach dem Namen einer Seite, z. B. „Sicherungen“ oder „Medien“.
          </li>
        ) : null}
        {!query.trim() && !results.length ? (
          <li className="px-3 py-2 text-[13px] text-muted" role="presentation">
            Tippen Sie den Namen einer Seite — auch Seiten, die das Menü nicht auflistet.
          </li>
        ) : null}
      </ul>
    </dialog>
  );
}
