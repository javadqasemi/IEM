import type { ReactNode } from "react";
import { Button } from "@/shared/ui/primitives";

/**
 * What can be done to the rows that are selected.
 *
 * It appears only when something is selected, and it says **how many** before
 * it says anything else. That order is deliberate: a bulk action is the one
 * place in a dashboard where a misread turns a click into forty changes, and
 * the count is the thing that stops it.
 *
 * `aria-live="polite"` on the count, because the number is the consequence of
 * the checkbox the reader just ticked and nothing else announces it.
 *
 * It does not float. A sticky bar over the last row hides a row, and the row
 * it hides is the one somebody is about to tick.
 */
export function BulkBar({
  count,
  onClear,
  children,
  noun = "Einträge",
}: {
  count: number;
  onClear: () => void;
  /** The actions. Buttons, and a destructive one carries `variant="danger"`. */
  children: ReactNode;
  /** Plural. "12 Bewerbungen ausgewählt". */
  noun?: string;
}) {
  if (!count) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-accent/[0.06] px-4 py-2.5 ring-1 ring-accent/20">
      <span className="text-[13px] font-medium text-ink" aria-live="polite">
        {count} {noun} ausgewählt
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto">
        Auswahl aufheben
      </Button>
    </div>
  );
}
