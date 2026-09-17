import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG contrast, asserted against the palette itself.
 *
 * This project already reasons about contrast by hand — `brand-bronze` and
 * `brand-sand` exist only because plain gold fails AA depending on what it sits
 * on, and README says so. Adding a second theme doubles every one of those
 * judgements, and judging a dark palette by eye is exactly how a dashboard ends
 * up with grey-on-grey secondary text that the person who chose it can read on
 * their own monitor.
 *
 * So the numbers are checked rather than trusted. The test **parses
 * `src/admin/admin.css`**, which is the single place the palette is declared,
 * rather than restating the values — a copy here would be a second source that
 * could drift, and a test that agrees with its own copy proves nothing.
 *
 * The bar is WCAG 2.1 AA: **4.5:1** for body text, **3:1** for large text and
 * for the boundaries of interface components. Where a pair sits at 3:1 it is
 * because it is a non-text boundary, and the case says which.
 */

const css = readFileSync(resolve(__dirname, "admin.css"), "utf8");

/**
 * Pulls `--c-name: r g b;` out of one `:root` block.
 *
 * Deliberately crude: the alternative is a CSS parser as a dependency, and the
 * shape it has to read is one this file controls and the comment above the
 * block documents. If the declarations ever stop looking like this, the lookup
 * throws by name rather than quietly returning a wrong colour.
 */
function palette(selector: string): Record<string, [number, number, number]> {
  const at = css.indexOf(selector);
  if (at === -1) throw new Error(`No ${selector} block in admin.css`);
  const open = css.indexOf("{", at);
  // The block ends at the first `}` that is not inside a nested rule. The token
  // blocks have no nesting, so the first one is the right one.
  const close = css.indexOf("\n  }", open);
  const body = css.slice(open, close === -1 ? css.length : close);

  const out: Record<string, [number, number, number]> = {};
  for (const m of body.matchAll(/--c-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const light = palette(":root {");
const dark = palette(':root[data-theme="dark"] {');

/** sRGB relative luminance, per WCAG 2.1. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The pairs that actually appear on screen, with the threshold each has to
 * clear and why.
 *
 * Only real combinations — a matrix of every token against every other would be
 * mostly meaningless and would fail on pairs nothing renders.
 */
const PAIRS: { fg: string; bg: string; min: number; where: string }[] = [
  // Body text. The bulk of every screen.
  { fg: "ink", bg: "base", min: 4.5, where: "body text on the page ground" },
  { fg: "ink", bg: "surface", min: 4.5, where: "body text in a card or table" },
  { fg: "ink", bg: "surface-2", min: 4.5, where: "body text on the raised step" },

  // Secondary text. The one most likely to be quietly unreadable, because it is
  // chosen to recede and the line between 'recedes' and 'illegible' is exactly
  // this number.
  { fg: "muted", bg: "base", min: 4.5, where: "secondary text on the page ground" },
  { fg: "muted", bg: "surface", min: 4.5, where: "secondary text in a card" },
  { fg: "muted", bg: "surface-2", min: 4.5, where: "secondary text on the raised step" },

  // Interactive text.
  { fg: "brand-blue", bg: "surface", min: 4.5, where: "links and interactive text in a card" },
  { fg: "brand-blue", bg: "base", min: 4.5, where: "links on the page ground" },
  { fg: "brand-bronze", bg: "surface", min: 4.5, where: "validation errors beside an input" },
  { fg: "accent", bg: "surface", min: 4.5, where: "KPI figures and emphasised text" },
  { fg: "accent", bg: "base", min: 4.5, where: "emphasised text on the page ground" },

  // On the primary button and the navy call-out panel. `brand-navy` is only
  // ever a background — its foreground counterpart is `accent` above, and the
  // two are the same colour in the light theme and deliberately not in the dark
  // one.
  { fg: "inverse", bg: "brand-navy", min: 4.5, where: "the primary button's label" },

  // The rail, which stays dark in both themes.
  { fg: "inverse", bg: "admin-rail", min: 4.5, where: "the rail's active row" },
  { fg: "brand-sand", bg: "admin-rail", min: 4.5, where: "the rail's accent and badge" },

  // Discipline hues, used as text on a card in badges and charts.
  { fg: "disc-heat", bg: "surface", min: 4.5, where: "Heizung/HLK as text" },
  { fg: "disc-air", bg: "surface", min: 4.5, where: "Lüftung/Klima as text" },
  { fg: "disc-water", bg: "surface", min: 4.5, where: "Sanitär as text" },
  { fg: "disc-power", bg: "surface", min: 4.5, where: "Elektro/Automation as text" },
  { fg: "disc-energy", bg: "surface", min: 4.5, where: "Energie/Sanierung as text" },

  /**
   * Non-text boundaries. 3:1 is the AA bar for these (WCAG 1.4.11), not 4.5.
   *
   * `field-border` rather than `line-strong`, and that distinction is the
   * finding this test produced: `line-strong` on white measures **1.66:1**, so
   * the dashboard's inputs were below the bar in the light theme before a dark
   * theme was ever considered. `line-strong` is not asserted here because it is
   * a hairline between table rows and a divider — decoration that is meant to
   * recede, and not a component boundary.
   */
  { fg: "field-border", bg: "surface", min: 3, where: "an input's resting border (non-text)" },
  { fg: "field-border", bg: "base", min: 3, where: "an input's border on the ground (non-text)" },
  { fg: "accent", bg: "surface", min: 3, where: "the focus ring on a card (non-text)" },
  { fg: "accent", bg: "base", min: 3, where: "the focus ring against the ground (non-text)" },
];

/**
 * `Badge` sets its text on a 10% wash of the same colour, not on the card.
 *
 * That wash is what this test missed. Every tone was checked against `surface`
 * and passed; on screen the text sits on `bg-<tone>/[0.10]`, which is darker
 * than the card in the light theme and lighter in the dark one — and an axe
 * pass measured the energy tone at **4.13:1** there while this file was
 * reporting 5.0:1 against white.
 *
 * The second background is the row hover, `bg-surface-2/60`, because a badge in
 * a table sits on a row that changes colour under the pointer. It is the worse
 * of the two and so the one worth asserting.
 */
function over(fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))) as [
    number,
    number,
    number,
  ];
}

/**
 * The tones `Badge` offers, by the token each one actually uses.
 *
 * `accent`, not `brand-navy`: the navy badge is `bg-accent/[0.08]
 * text-accent`, because `brand-navy` is a background-only token whose dark
 * value is chosen to carry white text and measures 2.49:1 as a foreground.
 * Asserting the wrong one here reported a failure the component does not have.
 */
const BADGE_TONES = [
  "accent",
  "brand-bronze",
  "disc-power",
  "disc-energy",
  "disc-water",
  "disc-air",
  "disc-heat",
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme — badge text on its own wash", (_name, colors) => {
  it.each(BADGE_TONES)("%s badge clears 4.5:1 on a hovered row", (tone) => {
    const fg = colors[tone];
    expect(fg, `--c-${tone} is not declared`).toBeDefined();
    // The row under the badge: `surface-2` at 60% over `surface`.
    const row = over(colors["surface-2"], colors.surface, 0.6);
    // The badge's own wash: the tone at 10% over that row.
    const wash = over(fg, row, 0.1);
    expect(Number(ratio(fg, wash).toFixed(2)), `${tone} on its wash ${wash}`).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme meets WCAG AA", (_name, colors) => {
  it("declares every token the other theme declares", () => {
    // A token missing from one theme inherits the other's value, which is the
    // failure mode that produces white-on-white in exactly one mode and is
    // invisible in review.
    expect(Object.keys(colors).sort()).toEqual(Object.keys(light).sort());
  });

  it.each(PAIRS)("$fg on $bg ($where) clears $min:1", ({ fg, bg, min }) => {
    const a = colors[fg];
    const b = colors[bg];
    expect(a, `--c-${fg} is not declared`).toBeDefined();
    expect(b, `--c-${bg} is not declared`).toBeDefined();
    expect(Number(ratio(a, b).toFixed(2))).toBeGreaterThanOrEqual(min);
  });
});

describe("the two themes are actually different", () => {
  it("inverts the relationship between text and ground", () => {
    // Catches a dark theme that was declared but left with light values — the
    // tokens would all pass their contrast checks and the page would be white.
    expect(luminance(light.ink)).toBeLessThan(luminance(light.base));
    expect(luminance(dark.ink)).toBeGreaterThan(luminance(dark.base));
  });

  it("raises cards above the ground in dark and keeps them below it in light", () => {
    // In the light theme a card is *brighter* than the page; in the dark theme
    // it is brighter too, because a raised surface catches more light. Getting
    // this backwards is what makes a dark UI look inside-out.
    expect(luminance(light.surface)).toBeGreaterThan(luminance(light.base));
    expect(luminance(dark.surface)).toBeGreaterThan(luminance(dark.base));
  });

  it("keeps the rail the deepest plane in the dark theme", () => {
    expect(luminance(dark["admin-rail"])).toBeLessThan(luminance(dark.base));
  });
});
