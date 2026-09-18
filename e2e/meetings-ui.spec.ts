import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, apiAs, expect, test } from "./fixtures";

/**
 * Sitzungen und Entscheide, **in a browser** — the client half of Wave 2,
 * module 2.
 *
 * `meetings.spec.ts` beside this one drives the API and guards the rules. This
 * one guards the four claims that are only true if a browser says so, because
 * each of them is a claim about composition rather than about a function:
 *
 * | | |
 * | --- | --- |
 * | **A protocol has a URL** | the whole reason this module got a route where Aufgaben got a drawer — and a `useState` tab would pass every unit test |
 * | **A line is filed under its Traktandum** | `groupProtocol` is tested pure; that the panel renders both its groups is not |
 * | **An approved protocol is read-only *before* the user types** | the server refuses either way, so a broken client guard fails silently as a 403 after the work |
 * | **The project tab is composed in** | `admin/pages/ProjectPage.tsx` is the only layer allowed to do it, and nothing in a type check notices if it does not |
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

type Meeting = {
  id: string;
  label: string;
  status: string;
  protocolLocked: boolean;
  agenda: { id: string; order: number; title: string }[];
  items: { id: string; key: string; text: string }[];
  attendees: { id: string }[];
};

const made: { meetings: string[]; decisions: string[] } = { meetings: [], decisions: [] };

test.afterEach(async () => {
  while (made.decisions.length) await admin.delete(`${API}/decisions/${made.decisions.pop()!}`);
  while (made.meetings.length) await admin.delete(`${API}/meetings/${made.meetings.pop()!}`);
});

async function projectId(): Promise<string> {
  const response = await admin.get(`${API}/projects?q=P-2026-001`);
  const items = ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(items.length, "the seeded demo project is missing").toBeGreaterThan(0);
  return items[0].id;
}

async function get(id: string): Promise<Meeting> {
  const response = await admin.get(`${API}/meetings/${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: Meeting }).data;
}

/** A meeting on the demo project, with two Traktanden and three lines. */
async function aMeeting(title: string): Promise<Meeting> {
  const created = await admin.post(`${API}/meetings`, {
    data: { title, startsAt: "2026-09-02T14:00:00Z", projectId: await projectId() },
  });
  expect(created.status(), await created.text()).toBe(201);
  const meeting = ((await created.json()) as { data: Meeting }).data;
  made.meetings.push(meeting.id);

  for (const agendaTitle of ["Stand Lüftung", "Termine"]) {
    const response = await admin.post(`${API}/meetings/${meeting.id}/agenda`, {
      data: { title: agendaTitle },
    });
    expect(response.status(), await response.text()).toBe(201);
  }

  const withAgenda = await get(meeting.id);
  await admin.post(`${API}/meetings/${meeting.id}/items`, {
    data: { text: "Steigzone Ost bleibt wie geplant", agendaItemId: withAgenda.agenda[0].id },
  });
  await admin.post(`${API}/meetings/${meeting.id}/items`, {
    data: { text: "Abnahme wird auf KW 48 verschoben", agendaItemId: withAgenda.agenda[1].id },
  });
  // The line that belongs to no Traktandum — "und noch etwas", which every
  // Bausitzung produces and which a naive group-by drops.
  await admin.post(`${API}/meetings/${meeting.id}/items`, {
    data: { text: "Parkplatz vor dem Baubüro wird gesperrt" },
  });

  return get(meeting.id);
}

/* ================================================================== */

test.describe("a protocol has a URL", () => {
  /**
   * The claim the whole route/drawer decision rests on.
   *
   * *"Siehe Bausitzung 14, Punkt 3"* has to be a link somebody can paste into an
   * e-mail. A tab held in `useState` would pass every unit test in the feature
   * and fail this one — which is exactly why it is here and not there.
   */
  test("the tab is in the address, and a reload comes back to it", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: Bausitzung");

    await page.goto(`/admin.html#/sitzungen/${meeting.id}/teilnehmende`);
    await expect(page.getByRole("heading", { name: "Teilnehmende" })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/sitzungen/${meeting.id}/teilnehmende$`));
    await expect(page.getByRole("heading", { name: "Teilnehmende" })).toBeVisible();
  });

  test("the bare id opens the protocol", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: bare");
    await page.goto(`/admin.html#/sitzungen/${meeting.id}`);
    // `/sitzungen/:id` and `/sitzungen/:id/protokoll` are the same page; the
    // list links to the bare form, because a URL with a redundant segment
    // invites people to wonder which one is canonical.
    await expect(page.getByText("Steigzone Ost bleibt wie geplant")).toBeVisible();
  });

  test("the breadcrumb is derived, so the way back is the list", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: trail");
    await page.goto(`/admin.html#/sitzungen/${meeting.id}/protokoll`);
    // Derived from the route's `parent` (F4), never written in the screen — a
    // hand-written trail keeps pointing at the old path the first time a route
    // moves.
    await expect(page.getByRole("link", { name: "Sitzungen" }).first()).toBeVisible();
  });
});

test.describe("the protocol panel", () => {
  /**
   * `groupProtocol` is tested pure and exhaustively. What a unit test cannot
   * show is that the panel renders *both* of its groups — and the second one is
   * the one that gets forgotten.
   */
  test("files each line under its Traktandum and keeps the loose one", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: groups");
    await page.goto(`/admin.html#/sitzungen/${meeting.id}/protokoll`);

    await expect(page.getByRole("heading", { name: /Stand Lüftung/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Termine/ })).toBeVisible();
    // The heading that only exists because somebody decided not to drop these
    // lines.
    await expect(page.getByRole("heading", { name: "Ohne Traktandum" })).toBeVisible();
    await expect(page.getByText("Parkplatz vor dem Baubüro wird gesperrt")).toBeVisible();
  });

  test("cites every line by its key", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: keys");
    await page.goto(`/admin.html#/sitzungen/${meeting.id}/protokoll`);

    // The keys the server derived. Three lines on a meeting with no series
    // number are cited `1`, `2`, `3`; with one they are `14.1` and so on. Either
    // way the screen prints what it was sent rather than assembling its own.
    for (const item of meeting.items) {
      await expect(page.getByText(item.key, { exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("an approved protocol is closed", () => {
  /**
   * The server refuses the write either way — that is `meetings.spec.ts`. What
   * this asserts is that the **editor is gone before the user types**, because a
   * client that only found out on submit would let somebody write four
   * corrections and lose all of them to a 403.
   */
  test("the editor disappears and the page says why", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: approved");

    // Attendance has to be recorded before a meeting may be held — the server
    // refuses a room nobody was in.
    const employees = await admin.get(`${API}/employees?perPage=1`);
    const employeeId = ((await employees.json()) as { data: { items: { id: string }[] } }).data
      .items[0].id;
    await admin.post(`${API}/meetings/${meeting.id}/attendees`, { data: { employeeId } });
    const withRoom = await get(meeting.id);
    await admin.put(`${API}/meetings/${meeting.id}/attendance`, {
      data: { attendance: [{ attendeeId: withRoom.attendees[0].id, attended: true }] },
    });
    await admin.put(`${API}/meetings/${meeting.id}/status`, { data: { status: "HELD" } });

    // Before approval: editable, and the buttons are there.
    await page.goto(`/admin.html#/sitzungen/${meeting.id}/protokoll`);
    await expect(page.getByRole("button", { name: "+ Zeile ohne Traktandum" })).toBeVisible();

    const approved = await admin.post(`${API}/meetings/${meeting.id}/approval`, {
      data: { decision: "APPROVED" },
    });
    expect(approved.status(), await approved.text()).toBe(201);

    await page.reload();
    await expect(page.getByText("Dieses Protokoll ist genehmigt.")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Zeile ohne Traktandum" })).toHaveCount(0);
    // The way forward, not just the refusal. A rule with no way forward is one
    // people route around — here, by keeping the real minutes in a Word file.
    await expect(page.getByText(/an der nächsten Sitzung genehmigt/)).toBeVisible();
    await expect(page.getByText("Schreibgeschützt")).toBeVisible();
  });

  /**
   * **Every write, not just the protocol** — and this is a regression guard for
   * a bug that was in this file's own screens.
   *
   * `refuseWhenClosed` on the server guards the meeting record, the attendance,
   * the agenda *and* the protocol. `AttendancePanel` was written with a weaker
   * condition — `status !== "CANCELLED"` — so it offered three attendance
   * buttons on an approved meeting that answered 403 on click. The record
   * carries `protocolLocked`, computed by the one rule that decides it, and any
   * second expression of it on the client is a second answer.
   */
  test("closes the attendance and the agenda too, not only the protocol", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: closed all round");

    const employees = await admin.get(`${API}/employees?perPage=1`);
    const employeeId = ((await employees.json()) as { data: { items: { id: string }[] } }).data
      .items[0].id;
    await admin.post(`${API}/meetings/${meeting.id}/attendees`, { data: { employeeId } });
    const withRoom = await get(meeting.id);
    await admin.put(`${API}/meetings/${meeting.id}/attendance`, {
      data: { attendance: [{ attendeeId: withRoom.attendees[0].id, attended: true }] },
    });
    await admin.put(`${API}/meetings/${meeting.id}/status`, { data: { status: "HELD" } });

    // Before approval, both panels offer their controls.
    await page.goto(`/admin.html#/sitzungen/${meeting.id}/teilnehmende`);
    await expect(page.getByRole("button", { name: "Person hinzufügen" })).toBeVisible();
    await page.goto(`/admin.html#/sitzungen/${meeting.id}/traktanden`);
    await expect(page.getByRole("button", { name: "Traktandum hinzufügen" })).toBeVisible();

    await admin.post(`${API}/meetings/${meeting.id}/approval`, { data: { decision: "APPROVED" } });

    /*
      `reload()`, not `goto()` — and this cost a red run.

      `goto()` to a URL that differs only in its hash is a hash change, not a
      navigation: the document stays, and so does `core/api`'s in-memory query
      cache. The page went on rendering the meeting as it was *before* the
      approval, so the assertion below failed against a screen that was correct
      for the data it had. Approving through the API behind the app's back is
      the only reason the cache can be wrong here; a user approving through the
      UI invalidates it.
    */
    await page.reload();
    await expect(page.getByRole("button", { name: "Person hinzufügen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Entfernen" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: /Anwesenheit/ })).toHaveCount(0);

    await page.goto(`/admin.html#/sitzungen/${meeting.id}/traktanden`);
    await expect(page.getByRole("button", { name: "Traktandum hinzufügen" })).toHaveCount(0);
  });

  test("keeps the recorded attendance readable once it is closed", async ({ page }) => {
    // A closed record is read-only, not hidden. Split from the test above so a
    // failure says which of the two halves broke.
    const meeting = await aMeeting("E2E UI: still readable");
    const employees = await admin.get(`${API}/employees?perPage=1`);
    const employeeId = ((await employees.json()) as { data: { items: { id: string }[] } }).data
      .items[0].id;
    await admin.post(`${API}/meetings/${meeting.id}/attendees`, { data: { employeeId } });
    const withRoom = await get(meeting.id);
    await admin.put(`${API}/meetings/${meeting.id}/attendance`, {
      data: { attendance: [{ attendeeId: withRoom.attendees[0].id, attended: true }] },
    });
    await admin.put(`${API}/meetings/${meeting.id}/status`, { data: { status: "HELD" } });
    await admin.post(`${API}/meetings/${meeting.id}/approval`, { data: { decision: "APPROVED" } });

    await page.goto(`/admin.html#/sitzungen/${meeting.id}/teilnehmende`);
    await expect(page.getByRole("group", { name: /Anwesenheit/ })).toHaveCount(0);
    await expect(page.getByText("Anwesend", { exact: true })).toBeVisible();
  });

  /**
   * The other half: `POST /minutes/sent` refuses a second send, so the button is
   * gated on `minutesSentAt` as well as on the status. A button that could only
   * ever produce that 400 reads as an offer.
   */
  test("offers the minutes-sent act once, then stops offering it", async ({ page }) => {
    const meeting = await aMeeting("E2E UI: sent once");

    const employees = await admin.get(`${API}/employees?perPage=1`);
    const employeeId = ((await employees.json()) as { data: { items: { id: string }[] } }).data
      .items[0].id;
    await admin.post(`${API}/meetings/${meeting.id}/attendees`, { data: { employeeId } });
    const withRoom = await get(meeting.id);
    await admin.put(`${API}/meetings/${meeting.id}/attendance`, {
      data: { attendance: [{ attendeeId: withRoom.attendees[0].id, attended: true }] },
    });
    await admin.put(`${API}/meetings/${meeting.id}/status`, { data: { status: "HELD" } });

    await page.goto(`/admin.html#/sitzungen/${meeting.id}/protokoll`);
    await expect(page.getByRole("button", { name: "Protokoll versenden" })).toBeVisible();

    const sent = await admin.post(`${API}/meetings/${meeting.id}/minutes/sent`, { data: {} });
    expect(sent.status(), await sent.text()).toBe(201);

    await page.reload();
    await expect(page.getByRole("button", { name: "Protokoll versenden" })).toHaveCount(0);
    // And the badge moves on: the meeting has left the Friday queue.
    //
    // `exact` matters — the card's own description reads "Versandt 18.09.2026,
    // 15:12.", so a substring match resolves to two elements and Playwright
    // refuses it under strict mode. The badge is the assertion; the description
    // is prose about it.
    await expect(page.getByText("Versandt", { exact: true })).toBeVisible();
  });
});

test.describe("decisions", () => {
  async function aDecision(title: string, over: Record<string, unknown> = {}) {
    const response = await admin.post(`${API}/decisions`, {
      data: {
        title,
        rationale: "Weil der Schacht sonst durch den Lift läuft und das teurer wird.",
        projectId: await projectId(),
        decidedAt: "2026-09-10",
        ...over,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const decision = ((await response.json()) as { data: { id: string; number: string } }).data;
    made.decisions.push(decision.id);
    return decision;
  }

  test("the register finds a decision by its citable number", async ({ page }) => {
    const decision = await aDecision("E2E UI: Steigzone Ost");
    await page.goto("/admin.html#/entscheide");

    /*
      Searched, not scanned.

      The first version of this test loaded `/entscheide` and looked for the
      number on the page. That passes only while the seeded register is shorter
      than one page and the new decision sorts to the top — and it does neither:
      the list is `decidedAt desc`, a fixture dated 10 September lands below the
      seeded ones, and the register is paginated at 25.

      Searching is also the truer assertion. Citing a decision means somebody has
      `E-2026-017` in an e-mail and needs to find it, which is what the search
      box is for.
    */
    await page.getByLabel("Entscheide durchsuchen").fill(decision.number);
    await expect(page.getByText(decision.number).first()).toBeVisible({ timeout: 15_000 });
  });

  test("the detail leads with the rationale, which is the record's whole point", async ({
    page,
  }) => {
    const decision = await aDecision("E2E UI: rationale");
    await page.goto(`/admin.html#/entscheide/${decision.id}`);
    await expect(page.getByRole("heading", { name: "Begründung" })).toBeVisible();
    await expect(page.getByText(/Weil der Schacht sonst durch den Lift läuft/)).toBeVisible();
  });

  /**
   * The notice that stops somebody acting on a decision that no longer stands.
   *
   * "Aufgehoben" as a badge in a row of badges is easy to miss on a page that is
   * mostly prose, so the sentence is above everything and names the successor —
   * because the next question is always "by what".
   */
  test("a reversed decision says so above everything, and names its successor", async ({
    page,
  }) => {
    const old = await aDecision("E2E UI: der alte Entscheid");
    const replacement = await aDecision("E2E UI: der neue Entscheid");

    // The arrow points from the new decision to the old one — the one call in
    // this module where the wrong direction would still typecheck.
    const reversed = await admin.post(`${API}/decisions/${replacement.id}/supersedes`, {
      data: { supersedesId: old.id },
    });
    // 201, not 200: `@Post(":id/supersedes")` creates the link, and Nest's
    // default for a POST is what the route keeps.
    expect(reversed.status(), await reversed.text()).toBe(201);

    await page.goto(`/admin.html#/entscheide/${old.id}`);
    await expect(page.getByText(new RegExp(`aufgehoben und durch ${replacement.number} ersetzt`)))
      .toBeVisible();
    await expect(page.getByRole("link", { name: `${replacement.number} öffnen` })).toBeVisible();

    // And the other way, on the decision that did the replacing.
    await page.goto(`/admin.html#/entscheide/${replacement.id}`);
    await expect(page.getByText(new RegExp(`ersetzt ${old.number}`))).toBeVisible();
  });

  test("a reversed decision offers no way to edit it", async ({ page }) => {
    const old = await aDecision("E2E UI: closed");
    const replacement = await aDecision("E2E UI: closer");
    await admin.post(`${API}/decisions/${replacement.id}/supersedes`, {
      data: { supersedesId: old.id },
    });

    await page.goto(`/admin.html#/entscheide/${old.id}`);
    await expect(page.getByRole("button", { name: "Korrigieren" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Aufheben" })).toHaveCount(0);
  });
});

test.describe("the shell", () => {
  test("both rail rows are there, and Entscheide is not filed under Sitzungen", async ({
    page,
  }) => {
    await page.goto("/admin.html#/sitzungen");
    const rail = page.getByRole("navigation", { name: "Hauptnavigation" });

    // Two destinations, because a decision outlives the meeting it was taken in
    // and some are taken in no meeting at all.
    await expect(rail.getByRole("link", { name: /Sitzungen/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /Entscheide/ })).toBeVisible();
  });

  /**
   * The composition `admin/pages/ProjectPage.tsx` performs — the only layer
   * allowed to, because `features/projects` may not import `features/meetings`
   * and `widgets/` may not import a feature at all.
   *
   * Nothing in a type check notices if the map entry is missing: the tab would
   * simply fall through to `ModulePlaceholder`, which renders perfectly well.
   */
  test("the project's Sitzungen tab is the module, not a placeholder", async ({ page }) => {
    const id = await projectId();
    await page.goto(`/admin.html#/projekte/${id}/sitzungen`);

    await expect(page.getByText("Dieses Modul ist noch nicht implementiert.")).toHaveCount(0);
    // Decisions above meetings, deliberately: a project's meetings are
    // chronology, its decisions are the state, and the second is what the tab
    // gets opened for.
    await expect(page.getByRole("heading", { name: "Entscheide" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sitzungen" })).toBeVisible();
  });
});
