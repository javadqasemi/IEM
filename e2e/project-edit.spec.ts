import type { APIRequestContext, Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, apiAs, e2eName, expect, expectClean, test } from "./fixtures";

/**
 * The project edit dialog, all the way through the browser.
 *
 * The one thing the reference module was missing: the API is covered by
 * `versioning.spec.ts` and the *buttons* are covered by `security.spec.ts`, but
 * nothing had ever driven a save from the form. That gap is not about this
 * dialog — it is about eighteen modules copying a workflow that had never been
 * completed once.
 *
 * Ten things, in the order a person meets them:
 *
 * | | |
 * | --- | --- |
 * | **Open** | the dialog carries the version it opened on |
 * | **Field** | a scalar changes and the record says so |
 * | **Relation** | a link changes — the path that was a 500 and typechecked |
 * | **Form error** | a malformed amount is refused, naming the field, and writes nothing |
 * | **Field error** | a DTO violation lands on its own input, via `aria-describedby` |
 * | **Cancel** | changes nothing, including the version |
 * | **Conflict** | a save against a stale version is refused |
 * | **No overwrite** | the conflict screen offers *reload* and never *save anyway* |
 * | **Reload** | and the reload gets the newer record |
 * | **History** | the edit, the person and the reason are all recorded |
 *
 * ---
 *
 * **It writes, so it owns what it writes.** A project is created for this file
 * and removed afterwards. Editing a seeded one would make every other spec's
 * expectations depend on how often this had run — and the version number is
 * precisely what this asserts on.
 */

let api: APIRequestContext;
let projectId = "";
let projectNumber = "";
/** A second employee, so the relation test has something to change *to*. */
let otherManager = { id: "", name: "" };

test.beforeAll(async () => {
  // The memoised token — see `apiToken`. No extra sign-in against the throttle.
  api = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);

  const customers = (await (await api.get(`${API}/customers?perPage=1`)).json()) as {
    data: { items: { id: string }[] };
  };
  const employees = (await (await api.get(`${API}/employees?perPage=2`)).json()) as {
    data: { items: { id: string; name: string }[] };
  };
  otherManager = employees.data.items[1] ?? employees.data.items[0];

  const created = await api.post(`${API}/projects`, {
    data: {
      name: e2eName(`Edit-Dialog Testlauf ${Date.now()}`),
      customerId: customers.data.items[0].id,
      contractValue: "100000.00",
    },
  });
  expect(created.ok(), `Projekt anlegen fehlgeschlagen (HTTP ${created.status()})`).toBe(true);
  const body = (await created.json()) as { data: { id: string; number: string } };
  projectId = body.data.id;
  projectNumber = body.data.number;
});

test.afterAll(async () => {
  if (projectId) {
    // Cancel then delete: the service refuses to remove a live project, and
    // that rule is not something a cleanup step should route around.
    await api.put(`${API}/projects/${projectId}/status`, { data: { status: "CANCELLED" } });
    await api.delete(`${API}/projects/${projectId}`);
  }
  await api?.dispose();
});

/** The record as the API sees it — the check that a save actually landed. */
async function record() {
  const response = await api.get(`${API}/projects/${projectId}`);
  return ((await response.json()) as {
    data: {
      version: number;
      name: string;
      notes: string | null;
      contractValue: string | null;
      manager: { id: string; name: string } | null;
    };
  }).data;
}

async function openDialog(page: Page) {
  await page.goto(`/admin.html#/projekte/${projectId}`);
  await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

  /*
    Waited for explicitly before clicking, and that is about the *report*
    rather than the timing.

    `click()` auto-waits, but against the **test** timeout rather than the
    expect timeout — so when the button never arrived, this hung for the full
    ninety seconds and reported `Target page, context or browser has been
    closed`, which describes the teardown rather than the problem. A bounded
    wait fails in twenty seconds saying the button is missing, which is the
    sentence somebody can act on.

    The disappearance of the loading text is not sufficient on its own: it
    means the lazy chunk resolved, while "Bearbeiten" needs the project's own
    query to have landed and the route to have published its actions.
  */
  await expect(
    page.getByRole("button", { name: "Bearbeiten" }),
    "Die Projektansicht hat keine Bearbeiten-Schaltfläche gerendert — " +
      "entweder ist die Detailabfrage fehlgeschlagen oder die Route hat ihre Aktionen nicht veröffentlicht.",
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(`${projectNumber} bearbeiten`)).toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe("the project edit dialog", () => {
  // Generous: each case opens the detail screen, which fetches a project with
  // three nested collections through an unwarmed dev transform.
  test.setTimeout(90_000);

  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("shows the version it opened on", async ({ page }) => {
    /*
      The badge in the footer is not decoration — it is the value that will be
      submitted, and showing it is what makes the conflict message below
      comprehensible rather than mysterious.
    */
    const before = await record();
    const dialog = await openDialog(page);
    await expect(dialog.getByText(`v${before.version}`, { exact: true })).toBeVisible();
  });

  test("saves a changed field, and the version advances", async ({ page, collected }) => {
    const before = await record();
    const dialog = await openDialog(page);

    const notes = dialog.getByLabel(/Interne Notizen/i);
    await notes.fill("Vom Edit-Dialog gesetzt");
    await dialog.getByLabel(/Grund der Änderung/i).fill("Notiz ergänzt");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    // The dialog closes on success — a form that stays open after a save is one
    // people press twice.
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const after = await record();
    expect(after.notes).toBe("Vom Edit-Dialog gesetzt");
    expect(after.version).toBe(before.version + 1);

    expectClean(collected, "edit dialog save");
  });

  test("saves a changed relation", async ({ page }) => {
    /*
      The path that was a 500 **and typechecked**: the mapper emitted
      `manager: { connect: … }`, which `update` accepts and `updateMany` — which
      the optimistic lock requires — does not. Every API test at the time
      changed a scalar, so the suite was green while this screen was broken.

      Driven through the picker rather than by posting an id, because the picker
      is the part that had never been exercised.
    */
    const before = await record();
    const dialog = await openDialog(page);

    const picker = dialog.getByLabel(/Projektleitung/i);
    await picker.click();
    await picker.fill(otherManager.name.split(" ")[0]);

    const option = page.getByRole("option", { name: new RegExp(otherManager.name, "i") }).first();
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();

    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const after = await record();
    expect(after.manager?.id, "die Projektleitung wurde nicht gespeichert").toBe(otherManager.id);
    expect(after.version).toBe(before.version + 1);
  });

  test("reports a malformed amount, naming the field, and writes nothing", async ({ page }) => {
    /*
      `1'450'000.00` is what a Swiss person types, and the server refuses it.

      **This one arrives as a form-level message, not a field one**, and the
      first version of this test claimed otherwise — it asserted "beside its
      input" and passed by matching the banner. The two are different code
      paths and only one of them was being exercised.

      The reason is in the server: the amount is parsed in `projects.mapper.ts`,
      which throws a plain `BadRequestException` with no `fields` map, because
      it knows the *label* ("Auftragswert") and not the DTO property. The
      message names the field in words, which is why this is acceptable rather
      than a defect — and the case below covers the per-field path properly.
    */
    const before = await record();
    const dialog = await openDialog(page);

    await dialog.getByLabel(/Auftragswert/i).fill("1'450'000.00");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    await expect(dialog.getByText(/kein gültiger Betrag für Auftragswert/)).toBeVisible({
      timeout: 15_000,
    });
    // Still open: a refused save must not look like a completed one.
    await expect(dialog).toBeVisible();

    // And nothing was written — not even the version.
    expect((await record()).version).toBe(before.version);
  });

  test("puts a per-field error beside its own input", async ({ page }) => {
    /*
      The path the dialog's `fieldError()` wiring exists for, and the one
      nothing covered: a one-character name fails the DTO's `@MinLength(2)`, so
      the server answers `validation_failed` **with a `fields` map**, and
      `ApiError.fields` turns that into a message under the right input.

      Asserted by *position* rather than by presence — the whole point is that
      it is not a banner over a form with ten inputs, which is a message that
      makes the reader hunt. `Field` renders the error inside the same wrapper
      as its control, so the assertion is that the error and the input share an
      ancestor that no other field is in.
    */
    const before = await record();
    const dialog = await openDialog(page);

    await dialog.getByLabel(/Projektname/i).fill("A");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    /*
      Asserted through the **accessibility contract**, not through DOM shape.

      `Field` renders its error as `<p id="{htmlFor}-error" role="alert">` and
      supplies the control with a matching `aria-describedby`. Following that
      link is what a screen reader does, so following it here tests the thing
      that matters rather than which `div` happens to wrap what — and it is why
      the first version of this assertion, which walked the DOM, was both
      brittle and uninformative.
    */
    const input = dialog.getByLabel(/Projektname/i);
    await expect(input).toHaveAttribute("aria-invalid", "true", { timeout: 15_000 });

    const describedBy = await input.getAttribute("aria-describedby");
    expect(describedBy, "das Eingabefeld verweist auf keine Fehlermeldung").toBeTruthy();

    /*
      An attribute selector, not `#id`.

      React's `useId` produces `:r1:`, and a colon is a pseudo-class in CSS — so
      `#:r1:-error` is not a selector that can match anything, and Playwright
      reports it as an element that is simply not visible. `[id="…"]` needs no
      escaping and says the same thing.
    */
    const message = dialog.locator(`[id="${describedBy}"]`);
    await expect(message).toBeVisible();
    await expect(message).toHaveAttribute("role", "alert");
    await expect(message).toHaveText(/2 characters|mindestens/i);

    await expect(dialog).toBeVisible();
    expect((await record()).version).toBe(before.version);
  });

  test("cancel changes nothing, including the version", async ({ page }) => {
    const before = await record();
    const dialog = await openDialog(page);

    await dialog.getByLabel(/Interne Notizen/i).fill("Das darf nicht gespeichert werden");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();

    const after = await record();
    expect(after.notes).not.toBe("Das darf nicht gespeichert werden");
    expect(after.version).toBe(before.version);
  });
});

test.describe("the conflict", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("refuses a save against a version somebody else has moved past", async ({ page }) => {
    /*
      The whole reason the lock exists, driven the way it actually happens: one
      person opens the record, another saves, the first presses Speichern.

      The second writer is the API rather than a second browser — the *server*
      is what decides, and a second browser would add a page to manage without
      changing which statement wins.
    */
    const dialog = await openDialog(page);
    const opened = await record();

    const outOfBand = await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: opened.version, notes: "von jemand anderem" },
    });
    expect(outOfBand.status(), "der zweite Schreiber muss durchkommen").toBe(200);

    await dialog.getByLabel(/Interne Notizen/i).fill("meine Version");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    // The conflict screen, by its heading.
    await expect(page.getByText("Inzwischen geändert")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/wurde inzwischen.*geändert/)).toBeVisible();
    // It names both versions: "Sie hatten v3, jetzt v4" is the difference
    // between reloading and wondering how much was lost.
    await expect(page.getByText(new RegExp(`Sie hatten v${opened.version}`))).toBeVisible();

    // Nothing of the first writer's reached the record.
    const after = await record();
    expect(after.notes).toBe("von jemand anderem");
    expect(after.version).toBe(opened.version + 1);
  });

  test("offers reload and never 'save anyway'", async ({ page }) => {
    /*
      The assertion that matters most in this file.

      A button that resubmitted with the new version would be a two-click way to
      do exactly the overwrite the lock prevents — and it would look like the
      safe option, sitting where the primary action was a moment earlier. Its
      *absence* is the design, so its absence is what is tested.
    */
    const dialog = await openDialog(page);
    const opened = await record();

    await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: opened.version, notes: "wieder jemand anderes" },
    });

    await dialog.getByLabel(/Interne Notizen/i).fill("egal");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Inzwischen geändert")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("button", { name: "Neu laden" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verwerfen" })).toBeVisible();
    // No second chance at the overwrite, under any wording.
    await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /trotzdem/i })).toHaveCount(0);
  });

  test("the reload brings back the newer record", async ({ page }) => {
    const dialog = await openDialog(page);
    const opened = await record();

    await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: opened.version, notes: "der neuere Stand" },
    });

    await dialog.getByLabel(/Interne Notizen/i).fill("der ältere Stand");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Inzwischen geändert")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Neu laden" }).click();
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    // Reopening shows what the *other* person wrote, at the new version — which
    // is the point of sending them back rather than merging silently.
    const reopened = await openDialog(page);
    await expect(reopened.getByLabel(/Interne Notizen/i)).toHaveValue("der neuere Stand");
    await expect(
      reopened.getByText(`v${opened.version + 1}`, { exact: true }),
    ).toBeVisible();
  });
});

test.describe("the history records what the dialog did", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("shows the version, the person and the reason", async ({ page }) => {
    /*
      The other half of the workflow: an edit that is not visible in the history
      is an edit nobody can account for later, and the reason field exists only
      because a person can supply what the diff cannot.
    */
    const dialog = await openDialog(page);
    await dialog.getByLabel(/Interne Notizen/i).fill("mit Begründung");
    await dialog.getByLabel(/Grund der Änderung/i).fill("Nach Rücksprache mit der Bauherrschaft");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await page.goto(`/admin.html#/projekte/${projectId}/verlauf`);
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    await expect(page.getByText("Nach Rücksprache mit der Bauherrschaft")).toBeVisible({
      timeout: 15_000,
    });
    // The field name in German, not `notes` — the history is read by people who
    // did not write the API.
    await expect(page.getByText(/interne Notizen/).first()).toBeVisible();
  });
});
