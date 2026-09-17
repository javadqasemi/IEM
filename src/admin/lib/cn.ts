import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The dashboard's class merger: `clsx` **plus** tailwind-merge.
 *
 * The site's `@/lib/cn` is plain `clsx`, and that difference is deliberate
 * rather than an oversight to be tidied away later.
 *
 * **Why the dashboard needs the merge.** `clsx` concatenates, so a `className`
 * passed into a component is *appended* to whatever the component already had.
 * Two classes setting the same property both survive into the output, and which
 * one wins is decided by their order in the stylesheet — not by the call site's
 * intent. The result is that `<Button className="bg-surface-2">` may or may not
 * override `bg-brand-navy` depending on how Tailwind happened to sort them, and
 * the failure is silent and looks like a specificity mystery. With ~30
 * components today and the enterprise modules adding many more, that is a
 * standing tax on every call site. tailwind-merge resolves conflicts by
 * *property*: the last `bg-*` wins, full stop.
 *
 * **Why the site keeps plain `clsx`.** It costs bytes — this package is a few
 * kB gzipped — and `index.html` is a marketing page whose payload is a
 * documented constraint of the project. The site's components take far fewer
 * `className` overrides and their call sites are all in one repository under
 * one author, so the concatenation is manageable there. The dashboard is a
 * private tool behind a login where a few kB is not a consideration.
 *
 * So: **`src/components/` keeps importing `@/lib/cn`; `src/admin/` imports
 * this.** Nothing in `src/components/` may import from `src/admin/` anyway (see
 * docs/ARCHITECTURE.md), so the boundary is one the project already enforces.
 */

/**
 * Teaches tailwind-merge the tokens this project invented.
 *
 * Without this it applies its own knowledge of Tailwind's default scales and
 * treats an unknown class as opaque — which is *safe* (it keeps both) but
 * wrong for exactly the classes that matter most here. `text-display-lg` and
 * `text-[15px]` are both font-size and must resolve to one; `tracking-ultra-wide`
 * is a real tracking value; `shadow-card`, `shadow-glow` and `shadow-rail` are
 * one group.
 *
 * Colours need no entry: `bg-surface` and `bg-base` are both `bg-*` and
 * tailwind-merge groups them by prefix already.
 */
export const cn = (() => {
  const merge = extendTailwindMerge({
    extend: {
      classGroups: {
        // The three clamped display sizes from `tailwind.config.ts`. Declared
        // as font-size so they conflict with `text-[15px]` and with each other.
        "font-size": [{ text: ["display-xl", "display-lg", "display-md"] }],
        tracking: [{ tracking: ["ultra-wide"] }],
        shadow: [{ shadow: ["card", "glow", "rail"] }],
      },
    },
  });
  return (...inputs: ClassValue[]) => merge(clsx(inputs));
})();
