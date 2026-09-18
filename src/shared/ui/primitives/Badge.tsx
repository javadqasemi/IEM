import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * The tone scale. Named after the palette rather than after meanings
 * ("success", "warning"), because the meanings are the *domain's* and belong in
 * `entities/` — `entities/content/WorkflowBadge` decides that `APPROVED` is
 * `water`, and this file stays free of any opinion about what is being shown.
 *
 * Every pair below is covered by `theme.contrast.test.ts`, including the
 * composition it actually renders in: a badge on a card is one measurement and
 * the same badge on a hovered table row is another, and five of these failed
 * the second one before that qualification was added.
 */
export type BadgeTone =
  | "neutral"
  | "navy"
  | "gold"
  | "bronze"
  | "energy"
  | "water"
  | "air";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted ring-line",
  navy: "bg-accent/[0.08] text-accent ring-accent/20",
  gold: "bg-disc-power/[0.10] text-disc-power ring-disc-power/25",
  bronze: "bg-brand-bronze/[0.10] text-brand-bronze ring-brand-bronze/25",
  energy: "bg-disc-energy/[0.10] text-disc-energy ring-disc-energy/25",
  water: "bg-disc-water/[0.10] text-disc-water ring-disc-water/25",
  air: "bg-disc-air/[0.10] text-disc-air ring-disc-air/25",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
