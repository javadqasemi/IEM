import { cn } from "@/lib/cn";

interface KPIProps {
  value: string;
  label: string;
  /** Optional source note — say where a number comes from rather than asserting it. */
  note?: string;
  tone?: "ink" | "navy" | "gold" | "water" | "energy";
  className?: string;
}

const toneMap = {
  ink: "text-ink",
  navy: "text-brand-navy",
  gold: "text-disc-power",
  water: "text-disc-water",
  energy: "text-disc-energy",
};

export function KPI({ value, label, note, tone = "ink", className }: KPIProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className={cn("font-display text-display-md font-semibold tnum", toneMap[tone])}>{value}</div>
      <div className="eyebrow text-muted">{label}</div>
      {note && <div className="text-[13px] leading-snug text-muted/80">{note}</div>}
    </div>
  );
}
