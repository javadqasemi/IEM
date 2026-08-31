import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/content/iem";

/**
 * Every discipline hue is text-safe on `surface`, so label, ring and dot can all
 * use the same colour — no separate "ink" variant to keep in sync.
 */
const tones: Record<Tone, string> = {
  neutral: "text-muted ring-line bg-surface",
  heat: "text-disc-heat ring-disc-heat/25 bg-disc-heat/[0.06]",
  air: "text-disc-air ring-disc-air/25 bg-disc-air/[0.06]",
  water: "text-disc-water ring-disc-water/25 bg-disc-water/[0.06]",
  power: "text-disc-power ring-disc-power/25 bg-disc-power/[0.06]",
  energy: "text-disc-energy ring-disc-energy/25 bg-disc-energy/[0.06]",
  model: "text-disc-model ring-disc-model/25 bg-disc-model/[0.06]",
};

const dots: Record<Tone, string> = {
  neutral: "bg-muted",
  heat: "bg-disc-heat",
  air: "bg-disc-air",
  water: "bg-disc-water",
  power: "bg-disc-power",
  energy: "bg-disc-energy",
  model: "bg-disc-model",
};

export function Badge({
  tone = "neutral",
  dot = true,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1",
        "eyebrow",
        tones[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn("h-1 w-1 rounded-full", dots[tone])} />}
      {children}
    </span>
  );
}
