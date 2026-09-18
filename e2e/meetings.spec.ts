import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, TEST_PASSWORD, apiAs, expect, test } from "./fixtures";

/**
 * Sitzungen und Entscheide, **against the live API** — Wave 2, module 2.
 *
 * Four things this suite is for, and the first two are why the module exists at
 * all rather than a meetings table with a text field:
 *
 * | | |
 * | --- | --- |
 * | **An approved protocol is closed** | the rule that makes minutes worth keeping, and one that a service-level check would let somebody quietly relax |
 * | **A reversal names its successor** | `AUFGEHOBEN` is reachable only through `supersede`, so a decision can never read as withdrawn with nothing to point at |
 * | **A Pendenz becomes a task** | the seam the wave order was built around, and the only place two modules write in one transaction |
 * | **`changed` says what changed** | the bug that shipped for a wave and that vitest cannot reproduce — `core/versioning/changed.ts` |
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
  title: string;
  label: string;
  status: string;
  version: number;
  seriesNumber: number | null;
  minutesSentAt: string | null;
  protocolLocked: boolean;
  allowedTransitions: string[];
  items: { id: string; key: string; kind: string; text: string; task: { id: string } | null }[];
  attendees: { id: string; name: string; organisation: string | null; attended: boolean | null }[];
  approvals: { decision: string }[];
  counts: { items: number; approvals: number };
};

type Decision = {
  id: string;
  number: string;
  title: string;
  status: string;
  version: number;
  supersedesId: string | null;
  supersededBy: { number: string } | null;
};

const made: { meetings: string[]; decisions: string[] } = { meetings: [], decisions: [] };

async function projectId(): Promise<string> {
  const response = await admin.get(`${API}/projects?q=P-2026-001`);
  const items = ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(items.length, "the seeded demo project is missing").toBeGreaterThan(0);
  return items[0].id;
}

async function anEmployee(): Promise<string> {
  const response = await admin.get(`${API}/employees?perPage=1`);
  return ((await response.json()) as { data: { items: { id: string }[] } }).data.items[0].id;
}

/** A fresh meeting, held, with one attendee whose presence is recorded. */
async function heldMeeting(title = "E2E: Bausitzung"): Promise<Meeting> {
  const created = await admin.post(`${API}/meetings`, {
    data: { title, startsAt: "2026-09-01T14:00:00Z", projectId: await projectId() },
  });
  expect(created.status(), await created.text()).toBe(201);
  const meeting = ((await created.json()) as { data: Meeting }).data;
  made.meetings.push(meeting.id);

  await admin.post(`${API}/meetings/${meeting.id}/attendees`, {
    data: { employeeId: await anEmployee() },
  });
  const withRoom = await get(meeting.id);
  await admin.put(`${API}/meetings/${meeting.id}/attendance`, {
    data: { attendance: [{ attendeeId: withRoom.attendees[0].id, attended: true }] },
  });

  const held = await admin.put(`${API}/meetings/${meeting.id}/status`, { data: { status: "HELD" } });
  expect(held.status(), await held.text()).toBe(200);
  return get(meeting.id);
}

async function get(id: string): Promise<Meeting> {
  const response = await admin.get(`${API}/meetings/${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: Meeting }).data;
}

test.afterEach(async () => {
  while (made.decisions.length) {
    await admin.delete(`${API}/decisions/${made.decisions.pop()!}`);
  }
  while (made.meetings.length) {
    await admin.delete(`${API}/meetings/${made.meetings.pop()!}`);
  }
});

/* ================================================================== */

test.describe("the protocol closes on approval", () => {
  test("an approved protocol refuses every write, whatever the caller holds", async () => {
    /**
     * **The rule that makes minutes worth keeping.** The administrator running
     * this holds every permission in the catalogue, and the protocol still
     * refuses — because the rule is about what the record *is* rather than
     * about who outranks whom.
     */
    const meeting = await heldMeeting("E2E: Genehmigtes Protokoll");

    await admin.post(`${API}/meetings/${meeting.id}/items`, {
      data: { text: "Etwas wurde besprochen." },
    });

    const approved = await admin.post(`${API}/meetings/${meeting.id}/approval`, {
      data: { decision: "APPROVED" },
    });
    expect(approved.status(), await approved.text()).toBe(201);

    const locked = await get(meeting.id);
    expect(locked.protocolLocked, "the detail must say so before the user types").toBe(true);

    const edit = await admin.patch(`${API}/meetings/${meeting.id}`, {
      data: { expectedVersion: locked.version, title: "Nachträglich umbenannt" },
    });
    expect(edit.status()).toBe(403);
    expect((await edit.json()).message).toContain("genehmigt");

    const line = await admin.post(`${API}/meetings/${meeting.id}/items`, {
      data: { text: "Nachträglich eingefügt." },
    });
    expect(line.status(), "a line added after approval").toBe(403);

    const removal = await admin.delete(`${API}/meetings/${meeting.id}/items/${locked.items[0].id}`);
    expect(removal.status(), "a line removed after approval").toBe(403);

    // And it cannot be deleted away either: cancel leaves the fact on the
    // record, which is the point.
    const deleted = await admin.delete(`${API}/meetings/${meeting.id}`);
    expect(deleted.status()).toBe(400);
  });

  test("an unapproved protocol is editable, and says so", async () => {
    const meeting = await heldMeeting("E2E: Offenes Protokoll");
    expect(meeting.protocolLocked).toBe(false);

    const edit = await admin.patch(`${API}/meetings/${meeting.id}`, {
      data: { expectedVersion: meeting.version, location: "Baubüro" },
    });
    expect(edit.status()).toBe(200);
  });

  test("approving twice is refused; an amendment needs a note", async () => {
    const meeting = await heldMeeting("E2E: Zweimal genehmigt");

    const amended = await admin.post(`${API}/meetings/${meeting.id}/approval`, {
      data: { decision: "AMENDED" },
    });
    expect(amended.status(), "an amendment nobody described").toBe(400);

    const first = await admin.post(`${API}/meetings/${meeting.id}/approval`, {
      data: { decision: "AMENDED", note: "Ziffer 3 betrifft OG3, nicht OG2." },
    });
    expect(first.status()).toBe(201);

    /**
     * **One protocol, one approval — of either kind.**
     *
     * This assertion is the reason the rule is right: the first version
     * allowed a plain approval after an amendment, which contradicted
     * `refuseProtocolEdit` closing the protocol on *any* approval. The minutes
     * would have been locked and then approvable again, and which row was "the"
     * approval would have been a question about row order.
     */
    const second = await admin.post(`${API}/meetings/${meeting.id}/approval`, {
      data: { decision: "APPROVED" },
    });
    expect(second.status()).toBe(400);
    expect((await second.json()).message).toContain("mit Änderung genehmigt");
  });

  test("a meeting cannot walk back from held to planned", async () => {
    // The absence that stops somebody reopening an approved protocol by
    // changing a status.
    const meeting = await heldMeeting("E2E: Zurück auf geplant");
    expect(meeting.allowedTransitions).toEqual(["CANCELLED"]);

    const back = await admin.put(`${API}/meetings/${meeting.id}/status`, {
      data: { status: "PLANNED" },
    });
    expect(back.status()).toBe(400);
  });
});

/* ================================================================== */

test.describe("a Pendenz becomes a task", () => {
  test("in one transaction, carrying its owner, date and Gewerk", async () => {
    /**
     * **The seam the wave order was built around.** Tasks was built before
     * Meetings so a Pendenz has somewhere to go; the line and the task are
     * written together, so a protocol can never record work that was never
     * created.
     */
    const meeting = await heldMeeting("E2E: Pendenz");
    const employee = await anEmployee();

    const before = await admin.get(`${API}/tasks?perPage=1`);
    const beforeTotal = ((await before.json()) as { data: { total: number } }).data.total;

    const added = await admin.post(`${API}/meetings/${meeting.id}/items`, {
      data: {
        text: "Luftmengen für die Räume 2.10 bis 2.14 neu berechnen. Ergebnis bis zur nächsten Sitzung.",
        kind: "PENDENZ",
        responsibleId: employee,
        dueDate: "2026-12-01",
      },
    });
    expect(added.status(), await added.text()).toBe(201);

    const after = await admin.get(`${API}/tasks?perPage=1`);
    const afterTotal = ((await after.json()) as { data: { total: number } }).data.total;
    expect(afterTotal, "no task was created").toBe(beforeTotal + 1);

    const detail = ((await added.json()) as { data: Meeting }).data;
    const line = detail.items.find((i) => i.kind === "PENDENZ")!;
    expect(line.task, "the line does not point at its task").toBeTruthy();

    const task = await admin.get(`${API}/tasks/${line.task!.id}`);
    const body = ((await task.json()) as {
      data: { title: string; assignee: { id: string } | null; dueDate: string | null };
    }).data;
    expect(body.assignee?.id, "the task did not inherit the responsible person").toBe(employee);
    expect(body.dueDate?.slice(0, 10)).toBe("2026-12-01");
    // The title is the first sentence; the full text stays in the description
    // and in the protocol, which is the record.
    expect(body.title).toBe("Luftmengen für die Räume 2.10 bis 2.14 neu berechnen.");
  });

  test("a Pendenz without an owner or a date is refused", async () => {
    /**
     * The rule people will want relaxed, and the one worth keeping: "wird noch
     * angeschaut" with nobody's name against it is the line that is still open
     * at Bausitzung 20.
     */
    const meeting = await heldMeeting("E2E: Unvollständige Pendenz");

    const noOwner = await admin.post(`${API}/meetings/${meeting.id}/items`, {
      data: { text: "Wird noch angeschaut.", kind: "PENDENZ" },
    });
    expect(noOwner.status()).toBe(400);
    expect((await noOwner.json()).message).toContain("zuständige Person");

    const noDate = await admin.post(`${API}/meetings/${meeting.id}/items`, {
      data: { text: "Wird noch angeschaut.", kind: "PENDENZ", responsibleId: await anEmployee() },
    });
    expect(noDate.status()).toBe(400);
    expect((await noDate.json()).message).toContain("Termin");
  });

  test("deleting the line leaves the task", async () => {
    /**
     * A protocol line is the record of what was said; the work it produced is
     * on somebody's board, may be half done, and is not this module's to
     * withdraw.
     */
    const meeting = await heldMeeting("E2E: Zeile weg, Aufgabe bleibt");
    const added = await admin.post(`${API}/meetings/${meeting.id}/items`, {
      data: {
        text: "Etwas erledigen.",
        kind: "PENDENZ",
        responsibleId: await anEmployee(),
        dueDate: "2026-12-01",
      },
    });
    const line = ((await added.json()) as { data: Meeting }).data.items.find(
      (i) => i.kind === "PENDENZ",
    )!;
    const taskId = line.task!.id;

    await admin.delete(`${API}/meetings/${meeting.id}/items/${line.id}`);

    const task = await admin.get(`${API}/tasks/${taskId}`);
    expect(task.status(), "the task went with the line").toBe(200);
    await admin.delete(`${API}/tasks/${taskId}`);
  });
});

/* ================================================================== */

test.describe("decisions", () => {
  test("a rationale that says nothing is refused", async () => {
    /**
     * The module's defining field. The schema can only refuse an empty string;
     * the thing worth refusing is a reason nobody can read in two years.
     */
    const project = await projectId();

    const empty = await admin.post(`${API}/decisions`, {
      data: { title: "Etwas", rationale: "", projectId: project, decidedAt: "2026-09-10" },
    });
    expect(empty.status()).toBe(400);

    const thin = await admin.post(`${API}/decisions`, {
      data: { title: "Etwas", rationale: "passt so", projectId: project, decidedAt: "2026-09-10" },
    });
    expect(thin.status()).toBe(400);
    expect((await thin.json()).message).toContain("zu kurz");
  });

  test("numbers are allocated per project and per year", async () => {
    const project = await projectId();
    const created = await admin.post(`${API}/decisions`, {
      data: {
        title: "E2E: Nummernvergabe",
        rationale: "Eine ausreichend lange Begründung, die erklärt warum so entschieden wurde.",
        projectId: project,
        decidedAt: "2026-09-10",
      },
    });
    expect(created.status()).toBe(201);
    const decision = ((await created.json()) as { data: Decision }).data;
    made.decisions.push(decision.id);
    expect(decision.number).toMatch(/^E-2026-\d{3}$/);
  });

  test("AUFGEHOBEN cannot be set directly, and the refusal says what to do", async () => {
    /**
     * **The rule that makes it a fact rather than a claim.** A status anybody
     * could type would let a decision read as withdrawn with nothing to point
     * at; `supersede` always leaves a successor attached.
     *
     * The DTO deliberately *accepts* the value so the rules file can answer —
     * narrowing the enum would reply "Die Eingaben sind unvollständig oder
     * ungültig", which tells a user nothing about what to do instead.
     */
    const project = await projectId();
    const created = await admin.post(`${API}/decisions`, {
      data: {
        title: "E2E: Direkt aufheben",
        rationale: "Eine ausreichend lange Begründung, die erklärt warum so entschieden wurde.",
        projectId: project,
        decidedAt: "2026-09-10",
      },
    });
    const decision = ((await created.json()) as { data: Decision }).data;
    made.decisions.push(decision.id);

    const direct = await admin.put(`${API}/decisions/${decision.id}/status`, {
      data: { status: "AUFGEHOBEN" },
    });
    expect(direct.status()).toBe(400);
    expect((await direct.json()).message).toContain("ersetzt");
  });

  test("superseding reverses the old one and links both ends", async () => {
    const project = await projectId();
    const rationale = "Eine ausreichend lange Begründung, die erklärt warum so entschieden wurde.";

    const first = ((await (
      await admin.post(`${API}/decisions`, {
        data: { title: "E2E: Der alte Entscheid", rationale, projectId: project, decidedAt: "2026-09-10" },
      })
    ).json()) as { data: Decision }).data;
    const second = ((await (
      await admin.post(`${API}/decisions`, {
        data: { title: "E2E: Der neue Entscheid", rationale, projectId: project, decidedAt: "2026-09-17" },
      })
    ).json()) as { data: Decision }).data;
    made.decisions.push(second.id, first.id);

    const response = await admin.post(`${API}/decisions/${second.id}/supersedes`, {
      data: { supersedesId: first.id },
    });
    expect(response.status(), await response.text()).toBe(201);

    const older = ((await (await admin.get(`${API}/decisions/${first.id}`)).json()) as {
      data: Decision;
    }).data;
    expect(older.status, "the replaced decision is not marked withdrawn").toBe("AUFGEHOBEN");
    /**
     * `supersededBy` is the sentence somebody needs when reading an old
     * decision — without it they act on one that no longer stands.
     */
    expect(older.supersededBy?.number).toBe(second.number);

    const newer = ((await (await admin.get(`${API}/decisions/${second.id}`)).json()) as {
      data: Decision;
    }).data;
    expect(newer.supersedesId).toBe(first.id);

    // And the reversal cannot be undone by deleting its successor, which would
    // leave the old one withdrawn with nothing to point at.
    const deleted = await admin.delete(`${API}/decisions/${second.id}`);
    expect(deleted.status()).toBe(400);
    made.decisions.length = 0;
  });

  test("a decision cannot supersede itself or one from another project", async () => {
    const project = await projectId();
    const rationale = "Eine ausreichend lange Begründung, die erklärt warum so entschieden wurde.";
    const decision = ((await (
      await admin.post(`${API}/decisions`, {
        data: { title: "E2E: Kreis", rationale, projectId: project, decidedAt: "2026-09-10" },
      })
    ).json()) as { data: Decision }).data;
    made.decisions.push(decision.id);

    const itself = await admin.post(`${API}/decisions/${decision.id}/supersedes`, {
      data: { supersedesId: decision.id },
    });
    expect(itself.status()).toBe(400);

    const others = await admin.get(`${API}/projects?q=P-2026-002`);
    const otherProject = ((await others.json()) as { data: { items: { id: string }[] } }).data
      .items[0];
    if (otherProject) {
      const foreign = ((await (
        await admin.post(`${API}/decisions`, {
          data: {
            title: "E2E: Anderes Projekt",
            rationale,
            projectId: otherProject.id,
            decidedAt: "2026-09-10",
          },
        })
      ).json()) as { data: Decision }).data;
      made.decisions.push(foreign.id);

      const across = await admin.post(`${API}/decisions/${decision.id}/supersedes`, {
        data: { supersedesId: foreign.id },
      });
      expect(across.status(), "a decision reversed another project's").toBe(400);
      expect((await across.json()).message).toContain("desselben Projekts");
    }
  });
});

/* ================================================================== */

test.describe("the protocol's own numbering", () => {
  test("cites a line as 14.3 and renumbers on a reorder", async () => {
    const meeting = await heldMeeting("E2E: Nummerierung");
    for (const text of ["Erste Zeile.", "Zweite Zeile.", "Dritte Zeile."]) {
      await admin.post(`${API}/meetings/${meeting.id}/items`, { data: { text } });
    }

    const withLines = await get(meeting.id);
    expect(withLines.seriesNumber).not.toBeNull();
    expect(withLines.items.map((i) => i.key)).toEqual([
      `${withLines.seriesNumber}.1`,
      `${withLines.seriesNumber}.2`,
      `${withLines.seriesNumber}.3`,
    ]);

    /**
     * A full reorder, through the two-pass renumber.
     *
     * `@@unique([meetingId, order])` means a straight renumber collides the
     * moment two lines swap; the repository writes everything to a negative
     * range first. This is the assertion that proves it — a one-pass version
     * fails here and nowhere else.
     */
    const reversed = [...withLines.items].reverse().map((i) => i.id);
    const response = await admin.put(`${API}/meetings/${meeting.id}/items/order`, {
      data: { order: reversed },
    });
    expect(response.status(), await response.text()).toBe(200);

    const reordered = await get(meeting.id);
    expect(reordered.items.map((i) => i.text)).toEqual([
      "Dritte Zeile.",
      "Zweite Zeile.",
      "Erste Zeile.",
    ]);
  });

  test("a partial reorder is refused rather than half-applied", async () => {
    // A partial order would leave the omitted lines at numbers the reordered
    // ones now occupy, and the unique constraint would refuse it halfway.
    const meeting = await heldMeeting("E2E: Teilweise umsortiert");
    await admin.post(`${API}/meetings/${meeting.id}/items`, { data: { text: "Eine Zeile." } });
    await admin.post(`${API}/meetings/${meeting.id}/items`, { data: { text: "Noch eine." } });

    const withLines = await get(meeting.id);
    const response = await admin.put(`${API}/meetings/${meeting.id}/items/order`, {
      data: { order: [withLines.items[0].id] },
    });
    expect(response.status()).toBe(400);
  });
});

/* ================================================================== */

test.describe("the version history", () => {
  test("records only the fields the request changed", async () => {
    /**
     * The regression guard for the bug that shipped, applied to the third
     * module: `Object.keys` on a transformed DTO returns every declared
     * property, and **vitest cannot reproduce it**. See
     * `core/versioning/changed.ts`.
     */
    const meeting = await heldMeeting("E2E: Verlauf");

    const patched = await admin.patch(`${API}/meetings/${meeting.id}`, {
      data: { expectedVersion: meeting.version, location: "Nur der Ort." },
    });
    expect(patched.status()).toBe(200);

    const history = await admin.get(`${API}/meetings/${meeting.id}/versions`);
    const rows = ((await history.json()) as { data: { changed: string[] }[] }).data;
    expect(rows[0].changed, "the history claims fields the request never sent").toEqual([
      "location",
    ]);
  });

  test("a decision's history records the same way", async () => {
    const project = await projectId();
    const created = await admin.post(`${API}/decisions`, {
      data: {
        title: "E2E: Entscheid-Verlauf",
        rationale: "Eine ausreichend lange Begründung, die erklärt warum so entschieden wurde.",
        projectId: project,
        decidedAt: "2026-09-10",
      },
    });
    const decision = ((await created.json()) as { data: Decision }).data;
    made.decisions.push(decision.id);

    await admin.patch(`${API}/decisions/${decision.id}`, {
      data: {
        expectedVersion: decision.version,
        rationale: "Eine überarbeitete Begründung, die den Entscheid weiterhin erklärt.",
        versionNote: "Nach Rückfrage der Bauherrschaft präzisiert",
      },
    });

    const history = await admin.get(`${API}/decisions/${decision.id}/versions`);
    const rows = ((await history.json()) as { data: { changed: string[]; note: string | null }[] })
      .data;
    expect(rows[0].changed).toEqual(["rationale"]);
    expect(rows[0].note).toBe("Nach Rückfrage der Bauherrschaft präzisiert");
  });

  test("the optimistic lock refuses a stale write with a 409", async () => {
    const meeting = await heldMeeting("E2E: Konflikt");

    const first = await admin.patch(`${API}/meetings/${meeting.id}`, {
      data: { expectedVersion: meeting.version, location: "Erst so" },
    });
    expect(first.status()).toBe(200);

    const stale = await admin.patch(`${API}/meetings/${meeting.id}`, {
      data: { expectedVersion: meeting.version, location: "Dann so" },
    });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).message).toMatch(/v\d+/);
  });
});

/* ================================================================== */

test.describe("cross-meeting protocol lines", () => {
  test("answers the question the module was asked for", async () => {
    /**
     * *"Alle offenen Pendenzen für Lüftung über alle Bausitzungen"* —
     * `data-model.md` §3.11 names it, and it is the reason `disciplineId` sits
     * on the line rather than being reached through the project.
     */
    const response = await admin.get(
      `${API}/meetings/items?filter[kind]=eq:PENDENZ&filter[discipline]=eq:LFT`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const body = ((await response.json()) as {
      data: { items: { kind: string; discipline: { code: string } | null; key: string }[] };
    }).data;

    for (const item of body.items) {
      expect(item.kind).toBe("PENDENZ");
      expect(item.discipline?.code).toBe("LFT");
      // The citation key travels with the line, so a result row can be quoted.
      expect(item.key).toMatch(/^\d+(\.\d+)?$/);
    }
  });
});

/* ================================================================== */

test.describe("row-level rules", () => {
  test.beforeAll(() => {
    test.skip(
      !TEST_PASSWORD,
      "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` legt die Rollenkonten an.",
    );
  });

  test("an engineer reads the minutes and writes none of them", async () => {
    /**
     * The three keys that are not CRUD, each refused separately: declaring that
     * a meeting took place, deciding that this is what was said, and putting it
     * in front of the client.
     */
    const engineer = await apiAs("ing@iem.test", TEST_PASSWORD);
    const meeting = await heldMeeting("E2E: Ingenieurin");

    const read = await engineer.get(`${API}/meetings?perPage=5`);
    expect(read.status(), "an engineer must be able to read minutes").toBe(200);

    for (const [label, call] of [
      ["update", () => engineer.patch(`${API}/meetings/${meeting.id}`, { data: { expectedVersion: 1 } })],
      ["hold", () => engineer.put(`${API}/meetings/${meeting.id}/status`, { data: { status: "CANCELLED" } })],
      ["approve", () => engineer.post(`${API}/meetings/${meeting.id}/approval`, { data: { decision: "APPROVED" } })],
      ["sendMinutes", () => engineer.post(`${API}/meetings/${meeting.id}/minutes/sent`, { data: {} })],
    ] as const) {
      const response = await call();
      expect(response.status(), `engineer ${label}`).toBe(403);
    }

    await engineer.dispose();
  });

  test("an engineer records a decision but cannot reverse one", async () => {
    /**
     * *"`update` is corrections; reversing a decision is its own authority."*
     * — `docs/permissions.md` §3.11. A decision taken on site is still a
     * decision and the person who was there can record it.
     */
    const engineer = await apiAs("ing@iem.test", TEST_PASSWORD);
    const project = await projectId();

    const created = await engineer.post(`${API}/decisions`, {
      data: {
        title: "E2E: Von der Ingenieurin festgehalten",
        rationale: "Auf der Baustelle mit der Bauleitung so vereinbart und hier festgehalten.",
        projectId: project,
        decidedAt: "2026-09-10",
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    made.decisions.push(((await created.json()) as { data: Decision }).data.id);

    const existing = await admin.get(`${API}/decisions?perPage=1`);
    const target = ((await existing.json()) as { data: { items: Decision[] } }).data.items[0];
    const reversal = await engineer.post(`${API}/decisions/${made.decisions[0]}/supersedes`, {
      data: { supersedesId: target.id },
    });
    expect(reversal.status()).toBe(403);

    await engineer.dispose();
  });

  test("a guest reaches neither resource", async () => {
    const guest = await apiAs("gast@iem.test", TEST_PASSWORD);
    expect((await guest.get(`${API}/meetings`)).status()).toBe(403);
    expect((await guest.get(`${API}/decisions`)).status()).toBe(403);
    await guest.dispose();
  });
});
