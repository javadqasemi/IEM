import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, apiAs, e2eName, expect, test } from "./fixtures";

/**
 * Fachliche Versionierung and the optimistic lock, against the live API.
 *
 * Foundation stage F13, demanded before Wave 2, and the reason it needs a live
 * test rather than a unit one is the whole mechanism: the lock is a property of
 * a **`WHERE` clause meeting a row**. `updateMany({ where: { id, version } })`
 * is decided by Postgres, and no amount of testing the service can prove that
 * the second of two concurrent writers loses.
 *
 * The lost-update bug this prevents is the one a user cannot detect, report or
 * work around: two people open the same project, both save, the second wins
 * silently and the first person's work is gone with nothing anywhere recording
 * that it existed. Without a test that actually races two writes, the guard is
 * a comment.
 */

let api: APIRequestContext;
let projectId = "";

test.beforeAll(async () => {
  // The shared token — see `apiToken`. Signing in here again would be the
  // eleventh attempt in a minute and the throttle's first refusal.
  api = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);

  /*
    A project created for this file, not a seeded one.

    The suite writes to it repeatedly and asserts on its version number; doing
    that to `P-2026-001` would make every other spec's expectations depend on
    how often this one had run.
  */
  const customers = (await (await api.get(`${API}/customers?perPage=1`)).json()) as {
    data: { items: { id: string }[] };
  };
  const created = await api.post(`${API}/projects`, {
    data: {
      name: e2eName(`Versionierung Testlauf ${Date.now()}`),
      customerId: customers.data.items[0].id,
    },
  });
  expect(created.ok(), `Projekt anlegen fehlgeschlagen (HTTP ${created.status()})`).toBe(true);
  projectId = ((await created.json()) as { data: { id: string } }).data.id;
});

test.afterAll(async () => {
  // Cancel then delete: the service refuses to remove a live project, which is
  // itself a rule and not an obstacle to work around.
  if (projectId) {
    await api.put(`${API}/projects/${projectId}/status`, { data: { status: "CANCELLED" } });
    await api.delete(`${API}/projects/${projectId}`);
  }
  await api?.dispose();
});

const read = async () =>
  ((await (await api.get(`${API}/projects/${projectId}`)).json()) as {
    data: { version: number; name: string; notes: string | null };
  }).data;

test.describe("the version number", () => {
  test("starts at 1 and advances by one on each write", async () => {
    const first = await read();
    expect(first.version).toBe(1);

    await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: 1, notes: "erste Änderung" },
    });
    expect((await read()).version).toBe(2);

    await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: 2, notes: "zweite Änderung" },
    });
    const third = await read();
    expect(third.version).toBe(3);
    expect(third.notes).toBe("zweite Änderung");
  });

  test("advances on a change to a *relation*, not only to a scalar", async () => {
    /*
      Added because this suite passed while the screen returned a 500.

      Every other case here changes `notes` — a scalar — and the bug was in the
      relation path: the mapper emitted `manager: { connect: … }`, which
      `update` accepts and `updateMany` does not, and the lock needs
      `updateMany` because the version has to be in the `where`. Prisma rejected
      it with *Unknown argument `manager`*, TypeScript did not, and a green
      suite said the feature worked.

      A test matrix that only exercises the easy column is a test matrix that
      confirms what somebody already believed.
    */
    const employees = (await (await api.get(`${API}/employees?perPage=1`)).json()) as {
      data: { items: { id: string }[] };
    };
    const managerId = employees.data.items[0].id;

    const before = await read();
    const assign = await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: before.version, managerId },
    });
    expect(assign.status(), await assign.text()).toBe(200);

    const assigned = (await assign.json()) as { data: { manager: { id: string } | null } };
    expect(assigned.data.manager?.id).toBe(managerId);
    expect((await read()).version).toBe(before.version + 1);

    // And `null` still clears it — the only thing `disconnect` was buying.
    const cleared = await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: before.version + 1, managerId: null },
    });
    expect(cleared.status()).toBe(200);
    expect(((await cleared.json()) as { data: { manager: unknown } }).data.manager).toBeNull();
  });

  test("refuses a write with no version at all", async () => {
    // The DTO requires it. An optimistic lock a caller may omit is one every
    // caller omits exactly once.
    const response = await api.patch(`${API}/projects/${projectId}`, {
      data: { notes: "ohne Version" },
    });
    expect(response.status()).toBe(400);
  });
});

test.describe("the optimistic lock", () => {
  test("the second of two writers at the same version is refused", async () => {
    /*
      The assertion this file exists for.

      Both callers read v_n and both submit against it — which is exactly what
      two people with the record open do. One must win and the other must be
      **told**, and the losing request must not have changed anything.
    */
    const before = await read();

    const [a, b] = await Promise.all([
      api.patch(`${API}/projects/${projectId}`, {
        data: { expectedVersion: before.version, notes: "Schreiber A" },
      }),
      api.patch(`${API}/projects/${projectId}`, {
        data: { expectedVersion: before.version, notes: "Schreiber B" },
      }),
    ]);

    const statuses = [a.status(), b.status()].sort();
    expect(statuses, "genau einer der beiden muss gewinnen").toEqual([200, 409]);

    const after = await read();
    // One increment, not two: the loser wrote nothing.
    expect(after.version).toBe(before.version + 1);

    const winner = a.status() === 200 ? "Schreiber A" : "Schreiber B";
    expect(after.notes, "der Gewinner muss der sein, dessen Wert steht").toBe(winner);
  });

  test("a stale version is a 409 and says who changed it", async () => {
    const stale = await read();

    // Somebody else saves.
    await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: stale.version, notes: "jemand anderes" },
    });

    // And now the first caller submits the version they had.
    const late = await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: stale.version, notes: "zu spät" },
    });

    expect(late.status()).toBe(409);
    const body = (await late.json()) as { message: string };
    // 409 and not 400: the client has to tell "fix your input" from "reload".
    // The message names the record and the new version, because "Konflikt" on
    // its own turns an error into a support ticket.
    expect(body.message).toMatch(/geändert/);
    expect(body.message).toMatch(/v\d+/);

    expect((await read()).notes).toBe("jemand anderes");
  });

  test("a version from the future is refused too", async () => {
    // Not a conflict anybody will hit by accident, and it is the cheap check
    // that the comparison is an equality rather than a `>=`. A `>=` would let a
    // client skip the lock by sending a large number.
    const now = await read();
    const response = await api.patch(`${API}/projects/${projectId}`, {
      data: { expectedVersion: now.version + 99, notes: "aus der Zukunft" },
    });
    expect(response.status()).toBe(409);
  });
});

test.describe("the history", () => {
  test("records every version, newest first, with what changed", async () => {
    const history = await api.get(`${API}/projects/${projectId}/versions`);
    expect(history.ok()).toBe(true);
    const rows = ((await history.json()) as {
      data: { version: number; label: string; changed: string[]; changedByEmail: string | null }[];
    }).data;

    expect(rows.length).toBeGreaterThan(1);

    // Newest first, and dense: v5, v4, v3 …
    const versions = rows.map((r) => r.version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));

    for (const row of rows) {
      expect(row.label).toBe(`v${row.version}`);
      // Who, recorded on the row rather than joined — the account may be
      // deleted, and a history that says "unknown" about a sign-off is not one.
      expect(row.changedByEmail).toBe(ADMIN_EMAIL);
    }

    /**
     * **`changed` names the fields the request sent, and nothing else.**
     *
     * This assertion used to be `every row contains "notes"`, and it passed for
     * the wrong reason: `Object.keys` on a transformed DTO returns every
     * declared property, so every row contained every field and any `toContain`
     * was true. The tests above this line exercise four `notes` writes and two
     * `managerId` writes, so the history has to show exactly that split — which
     * is only possible if the bug is fixed.
     *
     * See `core/versioning/changed.ts`. Vitest cannot reach this: esbuild does
     * not define the absent class fields, so the unit test passes either way.
     */
    const byVersion = new Map(rows.map((row) => [row.version, row.changed]));
    expect([...byVersion.values()].some((changed) => changed.join() === "managerId")).toBe(true);
    expect([...byVersion.values()].some((changed) => changed.join() === "notes")).toBe(true);
    for (const [version, changed] of byVersion) {
      expect(changed, `v${version} claims fields no request sent`).toHaveLength(1);
      expect(["notes", "managerId"]).toContain(changed[0]);
    }
  });

  test("keeps the record as the API returned it, not as Prisma had it", async () => {
    const current = await read();
    const response = await api.get(`${API}/projects/${projectId}/versions/${current.version}`);
    /**
     * The message carries the status and the body, and it earned its keep
     * immediately.
     *
     * When the test above this one failed, Playwright started a **fresh worker**
     * for the next test — which re-ran `beforeAll`, made a new project, and left
     * this one asking for v1 of a record that had never been written. A bare
     * `expect(ok).toBe(true)` reported "expected true, received false" and sent
     * the reader looking for a bug in `versionAt`. The URL in the message is
     * what showed it was a cascade.
     */
    expect(
      response.ok(),
      `GET /projects/${projectId}/versions/${current.version} -> ${response.status()} ${await response.text()}`,
    ).toBe(true);
    const row = ((await response.json()) as { data: { data: Record<string, unknown> } }).data;

    // A payload read in five years must not contain `{"s":1,"e":6,"d":[…]}`
    // where a contract value should be, and must not depend on a schema that
    // has since changed.
    expect(row.data.number).toBeTruthy();
    expect(row.data.version).toBe(current.version);
    const value = row.data.contractValue;
    expect(value === null || typeof value === "string").toBe(true);
  });

  test("a version that does not exist is a 404", async () => {
    const response = await api.get(`${API}/projects/${projectId}/versions/9999`);
    expect(response.status()).toBe(404);
  });

  test("a version number that is not one is a 400", async () => {
    for (const bad of ["0", "-1", "abc"]) {
      const response = await api.get(`${API}/projects/${projectId}/versions/${bad}`);
      expect(response.status(), `versions/${bad}`).toBe(400);
    }
  });
});
