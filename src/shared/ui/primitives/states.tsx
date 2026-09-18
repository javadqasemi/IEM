import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { Button } from "./Button";

/**
 * The four states a screen is in when it is not showing data: loading, empty,
 * failed — and the skeleton that stands in for a shape that is known.
 */

/**
 * A loading placeholder shaped like the content it replaces.
 *
 * A skeleton rather than a spinner wherever the shape is known: it keeps the
 * layout from jumping when the data lands, which is the actual cost of a
 * spinner on a table.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-2", className)} aria-hidden />;
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 bg-surface px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
      <span className="sr-only">Wird geladen …</span>
    </div>
  );
}

/**
 * The empty state.
 *
 * Always says what would be here and offers the action that creates it — an
 * empty box with "Keine Daten" tells a reader nothing they did not already
 * know from looking at it.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-surface px-6 py-14 text-center ring-1 ring-line">
      {icon ? <div className="text-line-strong">{icon}</div> : null}
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-md text-[14px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/**
 * The error state.
 *
 * Shows the server's own message: those are written to be read by the person
 * who hit them ("Fehlende Berechtigung: content.publish"), and replacing them
 * with "Etwas ist schiefgelaufen" throws away the only useful part.
 */
export function ErrorState({
  title = "Das hat nicht geklappt.",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg bg-surface p-6 ring-1 ring-brand-bronze/40"
    >
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {message ? <p className="text-[14px] leading-relaxed text-muted">{message}</p> : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Nochmals versuchen
        </Button>
      ) : null}
    </div>
  );
}
