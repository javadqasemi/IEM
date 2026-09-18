import type { FormEvent, ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * The frame around a form: the element, its sections, its actions.
 *
 * A real `<form>` with a submit handler rather than a `<div>` with a button,
 * and that is not pedantry: it is what makes Enter submit, what lets a browser
 * offer to save a password, and what a screen reader announces as a form. The
 * dashboard had none — every "form" was a `<div>` and every save was an
 * `onClick`, so Enter did nothing in fifteen places.
 */
export function Form({
  onSubmit,
  children,
  className,
  error,
}: {
  onSubmit: () => void;
  children: ReactNode;
  className?: string;
  /** The message that belongs to no field. Rendered above the fields. */
  error?: string | null;
}) {
  const handle = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handle} noValidate className={cn("flex flex-col gap-6", className)}>
      {/*
        `noValidate` because the messages are ours.

        The browser's own validation bubbles are untranslatable, disappear on
        the next click, and are positioned by the browser — and the server's
        rules are the authoritative ones anyway, so a form that passed the
        browser's check and failed the server's would show two different kinds
        of error for the same field.
      */}
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium text-brand-bronze ring-1 ring-brand-bronze/25"
        >
          {error}
        </p>
      ) : null}
      {children}
    </form>
  );
}

/** A titled group of fields. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {title ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-[15px] font-semibold text-ink">{title}</h3>
          {description ? (
            <p className="text-[13px] leading-snug text-muted">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/**
 * The row of buttons at the foot of a form.
 *
 * Right-aligned, primary last — the platform convention on Windows, which is
 * what this office runs. The submit button must be `type="submit"` for Enter
 * to reach it, which is the one thing a caller can get wrong here.
 */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 pt-1", className)}>
      {children}
    </div>
  );
}
