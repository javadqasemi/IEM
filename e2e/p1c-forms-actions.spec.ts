import type { APIRequestContext, Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, apiAs, e2eName, expect, test } from "./fixtures";

/**
 * P1C — the forms, actions and interaction standard, **in a browser**.
 *
 * The unit tests pin the rules (`Modal.test.ts`, `failure.test.ts`,
 * `theme.contrast.test.ts`) and `src/architecture.test.ts` pins the shapes —
 * a destructive button's variant, a dialog's form, one primary per footer.
 * These pin what only a browser can show: that the pieces meet.
 *
 * | Case | Standard |
 * | --- | --- |
 * | edit → dirty → save → saved → reload → persisted; discard | page form + SaveBar |
 * | leaving a dirty form through the palette asks first | unsaved guard |
 * | Enter submits a dialog exactly once | dialog form |
 * | a blocked primary says why | disabled reason |
 * | an empty submit points at its first field | validation + focus |
 * | a conflict keeps the input and reloads in place | ConflictNotice |
 * | consequence first, cancel is inert, confirm fires once | MEDIUM confirmation |
 * | from, to and what follows | StatusTransitionDialog |
 * | the "Mehr" menu by keyboard, destructive last | ActionMenu / RecordActions |
 * | header actions live in the sticky bar | page actions (UX-18) |
 * | 375 px: full-screen form dialog, compact confirm, toasts above the bar | responsive |
 *
 * Runs once (`SIGNS_IN_TWICE`): it signs an API context in for its fixtures,
 * and it changes the viewport itself where width matters.
 */

let admin: APIRequestContext;

test.beforeAll(async () => {
  admin = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
});

test.afterAll(async () => {
  await admin?.dispose();
});

const settle = (page: Page) =>
  expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

/** The save bar of the form on screen — the sticky pane that carries "Speichern". */
const saveBar = (page: Page) =>
  page.locator(".glass-raised").filter({ has: page.getByRole("button", { name: "Speichern" }) });

async function demoProjectId(): Promise<string> {
  const response = await admin.get(`${API}/projects?q=P-2026-001`);
  const items = ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(items.length, "the seeded demo project is missing").toBeGreaterThan(0);
  return items[0].id;
}

async function throwawayProject(label: string): Promise<{ id: string; version: number }> {
  const customers = (await (await admin.get(`${API}/customers?perPage=1`)).json()) as {
    data: { items: { id: string }[] };
  };
  const created = await admin.post(`${API}/projects`, {
    data: { name: e2eName(label), customerId: customers.data.items[0].id },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { data: { id: string; version: number } }).data;
}

async function dropProject(id: string) {
  await admin.put(`${API}/projects/${id}/status`, { data: { status: "CANCELLED" } });
  await admin.delete(`${API}/projects/${id}`);
}

/* ================================================================== */
/* The page form                                                       */
/* ================================================================== */

test.describe("a page form (Unternehmen › Kontakt)", () => {
  test("edit → unsaved → save → saved → reload → persisted, and Verwerfen restores the baseline", async ({
    page,
  }) => {
    await page.goto("/admin.html#/einstellungen/kontakt");
    await settle(page);
    const field = page.getByLabel("Support", { exact: true });
    await expect(field).toBeVisible({ timeout: 15_000 });
    const original = await field.inputValue();
    const probe = original === "hilfe@iem.ch" ? "support@iem.ch" : "hilfe@iem.ch";

    try {
      await field.fill(probe);
      await expect(saveBar(page).getByText("Ungespeicherte Änderungen.")).toBeVisible();

      await saveBar(page).getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByText("Gespeichert.", { exact: true })).toBeVisible({ timeout: 15_000 });
      // One signal, not two (Part 10.5): no toast repeating the bar.
      await expect(page.getByText("Die Unternehmensangaben wurden übernommen.")).toHaveCount(0);

      await page.reload();
      await settle(page);
      await expect(page.getByLabel("Support", { exact: true })).toHaveValue(probe, { timeout: 15_000 });

      // Discard: back to the accepted server baseline, and the bar goes.
      const again = page.getByLabel("Support", { exact: true });
      await again.fill("wird-verworfen@iem.ch");
      await saveBar(page).getByRole("button", { name: "Verwerfen" }).click();
      await expect(again).toHaveValue(probe);
      // Exact: the (closed) leave-guard dialog is always in the DOM and its
      // message contains the same words — "… ungespeicherte Änderungen."
      await expect(page.getByText("Ungespeicherte Änderungen.", { exact: true })).toHaveCount(0);
    } finally {
      const field2 = page.getByLabel("Support", { exact: true });
      if ((await field2.inputValue()) !== original) {
        await field2.fill(original);
        await saveBar(page).getByRole("button", { name: "Speichern" }).click();
        await expect(page.getByText("Gespeichert.", { exact: true })).toBeVisible({ timeout: 15_000 });
      }
    }
  });

  test("leaving a dirty form through the command palette asks first; staying keeps the input", async ({
    page,
  }) => {
    await page.goto("/admin.html#/einstellungen/kontakt");
    await settle(page);
    const field = page.getByLabel("Support", { exact: true });
    await expect(field).toBeVisible({ timeout: 15_000 });
    const original = await field.inputValue();

    await field.fill("palette-guard@iem.ch");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Seite oder Bereich suchen" }).fill("Standorte");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: "Änderungen verwerfen?" })).toBeVisible();
    expect(page.url()).toContain("/einstellungen/kontakt");

    await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
    await expect(field).toHaveValue("palette-guard@iem.ch");

    await saveBar(page).getByRole("button", { name: "Verwerfen" }).click();
    await expect(field).toHaveValue(original);
  });
});

/* ================================================================== */
/* Dialog forms                                                        */
/* ================================================================== */

test.describe("dialog forms", () => {
  test("Enter submits a dialog exactly once", async ({ page }) => {
    const title = e2eName("P1C Enter");
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/api\/v1\/tasks$/.test(r.url())) posts.push(r.url());
    });

    await page.goto("/admin.html#/aufgaben");
    await settle(page);
    // The list's create action is its primary, and it lives in the sticky bar.
    const create = page.locator("header.glass-bar").getByRole("button", { name: "Neue Aufgabe" });
    await expect(create).toHaveAttribute("data-variant", "primary");
    await create.click();

    const dialog = page.getByRole("dialog", { name: "Neue Aufgabe" });
    const field = dialog.getByLabel("Titel", { exact: true });
    // Required semantics reach assistive technology: no "(optional)", so required.
    await expect(field).toHaveAttribute("aria-required", "true");
    await field.fill(title);
    await field.press("Enter");
    await expect(dialog).toBeHidden();
    expect(posts, "one Enter, one request").toHaveLength(1);

    const found = await admin.get(`${API}/tasks?q=${encodeURIComponent(title)}`);
    const items = ((await found.json()) as { data: { items: { id: string; title: string }[] } }).data.items;
    const task = items.find((t) => t.title === title);
    expect(task, "Enter hat die Aufgabe nicht angelegt").toBeTruthy();
    await admin.delete(`${API}/tasks/${task!.id}`);
  });

  test("a blocked primary says why, in text and to assistive technology", async ({ page }) => {
    await page.goto("/admin.html#/benutzer");
    await settle(page);
    await page.locator("header.glass-bar").getByRole("button", { name: "+ Einladen" }).click();
    const dialog = page.getByRole("dialog", { name: "Benutzer einladen" });

    const invite = dialog.getByRole("button", { name: "Einladen" });
    await expect(invite).toHaveAttribute("aria-disabled", "true");
    await expect(invite).toHaveAccessibleDescription("Name fehlt.");
    await expect(dialog.getByText("Name fehlt.").first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("an empty submit puts each message beside its field and focuses the first", async ({ page }) => {
    await page.goto("/admin.html#/profil");
    await settle(page);
    const current = page.getByLabel("Aktuelles Passwort");
    await expect(current).toBeVisible();

    await page.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(page.getByText("Bitte das aktuelle Passwort eingeben.")).toBeVisible();
    await expect(page.getByText("Bitte ein neues Passwort eingeben.")).toBeVisible();
    await expect(current).toBeFocused();
    await expect(current).toHaveAttribute("aria-invalid", "true");
    // Error first in the description list, the hint of the next field kept.
    const describedBy = (await current.getAttribute("aria-describedby")) ?? "";
    await expect(page.locator(`[id="${describedBy.split(" ")[0]}"]`)).toHaveText(
      "Bitte das aktuelle Passwort eingeben.",
    );
    await expect(page.getByText("Mindestens 12 Zeichen.", { exact: false })).toBeVisible();
  });

  test("a conflict names itself, keeps the input and reloads in place", async ({ page }) => {
    const project = await throwawayProject("P1C Konflikt");
    try {
      await page.goto(`/admin.html#/projekte/${project.id}`);
      await settle(page);
      await page.evaluate(() => ((window as unknown as { __p1c: string }).__p1c = "same-document"));

      await page.getByRole("button", { name: "Bearbeiten" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Projektname").fill("Meine Änderung, nicht gespeichert");

      const other = await admin.patch(`${API}/projects/${project.id}`, {
        data: { expectedVersion: project.version, notes: "Von jemand anderem" },
      });
      expect(other.status(), await other.text()).toBe(200);

      await dialog.getByRole("button", { name: "Speichern" }).click();
      const notice = dialog.locator('[data-callout="warning"]');
      await expect(notice).toHaveAttribute("role", "alert");
      await expect(notice).toContainText("Inzwischen von jemand anderem geändert");
      await expect(notice).toContainText("nicht gespeichert");
      await expect(dialog.getByLabel("Projektname")).toHaveValue("Meine Änderung, nicht gespeichert");

      await notice.getByRole("button", { name: "Neueste Fassung laden" }).click();
      await expect(dialog).toBeHidden();
      expect(await page.evaluate(() => (window as unknown as { __p1c?: string }).__p1c)).toBe(
        "same-document",
      );
    } finally {
      await dropProject(project.id);
    }
  });
});

/* ================================================================== */
/* Actions                                                             */
/* ================================================================== */

test.describe("actions", () => {
  test("a destructive action states its consequence; cancel changes nothing; confirm fires once", async ({
    page,
  }) => {
    const created = await admin.post(`${API}/meetings`, {
      data: { title: e2eName("P1C Traktandum"), startsAt: "2026-09-02T14:00:00Z", projectId: await demoProjectId() },
    });
    expect(created.status(), await created.text()).toBe(201);
    const meeting = ((await created.json()) as { data: { id: string } }).data;

    try {
      const agenda = await admin.post(`${API}/meetings/${meeting.id}/agenda`, {
        data: { title: "P1C Wird entfernt" },
      });
      expect(agenda.status(), await agenda.text()).toBe(201);
      const detail = (await (await admin.get(`${API}/meetings/${meeting.id}`)).json()) as {
        data: { agenda: { id: string; title: string }[] };
      };
      const item = detail.data.agenda.find((a) => a.title === "P1C Wird entfernt")!;
      await admin.post(`${API}/meetings/${meeting.id}/items`, {
        data: { text: "Eine Zeile unter dem Traktandum", agendaItemId: item.id },
      });

      const deletes: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "DELETE" && r.url().includes(`/agenda/${item.id}`)) deletes.push(r.url());
      });

      await page.goto(`/admin.html#/sitzungen/${meeting.id}/traktanden`);
      await settle(page);
      const row = page.getByRole("listitem").filter({ hasText: "P1C Wird entfernt" });
      const remove = row.getByRole("button", { name: "Entfernen" });
      await expect(remove).toHaveAttribute("data-variant", "danger-quiet");

      await remove.click();
      const dialog = page.getByRole("dialog", { name: /Traktandum „P1C Wird entfernt“ entfernen/ });
      await expect(dialog.locator('[data-callout="warning"]')).toContainText("Ohne Traktandum");
      await dialog.getByRole("button", { name: "Abbrechen" }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toBeVisible();
      expect(deletes, "cancel sent nothing").toHaveLength(0);

      await remove.click();
      await expect(dialog.getByRole("button", { name: "Entfernen" })).toHaveAttribute("data-variant", "danger");
      await dialog.getByRole("button", { name: "Entfernen" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("listitem").filter({ hasText: "P1C Wird entfernt" })).toHaveCount(0);
      expect(deletes, "confirm sent exactly one request").toHaveLength(1);
    } finally {
      await admin.delete(`${API}/meetings/${meeting.id}`);
    }
  });

  test("a status transition shows where the record is, where it goes and what follows", async ({ page }) => {
    const project = await throwawayProject("P1C Status");
    try {
      await page.goto(`/admin.html#/projekte/${project.id}`);
      await settle(page);
      await page.getByRole("button", { name: "Status ändern" }).click();
      const dialog = page.getByRole("dialog", { name: "Status ändern" });

      await expect(dialog.locator("[data-transition]")).toContainText("Geplant");
      await dialog.getByLabel("Neuer Status").selectOption({ label: "Abgebrochen" });
      await expect(dialog.locator("[data-transition]")).toContainText("Abgebrochen");
      await expect(dialog.locator("[data-callout]")).toContainText("abgebrochenes Projekt");
      // Stopping a project is the destructive target: `danger`, never Enter.
      await expect(dialog.getByRole("button", { name: "Auf „Abgebrochen“ setzen" })).toHaveAttribute(
        "data-variant",
        "danger",
      );

      await dialog.getByRole("button", { name: "Abbrechen" }).click();
      const after = (await (await admin.get(`${API}/projects/${project.id}`)).json()) as {
        data: { status: string };
      };
      expect(after.data.status, "cancelling the dialog changed the status").toBe("PLANNED");
    } finally {
      await dropProject(project.id);
    }
  });

  test("the record's 'Mehr' menu works by keyboard, lists destructive items last, and returns focus", async ({
    page,
  }) => {
    const response = await admin.post(`${API}/decisions`, {
      data: {
        title: e2eName("P1C Menü"),
        rationale: "Weil ein Menü mit der Tastatur bedienbar sein muss, nicht nur mit der Maus.",
        projectId: await demoProjectId(),
        decidedAt: "2026-09-10",
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const decision = ((await response.json()) as { data: { id: string } }).data;

    try {
      await page.goto(`/admin.html#/entscheide/${decision.id}`);
      await settle(page);
      const more = page.getByRole("button", { name: "Mehr" });
      await more.focus();
      await page.keyboard.press("Enter");

      const menu = page.getByRole("menu", { name: "Mehr" });
      await expect(menu).toBeVisible();
      const items = menu.getByRole("menuitem");
      await expect(items.first()).toBeFocused();
      await expect(items.last()).toHaveText(/Löschen/);
      await expect(items.last()).toHaveAttribute("data-destructive", "true");

      await page.keyboard.press("End");
      await expect(items.last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(more).toBeFocused();
    } finally {
      await admin.delete(`${API}/decisions/${decision.id}`);
    }
  });

  test("a page's header actions stay reachable: they are drawn in the sticky bar", async ({ page }) => {
    await page.goto("/admin.html#/projekte");
    await settle(page);
    const create = page.locator("header.glass-bar").getByRole("button", { name: "Neues Projekt" });
    await expect(create).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(create).toBeInViewport();
  });
});

/* ================================================================== */
/* Widths                                                              */
/* ================================================================== */

test.describe("the standard at 1440, 1024, 768 and 375", () => {
  test.afterEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const width of [1440, 1024, 768, 375]) {
    test(`${width}px — a form dialog's primary is on screen; the page does not scroll sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/admin.html#/aufgaben");
      await settle(page);
      await page.locator("header.glass-bar").getByRole("button", { name: "Neue Aufgabe" }).click();
      const dialog = page.getByRole("dialog", { name: "Neue Aufgabe" });
      await expect(dialog.getByRole("button", { name: "Anlegen" })).toBeInViewport();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal scroll").toBeLessThanOrEqual(1);

      if (width === 375) {
        // Below `sm` a form dialog is a full-screen sheet (UX-26).
        const box = (await dialog.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(width - 1);
        expect(box.height).toBeGreaterThanOrEqual(812 - 1);
      }
      await page.keyboard.press("Escape");
    });
  }

  test("375px — a confirmation stays compact, and toasts stack above the save bar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto("/admin.html#/einstellungen/standorte");
    await settle(page);
    await page.getByRole("row", { name: /Thun/ }).getByRole("button", { name: "Archivieren" }).click();
    const confirm = page.getByRole("dialog", { name: /archivieren\?/ });
    const box = (await confirm.boundingBox())!;
    expect(box.width, "a two-button confirmation is not a full-screen sheet").toBeLessThan(375);
    await confirm.getByRole("button", { name: "Abbrechen" }).click();

    await page.goto("/admin.html#/einstellungen/kontakt");
    await settle(page);
    const field = page.getByLabel("Support", { exact: true });
    await expect(field).toBeVisible({ timeout: 15_000 });
    const original = await field.inputValue();
    await field.fill("bar-and-toast@iem.ch");

    const bar = saveBar(page);
    await expect(bar).toBeVisible();
    const measured = await page.evaluate(() => {
      const region = document.querySelector<HTMLElement>('div.fixed[aria-live="polite"]');
      const clearance = getComputedStyle(document.documentElement).getPropertyValue("--toast-clearance");
      return { bottom: region?.getBoundingClientRect().bottom ?? 0, clearance, inner: window.innerHeight };
    });
    const barBox = (await bar.boundingBox())!;
    expect(parseFloat(measured.clearance), "the bar published its height").toBeGreaterThanOrEqual(
      Math.floor(barBox.height),
    );
    // Where a toast lands is above where a bar stuck to the bottom sits.
    expect(measured.bottom).toBeLessThanOrEqual(measured.inner - barBox.height);

    await bar.getByRole("button", { name: "Verwerfen" }).click();
    await expect(field).toHaveValue(original);
  });
});
