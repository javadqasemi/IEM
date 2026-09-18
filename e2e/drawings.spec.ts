import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, TEST_PASSWORD, apiAs, expect, test } from "./fixtures";

/**
 * Pläne und Planversand, **against the live API** — Wave 2, module 3.
 *
 * Four things this suite is for, and the first two are why the module exists at
 * all rather than a documents table with a revision column:
 *
 * | | |
 * | --- | --- |
 * | **`ISSUED` and `SUPERSEDED` cannot be set** | both are consequences; a plan must never read as being in a contractor's hands with no row saying whose |
 * | **A reissue names who holds the old revision** | a warning rather than a refusal, because reissuing is the normal case and the person holding revision B is the one who builds the wrong thing |
 * | **`I` and `O` are skipped** | the exclusion F13 wrote down and left for this module; a naive counter puts `I` in a title block where it reads as a one |
 * | **`changed` says what changed** | the bug vitest cannot reproduce — `core/versioning/changed.ts` — so the guard has to run against the build |
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
  currentRevision: string | null;
  issuedRevision: string | null;
  readOnly: boolean;
  allowedTransitions: string[];
  drawnById: string | null;
  checkedById: string | null;
  revisions: { id: string; revision: string; releasedAt: string | null; supersededAt: string | null }[];
  counts: { revisions: number };
};

type Transmittal = {
  id: string;
  number: string;
  items: { revisionId: string; revision: string; supersededAt: string | null }[];
  recipients: { id: string; name: string; acknowledgedAt: string | null }[];
};

const made: { drawings: string[] } = { drawings: [] };

/**
 * Transmittals are **never deleted** — there is no route, by design — so the
 * cleanup only removes plans. The `PV-` sequence therefore grows across runs,
 * which is correct: a Planversand number may never be reissued.
 */
test.afterEach(async () => {
  while (made.drawings.length) {
    await admin.delete(`${API}/drawings/${made.drawings.pop()!}`);
  }
});

async function projectId(): Promise<string> {
  const response = await admin.get(`${API}/projects?q=P-2026-001`);
  const items = ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(items.length, "the seeded demo project is missing").toBeGreaterThan(0);
  return items[0].id;
}

async function disciplineId(): Promise<string> {
  const response = await admin.get(`${API}/disciplines`);
  const rows = (await response.json()) as { data: { id: string; code: string }[] };
  return rows.data[0].id;
}

async function employees(): Promise<{ id: string }[]> {
  const response = await admin.get(`${API}/employees?perPage=5`);
  return ((await response.json()) as { data: { items: { id: string }[] } }).data.items;
}

let unique = 0;
async function aDrawing(over: Record<string, unknown> = {}): Promise<Drawing> {
  unique += 1;
  const response = await admin.post(`${API}/drawings`, {
    data: {
      number: `E2E-${Date.now()}-${unique}`,
      title: "E2E Grundriss",
      projectId: await projectId(),
      disciplineId: await disciplineId(),
      type: "GRUNDRISS",
      ...over,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const drawing = ((await response.json()) as { data: Drawing }).data;
  made.drawings.push(drawing.id);
  return drawing;
}

async function get(id: string): Promise<Drawing> {
  const response = await admin.get(`${API}/drawings/${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: Drawing }).data;
}

async function addRevision(id: string, over: Record<string, unknown> = {}) {
  return admin.post(`${API}/drawings/${id}/revisions`, {
    data: {
      changeNote: "Steigzone Ost nach Norden verschoben.",
      storageKey: "plaene/2026/e2e.pdf",
      fileName: "e2e.pdf",
      size: 1234,
      checksum: "e2e-checksum",
      mimeType: "application/pdf",
      ...over,
    },
  });
}

/** Draws, checks and releases a plan, so it has something transmittable. */
async function aReleasedDrawing(): Promise<Drawing> {
  const people = await employees();
  const drawing = await aDrawing({ drawnById: people[0].id });

  const revision = await addRevision(drawing.id);
  expect(revision.status(), await revision.text()).toBe(201);

  // A different person, because a draftsman may not check their own work.
  await admin.patch(`${API}/drawings/${drawing.id}`, {
    data: { expectedVersion: (await get(drawing.id)).version, checkedById: people[1].id },
  });

  for (const status of ["IN_CHECK", "CHECKED", "RELEASED"]) {
    const moved = await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status } });
    expect(moved.status(), `${status}: ${await moved.text()}`).toBe(200);
  }

  return get(drawing.id);
}

/* ================================================================== */

test.describe("the revision letter", () => {
  /**
   * **The exclusion F13 wrote down and left for this module.**
   *
   * `core/versioning/revision.ts` declared `AMBIGUOUS_REVISION_LETTERS` with the
   * note *"nothing applies the exclusion yet — Drawings are Wave 2"*. `I` reads
   * as a one and `O` as a nought in a title block, which is why ISO 7200 omits
   * both. `drawings.rules.test.ts` walks the sequence; this proves the service
   * allocates from it.
   */
  test("counts A, B, C … and skips I and O", async () => {
    const drawing = await aDrawing();

    const seen: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      const response = await addRevision(drawing.id, { changeNote: `Schritt ${i} der Reihe.` });
      expect(response.status(), await response.text()).toBe(201);
      seen.push(((await response.json()) as { data: { revision: string } }).data.revision);
    }

    expect(seen.slice(0, 8)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    // H → J, not H → I.
    expect(seen[8]).toBe("J");
    expect(seen).not.toContain("I");
    expect(seen).not.toContain("O");
    // …M, N, P — the second skip.
    expect(seen.slice(11, 14)).toEqual(["M", "N", "P"]);
  });

  test("refuses a hand-entered I or O with the reason", async () => {
    const drawing = await aDrawing();
    const response = await addRevision(drawing.id, { revision: "I" });

    expect(response.status()).toBe(400);
    // The reason, not a bare rejection — somebody typing `I` is following the
    // alphabet and needs to know why it is not there.
    expect(await response.text()).toContain("Plankopf");
  });

  test("accepts a hand-entered label, because a plan set can start at C", async () => {
    const drawing = await aDrawing();
    const response = await addRevision(drawing.id, { revision: "c" });

    expect(response.status(), await response.text()).toBe(201);
    // Uppercased on the way in, so `c` and `C` are one revision.
    expect(((await response.json()) as { data: { revision: string } }).data.revision).toBe("C");
  });

  test("refuses a change note that says nothing", async () => {
    // Six months later the question is never "was there a revision C" but
    // "what changed in C".
    const drawing = await aDrawing();
    const response = await addRevision(drawing.id, { changeNote: "ok" });
    expect(response.status()).toBe(400);
  });
});

test.describe("the two statuses that cannot be set", () => {
  /**
   * The module's central claim, and the second time this shape has been used —
   * Entscheide did it for `AUFGEHOBEN`. A plan may never read as being in a
   * contractor's hands without a Planversand naming whose.
   */
  test("ISSUED is refused, and the refusal says what to do instead", async () => {
    const drawing = await aReleasedDrawing();
    const response = await admin.put(`${API}/drawings/${drawing.id}/status`, {
      data: { status: "ISSUED" },
    });

    expect(response.status()).toBe(400);
    const text = await response.text();
    expect(text).toContain("versandt");
    // Named specifically rather than "Status X kann nur nach Y" — the generic
    // message would send somebody looking for a missing transition.
    expect(text).not.toContain("kann nur nach");
  });

  test("SUPERSEDED is refused with its own reason", async () => {
    const drawing = await aReleasedDrawing();
    const response = await admin.put(`${API}/drawings/${drawing.id}/status`, {
      data: { status: "SUPERSEDED" },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("Revision");
  });

  test("neither appears in allowedTransitions", async () => {
    // The client renders this list directly, so an entry here would put a
    // button on screen that the API refuses.
    const drawing = await aReleasedDrawing();
    expect(drawing.allowedTransitions).not.toContain("ISSUED");
    expect(drawing.allowedTransitions).not.toContain("SUPERSEDED");
  });
});

test.describe("the four-eyes rule", () => {
  /**
   * A rule rather than a permission: the question is not what the caller holds
   * but whose name is already in the other column. The administrator holds
   * every key in the catalogue and is still refused.
   */
  test("refuses a check by whoever drew it, whatever the caller holds", async () => {
    const people = await employees();
    const drawing = await aDrawing({ drawnById: people[0].id });
    await addRevision(drawing.id);

    await admin.patch(`${API}/drawings/${drawing.id}`, {
      data: { expectedVersion: (await get(drawing.id)).version, checkedById: people[0].id },
    });
    await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status: "IN_CHECK" } });

    const response = await admin.put(`${API}/drawings/${drawing.id}/status`, {
      data: { status: "CHECKED" },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("nicht selbst prüfen");
  });

  test("allows it once two different people are named", async () => {
    const drawing = await aReleasedDrawing();
    expect(drawing.status).toBe("RELEASED");
  });
});

test.describe("what a plan needs before it can move", () => {
  test("refuses to check a plan that has no revision", async () => {
    // The status describes the drawing *file*, and there is not one yet.
    const drawing = await aDrawing();
    const response = await admin.put(`${API}/drawings/${drawing.id}/status`, {
      data: { status: "IN_CHECK" },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("keine Revision");
  });

  test("allows withdrawing one, because a plan opened by mistake must be disposable", async () => {
    const drawing = await aDrawing();
    const response = await admin.put(`${API}/drawings/${drawing.id}/status`, {
      data: { status: "WITHDRAWN", reason: "Versehentlich angelegt." },
    });
    expect(response.status(), await response.text()).toBe(200);
  });

  /**
   * The rule the **event catalogue** settled, before the service asked it:
   * `DrawingWithdrawn.reason` was declared a non-nullable `string` during F7.
   */
  test("refuses a withdrawal with no reason", async () => {
    const drawing = await aDrawing();
    const response = await admin.put(`${API}/drawings/${drawing.id}/status`, {
      data: { status: "WITHDRAWN" },
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("Begründung");
  });
});

test.describe("the Planversand", () => {
  async function send(drawing: Drawing, over: Record<string, unknown> = {}) {
    return admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: drawing.revisions[0].id }],
        recipients: [{ externalName: "E2E Sanitär AG", externalOrg: "Haustechnik" }],
        purpose: "ZUR_AUSFUEHRUNG",
        ...over,
      },
    });
  }

  /**
   * **One transaction across two aggregates.** The transmittal, its items, its
   * recipients and the plans' new status are written together — anything less
   * would allow plans marked as being in a contractor's hands with no record of
   * whose.
   */
  test("issuing moves the plans to ISSUED in one act", async () => {
    const drawing = await aReleasedDrawing();
    const response = await send(drawing);

    expect(response.status(), await response.text()).toBe(201);
    const result = (await response.json()) as { data: { transmittal: Transmittal } };
    expect(result.data.transmittal.number).toMatch(/^PV-\d{4}-\d{4}$/);

    expect((await get(drawing.id)).status).toBe("ISSUED");
  });

  test("refuses an unreleased revision, naming it", async () => {
    // The single most expensive mistake this module prevents: a contractor
    // building from a drawing nobody checked.
    const drawing = await aDrawing();
    await addRevision(drawing.id);
    const withRevision = await get(drawing.id);

    const response = await send(withRevision);
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("freigegebene");
  });

  test("refuses a Planversand with no recipients", async () => {
    const drawing = await aReleasedDrawing();
    const response = await send(drawing, { recipients: [] });
    expect(response.status()).toBe(400);
  });

  /**
   * **A warning, not a refusal**, and this is the assertion the module was
   * built for. Reissuing a revised plan is the normal case; the person holding
   * revision B while C goes out is the one who builds the wrong thing.
   */
  test("names whoever holds an older revision when a newer one goes out", async () => {
    const drawing = await aReleasedDrawing();

    const first = await send(drawing);
    expect(first.status(), await first.text()).toBe(201);
    const firstResult = (await first.json()) as { data: { warnings: unknown[] } };
    // Nobody held anything before, so the first send warns about nothing.
    expect(firstResult.data.warnings).toEqual([]);

    // A newer revision, released, and sent to the same recipient.
    await addRevision(drawing.id, { changeNote: "Heizkörper Zimmer 012 geändert." });
    await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status: "WIP" } });
    await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status: "IN_CHECK" } });
    await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status: "CHECKED" } });
    await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status: "RELEASED" } });

    const second = await send(await get(drawing.id));
    expect(second.status(), await second.text()).toBe(201);

    const result = (await second.json()) as {
      data: { warnings: { recipientLabel: string; previousRevision: string; newRevision: string }[] };
    };

    expect(result.data.warnings.length).toBeGreaterThan(0);
    expect(result.data.warnings[0].recipientLabel).toContain("E2E Sanitär AG");
    expect(result.data.warnings[0].previousRevision).toBe("A");
    expect(result.data.warnings[0].newRevision).toBe("B");
  });

  test("records receipt once, and refuses a second confirmation", async () => {
    const drawing = await aReleasedDrawing();
    const sent = await send(drawing);
    const { transmittal } = ((await sent.json()) as { data: { transmittal: Transmittal } }).data;

    // `acknowledgedAt` null is "not confirmed", not "did not receive".
    expect(transmittal.recipients[0].acknowledgedAt).toBeNull();

    const first = await admin.post(`${API}/transmittals/${transmittal.id}/acknowledge`, {
      data: { recipientId: transmittal.recipients[0].id },
    });
    expect(first.status(), await first.text()).toBe(201);

    const again = await admin.post(`${API}/transmittals/${transmittal.id}/acknowledge`, {
      data: { recipientId: transmittal.recipients[0].id },
    });
    expect(again.status()).toBe(400);
  });

  /**
   * **No update and no delete, by design.** A Planversand is a statement about
   * the past; correcting one means issuing another, the same reason `AuditLog`
   * has no route to edit a row. Enforced by there being no endpoint, which is
   * the cheapest enforcement there is.
   */
  test("cannot be edited or deleted, because the routes do not exist", async () => {
    const drawing = await aReleasedDrawing();
    const sent = await send(drawing);
    const { transmittal } = ((await sent.json()) as { data: { transmittal: Transmittal } }).data;

    const patched = await admin.patch(`${API}/transmittals/${transmittal.id}`, {
      data: { note: "umgeschrieben" },
    });
    const deleted = await admin.delete(`${API}/transmittals/${transmittal.id}`);

    // 404 rather than 405: Nest has no handler at all for these verbs.
    expect(patched.status()).toBe(404);
    expect(deleted.status()).toBe(404);
  });
});

test.describe("the version history", () => {
  /**
   * **The guard that has to run here and cannot run in vitest.**
   *
   * `changed` is a `string[]`, so it cannot be wrong at the type level; it was
   * wrong for every edit of every record from F13 until a browser showed a row
   * listing thirteen fields for a request that sent one. The cause is the
   * compiled DTO — ES2022 class fields plus `transform: true` — and esbuild
   * does not emit the definitions, so a unit test passes against broken code.
   */
  test("records only the fields the request changed", async () => {
    const drawing = await aDrawing();

    const patched = await admin.patch(`${API}/drawings/${drawing.id}`, {
      data: { expectedVersion: drawing.version, title: "Nur der Titel" },
    });
    expect(patched.status(), await patched.text()).toBe(200);

    const history = await admin.get(`${API}/drawings/${drawing.id}/versions`);
    const rows = ((await history.json()) as { data: { changed: string[] }[] }).data;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].changed).toEqual(["title"]);
    // The shape of the bug: every declared optional present as `undefined`.
    expect(rows[0].changed).not.toContain("scale");
    expect(rows[0].changed).not.toContain("buildingId");
  });

  test("the optimistic lock refuses a stale write with a 409", async () => {
    const drawing = await aDrawing();

    const first = await admin.patch(`${API}/drawings/${drawing.id}`, {
      data: { expectedVersion: drawing.version, title: "Erster" },
    });
    expect(first.status()).toBe(200);

    // The same version again — what a second browser tab would send.
    const second = await admin.patch(`${API}/drawings/${drawing.id}`, {
      data: { expectedVersion: drawing.version, title: "Zweiter" },
    });

    expect(second.status()).toBe(409);
    expect(await second.text()).toContain("neu laden");
  });

  test("a duplicate plan number is a 409 with a sentence, not a Prisma error", async () => {
    const drawing = await aDrawing();
    const response = await admin.post(`${API}/drawings`, {
      data: {
        number: drawing.number,
        title: "Kollision",
        projectId: await projectId(),
        disciplineId: await disciplineId(),
        type: "GRUNDRISS",
      },
    });

    expect(response.status()).toBe(409);
    const text = await response.text();
    expect(text).toContain(drawing.number);
    // Not "Unique constraint failed on the fields: (`projectId`,`number`)".
    expect(text).not.toContain("constraint");
  });
});

test.describe("row-level rules", () => {
  /**
   * Gated once for the whole block, the way `meetings.spec.ts` does it.
   *
   * Skipping **with a message** rather than failing, because these need the six
   * role accounts — `SEED_TEST_USERS=true` plus `SEED_TEST_PASSWORD` — and a
   * red suite on a machine that has not opted in is one people learn to ignore.
   */
  test.beforeAll(() => {
    test.skip(
      !TEST_PASSWORD,
      "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` legt die Rollenkonten an.",
    );
  });

  test("an engineer draws, checks and releases, and issues nothing", async () => {
    const engineer = await apiAs("ing@iem.test", TEST_PASSWORD);

    try {
      const drawing = await aReleasedDrawing();

      // Reads the register.
      const list = await engineer.get(`${API}/drawings`);
      expect(list.status()).toBe(200);

      // Sends nothing: `drawing.issue` is the Projektleitung's.
      const sent = await engineer.post(`${API}/transmittals`, {
        data: {
          projectId: await projectId(),
          items: [{ drawingRevisionId: drawing.revisions[0].id }],
          recipients: [{ externalName: "X" }],
        },
      });
      expect(sent.status()).toBe(403);
    } finally {
      await engineer.dispose();
    }
  });

  test("a guest reaches neither resource", async () => {
    const guest = await apiAs("gast@iem.test", TEST_PASSWORD);

    try {
      expect((await guest.get(`${API}/drawings`)).status()).toBe(403);
      expect((await guest.get(`${API}/transmittals`)).status()).toBe(403);
    } finally {
      await guest.dispose();
    }
  });
});

test.describe("what the plan row says is out there", () => {
  /**
   * **The two revisions, which are two different facts.**
   *
   * This started life as a characterisation test: it pinned the behaviour of a
   * row that reported `currentRevision: "B"`, `status: "WIP"` and *nothing at
   * all* about the revision a contractor was holding, so that the column which
   * fixes it would have something to change. This is that change.
   *
   * `currentRevision` is what the office is drawing. `issuedRevision` is what
   * the Bauherr and the Unternehmer have. They agree between a Planversand and
   * the next revision, and the moment they stop agreeing is the moment somebody
   * on a building site is working from a superseded plan.
   *
   * Against the **running API** rather than as a unit test, deliberately: this
   * is a stored column written inside a transaction, and CLAUDE.md's rule about
   * which toolchain a test runs in puts an e2e assertion first for exactly that
   * kind of claim.
   */
  test("records the issued revision beside the current one", async () => {
    const drawing = await aReleasedDrawing();

    // Before anything is sent, the plan is drawn but not delivered — and those
    // are different absences, so the column is null rather than the letter.
    expect(drawing.currentRevision).toBe("A");
    expect(drawing.issuedRevision).toBeNull();

    const sent = await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: drawing.revisions[0].id }],
        recipients: [{ externalName: "E2E Bauherr" }],
      },
    });
    expect(sent.status(), await sent.text()).toBe(201);

    const issued = await get(drawing.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.issuedRevision).toBe("A");

    // Rev. B is drawn internally, after Rev. A went out. The plan goes back to
    // WIP — and that is precisely where the row used to forget.
    await addRevision(drawing.id, { changeNote: "Interne Überarbeitung nach dem Versand." });

    const after = await get(drawing.id);
    expect(after.currentRevision).toBe("B");
    expect(after.status).toBe("WIP");
    // The fact that survives the status going backwards: A is on a building site.
    expect(after.issuedRevision).toBe("A");
  });

  /**
   * The register can now answer *"welche Pläne müssen neu ausgegeben werden"*
   * as a **list query**, which is the entire justification for storing the
   * column rather than deriving it from the transmittals.
   */
  test("the two revisions are both sortable and filterable", async () => {
    const sorted = await admin.get(`${API}/drawings?sort=issuedRevision:desc&perPage=5`);
    expect(sorted.status(), await sorted.text()).toBe(200);

    const filtered = await admin.get(`${API}/drawings?filter[issuedRevision]=eq:A&perPage=50`);
    expect(filtered.status(), await filtered.text()).toBe(200);
    const rows = ((await filtered.json()) as { data: { items: Drawing[] } }).data.items;
    for (const row of rows) expect(row.issuedRevision).toBe("A");
  });

  /**
   * **It never moves backwards.** Re-issuing an older revision is a real act —
   * somebody asks for the drawing they built from — but it does not make that
   * revision the newest thing out there. The Transmittal keeps the full truth;
   * this column is the index into it.
   */
  test("re-issuing an older revision does not move the column backwards", async () => {
    const drawing = await aReleasedDrawing();
    const first = drawing.revisions[0].id;

    const sentA = await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: first }],
        recipients: [{ externalName: "E2E Bauherr" }],
      },
    });
    expect(sentA.status(), await sentA.text()).toBe(201);

    // Draw B, release it, and send it.
    const added = await addRevision(drawing.id, { changeNote: "Zweite Ausgabe nach Koordination." });
    expect(added.status(), await added.text()).toBe(201);
    for (const status of ["IN_CHECK", "CHECKED", "RELEASED"]) {
      const moved = await admin.put(`${API}/drawings/${drawing.id}/status`, { data: { status } });
      expect(moved.status(), `${status}: ${await moved.text()}`).toBe(200);
    }

    const withB = await get(drawing.id);
    const revisionB = withB.revisions.find((r) => r.revision === "B");
    expect(revisionB, "Rev. B was not created").toBeTruthy();

    const sentB = await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: revisionB!.id }],
        recipients: [{ externalName: "E2E Bauherr" }],
      },
    });
    expect(sentB.status(), await sentB.text()).toBe(201);
    expect((await get(drawing.id)).issuedRevision).toBe("B");

    // Now somebody asks for A again. A superseded revision cannot be sent at
    // all — `refuseTransmittal` refuses it — so the guarantee holds by two
    // independent mechanisms, and this asserts the column is still B either way.
    const resend = await admin.post(`${API}/transmittals`, {
      data: {
        projectId: await projectId(),
        items: [{ drawingRevisionId: first }],
        recipients: [{ externalName: "E2E Bauherr" }],
      },
    });
    expect(resend.status()).toBe(400);
    expect((await get(drawing.id)).issuedRevision).toBe("B");
  });
});
