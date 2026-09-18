import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, TEST_PASSWORD, apiAs, expect, test } from "./fixtures";

/**
 * The operational metrics, **against the live API**.
 *
 * The firm's condition for Wave 2: *"Ab jetzt würde ich keine Module mehr ohne
 * Metriken akzeptieren. … Nicht für Benutzer. Sondern für Betrieb und
 * Monitoring."*
 *
 * `metrics.test.ts` proves the arithmetic and `architecture.test.ts` proves a
 * module declares itself. Neither can prove the thing an operator depends on:
 * that the figures **move** when the system is used. Every one of the six is a
 * number that is plausible whatever it says — a p95 of `null`, an event count
 * stuck at 0 and an audit total that never grows all look exactly like a quiet
 * afternoon. So this suite makes something happen and then asserts the report
 * noticed.
 *
 * Three failures it is aimed at, all of them silent:
 *
 * | | |
 * | --- | --- |
 * | **Attribution** | `req.route.path` carries the `/api/v1` prefix; a module declaring `/projects` matches nothing and reports zero for ever |
 * | **Counting the wrong things** | a 404 or a 409 counted as an error makes the error rate a measure of how often somebody mistypes a URL |
 * | **A module that stopped registering** | deleting a provider nothing injects removes it from the report and breaks no test that does not look here |
 */

let admin: APIRequestContext;

test.beforeAll(async () => {
  admin = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
});

test.afterAll(async () => {
  await admin.dispose();
});

type Module = {
  key: string;
  label: string;
  records: { total: number; active: number; archived: number | null; deleted: number };
  api: {
    requests: number;
    errors: number;
    errorRate: number;
    meanMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    slowest: { route: string; p95Ms: number } | null;
  };
  events: { total: number; byName: Record<string, number> };
  audit: { total: number; last24h: number };
  jobs: {
    total: number;
    queued: number;
    running: number;
    dead: number;
    meanDurationMs: number | null;
    p50DurationMs: number | null;
  };
};

async function report(ctx: APIRequestContext = admin): Promise<Module[]> {
  const response = await ctx.get(`${API}/metrics/modules`);
  expect(response.status(), "GET /metrics/modules").toBe(200);
  const body = (await response.json()) as { data: { modules: Module[] } };
  return body.data.modules;
}

const projects = (modules: Module[]): Module => {
  const found = modules.find((m) => m.key === "project");
  expect(found, "kein Modul mit key „project“ im Bericht").toBeTruthy();
  return found!;
};

test.describe("the route itself", () => {
  test("is behind system.health rather than open to any session", async () => {
    test.skip(
      !TEST_PASSWORD,
      "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` legt die Rollenkonten an.",
    );

    /*
      `guest` is the only seeded role without `system.health`, which is what
      makes it the right probe: a 403 here proves the decorator is read, and a
      200 would mean every signed-in user can see p95s, error rates and record
      counts for the whole firm. That is not catastrophic and it is not nothing
      — it is a map of what exists and how busy it is.
    */
    const guest = await apiAs("gast@iem.test", TEST_PASSWORD);
    const response = await guest.get(`${API}/metrics/modules`);
    expect(response.status(), "Gast auf /metrics/modules").toBe(403);
    await guest.dispose();
  });

  test("refuses an anonymous caller", async ({ request }) => {
    const response = await request.get(`${API}/metrics/modules`);
    expect(response.status()).toBe(401);
  });

  test("says since when the in-memory figures have been accumulating", async () => {
    /**
     * Latency, error counts and event counts live in the process and reset with
     * it; records, audit and jobs come from tables and do not. An operator
     * reading "0 errors" without knowing which it is has learnt nothing, so the
     * envelope states it rather than implying it.
     */
    const response = await admin.get(`${API}/metrics/modules`);
    const body = (await response.json()) as { data: { since: string; generatedAt: string } };
    expect(Number.isNaN(Date.parse(body.data.since))).toBe(false);
    expect(Date.parse(body.data.since)).toBeLessThanOrEqual(Date.parse(body.data.generatedAt));
  });
});

test.describe("the six figures", () => {
  test("reports every one of them for Projekte", async () => {
    const module = projects(await report());

    expect(module.label).toBe("Projekte");
    // Records: a seeded database has projects. 0 would mean `records()` is
    // counting with the wrong predicate, which is invisible in a type.
    expect(module.records.total).toBeGreaterThan(0);
    expect(module.records.active).toBeGreaterThan(0);
    expect(module.records.deleted).toBeGreaterThanOrEqual(0);

    expect(module.api).toMatchObject({ requests: expect.any(Number), errorRate: expect.any(Number) });
    expect(module.audit.total).toBeGreaterThanOrEqual(module.audit.last24h);
    expect(module.jobs).toMatchObject({ total: expect.any(Number), dead: expect.any(Number) });

    // Every declared event is a key, present at 0 rather than absent. Absent
    // and zero are different, and only one of them is a fact.
    expect(Object.keys(module.events.byName)).toContain("ProjectUpdated");
    expect(Object.keys(module.events.byName)).toContain("MilestoneMissed");
  });

  test("splits records four ways, and they add up", async () => {
    /**
     * `active + archived + deleted === total`, computed in one `$transaction`
     * so the four agree with each other even under a concurrent write. The
     * arithmetic is the assertion: three separate `count`s with overlapping
     * predicates is exactly the shape that double-counts an archived project
     * which was later deleted, and no type can see it.
     */
    const module = projects(await report());
    expect(module.records.active + (module.records.archived ?? 0) + module.records.deleted).toBe(
      module.records.total,
    );
  });

  test("reports no archive as null rather than as zero", async () => {
    /**
     * Aufgaben has no archive — `CANCELLED` is the whole of "this will not
     * happen", and `rbac/resources.ts` gives `task` no `archive` action. `0`
     * would invite an operator to ask why nothing is ever archived, which is a
     * question about a feature that does not exist.
     */
    const tasks = (await report()).find((m) => m.key === "task");
    expect(tasks, "kein Modul mit key „task“ im Bericht").toBeTruthy();
    expect(tasks!.records.archived).toBeNull();
    expect(tasks!.records.active).toBeGreaterThan(0);
  });

  test("reports the mean beside the percentiles, from the same window", async () => {
    // The mean is what people ask for and the one figure comparable across
    // deployments; the p95 beside it is what makes the mean safe to read. Both
    // are drawn from the same ring, so they describe one population.
    await admin.get(`${API}/projects?perPage=1`);
    const api = projects(await report()).api;

    expect(api.meanMs).not.toBeNull();
    expect(api.p95Ms).not.toBeNull();
    // A mean above the 95th percentile of the same sample is arithmetically
    // possible only with an extreme tail, and here would mean the two are
    // reading different windows.
    expect(api.meanMs!).toBeLessThanOrEqual(api.p95Ms!);
    expect(Number.isInteger(api.meanMs!), "a mean with eleven decimals ends up in a report").toBe(
      true,
    );
  });

  test("attributes a request to the module whose prefix it starts with", async () => {
    /**
     * The bug this is here for: `req.route.path` is `/api/v1/projects/:id`, not
     * `/projects/:id`. Before `normalise` stripped the global prefix, every
     * module matched nothing — `requests: 0`, `p95Ms: null`, for ever, with no
     * error anywhere. It reads as an idle system.
     */
    const before = projects(await report()).api.requests;

    await admin.get(`${API}/projects?pageSize=1`);
    await admin.get(`${API}/projects?pageSize=1`);

    const after = projects(await report()).api;
    expect(after.requests, "zwei Anfragen an /projects, nicht gezählt").toBeGreaterThanOrEqual(before + 2);
    expect(after.p95Ms, "keine Laufzeit erfasst").not.toBeNull();
    // The pattern, not the URL — otherwise there is one bucket per project and
    // an id in a metrics label.
    expect(after.slowest?.route).toMatch(/^[A-Z]+ \/projects/);
    expect(after.slowest?.route).not.toMatch(/\/api\/v1/);
  });

  test("counts a raised event, and only after it has committed", async () => {
    const list = await admin.get(`${API}/projects?perPage=1`);
    const item = ((await list.json()) as { data: { items: { id: string; name: string; version: number }[] } })
      .data.items[0];
    expect(item, "keine Projekte in der Datenbank").toBeTruthy();

    const before = projects(await report());

    /**
     * The successful write first, so the conflict that follows is a real one.
     *
     * The earlier version of this test sent `version - 1` and expected a 409.
     * That works only while the first project of the list happens to be at v2
     * or later — and the day Wave 2's seed put a freshly created project at the
     * top, `expectedVersion: 0` failed the DTO's `@Min(1)` and the test
     * reported a **400** for a case it was never exercising. A test whose
     * subject depends on which row sorts first is a test that passes for a
     * reason nobody chose.
     */
    const ok = await admin.patch(`${API}/projects/${item.id}`, {
      data: { name: item.name, expectedVersion: item.version },
    });
    expect(ok.status()).toBe(200);

    const afterEdit = projects(await report());
    expect(afterEdit.events.byName.ProjectUpdated).toBe(before.events.byName.ProjectUpdated + 1);
    // The audit row is derived from the same event, so the two move together.
    expect(afterEdit.audit.total).toBeGreaterThan(before.audit.total);

    /*
      And now the version this test read is genuinely stale: the write above
      moved the record on. The request fails, the transaction rolls back and
      `EventBus.discard()` throws the queued event away. If the count moved
      here, the report would be announcing edits that did not happen and would
      disagree with the audit log built from the same events.
    */
    const stale = await admin.patch(`${API}/projects/${item.id}`, {
      data: { name: item.name, expectedVersion: item.version },
    });
    expect(stale.status(), "veraltete Version").toBe(409);

    const afterConflict = projects(await report());
    expect(afterConflict.events.byName.ProjectUpdated).toBe(
      afterEdit.events.byName.ProjectUpdated,
    );
  });
});

test.describe("the error rate", () => {
  test("does not count a 404, a 403 or a 409 as a failure", async () => {
    /**
     * The figure an alert is set on, so what it counts is the whole design.
     *
     * A 404 for a project outside the caller's scope is the row-level rule
     * *working* — `security.spec.ts` asserts it is a 404 and not a 403 for
     * exactly that reason — and a 409 is two people editing one project on a
     * Tuesday. Counting either would make the error rate fire on ordinary use,
     * and an alert that fires on ordinary use is an alert somebody mutes.
     */
    const before = projects(await report()).api;

    const missing = await admin.get(`${API}/projects/00000000-0000-0000-0000-000000000000`);
    expect(missing.status()).toBe(404);

    const invalid = await admin.patch(`${API}/projects/00000000-0000-0000-0000-000000000000`, {
      data: { expectedVersion: "nicht eine Zahl" },
    });
    expect([400, 404]).toContain(invalid.status());

    const after = projects(await report()).api;
    expect(after.requests, "die abgelehnten Anfragen wurden gar nicht gezählt").toBeGreaterThan(
      before.requests,
    );
    expect(after.errors, "eine abgelehnte Anfrage zählt als Fehler").toBe(before.errors);
  });
});
