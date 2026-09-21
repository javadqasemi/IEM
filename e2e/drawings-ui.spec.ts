import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, apiAs, e2eNumber, expect, test } from "./fixtures";

/**
 * Pläne und Planversand, **in a browser** — the client half of Wave 2, module 3.
 *
 * `drawings.spec.ts` beside this one drives the API and guards the rules. This
 * one guards the claims that are only true if a browser says so, because each
 * is about composition rather than about a function:
 *
 * | | |
 * | --- | --- |
 * | **A plan has a URL** | the reason this module got a route where Aufgaben got a drawer — a `useState` tab would pass every unit test |
 * | **The register groups by Gewerk** | `groupByDiscipline` is tested pure; that the tab renders its groups is not |
 * | **A plan that cannot be sent is disabled with its reason** | `refuseSelection` is pure; that the checkbox is actually disabled is not |
 * | **The send produces a report, not a toast** | the warnings are the half that matters, and a toast would put them where nobody reads them |
 * | **The exports carry the rows** | a CSV that downloads empty reads as a broken button |
 *
 * Every fixture is made through the API and deleted afterwards, so a re-run
 * starts where it started.
 */

let admin: APIRequestContext;

test.beforeAll(async () => {
  admin = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
});

test.afterAll(async () => {
  await admin.dispose();
});

type Drawing = {
  id: string;
  number: string;
  status: string;
  version: number;
  revisions: { id: string; revision: string }[];
};

const made: string[] = [];

/**
 * Removes what the test created, and **fails if it cannot**.
 *
 * The first version was `await admin.delete(...)` with the result ignored,
 * and that silence cost a red suite twice. `DELETE /drawings/:id` refuses an
 * **ISSUED** plan — *"Ein ausgegebener Plan wird zurückgezogen, nicht
 * gelöscht — er ist bei den Empfängern"* — which is correct: a plan in a
 * contractor's hands is somebody else's record too. Several tests here issue
 * their fixtures, so several of them were undeletable, the cleanup swallowed
 * the 400, and the plans stayed.
 *
 * They accumulated to **111 issued drawings on P-2026-001**. The Planversand
 * dialog deliberately fetches one page of a hundred (it needs a revision id
 * per plan and will not join on every row of the register), so past that
 * point a freshly created fixture is simply not on the page the test looks
 * at — and two tests failed with "element not found" for a row that existed.
 * Nothing about that pointed at cleanup.
 *
 * So: withdraw first where the delete is refused — the documented path for a
 * plan that has gone out — and then assert. A leak that announces itself is
 * a five-minute fix; a silent one is a fortnight of somebody else's time.
 */
test.afterEach(async () => {
  const leaked: string[] = [];

  while (made.length) {
    const id = made.pop()!;
    let response = await admin.delete(`${API}/drawings/${id}`);

    if (!response.ok()) {
      // The only refusal this hits is ISSUED. Withdrawing needs a reason —
      // `DrawingWithdrawn.reason` is non-nullable, which is the catalogue
      // deciding that a plan cannot be pulled back without saying why.
      await admin.put(`${API}/drawings/${id}/status`, {
        data: { status: "WITHDRAWN", reason: "Testaufräumen" },
      });
      response = await admin.delete(`${API}/drawings/${id}`);
    }

    if (!response.ok()) leaked.push(`${id} (HTTP ${response.status()})`);
  }

  expect(
    leaked,
    "Fixtures blieben liegen — sie sammeln sich an, bis der Planversand-Dialog " +
      "sie nicht mehr auf seiner ersten Seite von 100 findet.",
  ).toEqual([]);
});

async function projectId(): Promise<string> {
  const response = await admin.get(`${API}/projects?q=P-2026-001`);
  const items = ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(items.length, "the seeded demo project is missing").toBeGreaterThan(0);
  return items[0].id;
}

async function get(id: string): Promise<Drawing> {
  const response = await admin.get(`${API}/drawings/${id}`);
  return ((await response.json()) as { data: Drawing }).data;
}

/*
  No local counter any more: `e2eNumber` owns uniqueness, because it has to be
  unique across *runs* as well as within one — three width projects can create
  a plan in the same millisecond.
*/
async function aDrawing(over: Record<string, unknown> = {}): Promise<Drawing> {
  const disciplines = await admin.get(`${API}/disciplines`);
  const rows = (await disciplines.json()) as { data: { id: string }[] };

  const response = await admin.post(`${API}/drawings`, {
    data: {
      number: e2eNumber("UI"),
      title: "UI Grundriss",
      projectId: await projectId(),
      disciplineId: rows.data[0].id,
      type: "GRUNDRISS",
      ...over,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const drawing = ((await response.json()) as { data: Drawing }).data;
  made.push(drawing.id);
  return drawing;
}

/** Draws, checks and releases, so the plan is transmittable. */
async function aReleasedDrawing(): Promise<Drawing> {
  const people = await admin.get(`${API}/employees?perPage=5`);
  const staff = ((await people.json()) as { data: { items: { id: string }[] } }).data.items;

  const drawing = await aDrawing({ drawnById: staff[0].id });
  await admin.post(`${API}/drawings/${drawing.id}/revisions`, {
    data: {
      changeNote: "Erstausgabe für die Ausführung.",
      storageKey: "plaene/2026/ui.pdf",
      fileName: "ui.pdf",
      size: 2048,
      checksum: "ui-checksum",
      mimeType: "application/pdf",
    },
  });
  await admin.patch(`${API}/drawings/${drawing.id}`, {
    data: { expectedVersion: (await get(drawing.id)).version, checkedById: staff[1].id },
  });
  for (const status of ["IN_CHECK", "CHECKED", "RELEASED"]) {
    await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status } });
  }
  return get(drawing.id);
}

async function textOf(download: { createReadStream(): Promise<NodeJS.ReadableStream> }) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/* ================================================================== */

test.describe("a plan has a URL", () => {
  /**
   * The claim the route/drawer decision rests on. A tab held in `useState`
   * would pass every unit test in the feature and fail this one.
   */
  test("the tab is in the address, and a reload comes back to it", async ({ page }) => {
    const drawing = await aReleasedDrawing();

    await page.goto(`/admin.html#/plaene/${drawing.id}/revisionen`);
    await expect(page.getByRole("heading", { name: "Revisionen" })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/plaene/${drawing.id}/revisionen$`));
    await expect(page.getByRole("heading", { name: "Revisionen" })).toBeVisible();
  });

  test("the bare id opens the overview", async ({ page }) => {
    const drawing = await aReleasedDrawing();
    await page.goto(`/admin.html#/plaene/${drawing.id}`);
    await expect(page.getByRole("heading", { name: "Aktuelle Revision" })).toBeVisible();
  });

  test("the breadcrumb is derived, so the way back is the register", async ({ page }) => {
    const drawing = await aDrawing();
    await page.goto(`/admin.html#/plaene/${drawing.id}`);
    // Derived from the route's `parent` (F4), never written in the screen.
    await expect(page.getByRole("link", { name: "Pläne" }).first()).toBeVisible();
  });

  test("shows the revision history, newest first and append-only", async ({ page }) => {
    const drawing = await aReleasedDrawing();
    await admin.post(`${API}/drawings/${drawing.id}/revisions`, {
      data: {
        changeNote: "Zweite Fassung nach der Koordination.",
        storageKey: "k",
        fileName: "b.pdf",
        size: 1,
        checksum: "c",
        mimeType: "application/pdf",
      },
    });

    await page.goto(`/admin.html#/plaene/${drawing.id}/revisionen`);
    // Both survive — the bytes of every revision are kept.
    await expect(page.getByText("Erstausgabe für die Ausführung.")).toBeVisible();
    await expect(page.getByText("Zweite Fassung nach der Koordination.")).toBeVisible();
  });
});

test.describe("a plan with no revision", () => {
  /**
   * The state the seed carries a row for on purpose: `refuseTransition`'s
   * refusal cannot be seen without one.
   */
  test("says so rather than showing an empty panel", async ({ page }) => {
    const drawing = await aDrawing();
    await page.goto(`/admin.html#/plaene/${drawing.id}`);

    await expect(page.getByText(/noch nicht gezeichnet/)).toBeVisible();
    // And the register row reads "noch keine" rather than a dash — a plan
    // nobody has drawn is a state somebody acts on, not a missing value.
    await expect(page.getByText("noch keine").first()).toBeVisible();
  });
});

test.describe("the four-eyes warning", () => {
  /**
   * The server refuses the *check*; this is the courtesy that says so before
   * somebody tries, because the two names are set on a different screen from
   * the one where the refusal happens.
   */
  test("appears when one person is named in both columns", async ({ page }) => {
    const people = await admin.get(`${API}/employees?perPage=5`);
    const staff = ((await people.json()) as { data: { items: { id: string }[] } }).data.items;

    const drawing = await aDrawing({ drawnById: staff[0].id });
    await admin.patch(`${API}/drawings/${drawing.id}`, {
      data: { expectedVersion: (await get(drawing.id)).version, checkedById: staff[0].id },
    });

    await page.goto(`/admin.html#/plaene/${drawing.id}`);
    await expect(page.getByText(/Gezeichnet und geprüft ist dieselbe Person/)).toBeVisible();
  });
});

test.describe("the project's Pläne tab", () => {
  /**
   * The composition `admin/pages/ProjectPage.tsx` performs — the only layer
   * allowed to, because `features/projects` may not import `features/drawings`
   * and `widgets/` may not import a feature at all. Nothing in a type check
   * notices if the map entry is missing: the tab falls through to
   * `ModulePlaceholder`, which renders perfectly well.
   */
  test("is the module, not a placeholder, and groups by Gewerk", async ({ page }) => {
    await aReleasedDrawing();
    const id = await projectId();

    await page.goto(`/admin.html#/projekte/${id}/plaene`);
    await expect(page.getByText("Dieses Modul ist noch nicht implementiert.")).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Planbestand" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Planversand" })).toBeVisible();

    // A Gewerk heading — `HZG · Heizung` — which is what grouping produces and
    // a flat table does not.
    await expect(page.getByRole("heading", { name: /·/ }).first()).toBeVisible();
  });
});

test.describe("the Planversand dialog", () => {
  /**
   * `refuseSelection` is tested pure. What a unit test cannot show is that the
   * checkbox is actually disabled and the reason is actually on the row — so
   * nobody assembles twelve plans and has the lot refused.
   */
  test("disables a plan that cannot be sent, with the reason on the row", async ({ page }) => {
    // A plan in WIP with a revision: released is what it is missing.
    const drawing = await aDrawing();
    await admin.post(`${API}/drawings/${drawing.id}/revisions`, {
      data: {
        changeNote: "Noch nicht freigegeben, nur gezeichnet.",
        storageKey: "k",
        fileName: "a.pdf",
        size: 1,
        checksum: "c",
        mimeType: "application/pdf",
      },
    });

    const id = await projectId();
    await page.goto(`/admin.html#/projekte/${id}/plaene`);
    await page.getByRole("button", { name: "Pläne versenden" }).click();

    const row = page.getByText(drawing.number).locator("xpath=ancestor::li");
    await expect(row.getByText("Noch nicht freigegeben.")).toBeVisible();
    await expect(row.getByRole("checkbox")).toBeDisabled();
  });

  /**
   * **The report, not a toast.** The warnings are the half that matters: the
   * person holding revision A while B goes out is the one who builds the wrong
   * thing, and a toast would put their name where nobody reads it.
   */
  test("reports who holds an older revision instead of closing", async ({ page }) => {
    const drawing = await aReleasedDrawing();

    // Sent once, so somebody holds Rev. A.
    await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: drawing.revisions[0].id }],
        recipients: [{ externalName: "UI Sanitär AG" }],
      },
    });

    // Rev. B, released.
    await admin.post(`${API}/drawings/${drawing.id}/revisions`, {
      data: {
        changeNote: "Korrektur nach der Koordinationssitzung.",
        storageKey: "k",
        fileName: "b.pdf",
        size: 1,
        checksum: "c",
        mimeType: "application/pdf",
      },
    });
    for (const status of ["IN_CHECK", "CHECKED", "RELEASED"]) {
      await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status } });
    }

    const id = await projectId();
    await page.goto(`/admin.html#/projekte/${id}/plaene`);
    await page.getByRole("button", { name: "Pläne versenden" }).click();

    const row = page.getByText(drawing.number).locator("xpath=ancestor::li");
    await row.getByRole("checkbox").check();

    await page.getByRole("textbox", { name: "Name" }).first().fill("UI Sanitär AG");
    // `exact` — Playwright's `name` matches as a substring, so plain
    // "Versenden" also finds the tab's own "Pläne versenden" button behind the
    // dialog and refuses under strict mode.
    await page.getByRole("button", { name: "Versenden", exact: true }).click();

    // The dialog becomes a report rather than closing.
    await expect(page.getByText(/haben eine ältere Revision/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("UI Sanitär AG").first()).toBeVisible();
  });
});

test.describe("the Planversand record", () => {
  test("shows who has confirmed and who has not, as two different facts", async ({ page }) => {
    const drawing = await aReleasedDrawing();
    const sent = await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: drawing.revisions[0].id }],
        recipients: [{ externalName: "UI Empfänger A" }, { externalName: "UI Empfänger B" }],
      },
    });
    const { transmittal } = ((await sent.json()) as {
      data: { transmittal: { id: string; recipients: { id: string }[] } };
    }).data;

    await admin.post(`${API}/transmittals/${transmittal.id}/acknowledge`, {
      data: { recipientId: transmittal.recipients[0].id },
    });

    await page.goto(`/admin.html#/planversand/${transmittal.id}`);
    // Confirmed is a badge; unconfirmed is prose — because `null` means "no
    // reply", not "did not receive".
    //
    // `exact` on both: without it "Bestätigt" also matches the "Bestätigen"
    // button, the "nicht bestätigt" line and the card's "1 von 2 bestätigt"
    // description, and strict mode refuses four elements.
    await expect(page.getByText("Bestätigt", { exact: true })).toBeVisible();
    await expect(page.getByText("nicht bestätigt", { exact: true })).toBeVisible();
    await expect(page.getByText(/Nicht bestätigt heisst nicht/)).toBeVisible();
  });

  test("offers no way to edit or delete it", async ({ page }) => {
    // A statement about the past. Correcting one means issuing another.
    const drawing = await aReleasedDrawing();
    const sent = await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: drawing.revisions[0].id }],
        recipients: [{ externalName: "UI Empfänger" }],
      },
    });
    const { transmittal } = ((await sent.json()) as { data: { transmittal: { id: string } } }).data;

    await page.goto(`/admin.html#/planversand/${transmittal.id}`);
    await expect(page.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Löschen" })).toHaveCount(0);
    await expect(page.getByText(/wird nicht geändert und nicht gelöscht/)).toBeVisible();
  });
});

test.describe("the exports", () => {
  /**
   * A CSV that downloads empty reads as a broken button. `downloads.spec.ts`
   * proves the *mechanism*; this proves these two carry rows.
   */
  test("the plan register exports the rows on screen", async ({ page }) => {
    const drawing = await aReleasedDrawing();

    await page.goto("/admin.html#/plaene");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Als CSV exportieren/i }).click(),
    ]);

    const csv = await textOf(download);
    // `Nummer`, not `Plannummer` — the CSV header is the export's own key, and
    // the register's column label is a different string. Asserting the UI's
    // word here passed nothing and failed for the right reason.
    expect(csv).toContain("Nummer;Titel;Projekt;Gewerk");
    expect(csv).toContain(drawing.number);
  });

  test("the Planversand register exports its rows", async ({ page }) => {
    const drawing = await aReleasedDrawing();
    const sent = await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: drawing.revisions[0].id }],
        recipients: [{ externalName: "UI Export" }],
      },
    });
    const { transmittal } = ((await sent.json()) as {
      data: { transmittal: { number: string } };
    }).data;

    await page.goto("/admin.html#/planversand");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Als CSV exportieren/i }).click(),
    ]);

    const csv = await textOf(download);
    expect(csv).toContain("Nummer");
    expect(csv).toContain(transmittal.number);
  });
});

test.describe("the shell", () => {
  test("both rail rows are there", async ({ page }) => {
    await page.goto("/admin.html#/plaene");
    const rail = page.getByRole("navigation", { name: "Hauptnavigation" });

    await expect(rail.getByRole("link", { name: /Pläne/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /Planversand/ })).toBeVisible();
  });
});
