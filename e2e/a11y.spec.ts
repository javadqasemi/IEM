import AxeBuilder from "@axe-core/playwright";
import { SCREENS, expect, setTheme, test } from "./fixtures";

/**
 * WCAG 2.1 AA, on every screen, in both themes.
 *
 * The unit suite already proves the *palette* clears AA — it computes contrast
 * from the declared tokens. That is a stronger check than axe can make (it
 * covers pairs no screenshot happens to show) and a much narrower one: it says
 * nothing about a missing label, a heading that skips a level, a control with
 * no accessible name, or a contrast failure produced by two tokens meeting in a
 * combination nobody predicted. This is the other half.
 *
 * Both themes are scanned because contrast is theme-dependent and a dark theme
 * is where a borrowed foreground goes wrong.
 */
test.describe("accessibility", () => {
  /**
   * Three minutes, not the suite's 45 seconds.
   *
   * Each case walks thirteen screens and runs a full axe pass on every one;
   * on desktop that lands at ~45s, which is to say exactly on the default and
   * therefore green or red depending on the machine. Tablet and mobile crossed
   * it and reported as failures with no violations in them — the worst kind of
   * red, because it looks like a finding.
   */
  test.setTimeout(180_000);

  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`WCAG 2.1 AA — ${theme} theme`, async ({ page }, testInfo) => {
      const failures: string[] = [];

      for (const screen of SCREENS) {
        await page.goto(`/admin.html#${screen.path}`);
        await setTheme(page, theme);
        await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
        // Let the lazy chunk paint before scanning it.
        await page.waitForTimeout(250);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          /**
           * The embedded live site is excluded.
           *
           * "Website bearbeiten" renders the public page inside an iframe. It
           * is a different application with its own markup and its own
           * stylesheet, and auditing it here would report the *site's* issues
           * as the dashboard's — it deserves its own pass, not a footnote in
           * this one.
           */
          .exclude("iframe")
          .analyze();

        for (const v of results.violations) {
          failures.push(
            `${screen.name} [${theme}] ${v.id} (${v.impact}): ${v.help}\n` +
              v.nodes
                .slice(0, 3)
                .map((n) => `        ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[0]}`)
                .join("\n"),
          );
        }
      }

      expect(failures.join("\n\n"), `axe violations at ${testInfo.project.name}/${theme}`).toBe("");
    });
  }

});

/**
 * The sign-in screen, scanned signed out.
 *
 * Its own `describe` because the one above signs in before every test — which
 * is why the first attempt at this never found the form: the fixture had
 * already dismissed it, and clearing cookies afterwards does not put it back.
 *
 * Worth a case of its own regardless: it is the one page every user meets and
 * the only one an unauthenticated visitor can reach.
 */
test.describe("accessibility — signed out", () => {
  test("WCAG 2.1 AA — sign-in screen", async ({ browser }) => {
    // A context of its own: the shared worker context is signed in, and the
    // sign-in screen cannot be reached from inside a live session.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/admin.html#/");
    await expect(page.getByRole("heading", { name: /Anmelden/i })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const summary = results.violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.slice(0, 3).map((n) => `        ${n.target.join(" ")}`).join("\n"),
    );
    expect(summary.join("\n")).toBe("");
    await context.close();
  });
});
