import type { Browser, Page } from "@playwright/test";
import { TEST_PASSWORD, expect, spendLogin, test } from "./fixtures";

/**
 * P1B — the workspace navigation, per role, **in a browser**.
 *
 * `src/admin/lib/navigation.test.ts` asserts the derivation for every seeded
 * role against the server's catalogue. This asserts what the unit tests cannot
 * see: that a *signed-in* person of that role is drawn exactly those rows, that
 * the palette offers them nothing more, that a deep link still resolves and a
 * forbidden one still refuses, and that the active state follows the browser's
 * own back and forward.
 *
 * Runs once (`SIGNS_IN_TWICE` in `playwright.config.ts`): seven personas sign
 * in through the form, each paced by `spendLogin`, and at three widths that
 * would be twenty-one sign-ins against a budget of ten a minute.
 */

const RAIL = "nav[aria-label='Hauptnavigation']";

/** The workspace rows the rail draws, by id, in order. */
async function workspaces(page: Page): Promise<string[]> {
  return page
    .locator(`${RAIL} [data-workspace]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-workspace") ?? ""));
}

async function settle(page: Page) {
  await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
}

/** Opens the palette with the keyboard and types. */
async function palette(page: Page, query: string) {
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Seite oder Bereich suchen" });
  await expect(box).toBeFocused();
  await box.fill(query);
  return page.getByRole("listbox");
}

async function signInAs(browser: Browser, email: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await spendLogin();
  await page.goto("/admin.html#/");
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.getByLabel(/Passwort/i).first().fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^Anmelden$/ }).click();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }), `${email} sign-in`).toBeVisible({
    timeout: 30_000,
  });
  return { page, close: () => context.close() };
}

/* ================================================================== */
/* Super Admin — the shared context                                    */
/* ================================================================== */

test.describe("Super Admin", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("seven workspaces, and Website → Freigaben → Veröffentlichen → System", async ({ page }) => {
    await page.goto("/admin.html#/");
    await settle(page);
    expect(await workspaces(page)).toEqual([
      "overview",
      "tasks",
      "projects",
      "website",
      "people",
      "company",
      "system",
    ]);

    // Website opens on its first destination and unfolds its own list.
    await page.locator(`${RAIL} a[data-workspace="website"]`).click();
    await expect(page).toHaveURL(/#\/inhalte$/);
    await expect(page.locator("h2[data-shell-title]")).toHaveText("Website");
    await expect(page.locator(`${RAIL} a[href="#/inhalte"]`)).toHaveAttribute("aria-current", "page");

    await page.locator(`${RAIL} a[href="#/freigaben"]`).click();
    await expect(page).toHaveURL(/#\/freigaben$/);
    await expect(page.locator(`${RAIL} a[href="#/freigaben"]`)).toHaveAttribute("aria-current", "page");

    await page.locator(`${RAIL} a[href="#/veroeffentlichen"]`).click();
    await expect(page).toHaveURL(/#\/veroeffentlichen$/);
    await expect(page.locator("h2[data-shell-title]")).toHaveText("Website");

    await page.locator(`${RAIL} a[data-workspace="system"]`).click();
    await expect(page).toHaveURL(/#\/system$/);
    await expect(page.locator("h2[data-shell-title]")).toHaveText("System");
    // Website closed again: one workspace open at a time.
    await expect(page.locator(`${RAIL} a[href="#/freigaben"]`)).toHaveCount(0);
  });

  test("the 35 content types are not rail rows, and are one search away", async ({ page }) => {
    await page.goto("/admin.html#/inhalte");
    await settle(page);
    await expect(page.locator(`${RAIL} a[href^="#/inhalte/"]`)).toHaveCount(0);

    const list = await palette(page, "team");
    await expect(list.getByRole("option").first()).toContainText("Website › Inhalte");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/inhalte\/team$/);
    // Owned by Website, and "Inhalte" is lit for it.
    await expect(page.locator("h2[data-shell-title]")).toHaveText("Website");
    await expect(page.locator(`${RAIL} a[href="#/inhalte"]`)).toHaveAttribute("aria-current", "page");
  });

  test("Ctrl+K → type → arrow → Enter opens the route; Escape closes and returns focus", async ({ page }) => {
    await page.goto("/admin.html#/");
    await settle(page);
    const list = await palette(page, "back");
    const options = list.getByRole("option");
    await expect(options.first()).toContainText("Sicherungen");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/sicherungen$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Escape closes without navigating.
    await palette(page, "mail");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Seite oder Bereich suchen" })).toBeHidden();
    await expect(page).toHaveURL(/#\/sicherungen$/);
  });

  test("the palette finds by alias and says when it finds nothing", async ({ page }) => {
    await page.goto("/admin.html#/");
    await settle(page);
    const list = await palette(page, "publ");
    await expect(list.getByRole("option").first()).toContainText("Veröffentlichen");
    await page.getByRole("combobox", { name: "Seite oder Bereich suchen" }).fill("xyzzy");
    await expect(page.getByText("Nichts gefunden.")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("deep links resolve to their workspace, and Back/Forward keep the rail right", async ({ page }) => {
    await page.goto("/admin.html#/projekte");
    await settle(page);
    await page.locator(`${RAIL} a[href="#/plaene"]`).click();
    await expect(page).toHaveURL(/#\/plaene$/);
    await page.locator("tbody [data-row-open]").first().click();
    await expect(page).toHaveURL(/#\/plaene\/[^/]+/);
    await expect(page.locator("h2[data-shell-title]")).toHaveText("Projekte");
    await expect(page.locator(`${RAIL} a[href="#/plaene"]`)).toHaveAttribute("aria-current", "page");

    await page.goBack();
    await expect(page).toHaveURL(/#\/plaene$/);
    await expect(page.locator(`${RAIL} a[href="#/plaene"]`)).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page).toHaveURL(/#\/projekte$/);
    await expect(page.locator(`${RAIL} a[href="#/projekte"]`)).toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expect(page).toHaveURL(/#\/plaene$/);
    await expect(page.locator(`${RAIL} a[href="#/plaene"]`)).toHaveAttribute("aria-current", "page");

    // Every route kept its path — there is nothing to redirect.
    for (const [path, workspace] of [
      ["/sitzungen", "Projekte"],
      ["/entscheide", "Projekte"],
      ["/planversand", "Projekte"],
      ["/einstellungen/email", "System"],
      ["/einstellungen/standorte", "Unternehmen"],
      ["/einstellungen/bewerbungen", "Personal"],
      ["/rollen", "Personal"],
      ["/audit", "System"],
    ] as const) {
      await page.goto(`/admin.html#${path}`);
      await settle(page);
      await expect(page).toHaveURL(new RegExp(`#${path}$`));
      await expect(page.locator("h2[data-shell-title]"), path).toHaveText(workspace);
      await expect(page.getByText("Diese Seite gibt es nicht.")).toHaveCount(0);
    }
  });

  test("at phone width: the drawer shows one workspace level, the strip the rest", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/admin.html#/sitzungen");
    await settle(page);

    const strip = page.getByRole("navigation", { name: "Bereiche in Projekte" });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("link", { name: "Sitzungen" })).toHaveAttribute("aria-current", "page");
    await strip.getByRole("link", { name: "Pläne" }).click();
    await expect(page).toHaveURL(/#\/plaene$/);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    // Seven rows at most, and only Projekte's destinations under them.
    expect((await workspaces(page)).length).toBeLessThanOrEqual(7);
    await expect(page.locator(`${RAIL} a[href="#/freigaben"]`)).toHaveCount(0);
    await expect(page.locator(`${RAIL} a[href="#/sitzungen"]`)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});

/* ================================================================== */
/* The personas                                                        */
/* ================================================================== */

type Persona = {
  email: string;
  workspaces: string[];
  /** A route the role may open, and the heading that proves it rendered. */
  allowed: string;
  /** A route the role may not open. */
  refused?: string;
  /** Search terms that must find nothing for this role. */
  hidden: string[];
};

const PERSONAS: Record<string, Persona> = {
  administrator: {
    email: "adm@iem.test",
    workspaces: ["overview", "tasks", "projects", "website", "people", "company", "system"],
    allowed: "/sicherungen",
    // `system.restore` is not the administrator's, but the list is; the
    // refusal here is the route guard for something they cannot hold at all.
    refused: undefined,
    hidden: [],
  },
  management: {
    email: "gl@iem.test",
    workspaces: ["overview", "tasks", "projects", "people", "company", "system"],
    allowed: "/audit",
    refused: "/sicherungen",
    hidden: ["Sicherungen", "Freigaben"],
  },
  projectManager: {
    email: "pl@iem.test",
    workspaces: ["overview", "tasks", "projects"],
    allowed: "/plaene",
    refused: "/benutzer",
    hidden: ["Sicherungen", "backup", "Audit", "Benutzer", "Freigaben", "Team"],
  },
  engineer: {
    email: "ing@iem.test",
    workspaces: ["overview", "tasks", "projects"],
    allowed: "/aufgaben",
    refused: "/audit",
    hidden: ["System", "E-Mail", "Rollen"],
  },
  hr: {
    email: "hr@iem.test",
    workspaces: ["overview", "projects", "website", "people"],
    allowed: "/bewerbungen",
    refused: "/audit",
    // `system.health` alone opens no System workspace any more.
    hidden: ["Systemzustand", "Diagnose", "Freigaben"],
  },
  contentEditor: {
    email: "redaktion@iem.test",
    workspaces: ["overview", "website"],
    allowed: "/inhalte",
    refused: "/projekte",
    // Not "Projekte": the content type "Referenzprojekte" is theirs to find.
    hidden: ["Freigaben", "Veröffentlichen", "Sitzungen", "Audit"],
  },
  guest: {
    email: "gast@iem.test",
    workspaces: ["overview", "website"],
    allowed: "/inhalte",
    refused: "/projekte",
    hidden: ["Sitzungen", "Medien", "Freigaben"],
  },
};

test.describe("each role sees its workspaces and nothing it cannot use", () => {
  test.skip(!TEST_PASSWORD, "SEED_TEST_USERS is not enabled on this machine.");
  test.setTimeout(150_000);

  for (const [name, persona] of Object.entries(PERSONAS)) {
    test(name, async ({ browser }) => {
      const { page, close } = await signInAs(browser, persona.email);
      try {
        await settle(page);
        expect(await workspaces(page), `${name}: rail`).toEqual(persona.workspaces);

        // No workspace is drawn empty: every row leads somewhere that renders.
        for (const id of persona.workspaces) {
          const row = page.locator(`${RAIL} [data-workspace="${id}"]`);
          if ((await row.evaluate((el) => el.tagName)) !== "A") continue; // the open one
          await row.click();
          await settle(page);
          await expect(page.getByText("Dafür fehlt Ihnen die Berechtigung."), `${name} › ${id}`).toHaveCount(0);
          await expect(page.getByText("Diese Seite gibt es nicht."), `${name} › ${id}`).toHaveCount(0);
        }

        // The palette offers nothing the rail would not.
        for (const term of persona.hidden) {
          const list = await palette(page, term);
          const labels = await list.getByRole("option").allTextContents();
          expect(
            labels.filter((label) => label.toLowerCase().includes(term.toLowerCase())),
            `${name} found "${term}" through search`,
          ).toEqual([]);
          await page.keyboard.press("Escape");
        }

        // A direct link it is allowed still works …
        await page.goto(`/admin.html#${persona.allowed}`);
        await settle(page);
        await expect(page.getByText("Dafür fehlt Ihnen die Berechtigung.")).toHaveCount(0);

        // … and one it is not still refuses. The server's 403 is the control;
        // this is the shell refusing first.
        if (persona.refused) {
          await page.goto(`/admin.html#${persona.refused}`);
          await settle(page);
          await expect(page.getByText("Dafür fehlt Ihnen die Berechtigung.")).toBeVisible();
        }
      } finally {
        await close();
      }
    });
  }
});
