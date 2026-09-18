import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, expectClean, setTheme, test } from "./fixtures";

/**
 * The project view: its tabs, its URLs, and the placeholder in the unbuilt ones.
 *
 * `screens.spec.ts` and `a11y.spec.ts` already walk `/projekte` in both themes
 * at three widths, because the list is in `SCREENS`. The **detail** cannot be,
 * because its path needs an id from the database — and it is also the one
 * screen in the dashboard whose interesting behaviour is not "it rendered": it
 * has fourteen tabs, seven of which are this feature's own and seven of which
 * are a placeholder standing in for a module that does not exist.
 *
 * Three things are asserted here that nothing else can reach:
 *
 * 1. **The tab is in the URL.** A project view whose state lives in `useState`
 *    cannot be linked to, cannot be reopened where it was left, and loses its
 *    place on every reload. The test navigates *directly* to a tab's URL as
 *    well as clicking to it, because those are different code paths and only
 *    one of them is exercised by a person clicking around.
 * 2. **No tab is empty.** The firm's rule, verbatim: an empty tab is
 *    indistinguishable from a broken one. Every unbuilt tab has to say what it
 *    will be, that it is not implemented, and in what state.
 * 3. **The strip is a `<nav>`, not a tablist.** The links change the route;
 *    telling a screen reader a panel is about to swap would describe something
 *    that does not happen.
 */

const shot = (width: string, name: string) =>
  resolve(process.cwd(), "e2e/shots", width, "projects", `${name}.png`);

/**
 * The tabs this feature owns, each named by a **card heading** it must render.
 *
 * Headings rather than any matching text, and both of the alternatives were
 * tried and are wrong: `getByText("Auftrag")` also matches "Auftragswert", and
 * `getByText(/Meilensteine/)` matched four nodes — the card title, the sentence
 * under it, and two on the overview — of which `.first()` happened to be one
 * that was not on screen. A card title is the one string that appears exactly
 * once per tab, which is what makes it an assertion rather than a coincidence.
 */
const OWNED = [
  { slug: "uebersicht", heading: "Aufmerksamkeit" },
  { slug: "team", heading: "Team" },
  { slug: "gewerke", heading: "Gewerke" },
  { slug: "termine", heading: "Meilensteine" },
  { slug: "kunde", heading: "Bauherrschaft" },
  { slug: "gebaeude", heading: "Objekt" },
  // Promoted out of the placeholders when the version history arrived (F13).
  { slug: "verlauf", heading: "Verlauf" },
];

const card = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

/**
 * A module's tab that does **not** exist yet. Every one must carry the
 * placeholder.
 *
 * `aufgaben` left this list in Wave 2 and moved to `EMBEDDED_BUILT` below — a
 * placeholder is removed by building the thing, and the test follows. The
 * distinction is not cosmetic: both kinds are `owned: false`, because a task is
 * not the project's data either way, and what separates them is only whether
 * the shell composed a screen in for the slug.
 */
const EMBEDDED_PLANNED = ["phasen", "sitzungen", "dokumente", "plaene", "bim", "finanzen"];

/**
 * The embedded tabs that are built, with what proves each one rendered.
 *
 * It is a **different module's screen inside this one's route**, which is the
 * whole container/owner arrangement (`docs/enterprise-architecture.md` §4.4.1)
 * and the thing worth an assertion: `features/projects` imports nothing from
 * `features/tasks`, `admin/pages/ProjectPage.tsx` puts them together, and if
 * that composition is ever dropped the tab falls back to a placeholder rather
 * than breaking — which is exactly the silent regression this catches.
 */
const EMBEDDED_BUILT = [{ slug: "aufgaben", column: "Offen" }];

/**
 * Opens the first project from the list, and returns its id.
 *
 * Through the UI rather than through the API, because the click is itself worth
 * testing — the list navigates to a route, and a drawer would have been the
 * easier thing to build and the wrong one.
 */
async function openFirstProject(page: Page): Promise<string> {
  await page.goto("/admin.html#/projekte");
  await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

  // Matched on the number *anywhere* in the row, not anchored to its start: the
  // first cell renders the name above the number, so the row's text begins with
  // the project's name. Anchoring found nothing and read as an empty list.
  const row = page.getByRole("row").filter({ hasText: /P-\d{4}-\d{3}/ }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toMatch(
    /#\/projekte\/[\w-]+$/,
  );
  return new URL(page.url()).hash.split("/")[2];
}

test.describe("the project view", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("opens from the list and puts the tab in the URL", async ({ page, collected }) => {
    const id = await openFirstProject(page);

    // The bare URL and the first tab are the same page. The list links to the
    // bare form, because a URL with a redundant segment invites people to
    // wonder which one is canonical.
    await expect(page.getByRole("navigation", { name: "Projektbereiche" })).toBeVisible();
    await expect(card(page, "Auftrag")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("link", { name: /^Gewerke/ }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#/projekte/${id}/gewerke`);
    await expect(card(page, "Gewerke")).toBeVisible({ timeout: 15_000 });

    // The other direction: a pasted link has to land on the same tab. This is
    // the path a colleague takes and the one a click never exercises.
    await page.goto(`/admin.html#/projekte/${id}/termine`);
    await expect(card(page, "Meilensteine")).toBeVisible({ timeout: 15_000 });

    expectClean(collected, "project detail");
  });

  test("marks the strip as navigation, not as a tablist", async ({ page }) => {
    const id = await openFirstProject(page);
    await page.goto(`/admin.html#/projekte/${id}/team`);

    const strip = page.getByRole("navigation", { name: "Projektbereiche" });
    await expect(strip).toBeVisible();
    // The links change the route. `role="tab"` would promise a panel swap.
    await expect(strip.getByRole("tab")).toHaveCount(0);
    await expect(strip.getByRole("link").first()).toBeVisible();
    // The current tab is marked for a screen reader, not only by its underline.
    await expect(strip.locator("[aria-current='page']")).toHaveCount(1);
  });

  test("renders every tab it owns", async ({ page, collected }) => {
    const id = await openFirstProject(page);

    for (const { slug, heading } of OWNED) {
      await page.goto(`/admin.html#/projekte/${id}/${slug}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByRole("navigation", { name: "Projektbereiche" })).toBeVisible();
      /*
        Each owned tab is checked for its **own** content rather than for the
        absence of a placeholder, and the difference is the container rule
        working as intended: "Bauherrschaft" and "Gebäude" show the project's
        link to those records *and* a placeholder for the module that will own
        the rest of them. An assertion that no placeholder appears would have
        forbidden exactly the arrangement the architecture asks for — it did,
        and this is the corrected version.
      */
      await expect(card(page, heading), `${slug} did not render`).toBeVisible({ timeout: 15_000 });
    }

    expectClean(collected, "owned tabs");
  });

  test("shows a placeholder in every tab whose module does not exist", async ({ page }) => {
    const id = await openFirstProject(page);

    for (const slug of EMBEDDED_PLANNED) {
      await page.goto(`/admin.html#/projekte/${id}/${slug}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

      // The firm's three requirements, checked one by one.
      await expect(
        page.getByText("Dieses Modul ist noch nicht implementiert."),
        `${slug} has no placeholder`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(/Geplant|In Entwicklung/).first(),
        `${slug} has no status`,
      ).toBeVisible();
      // And a description: the tab explains itself rather than merely promising.
      const description = page.locator("section p").first();
      await expect(description).toBeVisible();
      expect((await description.innerText()).length, `${slug} has no description`).toBeGreaterThan(
        40,
      );
    }
  });

  test("renders another module's screen in the tabs that are built", async ({ page }) => {
    /**
     * The other half of the test above, and the one that would otherwise be
     * missing: a tab that is built must show the module, **not** the
     * placeholder. Without this, dropping the `embedded` map from
     * `ProjectPage.tsx` would turn a working board back into "Dieses Modul ist
     * noch nicht implementiert." and every assertion in this file would still
     * pass.
     */
    const id = await openFirstProject(page);

    for (const { slug, column } of EMBEDDED_BUILT) {
      await page.goto(`/admin.html#/projekte/${id}/${slug}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

      await expect(
        page.getByRole("heading", { name: column, exact: true }),
        `${slug} did not render the embedded module`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText("Dieses Modul ist noch nicht implementiert."),
        `${slug} is built but still shows a placeholder`,
      ).toHaveCount(0);
    }
  });

  test("falls back to the overview for a tab nobody has heard of", async ({ page }) => {
    // A stale link from an e-mail, or a tab that was renamed. The overview is
    // the right answer; a blank page or a 404 inside the shell is not.
    const id = await openFirstProject(page);
    await page.goto(`/admin.html#/projekte/${id}/gibtsnicht`);
    await expect(card(page, "Auftrag")).toBeVisible({ timeout: 15_000 });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the detail passes axe in the ${theme} theme`, async ({ page }, testInfo) => {
      const id = await openFirstProject(page);
      const failures: string[] = [];

      // Three tabs rather than fourteen: the overview (dense, two cards of
      // definition lists), the Gewerke (the colour dots and the running total)
      // and one placeholder. Between them they cover every component this
      // screen introduces, and fourteen axe passes per theme per width is four
      // minutes of the suite for no more coverage.
      for (const slug of ["uebersicht", "gewerke", "plaene"]) {
        await page.goto(`/admin.html#/projekte/${id}/${slug}`);
        await setTheme(page, theme);
        await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
        await page.waitForTimeout(250);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        for (const violation of results.violations) {
          failures.push(
            `${slug} [${theme}] ${violation.id} (${violation.impact}): ${violation.help}\n` +
              violation.nodes
                .slice(0, 3)
                .map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary}`)
                .join("\n"),
          );
        }

        await page.screenshot({
          path: shot(testInfo.project.name, `${slug}-${theme}`),
          fullPage: true,
        });
      }

      expect(failures.join("\n\n"), `axe violations (${theme})`).toBe("");
    });
  }
});
