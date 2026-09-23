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
 * it never lands. On desktop this is a no-op.
 */
async function openRail(page: Page): Promise<void> {
  const toggle = railToggle(page);
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/**
 * The rail as workspaces (P1B): what is marked current, which workspace is
 * open, and the phone's off-canvas behaviour.
 *
 * The unit tests render the rail and assert the derivation for every role;
 * these exist because the interesting behaviour is *interactive* — a click
 * navigates, a navigation re-derives which workspace is open, a breakpoint
 * turns the column into a drawer. The per-role matrix, the palette's security
 * and the deep links are `p1b-navigation.spec.ts`.
 */
test.describe("navigation", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  const rail = "nav[aria-label='Hauptnavigation']";

  test("marks the destination you are on, and only that one", async ({ page }) => {
    await page.goto("/admin.html#/rollen");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(`${rail} a[href="#/benutzer"]`)).not.toHaveAttribute("aria-current", "page");

    await page.goto("/admin.html#/benutzer");
    await expect(page.locator(`${rail} a[href="#/benutzer"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).not.toHaveAttribute("aria-current", "page");
  });

  test("opens the workspace the route is in and closes it when you leave", async ({ page }) => {
    await page.goto("/admin.html#/benutzer");
    await openRail(page);
    await expect(page.locator(`${rail} p[data-workspace="people"]`)).toBeVisible();
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toBeVisible();

    await page.goto("/admin.html#/medien");
    await expect(page.locator(`${rail} a[href="#/rollen"]`)).toHaveCount(0);
    await expect(page.locator(`${rail} a[data-workspace="people"]`)).toHaveCount(1);
  });

  test("a closed workspace is a link to its first destination", async ({ page }) => {
    await page.goto("/admin.html#/medien");
    await openRail(page);
    await page.locator(`${rail} a[data-workspace="people"]`).click();
    await expect(page).toHaveURL(/#\/bewerbungen$/);
  });

  test("a single-destination workspace is a plain link, never a disclosure", async ({ page }) => {
    await page.goto("/admin.html#/medien");
    await expect(page.locator(`${rail} a[data-workspace="overview"]`)).toHaveAttribute("href", "#/");
    await expect(page.locator(`${rail} [aria-expanded]`)).toHaveCount(0);
  });

  test("search reaches a page the rail does not list", async ({ page }) => {
    await page.goto("/admin.html#/");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Seite oder Bereich suchen" }).fill("Mein Konto");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/profil$/);
  });

  test("every rail link resolves to a screen rather than the not-found page", async ({
    page,
    collected,
  }) => {
    // The broken-link check, against what actually renders: every workspace
    // row, and every destination inside each workspace once it is open.
    await page.goto("/admin.html#/");
    const rows = await page.locator(`${rail} a[data-workspace]`).evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!),
    );
    const hrefs = new Set<string>(rows);
    for (const row of rows) {
      await page.goto(`/admin.html${row}`);
      for (const href of await page.locator(`${rail} a[href^="#/"]`).evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!),
      )) {
        hrefs.add(href);
      }
    }
    expect(hrefs.size).toBeGreaterThan(20);

    for (const href of hrefs) {
      await page.goto(`/admin.html${href}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByText("Diese Seite gibt es nicht."), `${href} renders not-found`).toHaveCount(0);
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
      await expect(rail).toBeInViewport();
      await expect(toggle).toBeHidden();
      return;
    }

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(rail).toBeInViewport();

    // A route change closes it again, or the reader lands behind a panel.
    await page.locator("#admin-rail a[data-workspace='website']").click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("below lg, the open workspace's destinations sit above the page", async ({ page }, testInfo) => {
    const strip = page.getByRole("navigation", { name: "Bereiche in Projekte" });
    await page.goto("/admin.html#/sitzungen");
    if (testInfo.project.name === "desktop") {
      await expect(strip).toBeHidden();
      return;
    }
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("link", { name: "Sitzungen" })).toHaveAttribute("aria-current", "page");
  });
});

/**
 * Breadcrumbs and the top bar (foundation stage F4, with P1B's workspace name).
 */
test.describe("the trail and the bar", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("a top-level screen shows no trail, only its workspace", async ({ page }) => {
    await page.goto("/admin.html#/medien");
    await expect(page.getByRole("heading", { name: /Medien/i }).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Brotkrumen" })).toHaveCount(0);
    await expect(page.locator("h2[data-shell-title]")).toHaveText("Website");
  });

  test("a nested screen shows the chain, and the parent link works", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "the trail is hidden below sm: the bar already wraps");

    await page.goto("/admin.html#/inhalte/projects");
    const trail = page.getByRole("navigation", { name: "Brotkrumen" });
    await expect(trail).toBeVisible();
    await expect(trail.getByRole("link", { name: "Inhalte" })).toBeVisible();
    await expect(trail.locator("a")).toHaveCount(1);

    await page.locator("main a[href^='#/inhalte/projects/']").first().click();
    const parentLink = trail.locator("a[href='#/inhalte/projects']");
    await expect(parentLink).toBeVisible();
    await expect(trail.locator("a")).toHaveCount(2);

    await parentLink.click();
    await expect(page).toHaveURL(/#\/inhalte\/projects$/);
  });

  test("the audit export is published to the bar, not to the page", async ({ page }) => {
    await page.goto("/admin.html#/audit");
    const header = page.locator("header.glass-bar");
    await expect(header.getByRole("button", { name: /Als CSV exportieren/i })).toBeVisible();
    await page.goto("/admin.html#/medien");
    await expect(header.getByRole("button", { name: /Als CSV exportieren/i })).toHaveCount(0);
  });
});

/**
 * The unsaved-changes guard (foundation stage F5): leaving through the *rail*.
 */
test.describe("unsaved changes", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("refuses a rail click while a form is dirty, and honours both answers", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the rail is off-canvas below lg");

    await page.goto("/admin.html#/inhalte/projects");
    await page.locator("main a[href^='#/inhalte/projects/']").first().click();
    await expect(page).toHaveURL(/#\/inhalte\/projects\/.+/);
    const editing = page.url();

    const firstInput = page.locator("main input[type='text']").first();
    await firstInput.click();
    await firstInput.type("X");

    // Medien is a destination of the open Website workspace.
    await page.locator("#admin-rail a[href='#/medien']").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Änderungen verwerfen?")).toBeVisible();

    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page).toHaveURL(editing);
    await expect(firstInput).toBeVisible();

    await page.locator("#admin-rail a[href='#/medien']").click();
    await expect(dialog.getByText("Änderungen verwerfen?")).toBeVisible();
    await dialog.getByRole("button", { name: "Verwerfen" }).click();
    await expect(page).toHaveURL(/#\/medien$/);
  });

  test("lets a clean form leave without asking", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the rail is off-canvas below lg");

    await page.goto("/admin.html#/inhalte/projects");
    await page.locator("main a[href^='#/inhalte/projects/']").first().click();
    await expect(page).toHaveURL(/#\/inhalte\/projects\/.+/);

    await page.locator("#admin-rail a[href='#/medien']").click();
    await expect(page).toHaveURL(/#\/medien$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
