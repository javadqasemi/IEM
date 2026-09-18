import { useId, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/shared/ui/primitives";

export type PickableColumn = { key: string; header: string; required?: boolean };

/**
 * Which columns the reader wants to see.
 *
 * **Client-side, and the server still sends every field.** Letting the client
 * ask for a subset would make the response shape depend on the query, which
 * breaks the mapper's contract — `toApplication(dto)` has to know what it is
 * receiving. The saving would be bytes on a row that is already small; the
 * cost would be a DTO that is sometimes partial, which is a type nobody can
 * rely on. Architecture §7.2 states it as a rule.
 *
 * A `required` column cannot be hidden. That is not paternalism: a table
 * without the column that identifies a row is a table of anonymous cells, and
 * the reader who hid it has no way to tell what they are looking at.
 *
 * A `<details>` rather than a popover library. It is a disclosure, the platform
 * gives Esc and the click-outside is one listener; a floating menu here would
 * be the only one in the dashboard.
 */
export function ColumnPicker({
  columns,
  hidden,
  onChange,
  onReset,
}: {
  columns: PickableColumn[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Absent when there is nothing to restore. */
  onReset?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const shown = columns.length - hidden.size;

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        Spalten
        <span className="font-mono text-[11px] tnum text-muted">
          {shown}/{columns.length}
        </span>
      </Button>

      {open ? (
        <>
          {/*
            A full-screen button rather than a document listener: it closes on
            a click anywhere else, it is reachable by keyboard, and it needs no
            effect to clean up. Labelled, because an unlabelled button is a
            control a screen reader announces as nothing.
          */}
          <button
            type="button"
            aria-label="Spaltenauswahl schliessen"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            id={id}
            className="absolute right-0 z-40 mt-1 w-60 rounded-md bg-surface p-1 shadow-card ring-1 ring-line"
          >
            <ul className="flex flex-col">
              {columns.map((column) => {
                const visible = !hidden.has(column.key);
                return (
                  <li key={column.key}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] text-ink",
                        column.required ? "cursor-not-allowed text-muted" : "hover:bg-surface-2",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={visible}
                        disabled={column.required}
                        onChange={() => toggle(column.key)}
                        className="h-3.5 w-3.5 rounded border-line-strong text-accent focus:ring-2 focus:ring-accent disabled:cursor-not-allowed"
                      />
                      <span className="truncate">{column.header}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {onReset ? (
              <div className="border-t border-line px-2.5 pb-1 pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                  className="text-[12px] text-brand-blue transition-colors hover:text-brand-bronze"
                >
                  Standard wiederherstellen
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
