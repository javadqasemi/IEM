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
      Through the workspace navigation in the rail (P1B).

      The page's own section `SideNav` is gone — its sections belong to the
      workspaces that own them now, and Allgemein is a destination of the open
      Unternehmen workspace. Scoped to the rail because the strip above the
      page (below `lg`) carries the same link.
    */
    await page
      .getByRole("navigation", { name: "Hauptnavigation" })
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
      And the honest absences. `version: null` with a reason beats
      `package.json`'s 0.0.1 — a number that never changes and looks like one
      that does — and "Nicht gebaut" beats a grey dash that reads the same as
      "not configured yet".

      This used to assert *"Es gibt keine Sicherungsautomatik"* as its example
      of an `unbuilt` integration, and P2-5 built it — so asserting it would be
      asserting a lie, exactly as the note on the next test says about the
      notifications placeholder. Analytics and Karten are still genuinely
      unbuilt and carry the `Nicht gebaut` state, which is the property this
      test is actually about: **the panel distinguishes "not configured" from
      "not built"**, because one grey dot for both is how a missing feature
      gets waited on for ever.
    */
    /*
      The version row, and this assertion changed in P2-6 for the third time
      on this test — which is the pattern the two notes around it describe.

      It used to assert *"Kein Build-Stempel"* was visible, because nothing
      stamped a build and `version` was a hardcoded `null`. P2-6 made it real:
      `scripts/stamp-build.mjs` writes one, and `APP_VERSION`/`APP_COMMIT`
      override it at deployment. So the old assertion would now be asserting a
      lie on any machine that has run a build.

      What survives is the property the test is actually about — **the row
      never goes silently blank**. Either it names a version or a commit, or
      it says why it cannot. Both are correct states and a developer who has
      never run `npm run stamp` must not get a red suite for it.
    */
    const versionRow = page.getByText(/Kein Build-Stempel|[0-9]+\.[0-9]+\.[0-9]+|[0-9a-f]{7,12}/);
    await expect(versionRow.first()).toBeVisible();

    await expect(page.getByText(/Nicht angebunden/)).toBeVisible();
    await expect(page.getByText("Nicht gebaut").first()).toBeVisible();

    // And the row that changed: backup is a real integration now, with a
    // measured verdict rather than a placeholder sentence.
    await expect(page.getByText("Sicherung und Wiederherstellung")).toBeVisible();
  });

  /**
   * This test used to assert the opposite, and the change is the point.
   *
   * Benachrichtigungen was the workspace's one `placeholder` section: it said
   * *"Das Benachrichtigungsmodul ist noch nicht gebaut"* and deliberately
   * rendered no Speichern button, because an absent section makes an
   * administrator conclude the system has no such feature and stop looking,
   * while a form with no effect is worse still. P2-3 built the module, so the
   * placeholder is gone and asserting it would be asserting a lie.
   *
   * What replaces it is the property that actually matters now: the slot is
   * filled by the **embedded** module rather than by an empty form. The
   * honest-absence behaviour it used to guard has not gone away — the three
   * integrations that really are unbuilt are asserted in the System panel
   * test above, which is where the remaining `Nicht gebaut` rows live.
   */
  test("the section that was a placeholder now renders the module itself", async ({ page }) => {
    await page.goto(`${SECTION}/benachrichtigungen`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    await expect(page.getByText(/Welche Ereignisse benachrichtigen/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/noch nicht gebaut/)).toHaveCount(0);

    // Composed by `admin/pages/SettingsPage.tsx`, not by the workspace: the
    // delivery log is the second half of the embedded slot and carries its
    // own permission, so seeing it here proves the whole section arrived and
    // not just its heading.
    // By role: the table's `<caption>` carries the same word for screen
    // readers, so a text match resolves to two elements and fails strict mode.
    await expect(page.getByRole("heading", { name: "Zustellprotokoll" })).toBeVisible();
  });
});


