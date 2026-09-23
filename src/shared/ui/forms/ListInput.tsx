import { markRequirable } from "./requirable";
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { Input } from "./inputs";

/** `"a, b ,, c"` → `["a", "b", "c"]`. Blank parts are dropped, the rest trimmed. */
export function parseList(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The canonical spelling a list is shown in once it is no longer being typed. */
export function formatList(items: readonly string[]): string {
  return items.join(", ");
}

/** Whether two lists hold the same items in the same order. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

type ListInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: readonly string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
};

/**
 * A comma-separated list, typed as text.
 *
 * ---
 *
 * **The bug it replaces (UX-41).** Two screens rendered a list field as
 * `value={items.join(", ")}` and wrote back `text.split(",")…filter(Boolean)`
 * on every keystroke. Typing `Lüftung,` produced `["Lüftung"]`, which rendered
 * as `Lüftung` — the comma vanished the instant it was typed, so a second item
 * could never be started. It looked like a broken keyboard.
 *
 * The fix is to keep **the text** as the thing being edited and the list as
 * something derived from it. The parent still hears about every change — so a
 * save bar's dirty state stays live — but the text is only rewritten from the
 * value when the value changes for a reason that is not this input (a reset,
 * a reload), and tidied to the canonical spelling when the field is left.
 */
export const ListInput = forwardRef<HTMLInputElement, ListInputProps>(function ListInput(
  { value, onChange, onBlur, ...rest },
  ref,
) {
  const [text, setText] = useState(() => formatList(value));

  /*
    Adopt a value that arrived from outside — and only then. Comparing parsed
    lists rather than strings is what lets `Lüftung,` stand: it parses to the
    same list the parent already has, so the text is left exactly as typed.
  */
  useEffect(() => {
    setText((current) => (sameList(parseList(current), value) ? current : formatList(value)));
  }, [value]);

  return (
    <Input
      ref={ref}
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = parseList(e.target.value);
        if (!sameList(next, value)) onChange(next);
      }}
      onBlur={(e) => {
        setText(formatList(parseList(text)));
        onBlur?.(e);
      }}
    />
  );
});

// Passes `aria-required` to a real input — see `requirable.ts`.
markRequirable(ListInput);
