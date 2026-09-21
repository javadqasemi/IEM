import { resolve } from "node:path";
import { SCREENS, expect, expectClean, setTheme, settleImages, test } from "./fixtures";

/**
 * Where the screenshots go.
 *
 * A fixed folder rather than `testInfo.outputPath`, which is scoped to the
 * per-test results directory and refuses a path that climbs out of it. These
 * are meant to be browsed as a set — every screen, both themes, side by side —
 * not filed under the test that happened to take them.
 */
const shot = (width: string, theme: string, name: string) =>
  resolve(process.cwd(), "e2e/shots", width, theme, `${name}.png`);

/**
 * Every screen the dashboard serves, in both themes, at the running width.
 *
 * One spec rather than one per screen, because the interesting assertions are
 * the ones that apply to all of them: it rendered, nothing threw, no request
 * failed, and the theme actually reached the page. A per-screen spec would
 * repeat that thirteen times and still not say more.
 *
 * Screenshots are written for every screen in both themes. They are the record
 * a person can look at — this suite can prove an element exists and cannot
 * prove it looks right.
 */
test.describe("screens", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  /**
   * The list itself, before anything is rendered from it.
   *
   * A duplicate `name` is not the harmless thing it looks like. Screenshots
   * are filed by name, so the second entry silently overwrites the first
   * one's image; `a11y.spec.ts` keys its report by name, so one screen's
   * violations are reported twice under a single id and read as two separate
   * faults. Both happened in one run of P2-3, where a rebuilt section was
   * added beside the stale entry it was meant to replace rather than over it.
   * It navigates to nothing and asserts against the list in memory, so it
   * costs a millisecond and catches a copy-paste.
   */
  test("the screen list has no duplicate name", async () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const screen of SCREENS) {
      const first = seen.get(screen.name);
      if (first) clashes.push(`${screen.name}: ${first} and ${screen.path}`);
      else seen.set(screen.name, screen.path);
    }
    expect(clashes.join("\n"), "duplicate SCREENS names").toBe("");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`render in the ${theme} theme`, async ({ page, collected }, testInfo) => {
      const width = testInfo.project.name;

      for (const screen of SCREENS) {
        await page.goto(`/admin.html#${screen.path}`);
        await setTheme(page, theme);

        // The shell is always present once signed in; waiting on it rather than
        // on a network idle keeps this honest about lazy chunks.
        await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();

        // The skeleton has a live region; it must go away.
        await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

        // Something on the page identifies it. `first()` because a heading's
        // words legitimately appear in the rail as well.
        await expect(page.getByText(screen.heading).first()).toBeVisible({ timeout: 15_000 });

        // The theme reached the document, not just localStorage.
        const attr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
        expect(attr, `data-theme on ${screen.name}`).toBe(theme === "dark" ? "dark" : null);

        /**
         * Wait for the pictures before taking the picture.
         *
         * Media tiles and team portraits are `loading="lazy"`, so they begin
         * fetching when they enter the viewport and finish some time after the
         * heading this test waits on. Screenshotting before that produced tiles
         * that were empty in *both* themes — which reads exactly like a broken
         * image and cost a diagnosis before the DOM said `naturalWidth: 2560`
         * and `complete: true`.
         *
         * These files are the deliverable a person actually looks at, so they
         * have to show what the screen shows. Bounded, because a screen with no
         * images should not pay for the wait.
         */
        // A slow image is not worth failing a render test over, so the result
        // is ignored here — `performance.spec.ts` is where a broken one fails.
        await settleImages(page, 6_000);

        // The capture itself needed the full Chromium build rather than the
        // headless shell to include composited regions at small viewports —
        // see `channel` in playwright.config.ts. A scroll-through pass was
        // tried first and did not help; it is not here because it did nothing.
        await page.screenshot({ path: shot(width, theme, screen.name), fullPage: true });
      }

      expectClean(collected, `${width}/${theme}`);
    });
  }

  /**
   * The page ground actually changes with the theme.
   *
   * The `data-theme` check above proves the attribute is set. This proves the
   * stylesheet reacted to it — a token that failed to resolve would leave the
   * attribute correct and the page white, which is precisely the silent failure
   * the unit tests guard against from the other side.
   */
  test("the dark theme repaints the page", async ({ page }) => {
    await page.goto("/admin.html#/");
    await setTheme(page, "light");
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await setTheme(page, "dark");
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    expect(light).not.toBe(dark);
    // And the dark one is genuinely dark, rather than merely different.
    const [r, g, b] = /(\d+),\s*(\d+),\s*(\d+)/.exec(dark)!.slice(1).map(Number);
    expect(r + g + b, `dark body background was ${dark}`).toBeLessThan(160);
  });

  /**
   * No element overflows the viewport horizontally.
   *
   * The failure a responsive layout has, and one that a screenshot at full page
   * height hides: a table or a toolbar that pushes the document sideways gives
   * the whole page a horizontal scrollbar on a phone.
   */
  test("nothing overflows horizontally", async ({ page }, testInfo) => {
    const offenders: string[] = [];

    for (const screen of SCREENS) {
      await page.goto(`/admin.html#${screen.path}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
      await page.waitForTimeout(150);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scroll: doc.scrollWidth, client: doc.clientWidth };
      });
      // One pixel of slack for sub-pixel rounding at fractional zoom.
      if (overflow.scroll > overflow.client + 1) {
        offenders.push(
          `${screen.name}: scrollWidth ${overflow.scroll} > clientWidth ${overflow.client}`,
        );
      }
    }

    expect(offenders, `horizontal overflow at ${testInfo.project.name}`).toEqual([]);
  });
});
