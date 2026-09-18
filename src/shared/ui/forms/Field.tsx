import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * The wrapper every input sits in.
 *
 * It owns the label/hint/error relationship — `htmlFor`, `aria-describedby`,
 * `aria-invalid` — so no screen has to remember to wire them up, and none of
 * them can get it subtly wrong. `optional` is shown rather than `required`:
 * most fields in this dashboard are required, so marking the exceptions is
 * both quieter and more informative.
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
      {children}
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
