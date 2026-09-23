import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { useInForm } from "./Form";
import { isRequirable } from "./requirable";

/**
 * The wrapper every input sits in.
 *
 * It owns the label/hint/error relationship — `htmlFor`, `aria-describedby`,
 * `aria-invalid` — so no screen has to remember to wire them up, and none of
 * them can get it subtly wrong. `optional` is shown rather than `required`:
 * most fields in this dashboard are required, so marking the exceptions is
 * both quieter and more informative.
 *
 * ---
 *
 * **The `aria-describedby` half of that was a claim rather than a behaviour**,
 * and it was found by writing a test that tried to assert it. `FieldRenderer`
 * wired the attribute itself, so every content form was correct; every
 * *hand-written* `<Field><Input/></Field>` — which is what the project dialogs
 * and all nineteen modules after them use — rendered an error with an `id` that
 * nothing referenced. The message was announced (it carries `role="alert"`) and
 * a reader who tabbed back to the field afterwards heard nothing about why it
 * was invalid.
 *
 * So the wrapper now does what it always said it did: it clones its single
 * child element and supplies `aria-describedby` and `aria-invalid`. A call site
 * that sets either itself still wins — `FieldRenderer` does, and a composite
 * control may have a better answer than this component can guess.
 *
 * ---
 *
 * **Required, as of P1C.** The *visible* convention stays — "(optional)" on
 * the exceptions, nothing on the rest — and it now reaches assistive
 * technology too: inside a `<Form>`, a field that is not `optional` gives its
 * control `aria-required`, so "Pflichtfeld" is announced where a sighted reader
 * infers it from the missing marker. Outside a form (a filter bar, a read-only
 * panel) nothing is claimed. `required` overrides either way. Only controls
 * known to pass the attribute to a real input receive it — see `requirable.ts`.
 *
 * **Hint and error together.** An error used to *replace* the hint, so the
 * sentence explaining the format disappeared at the moment the reader got the
 * format wrong. Both are shown and both are in `aria-describedby`, error first.
 *
 * **`readOnlyReason`** says why a field cannot be changed — "Nur mit der
 * Berechtigung für rechtliche Angaben" — in visible text, the field-level twin
 * of a button's `disabledReason`. It never contains a permission key.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  required,
  readOnlyReason,
  action,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** Overrides the in-form default (required unless `optional`). */
  required?: boolean;
  readOnlyReason?: string | null;
  /**
   * Shown at the end of the label row — a badge or a small control that
   * qualifies the field rather than being part of it.
   *
   * Added for the settings screen's "noch nicht angebunden" mark, which first
   * tried to say the same thing by dimming the whole field and measured 2.54:1
   * for its trouble. A qualification about a field belongs beside its label, at
   * full contrast.
   */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const inForm = useInForm();
  const isRequired = required ?? (inForm && !optional);

  const errorId = error ? `${htmlFor}-error` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const reasonId = readOnlyReason ? `${htmlFor}-reason` : undefined;
  const describedBy = [errorId, reasonId, hintId].filter(Boolean).join(" ") || undefined;

  /**
   * The child, wired to its own message.
   *
   * Only a single element is cloned, and only attributes it has not already set
   * are supplied. Anything else — a fragment, several controls, a string — is
   * rendered untouched: guessing which of three inputs a description belongs to
   * would be worse than leaving it to the caller.
   */
  let control: ReactNode = children;
  if (isValidElement(children)) {
    const props = children.props as Record<string, unknown>;
    const extra: Record<string, unknown> = {};
    if (describedBy) {
      extra["aria-describedby"] = props["aria-describedby"] ?? describedBy;
      extra["aria-invalid"] = props["aria-invalid"] ?? (error ? true : undefined);
    }
    if (isRequired && isRequirable(children.type) && props["aria-required"] === undefined) {
      extra["aria-required"] = true;
    }
    if (Object.keys(extra).length) {
      control = cloneElement(children as ReactElement<Record<string, unknown>>, extra);
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="field-label">
          {label}
          {optional ? (
            <span className="normal-case tracking-normal text-muted">(optional)</span>
          ) : null}
        </label>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-[12px] font-medium text-brand-bronze">
          {error}
        </p>
      ) : null}
      {readOnlyReason ? (
        <p id={reasonId} className="text-[12px] leading-snug text-muted">
          {readOnlyReason}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-[12px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
