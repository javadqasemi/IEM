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
