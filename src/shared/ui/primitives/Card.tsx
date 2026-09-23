import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/utils/cn";
import { usePageActionsSlot } from "./pageActionsSlot";

/** The bordered panel every screen groups content in. */
export function Card({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {title || action ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? (
              <h2 className="font-display text-[15px] font-semibold leading-tight text-ink">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="text-[13px] leading-snug text-muted">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  /**
   * The screen's actions. Drawn in the shell's sticky bar when there is one
   * (see `pageActionsSlot.ts`), inline under the title otherwise.
   */
  actions?: ReactNode;
}) {
  const slot = usePageActionsSlot();
  const group = actions ? (
    <div className="flex shrink-0 flex-wrap items-center gap-2" data-page-actions>
      {actions}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <p className="eyebrow text-muted">{eyebrow}</p> : null}
        <h1 className="font-display text-[26px] font-semibold leading-tight text-ink">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-[14px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {group ? (slot ? createPortal(group, slot) : group) : null}
    </div>
  );
}
