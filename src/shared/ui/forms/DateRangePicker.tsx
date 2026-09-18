import { useId } from "react";
import { cn } from "@/shared/utils/cn";
import { DateInput } from "./DatePicker";

/**
 * Two dates that belong together, plus the four ranges people actually ask for.
 *
 * The presets are not decoration. Every screen that filters by date — the audit
 * log, time entries, invoices, a project's activity — is asked the same four
 * questions, and a reader who has to open two calendars to answer "this month"
 * mostly does not bother. They are computed rather than stored, so they follow
 * the clock and never go stale.
 *
 * **The constraint is enforced in the control, not by a validator.** `from`
 * caps the second field's `min` and `to` caps the first field's `max`, so an
 * inverted range cannot be entered at all. A range that would return nothing is
 * a filter that looks broken, and explaining it afterwards is worse than not
 * offering it.
 */

export type DateRange = { from: string; to: string };

export const EMPTY_RANGE: DateRange = { from: "", to: "" };

/** ISO `yyyy-mm-dd`, in the machine's own timezone rather than UTC. */
function iso(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * The presets, computed on every render.
 *
 * Dates are *local*: `toISOString()` alone would return the previous day for
 * anyone east of Greenwich after midnight UTC, which in Switzerland means every
 * evening between 01:00 and 02:00 CET. That is the class of bug a "last 30
 * days" filter hides for months.
 */
export function rangePresets(now: Date = new Date()): { id: string; label: string; range: DateRange }[] {
  const today = iso(now);
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return iso(d);
  };
  const startOfMonth = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const startOfYear = iso(new Date(now.getFullYear(), 0, 1));

  return [
    { id: "7", label: "7 Tage", range: { from: daysAgo(6), to: today } },
    { id: "30", label: "30 Tage", range: { from: daysAgo(29), to: today } },
    { id: "month", label: "Dieser Monat", range: { from: startOfMonth, to: today } },
    { id: "year", label: "Dieses Jahr", range: { from: startOfYear, to: today } },
  ];
}

export function DateRangePicker({
  value,
  onChange,
  label = "Zeitraum",
  presets = true,
  disabled,
  className,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  label?: string;
  presets?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const fromId = useId();
  const toId = useId();
  const options = rangePresets();
  const active = options.find((p) => p.range.from === value.from && p.range.to === value.to);

  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
      {/* A `<fieldset>` and a `<legend>`, because the two inputs are one
          question — a screen reader otherwise announces "von" and "bis" with
          nothing saying what they are a range *of*. */}
      <legend className="field-label">{label}</legend>

      <div className="flex flex-wrap items-center gap-2">
        <DateInput
          id={fromId}
          aria-label={`${label} von`}
          value={value.from}
          max={value.to || undefined}
          disabled={disabled}
          onChange={(from) => onChange({ ...value, from })}
          className="w-auto"
        />
        <span aria-hidden className="text-muted">
          –
        </span>
        <DateInput
          id={toId}
          aria-label={`${label} bis`}
          value={value.to}
          min={value.from || undefined}
          disabled={disabled}
          onChange={(to) => onChange({ ...value, to })}
          className="w-auto"
        />
        {value.from || value.to ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_RANGE)}
            disabled={disabled}
            className="text-[13px] text-brand-blue transition-colors hover:text-brand-bronze"
          >
            Zurücksetzen
          </button>
        ) : null}
      </div>

      {presets ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              aria-pressed={active?.id === preset.id}
              onClick={() => onChange(preset.range)}
              className={cn(
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                active?.id === preset.id
                  ? "bg-ink text-inverse"
                  : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
