import type { Config } from "tailwindcss";
import base from "./tailwind.config";

/**
 * The dashboard's Tailwind config.
 *
 * A second config rather than a second theme: `src/admin/admin.css` selects it
 * with `@config`, so the dashboard's utilities are emitted into the
 * dashboard's own stylesheet and never reach the one the public site loads.
 * That is the whole reason this file exists — see the note on `content` in
 * `tailwind.config.ts`.
 *
 * The **theme is imported, not copied.** The dashboard is IEM's own tool and
 * should look like it: same navy, same gold, same discipline hues, same
 * Archivo/Plex pairing. Restating the palette here would create a second place
 * for it to drift, which is exactly what the two-file token rule in
 * docs/ARCHITECTURE.md exists to prevent.
 */
/**
 * `bg-surface` → `rgb(var(--c-surface) / <alpha-value>)`.
 *
 * The channel form is what keeps the alpha modifiers working. The dashboard
 * writes `text-muted/70`, `bg-brand-navy/[0.08]` and `bg-surface/[0.07]` in
 * about forty places; with a hex variable those silently produce an invalid
 * colour, because there is nowhere to put the alpha. With space-separated
 * channels Tailwind substitutes it into the `rgb()` itself.
 */
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./admin.html", "./src/admin/**/*.{ts,tsx}"],
  /**
   * `selector`, not `media`.
   *
   * There is almost no `dark:` in the markup — the theme is carried by the
   * tokens below, so a card is `bg-surface` in both themes and the *value* of
   * `surface` changes. This is set for the handful of places that genuinely
   * need to differ in kind rather than in shade, and it has to agree with the
   * attribute `admin.html` writes and `useTheme` maintains.
   *
   * An attribute rather than the media query alone because Settings offers an
   * explicit choice: a reader who picks "hell" on a machine configured dark
   * has to get light, and `prefers-color-scheme` cannot express that.
   */
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    ...base.theme,
    extend: {
      ...base.theme?.extend,
      /**
       * The dashboard's palette, re-based onto CSS variables.
       *
       * Every name here already existed and is spelled the same at all ~400
       * call sites — only the *definition* moved, from a literal in
       * `tailwind.config.ts` to a variable declared in `src/admin/admin.css`.
       * That is why adding a theme changed no markup: `bg-surface` is still
       * `bg-surface`, and what `surface` means is now a property of the
       * document rather than of the stylesheet.
       *
       * The public site keeps the literals. It has one appearance, no switch,
       * and re-basing it would change the CSS every visitor downloads for no
       * gain — the hash `globals-B1c5Zfq1.css` is the check that it did not.
       */
      colors: {
        ...(base.theme?.extend as { colors?: Record<string, unknown> })?.colors,

        base: token("base"),
        surface: {
          DEFAULT: token("surface"),
          2: token("surface-2"),
        },
        "surface-2": token("surface-2"),
        ink: token("ink"),
        muted: token("muted"),
        line: {
          DEFAULT: token("line"),
          strong: token("line-strong"),
        },
        "line-strong": token("line-strong"),

        /** The resting border of a form control. See the note in `admin.css`. */
        field: token("field-border"),

        /**
         * Navy as a foreground — emphasised text, focus rings, active markers.
         *
         * Identical to `brand-navy` in the light theme, so nothing about the
         * light appearance changed when this was split out. They diverge in the
         * dark theme because a colour light enough to read as text on a dark
         * card is too light to carry white text as a button.
         */
        accent: token("accent"),

        /**
         * Text on something that stays dark in both themes.
         *
         * Split out from `surface`, which it used to borrow. They only ever
         * looked like the same colour: `surface` is a background that has to
         * invert with the theme, this is a foreground on the rail and on a
         * primary button, both of which stay dark in the dark theme too. Left
         * as `text-surface` it would have turned the rail's labels dark on
         * dark. All twenty call sites were changed together.
         */
        inverse: token("inverse"),

        brand: {
          navy: token("brand-navy"),
          blue: token("brand-blue"),
          gold: token("brand-gold"),
          bronze: token("brand-bronze"),
          sand: token("brand-sand"),
        },

        disc: {
          heat: token("disc-heat"),
          air: token("disc-air"),
          water: token("disc-water"),
          power: token("disc-power"),
          energy: token("disc-energy"),
          model: token("disc-model"),
        },

        // The sidebar ground: navy, dropped far enough to sit under white text
        // without competing with `brand-navy` on the buttons in front of it.
        // In the dark theme it inverts the relationship and becomes the
        // *deepest* plane on screen — see the note in `admin.css`.
        "admin-rail": token("admin-rail"),
        "admin-rail-2": token("admin-rail-2"),
      },
      keyframes: {
        ...(base.theme?.extend as { keyframes?: Record<string, unknown> })?.keyframes,
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        ...(base.theme?.extend as { animation?: Record<string, unknown> })?.animation,
        "toast-in": "toast-in 180ms cubic-bezier(0.2, 0.8, 0.3, 1) both",
      },
    },
  },
  plugins: base.plugins ?? [],
} satisfies Config;
