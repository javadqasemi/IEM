import { useEffect, useId, useMemo, useRef, useState } from "react";
import { groupResults, projectId, searchSite, type SearchResult } from "@/lib/search";

/**
 * Thumbnail for the kinds that carry one. Text-only kinds render nothing, and
 * because each group is a single kind the rows in a group stay flush with each
 * other rather than alternating indent.
 *
 * Portraits get `object-top`: a face sits in the upper third, and centring a
 * 3:4 portrait in a square box crops foreheads.
 */
function Thumb({ result }: { result: SearchResult }) {
  if (result.image === undefined) return null;

  if (result.image === null) {
    return (
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-navy/[0.07] font-display text-[13px] font-semibold text-brand-navy/45"
      >
        {result.fallback}
      </span>
    );
  }

  return (
    <img
      src={result.image}
      alt=""
      loading="lazy"
      decoding="async"
      className={`h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-line ${
        result.imageAspect === "portrait" ? "object-top" : ""
      }`}
    />
  );
}

/**
 * Selecting a result has to reach a component the header does not own — the
 * project dialog lives in `ProjectRegister`, the team filter in `TeamGrid`.
 * These two events are the seam. A custom event keeps both sides ignorant of
 * each other and costs nothing; a store or a lifted `App` state would put
 * page-wide plumbing in place for one interaction.
 */
export const OPEN_PROJECT = "iem:open-project";
export const FILTER_TEAM = "iem:filter-team";

function select(result: SearchResult) {
  if (result.project) {
    window.dispatchEvent(
      new CustomEvent(OPEN_PROJECT, { detail: { id: projectId(result.project) } }),
    );
  }
  if (result.member) {
    window.dispatchEvent(new CustomEvent(FILTER_TEAM, { detail: { name: result.member.name } }));
  }
  // Assigning the hash rather than pushing history: these are same-page
  // anchors, and `scroll-padding-top` in globals.css keeps them clear of the
  // fixed header.
  window.location.hash = result.href;
}

export function SiteSearch({
  className = "",
  autoFocus = false,
  onNavigate,
}: {
  className?: string;
  autoFocus?: boolean;
  /** Lets the mobile menu close itself once a result is chosen. */
  onNavigate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const results = useMemo(() => searchSite(query), [query]);
  const grouped = useMemo(() => groupResults(results), [results]);

  // The cursor indexes `results`, so it has to come back in range whenever the
  // query changes — otherwise Enter fires on a result that is no longer shown.
  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const showPanel = open && query.trim().length > 0;

  function commit(result: SearchResult) {
    select(result);
    setOpen(false);
    setQuery("");
    onNavigate?.();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else setOpen(false);
      return;
    }
    if (!showPanel || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(results[cursor]);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
      </svg>

      <input
        type="search"
        role="combobox"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Suchen"
        aria-label="Website durchsuchen"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showPanel && results.length ? `${listId}-${cursor}` : undefined
        }
        className="w-full rounded-full bg-surface py-2 pl-9 pr-9 text-[13px] text-ink ring-1 ring-line transition-colors placeholder:text-muted hover:ring-line-strong [&::-webkit-search-cancel-button]:appearance-none"
      />

      {query ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label="Suche zurücksetzen"
          className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="M4 4 L12 12 M12 4 L4 12" />
          </svg>
        </button>
      ) : null}

      {showPanel ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,26rem)] overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-line">
          {results.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-muted">
              Nichts gefunden für „{query.trim()}“.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Suchergebnisse" className="max-h-[70vh] overflow-y-auto py-1.5">
              {grouped.map((group) => (
                <li key={group.kind}>
                  <p className="eyebrow px-4 pb-1 pt-3 text-muted">{group.kind}</p>
                  <ul>
                    {group.items.map((item) => {
                      const index = results.indexOf(item);
                      return (
                        <li key={item.id}>
                          <button
                            id={`${listId}-${index}`}
                            type="button"
                            role="option"
                            aria-selected={index === cursor}
                            onMouseEnter={() => setCursor(index)}
                            onClick={() => commit(item)}
                            className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                              index === cursor ? "bg-surface-2" : ""
                            }`}
                          >
                            <Thumb result={item} />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate text-[14px] font-medium leading-tight text-ink">
                                {item.title}
                              </span>
                              {item.detail ? (
                                <span className="truncate text-[12px] leading-snug text-muted">
                                  {item.detail}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
