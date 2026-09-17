import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_CHOICES, THEME_STORAGE_KEY } from "./theme";

/**
 * The theme's one duplicated fact.
 *
 * `admin.html` carries an inline script that sets `data-theme` before the first
 * paint, because the module bundle is deferred and React cannot run early
 * enough — without it a reader who chose dark gets a white flash on every load,
 * worst on the slowest machine. That script cannot import anything, so the
 * storage key and the three choice names are written twice.
 *
 * This is the cheap substitute for not duplicating them: if the two ever
 * disagree, the preference silently stops being read at boot and the flash
 * comes back — a bug nobody reports because the dashboard still works.
 */
const html = readFileSync(resolve(__dirname, "../../../admin.html"), "utf8");

describe("the pre-paint theme script agrees with useTheme", () => {
  it("uses the same localStorage key", () => {
    expect(html).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("names the two choices that need naming", () => {
    // `light` is deliberately absent from the script: the light palette is what
    // `:root` declares, so light is the *absence* of the attribute and needs no
    // branch. Only `dark` and `system` change what it does, and a fourth choice
    // added later would fall through to light, which is the safe default.
    expect(html).toContain('"dark"');
    expect(html).toContain('"system"');
  });

  it("agrees with useTheme about which choices exist", () => {
    expect(THEME_CHOICES.map((c) => c.value).sort()).toEqual(["dark", "light", "system"]);
  });

  it("writes the attribute the stylesheet and the Tailwind config key off", () => {
    // `tailwind.admin.config.ts` selects dark with `[data-theme="dark"]` and
    // `admin.css` declares the palette under the same selector. Three files
    // have to agree on this string.
    expect(html).toContain('setAttribute("data-theme", "dark")');

    const css = readFileSync(resolve(__dirname, "../admin.css"), "utf8");
    expect(css).toContain(':root[data-theme="dark"]');

    const config = readFileSync(resolve(__dirname, "../../../tailwind.admin.config.ts"), "utf8");
    expect(config).toContain('[data-theme="dark"]');
  });

  it("runs before the module bundle, or it cannot prevent the flash", () => {
    // The whole point is ordering. A script tag that moved below the bundle
    // would still work and still flash.
    const script = html.indexOf("iem.admin.theme");
    const bundle = html.indexOf("/src/admin/main.tsx");
    expect(script).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(-1);
    expect(script).toBeLessThan(bundle);
  });

  it("offers system, light and dark — in that order", () => {
    // "System" leads because it is the default, and a settings list whose first
    // option is not the default reads as though something has been chosen.
    expect(THEME_CHOICES.map((c) => c.value)).toEqual(["system", "light", "dark"]);
  });
});
