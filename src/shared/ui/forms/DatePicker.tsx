import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { Field } from "./Field";

/**
 * A native `<input type="date">`, styled.
 *
 * **Native on purpose, and it is the decision with the most to defend.** A
 * hand-built calendar is the most commonly re-implemented control on the web
 * and the one most commonly re-implemented badly: the keyboard grid, the month
 * roll-over, the locale's first weekday, the screen-reader announcement of a
 * date cell, and the mobile experience all have to be rebuilt, and the last of
 * those is a picker the platform already does better than any library.
 *
 * Two facts make the trade cheap here rather than merely defensible:
 *
 * - **The value is always ISO**, `yyyy-mm-dd`, whatever the browser shows. The
 *   display follows the machine's locale, so a Swiss operator sees
 *   `14.03.2026` and a colleague on an English profile sees their own format —
 *   and neither of them can type something the other cannot parse.
 * - **Nothing here needs a range highlight or a month of availability.** The
 *   dates in this system are a due date, a start date, a retention date. The
 *   day Planning wants a Gantt-shaped picker is the day to revisit this, and
 *   the surface is `value`/`onChange` so revisiting it changes one file.
 *
 * `min`/`max` are real constraints, not hints: they stop the picker offering a
 * date the server would refuse, which is better than explaining the refusal.
 */

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  /** ISO `yyyy-mm-dd`, or `""`. Never a `Date` — see above. */
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
};

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      className={cn(
        "field-input",
        // The picker indicator is drawn by the browser and inherits nothing.
        // In the dark theme it renders as a black glyph on a dark field and is
        // effectively invisible; the filter inverts it there and only there.
        "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
        "dark:[&::-webkit-calendar-picker-indicator]:invert",
        invalid && "field-input-error",
        className,
      )}
      {...rest}
    />
  );
});

/** The labelled form of it, for the common case. */
export function DatePicker({
  label,
  value,
  onChange,
  hint,
  error,
  optional,
  min,
  max,
  disabled,
  id,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} optional={optional}>
      <DateInput
        id={inputId}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        disabled={disabled}
        invalid={Boolean(error)}
      />
    </Field>
  );
}

/* ================================================================== */
/* Date *and* time                                                     */
/* ================================================================== */

/**
 * `<input type="datetime-local">`, on the same argument as `DateInput`.
 *
 * Added for scheduled publishing (P2-3), which is the first thing in the system
 * where the hour is part of the decision — every date before it was a due date
 * or a retention date, where midnight is as good an answer as any. "Live at
 * 06:00 on Monday" is not the same instruction as "live on Monday".
 *
 * **The value is local wall-clock time, not an instant**, and that is the one
 * trap here: `2026-12-24T08:00` carries no zone, so the caller converts. Doing
 * it in the control would be wrong in the other direction — the string a
 * `datetime-local` shows is by definition the one on the operator's own clock,
 * and an editor who types 08:00 means eight o'clock where they are.
 * `toLocalInput`/`fromLocalInput` below are that conversion, in one place
 * rather than at each call site.
 */
export const DateTimeInput = forwardRef<HTMLInputElement, DateInputProps>(
  function DateTimeInput({ value, onChange, invalid, className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={cn(
          "field-input",
          "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
          "dark:[&::-webkit-calendar-picker-indicator]:invert",
          invalid && "field-input-error",
          className,
        )}
        {...rest}
      />
    );
  },
);

/** The labelled form, matching `DatePicker`. */
export function DateTimePicker({
  label,
  value,
  onChange,
  hint,
  error,
  optional,
  min,
  max,
  disabled,
  id,
}: {
  label: string;
  /** `yyyy-mm-ddThh:mm`, local wall-clock. Use `toLocalInput` to produce one. */
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} optional={optional}>
      <DateTimeInput
        id={inputId}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        disabled={disabled}
        invalid={Boolean(error)}
      />
    </Field>
  );
}

/**
 * An instant → the `datetime-local` string for the viewer's own clock.
 *
 * `toISOString().slice(0, 16)` is the obvious version and is wrong by the UTC
 * offset — in Switzerland that is an hour in winter and two in summer, so a
 * publication typed for 08:00 is offered back as 06:00 and somebody "corrects"
 * it. Subtracting the offset before formatting is what makes the round trip
 * identity.
 */
export function toLocalInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** The inverse: a `datetime-local` string → the instant it names locally. */
export function fromLocalInput(value: string): Date {
  // `new Date("2026-12-24T08:00")` is already parsed as local time by every
  // engine that follows the spec — the absence of a `Z` is what decides it.
  return new Date(value);
}
