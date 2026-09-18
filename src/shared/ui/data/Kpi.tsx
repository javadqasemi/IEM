import { cn } from "@/shared/utils/cn";
import type { BadgeTone } from "@/shared/ui/primitives";

export function KpiCard({
  label,
  value,
  note,
  tone = "navy",
  href,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: BadgeTone;
  href?: string;
}) {
  const toneText: Record<BadgeTone, string> = {
    neutral: "text-ink",
    navy: "text-accent",
    gold: "text-disc-power",
    bronze: "text-brand-bronze",
    energy: "text-disc-energy",
    water: "text-disc-water",
    air: "text-disc-air",
  };

  const inner = (
    <>
      <div className={cn("font-display text-[30px] font-semibold leading-none tnum", toneText[tone])}>
        {value}
      </div>
      <div className="eyebrow text-muted">{label}</div>
      {note ? <div className="text-[12px] leading-snug text-muted">{note}</div> : null}
    </>
  );

  const classes =
    "flex flex-col gap-2 rounded-lg bg-surface p-5 ring-1 ring-line transition-shadow";

  return href ? (
    <a href={`#${href}`} className={cn(classes, "hover:shadow-card")}>
      {inner}
    </a>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

/**
 * A KPI tile with no data behind it.
 *
 * Shown instead of a zero for the figures the spec asks for that this system
 * has no source for — visitors, conversions, revenue. A zero would read as a
 * measurement; this reads as what it is. The whole page rests on its numbers
 * being checkable, and that has to include the dashboard.
 */
export function KpiUnavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface/50 p-5">
      <div className="font-display text-[30px] font-semibold leading-none text-line-strong">—</div>
      <div className="eyebrow text-muted">{label}</div>
      <div className="text-[12px] leading-snug text-muted">{reason}</div>
    </div>
  );
}
