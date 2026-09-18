import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

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
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  action,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  optional?: boolean;
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
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;

  /**
   * The child, wired to its own message.
   *
   * Only a single element is cloned, and only attributes it has not already set
   * are supplied. Anything else — a fragment, several controls, a string — is
   * rendered untouched: guessing which of three inputs a description belongs to
   * would be worse than leaving it to the caller.
   */
  const control =
    isValidElement(children) && describedBy
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          "aria-describedby":
            (children.props as Record<string, unknown>)["aria-describedby"] ?? describedBy,
          "aria-invalid":
            (children.props as Record<string, unknown>)["aria-invalid"] ?? (error ? true : undefined),
        })
      : children;

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
        <p id={`${htmlFor}-error`} role="alert" className="text-[12px] font-medium text-brand-bronze">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[12px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
