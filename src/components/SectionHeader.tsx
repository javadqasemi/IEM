import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SectionHeaderProps {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot for a link or control that belongs to this section. */
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-10",
        className,
      )}
    >
      <div className="flex max-w-2xl flex-col gap-4">
        <div className="eyebrow flex items-center gap-3 text-muted">
          <span aria-hidden className="h-px w-6 bg-line-strong" />
          <span>{eyebrow}</span>
        </div>
        <h2 className="font-display text-display-lg font-semibold text-ink">{title}</h2>
        {description && <p className="text-lg leading-relaxed text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
