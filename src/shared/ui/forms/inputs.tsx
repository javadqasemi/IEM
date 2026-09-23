import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/shared/utils/cn";
import { markRequirable } from "./requirable";

/**
 * The native controls, styled.
 *
 * Native throughout: they bring keyboard handling, the mobile picker, form
 * association and screen-reader semantics for free, all of which a custom
 * widget has to rebuild and usually rebuilds incompletely. The richer inputs
 * that genuinely have no native equivalent — `Combobox`, `EntityPicker`,
 * `DateRangePicker` — live beside these and are built on a listbox pattern
 * rather than replacing what the platform already does well.
 */

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = markRequirable(forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn("field-input", invalid && "field-input-error", className)}
      {...rest}
    />
  );
}));

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = markRequirable(forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn("field-input resize-y leading-relaxed", invalid && "field-input-error", className)}
      {...rest}
    />
  );
}));

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  options: { value: string; label: string }[];
  placeholder?: string;
};

/**
 * A native `<select>`, styled. Only the chevron is ours.
 */
export const Select = markRequirable(forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, options, placeholder, className, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "field-input cursor-pointer appearance-none pr-9",
          invalid && "field-input-error",
          className,
        )}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6 L8 10 L12 6" />
      </svg>
    </div>
  );
}));

export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong text-accent
                   focus:ring-2 focus:ring-accent focus:ring-offset-0 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
        <span className="text-[14px] leading-tight text-ink">{label}</span>
        {hint ? <span className="text-[12px] leading-snug text-muted">{hint}</span> : null}
      </label>
    </div>
  );
}

/** A labelled on/off control for a boolean setting. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] leading-tight text-ink">{label}</span>
        {hint ? <span className="text-[12px] leading-snug text-muted">{hint}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-brand-navy" : "bg-line-strong",
        )}
      >
        {/*
          `left-0.5` is load-bearing, not decoration.

          Without a horizontal anchor both `left` and `right` are `auto`, so the
          knob is placed at its *static position* — where it would have sat in
          normal flow. A `<button>` carries `text-align: center` from the user
          agent and Tailwind's preflight does not reset it, so that position is
          the middle of the track: the knob started centred and the transform
          shifted it from there, which is why neither state looked right.

          Anchored at 2px the geometry closes: the track is 36×20 and the knob
          16, so off leaves 2px at the left, and `translate-x-4` (16px) puts it
          at 18px — 2px from the right. Symmetric, and both numbers stay on the
          spacing scale.
        */}
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

/** A search box with a clear button. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Suchen",
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
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
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field-input pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Suche zurücksetzen"
          className="absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M4 4 L12 12 M12 4 L4 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
