import type { Page } from "@playwright/test";
import { expect, expectClean, test } from "./fixtures";

/**
 * The toggle, matched exactly.
 *
 * While the drawer is open the scrim behind it is also a button, labelled
 * "Navigation schliessen" — which a substring match on "Navigation" picks up
 * too, and Playwright then refuses the ambiguity. Worth the `exact`: the two
 * do opposite things.
 */
const railToggle = (page: Page) => page.getByRole("button", { name: "Navigation", exact: true });

/**
 * Makes the rail operable at whatever width the project is running.
 *
 * Below `lg` it is a drawer, translated off-canvas, so a click on a row inside
 * it never lands — the test times out after 45 seconds and reads as though the
 * rail were broken. It is not; it is closed. On desktop this is a no-op.
 */
async function openRail(page: Page): Promise<void> {
  const toggle = railToggle(page);
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/**
 * The rail: folding, the accordion, what is marked current, and the phone's
 * off-canvas behaviour.
 *
 * The unit tests already render the rail and assert its markup. These exist
 * because the rail's interesting behaviour is *interactive* — a click toggles,
 * a navigation re-derives, a breakpoint changes it from a column to a drawer —
 * and none of that is observable from `renderToStaticMarkup`.
 */
test.describe("navigation", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  const rail = "nav[aria-label='Hauptnavigation']";

  test("marks the entry you are on, and only that one", async ({ page }) => {
    /**
     * The check a screenshot prompted: at `/rollen` the sibling entry
     * "Benutzer" sits directly above "Rollen" in the same open group, and the
     * two are easy to confuse by eye. `aria-current` is the thing a screen
     * reader announces, so it is the thing worth asserting.
     */
    await page.goto("/admin.html#/rollen");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(`${rail} a[href="#/benutzer"]`)).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.goto("/admin.html#/benutzer");
    await expect(page.locator(`${rail} a[href="#/benutzer"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("opens the group the route is in and closes it when you leave", async ({ page }) => {
    await page.goto("/admin.html#/benutzer");
    await openRail(page);
    const group = page.locator(`${rail} button:has-text("Benutzer & Rollen")`);
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toBeVisible();

    await page.goto("/admin.html#/medien");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toHaveCount(0);
  });

  test("folds a group open on click and shut again", async ({ page }) => {
    await page.goto("/admin.html#/medien");
    await openRail(page);
    const toggle = page.locator(`${rail} button:has-text("Benutzer & Rollen")`);

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toHaveCount(0);
  });

  test("opening one group closes the other", async ({ page }) => {
    // The accordion. Without it the Website block alone unfolds to 36 rows.
    await page.goto("/admin.html#/medien");
    await openRail(page);
    const people = page.locator(`${rail} button:has-text("Benutzer & Rollen")`);
    const system = page.locator(`${rail} button:has-text("System")`);

    await people.click();
    await expect(people).toHaveAttribute("aria-expanded", "true");

    await system.click();
    await expect(system).toHaveAttribute("aria-expanded", "true");
    await expect(people).toHaveAttribute("aria-expanded", "false");
  });

  test("remembers a deliberately opened group across a reload", async ({ page }) => {
    await page.goto("/admin.html#/medien");
    await openRail(page);
    await page.locator(`${rail} button:has-text("Benutzer & Rollen")`).click();
    await page.reload();
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toBeVisible();
  });

  test("gives a single-destination group no disclosure", async ({ page }) => {
    await page.goto("/admin.html#/");
    // "Medien" is one page; a control that reveals nothing is furniture.
    await expect(page.locator(`${rail} button:has-text("Medien")`)).toHaveCount(0);
  });

  test("search reaches a destination the rail does not list", async ({ page }) => {
    await page.goto("/admin.html#/");
    await openRail(page);
    await page.getByRole("searchbox", { name: /Navigation durchsuchen/i }).fill("Audit");
    const hit = page.locator(`${rail} a[href="#/audit"]`);
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(/#\/audit$/);
  });

  test("every rail link resolves to a screen rather than the not-found page", async ({
    page,
    collected,
  }) => {
    // The broken-link check. `navigation.ts` says a menu entry pointing at a
    // route the app does not serve is a broken link; the unit test asserts that
    // against the route table, and this asserts it against what actually
    // renders.
    await page.goto("/admin.html#/");
    const hrefs = await page.locator(`${rail} a[href^="#/"]`).evaluateAll((els) =>
      [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!))],
    );
    expect(hrefs.length).toBeGreaterThan(5);

    for (const href of hrefs) {
      await page.goto(`/admin.html${href}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
      await expect(
        page.getByText("Diese Seite gibt es nicht."),
        `${href} renders the not-found screen`,
      ).toHaveCount(0);
      await expect(
        page.getByText("Dafür fehlt Ihnen die Berechtigung."),
        `${href} is refused to a Super Admin`,
      ).toHaveCount(0);
    }

    expectClean(collected, "rail links");
  });
});

/**
 * The rail is a drawer below `lg`, and a column at and above it.
 *
 * Asserted per project rather than by resizing inside one test, so the failure
 * names the width it happened at.
 */
test.describe("the rail at this width", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("is reachable", async ({ page }, testInfo) => {
    const rail = page.locator("#admin-rail");
    const toggle = railToggle(page);

    if (testInfo.project.name === "desktop") {
      // Pinned open, no toggle offered.
      await expect(rail).toBeInViewport();
      await expect(toggle).toBeHidden();
      return;
    }

    // Tablet and phone: off-canvas until asked for.
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(rail).toBeInViewport();

    // A route change closes it again, or the reader lands behind a panel.
    await page.locator("#admin-rail a[href='#/medien']").click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
