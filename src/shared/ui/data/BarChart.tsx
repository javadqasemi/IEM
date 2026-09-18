import { cn } from "@/shared/utils/cn";

/**
 * A bar chart as inline SVG-free markup.
 *
 * No charting library: the dashboard shows two of these, both single-series
 * categorical, and a 140 kB dependency for that is not a trade worth making.
 * Values are labelled directly rather than read off an axis, which is both
 * more accurate and removes the need for gridlines.
 *
 * Finance and Reports will force a real charting decision (`docs/enterprise-
 * architecture.md` §6.2). When that lands it is wrapped the same way this is —
 * call sites never import the library — so this component's contract survives
 * whatever is chosen underneath it.
 */
export function BarChart({
  data,
  format = (n) => String(n),
  label,
  tone = "navy",
}: {
  data: { label: string; value: number }[];
  format?: (value: number) => string;
  label: string;
  tone?: "navy" | "gold" | "energy";
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fills = {
    navy: "bg-brand-navy",
    gold: "bg-disc-power",
    energy: "bg-disc-energy",
  };

  if (!data.length) {
    return <p className="py-6 text-center text-[13px] text-muted">Keine Daten.</p>;
  }

  return (
    // A list, not a canvas: every value is in the DOM as text, so the chart is
    // readable by a screen reader without a parallel table.
    <ul className="flex flex-col gap-2.5" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-[13px] text-muted" title={d.label}>
            {d.label}
          </span>
          <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <span
              className={cn("absolute inset-y-0 left-0 rounded-sm transition-all duration-500", fills[tone])}
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-[12px] tnum text-ink">
            {format(d.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
