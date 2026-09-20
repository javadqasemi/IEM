import { expect, test } from "./fixtures";

/**
 * Company settings, end to end, in the browser.
 *
 * The parts of this module that unit tests genuinely cannot reach:
 *
 * - **A save is one request.** `SaveBar`'s button is the enclosing form's
 *   submit and carries no `onClick`, because having both fired twice from one
 *   click — and the second `PATCH` carried the now-stale `expectedVersion` and
 *   came back **409**, so a save that had worked reported a conflict with
 *   itself. Nothing about that is visible to a unit test of either piece; it
 *   only exists where a real form element and a real click meet.
 * - **The value reaches the database and comes back.** Which is the brief's
 *   own acceptance criterion, and the only place the five layers are proven to
 *   be wired to each other rather than merely to their neighbours.
 * - **The unsaved-changes guard blocks a hash change.** `beforeunload` does
 *   not fire for one, which is the whole reason `useUnsavedGuard` exists, and
 *   a hash change is how every navigation in this dashboard happens.
 *
 * Every test restores what it changed. The suite runs serially against one
 * database and a spec that leaves the company's telephone number altered
 * would make the next reader's diff a mystery.
 */

const SECTION = "/admin.html#/einstellungen";

test.describe("Unternehmen", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("a save sends exactly one PATCH, and the value comes back", async ({ page }) => {
    await page.goto(`${SECTION}/kontakt`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    const field = page.getByLabel("Support", { exact: true });
    await expect(field).toBeVisible({ timeout: 15_000 });
    const original = await field.inputValue();

    /*
      A value derived from what is there, not a constant.

      The first version filled a fixed address — and when the test failed
      after the save but before the restore, the *next* run filled the field
      with what it already contained, produced no change, and failed one line
      earlier with "no unsaved changes". A test whose second run fails for a
      different reason than its first is a test that hides its own findings.
    */
    const probe = original === "hilfe@iem.ch" ? "support@iem.ch" : "hilfe@iem.ch";

    /*
      Counted rather than awaited.

      `waitForResponse` would resolve on the *first* PATCH and prove nothing
      about a second; the double submit this guards against is precisely a
      second request arriving after the first has already succeeded. So the
      listener stays attached across the save and the assertion is on the
      count.
    */
    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/organisation")) {
        patches.push(request.url());
      }
    });

    await field.fill(probe);
    await expect(page.getByText("Ungespeicherte Änderungen.", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 15_000 });

    // One click, one write. Two would mean the second answered 409 against the
    // first, and the reader would have been told their save conflicted.
    expect(patches, "one save must produce one PATCH").toHaveLength(1);

    // It survives a reload, which is the difference between a form that looks
    // saved and a record that is.
    await page.reload();
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByLabel("Support", { exact: true })).toHaveValue(probe, {
      timeout: 15_000,
    });

    // Put it back.
    await page.getByLabel("Support", { exact: true }).fill(original);
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 15_000 });
  });

  test("the unsaved-changes guard stops a hash change", async ({ page }) => {
    await page.goto(`${SECTION}/kontakt`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    const field = page.getByLabel("Support", { exact: true });
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill("wird-verworfen@iem.ch");

    /*
      Scoped to the workspace's own navigation.

      "Allgemein" is a link in **two** places — the rail's Unternehmen group
      and the section rail beside the form — and an unscoped `getByRole` is a
      strict-mode violation. Which is the `SideNav`'s `aria-label` earning its
      keep: the two are distinguishable because each nav landmark is named.
    */
    await page
      .getByRole("navigation", { name: "Einstellungsbereiche" })
      .getByRole("link", { name: "Allgemein" })
      .click();

    await expect(page.getByRole("heading", { name: "Änderungen verwerfen?" })).toBeVisible();
    // Refused means the address bar did not move either — a guard that let the
    // URL change and kept the screen would leave the two disagreeing.
    expect(page.url()).toContain("/einstellungen/kontakt");

    await page.getByRole("button", { name: "Verwerfen und verlassen" }).click();
    await expect(page).toHaveURL(/einstellungen\/unternehmen/);
  });

  test("the register says which offices the website will show", async ({ page }) => {
    await page.goto(`${SECTION}/standorte`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    /*
      The line that makes the single source of truth visible.

      `publicOffices` on the client mirrors `toSiteOffices` on the server, and
      this is the assertion that the register is describing the *same* rows the
      next publish will put on the site — the seeded pair, in `position` order.
    */
    const summary = page.getByText(/Auf der Website:/);
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("Thun");
    await expect(summary).toContainText("Bern");

    // Both seeded offices are in the table, with the addresses that are
    // checkable against iem.ch rather than the ones the old seed invented.
    await expect(page.getByRole("cell", { name: /Uttigenstrasse 49/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Sandrainstrasse 3/ })).toBeVisible();
  });

  test("the headquarters cannot be archived, and the refusal says what to do", async ({ page }) => {
    await page.goto(`${SECTION}/standorte`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    const thun = page.getByRole("row", { name: /Thun/ });
    await thun.getByRole("button", { name: "Archivieren" }).click();
    await expect(page.getByRole("heading", { name: /„Thun“ archivieren\?/ })).toBeVisible();
    await page.getByRole("button", { name: "Archivieren" }).last().click();

    /*
      The refusal is shown **in place**, not as a toast.

      Every message from `organisation.rules.ts` names the repair — here,
      promote another office first — and a toast puts that sentence where it
      disappears after four seconds.
    */
    const refusal = page.getByRole("alert").filter({ hasText: /Hauptsitz/ });
    await expect(refusal).toBeVisible({ timeout: 15_000 });
    await expect(refusal).toContainText("zuerst");

    // And it really did not archive: still on the website.
    await expect(page.getByText(/Auf der Website:/)).toContainText("Thun");
  });

  test("the System panel reports what it cannot measure rather than a zero", async ({ page }) => {
    await page.goto(`${SECTION}/system`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    // Measured figures. `exact` because the card's own description lists the
    // word too — the label is a `<dt>`, the description is a sentence.
    await expect(page.getByText("Migrationen", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/\d+ angewendet/)).toBeVisible();

    /*
      And the three honest absences. `version: null` with a reason beats
      `package.json`'s 0.0.1 — a number that never changes and looks like one
      that does — and "Nicht gebaut" beats a grey dash that reads the same as
      "not configured yet".
    */
    await expect(page.getByText(/Kein Build-Stempel/)).toBeVisible();
    await expect(page.getByText(/Es gibt keine Sicherungsautomatik/)).toBeVisible();
    await expect(page.getByText("Nicht gebaut").first()).toBeVisible();
  });

  test("a group that is not built says so instead of showing an empty form", async ({ page }) => {
    await page.goto(`${SECTION}/benachrichtigungen`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    // An absent section would make an administrator conclude the system has no
    // such feature and stop looking; a form with no effect is worse still.
    await expect(page.getByText(/Benachrichtigungsmodul ist noch nicht gebaut/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);
  });
});


