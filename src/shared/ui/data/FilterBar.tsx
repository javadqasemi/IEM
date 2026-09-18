import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/shared/ui/primitives";

/**
 * The row above a list: the controls, and what is currently narrowing it.
 *
 * Two jobs that are usually one component and should not be. The **controls**
 * are whatever the screen needs — a search box, a status select, a date range;
 * the **chips** are a readback of what is active, with a way to remove each
 * one. Lists where the second is missing are lists where somebody eventually
 * asks why there are no results, and the answer is a filter three screens ago.
 *
 * `useFilterChips` derives the chips from the filter object, so a screen cannot
 * forget to add one when it adds a control — the chip list is a function of the
 * state, not a second thing to maintain.
 */

export type FilterChip = {
  /** The filter key, so `onClear` knows what to unset. */
  id: string;
  label: string;
  value: string;
};

export function FilterBar({
  children,
  chips = [],
  onClear,
  onClearAll,
  total,
  className,
}: {
  /** The controls. Laid out by the caller — they differ per screen. */
  children: ReactNode;
  chips?: FilterChip[];
  onClear?: (id: string) => void;
  onClearAll?: () => void;
  /** Shown beside the chips: the point of filtering is the number. */
  total?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end gap-3">{children}</div>

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            `aria-live="polite"`, because the count is the answer to the action
            the reader just took and nothing else announces it. `polite` rather
            than `assertive`: it should not interrupt them mid-word while they
            are still typing in the search box.
          */}
          {total !== undefined ? (
            <span className="eyebrow text-muted" aria-live="polite">
              {total} {total === 1 ? "Treffer" : "Treffer"}
            </span>
          ) : null}

          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3 pr-1.5 text-[12px] text-ink ring-1 ring-line"
            >
              <span className="text-muted">{chip.label}:</span>
              <span className="font-medium">{chip.value}</span>
              {onClear ? (
                <button
                  type="button"
                  onClick={() => onClear(chip.id)}
                  aria-label={`Filter „${chip.label}“ entfernen`}
                  className="grid h-4 w-4 place-items-center rounded-full text-muted transition-colors hover:bg-line hover:text-ink"
                >
                  <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M4 4 L12 12 M12 4 L4 12" />
                  </svg>
                </button>
              ) : null}
            </span>
          ))}

          {onClearAll && chips.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={onClearAll}>
              Alle zurücksetzen
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Turns a filter object into chips, dropping anything unset.
 *
 * `labels` names the fields and `format` renders a value that is not its own
 * label — a status key becomes "In Prüfung", an id becomes a customer's name.
 * Both are the screen's knowledge, which is why they are arguments rather than
 * something this file tries to infer.
 */
export function buildFilterChips<T extends Record<string, unknown>>(
  filters: T,
  labels: Partial<Record<keyof T & string, string>>,
  format?: Partial<Record<keyof T & string, (value: unknown) => string>>,
): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const [id, raw] of Object.entries(filters)) {
    // `0` and `false` are real filter values and must survive; `""`, `null`,
    // `undefined` and an empty array are "not filtering".
    if (raw === "" || raw === null || raw === undefined) continue;
    if (Array.isArray(raw) && raw.length === 0) continue;

    const label = labels[id as keyof T & string] ?? id;
    const value = format?.[id as keyof T & string]?.(raw) ?? String(raw);
    if (!value) continue;
    chips.push({ id, label, value });
  }
  return chips;
}
