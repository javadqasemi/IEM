import { cn } from "@/lib/cn";

/**
 * The IEM wordmark, transcribed from the logo published at
 * https://www.iem.ch/images/logo.svg (viewBox 0 0 142 56).
 *
 * The mark is built from vertical bars whose widths taper left to right — a
 * raster of tapering strokes rather than drawn letterforms. That construction
 * is the brand's most distinctive asset and is echoed elsewhere on the page by
 * the `.tick-rule` section divider.
 *
 * Fills use `currentColor` so the mark inherits its colour from context (navy
 * on paper, white on the navy panels).
 */

/** Full-height bars forming the "I" and the "E" stem. [x, width] */
const stems: [number, number][] = [
  [0, 2.3], [3.6, 1.9], [7, 1.5], [10.4, 1.6], [14, 1.3], [17.3, 1.2],
  [22.9, 2.4], [26.3, 2], [29.7, 1.9], [33, 1.9], [36.7, 1.7], [40.1, 1.6],
];

/** Bars forming each of the three arms of the "E". [x, width] */
const arms: [number, number][] = [
  [43.4, 1.8], [47, 1.5], [50.4, 1.5], [53.9, 1.3],
  [57.2, 1.2], [60.4, 1.1], [63.8, 1.2], [67.1, 0.9],
];

/** Vertical offsets of the three "E" arms. */
const armRows = [0, 20.1, 40.2];

/** The "M" uprights, left group then right group. [x, width] */
const mStems: [number, number][] = [
  [73.6, 2.3], [77, 2.1], [80.4, 2], [84.1, 1.8], [87.4, 1.9], [90.8, 1.9],
  [124.4, 1], [127.8, 0.9], [131.2, 0.9], [134.6, 0.7], [138, 0.7], [141.3, 0.7],
];

/** The "M" inner diagonals, taken verbatim from the source logo. */
const mDiagonals = [
  "M96,37.2L96,37.2c-0.1-0.1-0.1-0.4-0.1-0.5h-0.1c-0.1-0.4,0.1-0.8-0.1-1h-0.2c0.1-0.8-0.2-1.2-0.1-1.8h-0.3c-0.1-0.4,0.1-0.9-0.2-1.1c0-0.3,0.2-0.8-0.1-0.9V0.5H96V37.2z",
  "M99.3,49.4H99c-0.1-0.6-0.1-1-0.2-1.6h-0.2c-0.1-0.4,0.1-1.2-0.2-1.4c-0.1-0.3,0.1-0.9-0.2-1c0-0.3,0.1-0.7-0.1-0.8h-0.1V0.5h1.5V49.4z",
  "M101.3,0.5c0.1,0.1-0.1,0.4,0.1,0.4h0.2c0,0.1,0,0.1,0.1,0.1h0.1c0,0.2-0.1,0.4,0,0.6h0.2c0,0.1-0.1,0.4,0.1,0.6h0.2c0.1,0.3-0.2,0.9,0.1,0.9V56h-1.3L101.3,0.5L101.3,0.5z",
  "M115.6,56h-1.2V3.1h0.2c0.2-0.3-0.1-1,0.4-1V1.4c0.2,0.1,0.3-0.1,0.2-0.4V0.9c0.4,0.1,0-0.5,0.4-0.4V56z",
  "M119,45.5h-0.1l-0.1,1.3h-0.2c-0.1,0.3-0.1,0.7-0.1,1h-0.1c-0.1,0.2-0.1,0.5-0.1,0.7h-0.1c-0.1,0.2-0.1,0.6-0.1,0.9h-0.2V0.5h1.2V45.5z",
  "M122.1,33.9h-0.2c0,0.8-0.3,1.2-0.2,2h-0.2c-0.1,0.2-0.1,0.6-0.1,0.8h-0.1V0.5h0.9V33.9z",
  "M104.7,10.6c0,0.3-0.1,0.6,0.1,0.9h0.2c0,0.3-0.1,0.7,0.1,0.9h0.1c0.1,0.4-0.1,1.2,0.2,1.4c0.1,0.5-0.2,1.4,0.3,1.6c0,0.6-0.1,1.2,0.1,1.8h0.1V56h-1.4V10.6H104.7z",
  "M112.5,56h-1.4V16.9h0.1l0.1-1.5h0.2l0.1-1.6h0.1l0.1-1.4h0.1c0.2-0.3-0.1-1,0.4-1v-0.8h0.1V56z",
  "M108.2,23.9c0,0.1-0.1,0.4,0.1,0.5h0.1c0,0.1-0.1,0.4,0.1,0.5c0.2,0.1,0.3-0.1,0.2-0.3v-0.2c0.3,0.1,0.3-0.1,0.3-0.4v-0.1h0.1V56h-1.2V23.9H108.2z",
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 142 56"
      className={cn("w-auto", className)}
      role="img"
      aria-label="IEM"
      fill="currentColor"
    >
      {stems.map(([x, w]) => (
        <rect key={`s${x}`} x={x} y="0" width={w} height="56" />
      ))}
      {armRows.map((y) =>
        arms.map(([x, w]) => <rect key={`a${y}-${x}`} x={x} y={y} width={w} height="15.8" />),
      )}
      {mStems.map(([x, w]) => (
        <rect key={`m${x}`} x={x} y="0.5" width={w} height="55.5" />
      ))}
      {mDiagonals.map((d) => (
        <path key={d.slice(0, 12)} d={d} />
      ))}
    </svg>
  );
}
