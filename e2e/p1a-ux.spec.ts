import type { APIRequestContext, Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, apiAs, e2eName, expect, test } from "./fixtures";

/**
 * P1A — the UX defect sweep, **in a browser**.
 *
 * Each case below is a defect from `docs/COMPLETE_APPLICATION_AUDIT.md` Part 25
 * that a unit test can describe but not prove, because the defect was in how
 * the pieces met: a toast after an `await`, a footer outside a form, a row
 * handler a keyboard cannot reach, a cache entry dropped under a mounted
 * panel. The unit tests pin the rules; these pin the composition.
 *
 * | Case | Finding |
 * | --- | --- |
 * | reorder → save → reload → order remains | UX-01 |
 * | server rejects → no success toast, visible error | UX-02 |
 * | unrelated write keeps unsaved attendance | UX-03 |
 * | Enter submits a dialog; blocked Enter explains | UX-12, UX-14 |
 * | Tab → record link → Enter opens the record | UX-19 |
 * | failed list → error; empty list → empty | UX-21 |
 * | a pending effect that is not APPROVED reaches the home page | UX-07 |
 * | a 409 keeps the input and reloads in place | UX-15 |
 * | the touched primitives at four widths | responsive |
 *
 * Runs once (`SIGNS_IN_TWICE` in `playwright.config.ts`): it signs an API
 * context in for its fixtures, and it reorders real content — at three widths
 * that would be three processes reordering one collection.
 */

let admin: APIRequestContext;

test.beforeAll(async () => {
  admin = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
});

test.afterAll(async () => {
  await admin?.dispose();
});

type Entry = { id: string; key: string; typeKey: string };

async function entriesOf(typeKey: string): Promise<Entry[]> {
  const response = await admin.get(`${API}/content/entries?typeKey=${typeKey}&perPage=200`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { items: Entry[] } }).data.items;
}

async function reorderTo(typeKey: string, ids: string[]) {
  const response = await admin.post(`${API}/content/entries/reorder`, { data: { typeKey, ids } });
  expect(response.status(), await response.text()).toBe(204);
}

async function pendingAreas(): Promise<number> {
  const response = await admin.get(`${API}/content/pending`);
  const data = ((await response.json()) as { data: { changed: boolean; changes: unknown[] } }).data;
  return data.changed ? data.changes.length : 0;
}

/** The ids of the rows on screen, read from the links the rows open through. */
async function rowIds(page: Page): Promise<string[]> {
  const hrefs = await page.locator("tbody [data-row-open]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? ""),
  );
  return hrefs.map((href) => href.split("/").pop() ?? "");
}

/** The id of the demo project the seed creates. */
async function demoProjectId(): Promise<string> {
  const response = await admin.get(`${API}/projects?q=P-2026-001`);
  const items = ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(items.length, "the seeded demo project is missing").toBeGreaterThan(0);
  return items[0].id;
}

/* ================================================================== */
/* UX-01 and UX-07 — the order persists, and the home page sees it     */
/* ================================================================== */

test.describe("reordering content persists (UX-01)", () => {
  /*
    Three collections, as the brief names them. Each is put back through the
    API afterwards, so the live order a later publish would take is the one it
    found — nothing here publishes.
  */
  for (const typeKey of ["team", "projects", "openings"]) {
    test(`${typeKey}: move → save → reload → the order remains`, async ({ page }) => {
      const before = await entriesOf(typeKey);
      test.skip(before.length < 2, `„${typeKey}“ hat weniger als zwei Einträge.`);
      const original = before.map((e) => e.id);

      /*
        A row *of this collection*, not any row. The three cases run in one
        page, so `/inhalte/projects` → `/inhalte/openings` is a hash change that
        reuses the list component: the previous collection's rows are still on
        screen for a moment, and reading the ids then produced `[]` — a flake
        seen once in the P1C final run, never reproducible on a rerun. Each
        row's link carries its collection, which makes the wait exact.
      */
      const ownRow = page.locator(`tbody [data-row-open][href*="/inhalte/${typeKey}/"]`).first();

      try {
        await page.goto(`/admin.html#/inhalte/${typeKey}`);
        await expect(ownRow).toBeVisible();
        const shown = await rowIds(page);
        expect(shown.length, "the list rendered its rows").toBeGreaterThanOrEqual(2);

        await page.getByRole("button", { name: "Reihenfolge ändern" }).click();
        // Nothing moved yet: the save is blocked, focusable, and says why.
        const save = page.getByRole("button", { name: "Reihenfolge speichern" });
        await expect(save).toHaveAttribute("aria-disabled", "true");
        await expect(save).toHaveAccessibleDescription("Noch nichts verschoben.");

        await page.getByRole("button", { name: /nach unten$/ }).first().click();
        await save.click();
        await expect(page.getByRole("status").filter({ hasText: "Reihenfolge gespeichert" })).toBeVisible();

        // The claim is persistence, so the proof is a fresh page.
        await page.reload();
        await expect(ownRow).toBeVisible();
        const after = await rowIds(page);
        expect(after.slice(0, 2)).toEqual([shown[1], shown[0]]);
        expect(after.slice(2)).toEqual(shown.slice(2));

        // …and the server agrees, which is the difference from the old
        // control: it moved nothing but client state.
        expect((await entriesOf(typeKey)).map((e) => e.id).slice(0, 2)).toEqual([shown[1], shown[0]]);

        /*
          UX-07, while the difference exists. A reorder never becomes
          APPROVED — the home page used to count approvals and say nothing was
          waiting. It must now say what `/content/pending` says.
        */
        if (typeKey === "team") {
          const areas = await pendingAreas();
          expect(areas, "a reorder must be a pending effect").toBeGreaterThan(0);
          await page.goto("/admin.html#/");
          await expect(page.getByTestId("dashboard-waiting")).toContainText(
            `${areas} ${areas === 1 ? "Bereich weicht" : "Bereiche weichen"} von der Website ab`,
          );
          await expect(
            page.getByRole("link", { name: `${areas} ${areas === 1 ? "Bereich" : "Bereiche"} veröffentlichen` }),
          ).toBeVisible();
        }
      } finally {
        await reorderTo(typeKey, original);
      }
    });
  }

  test("the server refuses one page of a longer list (the rule, end to end)", async () => {
    const entries = await entriesOf("team");
    test.skip(entries.length < 2, "zu wenige Einträge");
    const response = await admin.post(`${API}/content/entries/reorder`, {
      data: { typeKey: "team", ids: entries.slice(0, 1).map((e) => e.id) },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toMatch(/ganzen Bereich/);
  });
});

/* ================================================================== */
/* UX-02 — a refused write never reports success                       */
/* ================================================================== */

test.describe("a failed write says so, and never 'gespeichert' (UX-02)", () => {
  test("the server fails the reorder: error toast, no success toast, order kept for a retry", async ({
    page,
  }) => {
    const entries = await entriesOf("team");
    test.skip(entries.length < 2, "zu wenige Einträge");

    await page.route(/\/api\/v1\/content\/entries\/reorder$/, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 500, code: "internal", message: "Internal server error" }),
      }),
    );
    try {
      await page.goto("/admin.html#/inhalte/team");
      await page.getByRole("button", { name: "Reihenfolge ändern" }).click();
      await page.getByRole("button", { name: /nach unten$/ }).first().click();
      await page.getByRole("button", { name: "Reihenfolge speichern" }).click();

      const failure = page.getByRole("alert").filter({ hasText: "Reihenfolge nicht gespeichert" });
      await expect(failure).toBeVisible();
      // Normalised: the framework's English never reaches the reader.
      await expect(failure).toContainText("Der Server hat einen Fehler gemeldet");
      await expect(failure).not.toContainText("Internal server error");
      await expect(page.getByText("Reihenfolge gespeichert", { exact: true })).toHaveCount(0);
      // Still in edit mode with the move applied, so a retry is one click.
      await expect(page.getByRole("button", { name: "Reihenfolge speichern" })).toBeEnabled();
    } finally {
      await page.unroute(/\/api\/v1\/content\/entries\/reorder$/);
    }
    // Nothing moved on the server.
    expect((await entriesOf("team")).map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });

  test("the connection drops on a delete: the dialog stays, with a sentence a person can act on", async ({
    page,
  }) => {
    const entries = await entriesOf("team");
    test.skip(entries.length < 1, "keine Einträge");

    await page.route(/\/api\/v1\/content\/entries\/[^/]+$/, (route) =>
      route.request().method() === "DELETE" ? route.abort("connectionrefused") : route.continue(),
    );
    try {
      await page.goto("/admin.html#/inhalte/team");
      await page.getByRole("button", { name: "Löschen" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Eintrag löschen?" });
      await dialog.getByRole("button", { name: "Löschen" }).click();

      await expect(dialog.getByRole("alert")).toContainText("nicht erreichbar");
      await expect(dialog.getByRole("alert")).toContainText("Eingaben sind noch da");
      await expect(page.getByText("Gelöscht", { exact: true })).toHaveCount(0);
      await expect(dialog).toBeVisible();
    } finally {
      await page.unroute(/\/api\/v1\/content\/entries\/[^/]+$/);
    }
    expect((await entriesOf("team")).length).toBe(entries.length);
  });
});

/* ================================================================== */
/* UX-03 — an unrelated write does not erase unsaved input             */
/* ================================================================== */

test.describe("unsaved input survives another write on the same screen (UX-03)", () => {
  test("attendance ticked but not saved outlives adding a person", async ({ page }) => {
    const created = await admin.post(`${API}/meetings`, {
      data: {
        title: e2eName("P1A Anwesenheit"),
        startsAt: "2026-09-03T14:00:00Z",
        projectId: await demoProjectId(),
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const meeting = ((await created.json()) as { data: { id: string } }).data;

    try {
      for (const name of ["Anna Ahorn", "Bruno Birke"]) {
        const r = await admin.post(`${API}/meetings/${meeting.id}/attendees`, {
          data: { externalName: name, externalOrg: "E2E" },
        });
        expect(r.status(), await r.text()).toBe(201);
      }

      await page.goto(`/admin.html#/sitzungen/${meeting.id}/teilnehmende`);
      const anna = page.getByRole("group", { name: "Anwesenheit Anna Ahorn" });
      await anna.getByRole("button", { name: "Anwesend" }).click();
      await expect(anna.getByRole("button", { name: "Anwesend" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Anwesenheit speichern" })).toBeVisible();

      // Another write on the same meeting — and through Enter, which is UX-12.
      await page.getByRole("button", { name: "Person hinzufügen" }).click();
      const dialog = page.getByRole("dialog", { name: "Person hinzufügen" });
      await dialog.getByRole("button", { name: "Extern" }).click();
      await dialog.getByLabel("Name").fill("Carla Castanie");
      await dialog.getByLabel("Name").press("Enter");
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Carla Castanie")).toBeVisible();

      // The tick that was never saved is still there. Before the fix the
      // detail dropped to a skeleton, the panel unmounted, and this was gone.
      await expect(anna.getByRole("button", { name: "Anwesend" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Anwesenheit speichern" })).toBeVisible();
    } finally {
      await admin.delete(`${API}/meetings/${meeting.id}`);
    }
  });
});

/* ================================================================== */
/* UX-12 and UX-14 — Enter, and the reason when it cannot              */
/* ================================================================== */

test.describe("Enter submits a dialog (UX-12)", () => {
  test("a valid form submits on Enter; an incomplete one says why and does not", async ({ page }) => {
    const title = e2eName("P1A Enter");
    await page.goto("/admin.html#/aufgaben");
    await page.getByRole("button", { name: "Neue Aufgabe" }).click();
    const dialog = page.getByRole("dialog", { name: "Neue Aufgabe" });
    const field = dialog.getByLabel("Titel", { exact: true });

    // Too short: Enter does not submit, the reason is visible text *and* the
    // button's accessible description, and focus lands where it is announced.
    await field.fill("x");
    await field.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Der Titel braucht mindestens zwei Zeichen.").first()).toBeVisible();
    const create = dialog.getByRole("button", { name: "Anlegen" });
    await expect(create).toHaveAccessibleDescription("Der Titel braucht mindestens zwei Zeichen.");
    await expect(create).toBeFocused();

    await field.fill(title);
    await field.press("Enter");
    await expect(dialog).toBeHidden();

    const found = await admin.get(`${API}/tasks?q=${encodeURIComponent(title)}`);
    const items = ((await found.json()) as { data: { items: { id: string; title: string }[] } }).data.items;
    const task = items.find((t) => t.title === title);
    expect(task, "Enter hat die Aufgabe nicht angelegt").toBeTruthy();
    await admin.delete(`${API}/tasks/${task!.id}`);
  });

  test("Enter never confirms a destructive dialog, even with the word typed", async ({ page }) => {
    /*
      The typed "LÖSCHEN" is the one field a destructive dialog has, and Enter
      in it is exactly the reflex the confirmation exists to interrupt. A
      throwaway account, so a regression here deletes nothing that matters.
    */
    const email = `p1a-enter-${Date.now()}@iem.test`;
    const invited = await admin.post(`${API}/users`, {
      data: { email, name: e2eName("P1A Enter-Löschen"), roleIds: [] },
    });
    expect(invited.status(), await invited.text()).toBe(201);
    const user = ((await invited.json()) as { data: { id: string } }).data;

    try {
      await page.goto("/admin.html#/benutzer");
      await page.getByRole("searchbox").first().fill(email);
      const row = page.locator("tbody tr").filter({ hasText: email });
      // Exact: the row's own opener is named after the account, which says "Löschen".
      await row.getByRole("button", { name: "Löschen", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Benutzer löschen?" });
      const confirm = dialog.getByRole("textbox");
      await confirm.fill("LÖSCHEN");
      await confirm.press("Enter");

      await expect(dialog).toBeVisible();
      const still = await admin.get(`${API}/users/${user.id}`);
      expect(still.status(), "Enter hat einen destruktiven Dialog bestätigt").toBe(200);
      await dialog.getByRole("button", { name: "Abbrechen" }).click();
    } finally {
      await admin.delete(`${API}/users/${user.id}`);
    }
  });
});

/* ================================================================== */
/* UX-19 — a register can be opened from the keyboard                  */
/* ================================================================== */

test.describe("a list row opens by keyboard (UX-19)", () => {
  test("Tab reaches the record's link, Enter opens it", async ({ page }) => {
    await page.goto("/admin.html#/projekte");
    const firstLink = page.locator("tbody [data-row-open]").first();
    await expect(firstLink).toBeVisible();
    const href = await firstLink.getAttribute("href");
    expect(href, "the identity cell must be a real link").toMatch(/^#\/projekte\/.+/);

    // From the last column header, Tab walks into the table body.
    await page.locator("thead button").last().focus();
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.hasAttribute("data-row-open") ?? false);
    }
    expect(reached, "no row link was reachable by Tab").toBe(true);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${href!.slice(1).replace(/\//g, "\\/")}$`));
  });

  test("a row that opens a dialog opens through a real button", async ({ page }) => {
    await page.goto("/admin.html#/benutzer");
    const opener = page.locator("tbody [data-row-open]").first();
    await expect(opener).toBeVisible();
    expect(await opener.evaluate((el) => el.tagName)).toBe("BUTTON");
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

/* ================================================================== */
/* UX-21 — an error is not an empty list                               */
/* ================================================================== */

const BACKUP_LIST = /\/api\/v1\/backups(\?.*)?$/;
const RESTORE_LIST = /\/api\/v1\/backups\/restores$/;

test.describe("an error is not an empty list (UX-21)", () => {
  test("a refused request shows an error, never 'Noch keine Sicherung'", async ({ page }) => {
    const refuse = (route: import("@playwright/test").Route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ statusCode: 500, code: "internal", message: "Internal server error" }),
          })
        : route.continue();
    await page.route(BACKUP_LIST, refuse);
    await page.route(RESTORE_LIST, refuse);
    try {
      await page.goto("/admin.html#/sicherungen");
      await expect(page.getByText("Die Liste konnte nicht geladen werden.").first()).toBeVisible();
      await expect(page.getByText("Noch keine Sicherung")).toHaveCount(0);
      await expect(page.getByText("Noch nie wiederhergestellt")).toHaveCount(0);
      // The page keeps its frame: header and the other cards are still there.
      await expect(page.getByRole("heading", { name: "Sicherungen", level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Nochmals versuchen" }).first()).toBeVisible();
    } finally {
      await page.unroute(BACKUP_LIST);
      await page.unroute(RESTORE_LIST);
    }
  });

  test("an empty answer shows the empty state, not an error", async ({ page }) => {
    await page.route(BACKUP_LIST, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: { items: [], total: 0, page: 1, perPage: 25, pages: 0 } }),
          })
        : route.continue(),
    );
    try {
      await page.goto("/admin.html#/sicherungen");
      await expect(page.getByText("Noch keine Sicherung")).toBeVisible();
      await expect(page.getByText("Die Liste konnte nicht geladen werden.")).toHaveCount(0);
    } finally {
      await page.unroute(BACKUP_LIST);
    }
  });
});

/* ================================================================== */
/* UX-15 — a conflict keeps the input and reloads in place             */
/* ================================================================== */

test.describe("a 409 keeps the reader's input (UX-15)", () => {
  test("the form stays, save is blocked with a reason, and 'Neueste Fassung laden' does not reload the app", async ({
    page,
  }) => {
    const customers = (await (await admin.get(`${API}/customers?perPage=1`)).json()) as {
      data: { items: { id: string }[] };
    };
    const created = await admin.post(`${API}/projects`, {
      data: { name: e2eName("P1A Konflikt"), customerId: customers.data.items[0].id },
    });
    expect(created.status(), await created.text()).toBe(201);
    const project = ((await created.json()) as { data: { id: string; version: number } }).data;

    try {
      await page.goto(`/admin.html#/projekte/${project.id}`);
      await page.evaluate(() => ((window as unknown as { __p1a: string }).__p1a = "same-document"));

      await page.getByRole("button", { name: "Bearbeiten" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Projektname").fill("Meine Änderung, nicht gespeichert");

      // Somebody else saves first.
      const other = await admin.patch(`${API}/projects/${project.id}`, {
        data: { expectedVersion: project.version, notes: "Von jemand anderem" },
      });
      expect(other.status(), await other.text()).toBe(200);

      await dialog.getByRole("button", { name: "Speichern" }).click();
      await expect(dialog.getByText("Inzwischen von jemand anderem geändert")).toBeVisible();
      // The input is still on screen — the old dialog replaced it.
      await expect(dialog.getByLabel("Projektname")).toHaveValue("Meine Änderung, nicht gespeichert");
      await expect(dialog.getByRole("button", { name: "Speichern" })).toHaveAttribute("aria-disabled", "true");

      await dialog.getByRole("button", { name: "Neueste Fassung laden" }).click();
      await expect(dialog).toBeHidden();
      // Same document: no `window.location.reload()`.
      expect(
        await page.evaluate(() => (window as unknown as { __p1a?: string }).__p1a),
      ).toBe("same-document");

      // Reopened, it edits the newer version.
      await page.getByRole("button", { name: "Bearbeiten" }).click();
      await expect(page.getByRole("dialog").getByText(`v${project.version + 1}`)).toBeVisible();
    } finally {
      await admin.put(`${API}/projects/${project.id}/status`, { data: { status: "CANCELLED" } });
      await admin.delete(`${API}/projects/${project.id}`);
    }
  });
});

/* ================================================================== */
/* The touched primitives at four widths                               */
/* ================================================================== */

test.describe("the shared primitives hold at 1440, 1024, 768 and 375", () => {
  for (const width of [1440, 1024, 768, 375]) {
    test(`${width}px — dialog footer with its reason, and a table's error state`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });

      await page.goto("/admin.html#/aufgaben");
      await page.getByRole("button", { name: "Neue Aufgabe" }).click();
      const dialog = page.getByRole("dialog", { name: "Neue Aufgabe" });
      await expect(dialog.getByText("Der Titel braucht mindestens zwei Zeichen.").first()).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Anlegen" })).toBeInViewport();
      const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(dialogOverflow, "the dialog scrolls sideways").toBeLessThanOrEqual(1);
      await page.screenshot({ path: `e2e/shots/p1a/${width}-dialog-hint.png` });
      await dialog.getByRole("button", { name: "Abbrechen" }).click();

      await page.route(BACKUP_LIST, (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ statusCode: 503, code: "unavailable", message: "Service Unavailable" }),
            })
          : route.continue(),
      );
      try {
        await page.goto("/admin.html#/sicherungen");
        await expect(page.getByText("Die Liste konnte nicht geladen werden.").first()).toBeVisible();
        const pageOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(pageOverflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
        await page.screenshot({ path: `e2e/shots/p1a/${width}-table-error.png` });
      } finally {
        await page.unroute(BACKUP_LIST);
      }
    });
  }
});
