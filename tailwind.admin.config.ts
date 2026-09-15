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
export default {
  content: ["./admin.html", "./src/admin/**/*.{ts,tsx}"],
  theme: {
    ...base.theme,
    extend: {
      ...base.theme?.extend,
      // Admin-only additions. The dashboard has denser surfaces than the site
      // — tables, sidebars, toolbars — and needs a couple of steps the public
      // palette has no use for.
      colors: {
        ...(base.theme?.extend as { colors?: Record<string, unknown> })?.colors,
        // The sidebar ground: navy, dropped far enough to sit under white text
        // without competing with `brand-navy` on the buttons in front of it.
        "admin-rail": "#00224F",
        "admin-rail-2": "#002E69",
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
