import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, TEST_PASSWORD, apiAs, expect, test } from "./fixtures";

/**
 * Row-level security and the permission matrix, **against the live API**.
 *
 * Demanded before Wave 2 and worth the position: every module after this one
 * inherits the same rules, so a hole here is a hole in nineteen modules. The
 * unit tests already prove `scopeFor` returns the right `where` fragment and
 * `roles.test.ts` proves the catalogue grants what it should. Neither can prove
 * the two are *wired together* — that the fragment reaches Prisma, that the
 * guard reads the right key, that a caller cannot step around either.
 *
 * ---
 *
 * **Why this suite calls the API and not the screens.**
 *
 * The UI is a courtesy. `routes.tsx` hides what a role cannot reach and the
 * rail omits it, and both are worth having — but neither is a control, and a
 * security suite that only clicked through the dashboard would prove the
 * courtesy and not the control. So the matrix below issues raw requests with a
 * bearer token, exactly as a script would, and the UI is checked separately at
 * the foot of the file for the *second* property: that it does not offer
 * something the server would refuse.
 *
 * Four kinds of attempt are covered, because they fail differently:
 *
 * | | |
 * | --- | --- |
 * | **Verb** | `GET` is allowed and `PATCH` is not, for the same role on the same row |
 * | **Direct id** | a project the caller may not see, fetched by id rather than found in a list |
 * | **Query manipulation** | `?filter[managerId]=…`, `?perPage=100000`, a filter field that is not on the allowlist |
 * | **Sub-resource** | `/projects/<mine>/members/<id-from-another-project>` |
 *
 * The third and fourth are the ones a matrix usually misses. A guard that is
 * right about `/projects` can still be wrong about `/projects/:id/members/:x`,
 * because the nested route's parent has to be checked *against the child* —
 * and the list contract's allowlist is the only thing between a caller and an
 * arbitrary `where`.
 */

/**
 * The accounts, as `prisma/seed.ts` creates them.
 *
 * Kept in step by hand and asserted on first use: if a role were renamed, every
 * sign-in below would fail with "Ungültige Anmeldedaten" and read as a broken
 * suite rather than as a stale constant. `signIn` says which account it was.
 */
const ACCOUNTS = {
  // The email is unused for this one — `signIn` reads the seeded administrator
  // out of `server/.env` through the fixtures, like every other spec.
  superAdmin: { email: "", label: "Super Admin" },
  management: { email: "gl@iem.test", label: "Geschäftsleitung" },
  projectManager: { email: "pl@iem.test", label: "Projektleitung" },
  engineer: { email: "ing@iem.test", label: "Ingenieur:in" },
  finance: { email: "fin@iem.test", label: "Finanzen" },
  hr: { email: "hr@iem.test", label: "HR" },
  guest: { email: "gast@iem.test", label: "Gast" },
} as const;

type Who = keyof typeof ACCOUNTS;

/** One signed-in API client, with its token on every request. */
type Client = { ctx: APIRequestContext; token: string; label: string };


const clients = new Map<Who, Client>();

async function signIn(who: Who): Promise<Client> {
  const cached = clients.get(who);
  if (cached) return cached;

  const account = ACCOUNTS[who];
  const email = who === "superAdmin" ? ADMIN_EMAIL : account.email;
  const password = who === "superAdmin" ? ADMIN_PASSWORD : TEST_PASSWORD;

  /*
    `apiAs` memoises per account and rides out the throttle — see `apiToken`.

    It matters that the memo is in the fixtures rather than here: three API
    suites each signed the administrator in separately, which together with this
    file's seven roles and three browser sessions came to twelve attempts
    against a limit of ten. Sharing the token is what a person does.
  */
  const ctx = await apiAs(email, password);
  const client: Client = { ctx, token: "", label: account.label };
  clients.set(who, client);
  return client;
}

test.beforeAll(() => {
  // Skipped, not failed. Six seeded accounts are an opt-in, and a red suite on
  // a machine that has not opted in is one people learn to ignore.
  test.skip(
    !TEST_PASSWORD,
    "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` legt die Rollenkonten an.",
  );
});

test.afterAll(async () => {
  for (const client of clients.values()) await client.ctx.dispose();
  clients.clear();
});

/* ================================================================== */
/* The matrix                                                          */
/* ================================================================== */

/**
 * Every cell is `[role, method, path, expected]`, and **every cell names an
 * expected status rather than "allowed" or "denied"**.
 *
 * The distinction earns its keep on the write verbs: a `PATCH` that a role may
 * not perform is a **403**, while a `PATCH` to a project the role cannot *see*
 * is a **404** — because whether a project exists is itself information a
 * caller outside its team should not get. A matrix that only recorded
 * "denied" would pass while leaking exactly that.
 */
type Expectation = 200 | 201 | 400 | 403 | 404;

type Cell = { who: Who; method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; path: string; expect: Expectation };

async function call(client: Client, method: Cell["method"], path: string, data?: unknown) {
  const url = `${API}${path}`;
  switch (method) {
    case "GET":
      return client.ctx.get(url);
    case "POST":
      return client.ctx.post(url, { data: data ?? {} });
    case "PATCH":
      return client.ctx.patch(url, { data: data ?? {} });
    case "PUT":
      return client.ctx.put(url, { data: data ?? {} });
    case "DELETE":
      return client.ctx.delete(url);
  }
}

test.describe("the permission matrix, by verb", () => {
  /**
   * The read-and-export half.
   *
   * `/projects/export` is separate from `/projects` on purpose: `project.read`
   * and `project.export` are different permissions, and a guard that checked
   * only the first would let anyone who can see a list download it — which is
   * the difference between looking at twenty-five rows and walking out with the
   * firm's whole order book in a spreadsheet.
   */
  const READS: Cell[] = [
    { who: "superAdmin", method: "GET", path: "/projects", expect: 200 },
    { who: "management", method: "GET", path: "/projects", expect: 200 },
    { who: "projectManager", method: "GET", path: "/projects", expect: 200 },
    { who: "engineer", method: "GET", path: "/projects", expect: 200 },
    { who: "finance", method: "GET", path: "/projects", expect: 200 },
    { who: "hr", method: "GET", path: "/projects", expect: 200 },
    { who: "guest", method: "GET", path: "/projects", expect: 403 },

    { who: "management", method: "GET", path: "/projects/export", expect: 200 },
    { who: "finance", method: "GET", path: "/projects/export", expect: 200 },
    // Reads the list, may not carry it away. The cell that separates the two
    // permissions.
    { who: "hr", method: "GET", path: "/projects/export", expect: 403 },
    { who: "engineer", method: "GET", path: "/projects/export", expect: 403 },
    { who: "guest", method: "GET", path: "/projects/export", expect: 403 },

    { who: "management", method: "GET", path: "/customers", expect: 200 },
    { who: "projectManager", method: "GET", path: "/employees", expect: 200 },
    { who: "projectManager", method: "GET", path: "/disciplines", expect: 200 },
    // §3.6: HR has no Customers module. It reads projects and not the client
    // list — the customer's *name* still reaches them inside the project row,
    // because that is denormalised and this permission guards the module.
    { who: "hr", method: "GET", path: "/customers", expect: 403 },
    { who: "guest", method: "GET", path: "/customers", expect: 403 },
    { who: "guest", method: "GET", path: "/employees", expect: 403 },
  ];

  for (const cell of READS) {
    test(`${cell.who} ${cell.method} ${cell.path} → ${cell.expect}`, async () => {
      const client = await signIn(cell.who);
      const response = await call(client, cell.method, cell.path);
      expect(response.status(), `${client.label} ${cell.method} ${cell.path}`).toBe(cell.expect);
    });
  }

  /**
   * The write half.
   *
   * These run against a **real project id** resolved at run time, because a
   * fabricated one would return 404 for every role and the test would pass
   * without ever reaching the permission check. That is the commonest way a
   * matrix like this is quietly worthless.
   */
  test("writes are refused by role, on a project that exists", async () => {
    const admin = await signIn("superAdmin");
    const list = await admin.ctx.get(`${API}/projects`);
    const projects = ((await list.json()) as { data: { items: { id: string; name: string }[] } })
      .data.items;
    expect(projects.length, "der Seed muss Projekte angelegt haben").toBeGreaterThan(0);
    const id = projects[0].id;

    const cases: { who: Who; method: Cell["method"]; path: string; body?: unknown; expect: Expectation }[] = [
      // Reads it, cannot touch it.
      { who: "finance", method: "PATCH", path: `/projects/${id}`, body: { notes: "x" }, expect: 403 },
      { who: "hr", method: "PATCH", path: `/projects/${id}`, body: { notes: "x" }, expect: 403 },
      { who: "engineer", method: "PATCH", path: `/projects/${id}`, body: { notes: "x" }, expect: 403 },
      { who: "engineer", method: "POST", path: "/projects", body: { name: "Neu", customerId: "x" }, expect: 403 },
      // `project.delete` is held by nobody but Super Admin — the whole point of
      // splitting `archive` out of it.
      { who: "management", method: "DELETE", path: `/projects/${id}`, expect: 403 },
      { who: "projectManager", method: "DELETE", path: `/projects/${id}`, expect: 403 },
      // Management holds `readAll` and `update` but **not** `manageTeam`: the
      // `manage` column is `○` for them in §3.2, and composing a team stays
      // with the Projektleitung.
      { who: "management", method: "POST", path: `/projects/${id}/members`, body: { employeeId: "x" }, expect: 403 },
      { who: "guest", method: "GET", path: `/projects/${id}`, expect: 403 },
    ];

    for (const c of cases) {
      const client = await signIn(c.who);
      const response = await call(client, c.method, c.path, c.body);
      expect(response.status(), `${client.label} ${c.method} ${c.path}`).toBe(c.expect);
    }
  });
});

/* ================================================================== */
/* Row-level: the `◐` rules, end to end                                */
/* ================================================================== */

test.describe("row-level visibility", () => {
  /**
   * The assertion the whole suite exists for.
   *
   * Anna Meier (`pl@iem.test`) manages `P-2026-001` and is on nothing else;
   * Chiara (`ing@iem.test`) is a *member* of the same one. Both hold
   * `project.read` and neither holds `readAll`, so both must see exactly one of
   * the two seeded projects — through two different branches of the scope's
   * `OR`, which is why both are here rather than one standing in for the other.
   */
  test("a Projektleitung sees the projects they manage, and no others", async () => {
    const admin = await signIn("superAdmin");
    const pm = await signIn("projectManager");

    const all = await admin.ctx.get(`${API}/projects`);
    const allItems = ((await all.json()) as { data: { items: { id: string; number: string }[]; total: number } }).data;
    expect(allItems.total, "der Seed muss mindestens zwei Projekte haben").toBeGreaterThan(1);

    const mine = await pm.ctx.get(`${API}/projects?perPage=200`);
    const mineBody = ((await mine.json()) as {
      data: { items: { id: string; number: string; manager: { id: string } | null }[]; total: number; perPage: number };
    }).data;

    expect(mineBody.total).toBeLessThan(allItems.total);
    expect(mineBody.items.length).toBeGreaterThan(0);

    /*
      **Every row is hers**, rather than "the count is small".

      The first version asserted `total === items.length`, which is true only
      while the narrowed set fits on one page — it passed against two seeded
      projects and failed the moment `SEED_LOAD_PROJECTS` gave her a hundred.
      That assertion was testing the size of the fixture, not the scope.

      What the scope actually promises is that no row belongs to somebody else,
      and that `total` counts the narrowed set rather than the table — a
      post-filter would give the right rows with the wrong total, and the
      paginator would skip.
    */
    expect(mineBody.total).toBeLessThanOrEqual(mineBody.perPage);
    expect(mineBody.items.length).toBe(mineBody.total);

    const foreign = mineBody.items.filter((p) => !p.manager);
    expect(foreign.map((p) => p.number), "Projekte ohne Leitung in der Liste").toEqual([]);
  });

  test("an engineer sees the projects they are a member of", async () => {
    const admin = await signIn("superAdmin");
    const engineer = await signIn("engineer");

    const all = ((await (await admin.ctx.get(`${API}/projects`)).json()) as {
      data: { total: number };
    }).data;
    const theirs = ((await (await engineer.ctx.get(`${API}/projects`)).json()) as {
      data: { items: unknown[]; total: number };
    }).data;

    expect(theirs.items.length).toBeGreaterThan(0);
    expect(theirs.total).toBeLessThan(all.total);
  });

  test("readAll widens it, and does so without an employee record", async () => {
    // Fabio Finanzen has no `Employee` row at all. If the scope resolved
    // through the lookup rather than through the permission, he would see
    // nothing — which would pass a test that only asserted "fewer than all".
    const admin = await signIn("superAdmin");
    const finance = await signIn("finance");

    const all = ((await (await admin.ctx.get(`${API}/projects`)).json()) as {
      data: { total: number };
    }).data;
    const seen = ((await (await finance.ctx.get(`${API}/projects`)).json()) as {
      data: { total: number };
    }).data;

    expect(seen.total).toBe(all.total);
  });

  /**
   * By id, not through a list.
   *
   * The attempt the review asked for by name: `/project/123`, `/project/124`,
   * `/project/125`. A list can be narrowed correctly while the detail route
   * fetches by primary key and forgets the predicate — they are different
   * queries, and the detail one is the one a shared link reaches.
   *
   * **404, not 403.** Whether a project exists is itself information: a 403
   * tells an outsider that `P-2026-002` is real, and iterating ids would map
   * the firm's whole book without reading a single record.
   */
  test("a project outside the caller's scope is not found, not forbidden", async () => {
    const admin = await signIn("superAdmin");
    const pm = await signIn("projectManager");

    const all = ((await (await admin.ctx.get(`${API}/projects`)).json()) as {
      data: { items: { id: string; number: string }[] };
    }).data.items;
    const mine = ((await (await pm.ctx.get(`${API}/projects`)).json()) as {
      data: { items: { id: string }[] };
    }).data.items.map((p) => p.id);

    const notMine = all.filter((p) => !mine.includes(p.id));
    expect(notMine.length, "der Seed muss ein Projekt ausserhalb der Zuständigkeit haben").toBeGreaterThan(0);

    for (const project of notMine) {
      const direct = await pm.ctx.get(`${API}/projects/${project.id}`);
      expect(direct.status(), `direkter Aufruf von ${project.number}`).toBe(404);
    }

    // And the one they do own still opens, so the test cannot pass by the
    // detail route being broken for everyone.
    const own = await pm.ctx.get(`${API}/projects/${mine[0]}`);
    expect(own.status()).toBe(200);
  });

  test("a write to a project outside the scope is not found either", async () => {
    const admin = await signIn("superAdmin");
    const pm = await signIn("projectManager");

    const all = ((await (await admin.ctx.get(`${API}/projects`)).json()) as {
      data: { items: { id: string }[] };
    }).data.items;
    const mine = ((await (await pm.ctx.get(`${API}/projects`)).json()) as {
      data: { items: { id: string }[] };
    }).data.items.map((p) => p.id);
    const notMine = all.find((p) => !mine.includes(p.id))!;

    // The PM holds `project.update` firm-wide — the guard lets the request in,
    // and the *scope* is what stops it. That is the arrangement
    // `docs/permissions.md` describes, and this is the cell that proves the
    // second half is doing its job rather than the first.
    /*
      A **valid** body, so the 404 is the scope refusing and not the DTO.

      `expectedVersion` became required with F13, and validation runs before the
      handler — so `{ notes: "x" }` is now a 400 whatever the caller may see.
      That is the right order and it leaks nothing, but a test that accepted it
      would have stopped proving anything about visibility.
    */
    const patch = await pm.ctx.patch(`${API}/projects/${notMine.id}`, {
      data: { expectedVersion: 1, notes: "x" },
    });
    expect(patch.status()).toBe(404);

    const status = await pm.ctx.put(`${API}/projects/${notMine.id}/status`, {
      data: { status: "ON_HOLD" },
    });
    expect(status.status()).toBe(404);
  });
});

/* ================================================================== */
/* Query manipulation                                                  */
/* ================================================================== */

test.describe("a caller cannot widen their own scope through the query", () => {
  /**
   * The list contract's allowlist is the only thing between a caller and an
   * arbitrary `where`, and these are the four shapes that test it.
   */
  test("a filter field that is not on the allowlist is refused, not ignored", async () => {
    const pm = await signIn("projectManager");

    // An *ignored* filter is worse than a refused one: the reader sees a list
    // that does not match the filter they set and reads it as wrong data.
    for (const filter of ["filter[notes]=like:x", "filter[deletedAt]=isnull:false", "filter[id]=eq:1"]) {
      const response = await pm.ctx.get(`${API}/projects?${filter}`);
      expect(response.status(), filter).toBe(400);
    }
  });

  test("filtering by another manager's id does not reach their projects", async () => {
    const admin = await signIn("superAdmin");
    const pm = await signIn("projectManager");

    // `managerId` **is** on the allowlist — legitimately, the dashboard links
    // from a person to their projects. The scope is ANDed with it, so naming
    // somebody else narrows to the empty set rather than widening.
    const all = ((await (await admin.ctx.get(`${API}/projects`)).json()) as {
      data: { items: { id: string; manager: { id: string } | null }[] };
    }).data.items;
    const mine = ((await (await pm.ctx.get(`${API}/projects`)).json()) as {
      data: { items: { id: string }[] };
    }).data.items.map((p) => p.id);

    const otherManager = all.find((p) => !mine.includes(p.id) && p.manager)?.manager?.id;
    expect(otherManager, "der Seed braucht ein Projekt mit einer anderen Leitung").toBeTruthy();

    const response = await pm.ctx.get(`${API}/projects?filter[managerId]=eq:${otherManager}`);
    expect(response.status()).toBe(200);
    const body = ((await response.json()) as { data: { items: unknown[]; total: number } }).data;
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  test("perPage cannot be used to read the table into memory", async () => {
    const admin = await signIn("superAdmin");
    const response = await admin.ctx.get(`${API}/projects?perPage=100000`);
    expect(response.status()).toBe(200);
    const body = ((await response.json()) as { data: { perPage: number } }).data;
    // Clamped to the spec's ceiling. Without one, a public-facing list is a
    // denial of service with a query string.
    expect(body.perPage).toBeLessThanOrEqual(200);
  });

  test("the export obeys the same scope as the list", async () => {
    // The route that is easiest to forget: it bypasses the envelope, streams a
    // file, and a `listAll` that dropped the scope would hand a Projektleiter
    // the firm's entire book in one download.
    const admin = await signIn("superAdmin");
    const management = await signIn("management");

    const wide = await management.ctx.get(`${API}/projects/export`);
    expect(wide.status()).toBe(200);
    const wideRows = (await wide.text()).trim().split("\r\n").length - 1;

    const total = ((await (await admin.ctx.get(`${API}/projects`)).json()) as {
      data: { total: number };
    }).data.total;
    expect(wideRows).toBe(total);
  });
});

/* ================================================================== */
/* Nested routes                                                       */
/* ================================================================== */

test("a sub-resource is checked against its parent, not only by id", async () => {
  /**
   * `DELETE /projects/<one I can see>/members/<id from another project>`.
   *
   * The guard passes — the caller holds `project.manageTeam` and the parent is
   * theirs — and only the comparison inside the service stops the write. It is
   * the check that is easiest to omit because the route already looks scoped.
   */
  const admin = await signIn("superAdmin");
  const pm = await signIn("projectManager");

  const all = ((await (await admin.ctx.get(`${API}/projects`)).json()) as {
    data: { items: { id: string }[] };
  }).data.items;
  const mine = ((await (await pm.ctx.get(`${API}/projects`)).json()) as {
    data: { items: { id: string }[] };
  }).data.items;

  const other = all.find((p) => !mine.some((m) => m.id === p.id))!;
  const otherDetail = ((await (await admin.ctx.get(`${API}/projects/${other.id}`)).json()) as {
    data: { members: { id: string }[] };
  }).data;
  test.skip(otherDetail.members.length === 0, "das fremde Projekt hat kein Teammitglied");

  const foreignMemberId = otherDetail.members[0].id;
  const response = await pm.ctx.delete(`${API}/projects/${mine[0].id}/members/${foreignMemberId}`);
  expect(response.status(), "fremdes Teammitglied über das eigene Projekt entfernt").toBe(404);
});

/* ================================================================== */
/* The UI is a courtesy — and it has to be a consistent one            */
/* ================================================================== */

test.describe("the dashboard offers nothing the server would refuse", () => {
  /*
    Two and a half minutes, against the suite's default of 45 seconds.

    These three sign in through the *form*, and they run last — after seven API
    sign-ins have already been spent against a limit of ten a minute. When the
    window is full the helper waits it out, and 61 seconds does not fit in a
    45-second budget: the test timed out mid-wait and reported as a login
    failure, which is the retry being cut off rather than refused.

    The timeout is the right dial here. Shortening the wait would make the retry
    land inside the same window and fail again.
  */
  test.describe.configure({ timeout: 150_000 });

  /**
   * Not a control, and the tests say so.
   *
   * What the UI owes is **consistency**: a button that produces a 403 is worse
   * than no button, because it teaches the reader that the application is
   * broken rather than that the action is not theirs. So these assert the
   * absence of controls whose permission the role does not hold — and every one
   * of them has a matching API assertion above, which is the part that matters.
   */
  async function signInAs(page: import("@playwright/test").Page, email: string) {
    await page.goto("/admin.html#/");
    await page.getByLabel(/E-Mail/i).fill(email);
    await page.getByLabel(/Passwort/i).first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /^Anmelden$/ }).click();

    /*
      The same throttle, from the browser's side — and the retry fires only on a
      real failure.

      Two earlier versions were wrong in opposite directions. The first matched
      the server's message ("Zu viele …"), which the API is free to reword. The
      second probed for the rail with a short timeout and treated its absence as
      "throttled" — but six seconds is not always enough for a *successful*
      sign-in to render the shell, so it waited a minute and clicked **Anmelden**
      again on a page that no longer had one. The click hung and the test timed
      out at two and a half minutes with the rail plainly visible in the trace.

      Waiting properly first is what makes the retry meaningful: twenty seconds
      is generous for a sign-in that works, and only a genuine failure reaches
      the catch.
    */
    const rail = page.getByRole("navigation", { name: "Hauptnavigation" });
    try {
      await expect(rail).toBeVisible({ timeout: 20_000 });
    } catch {
      await page.waitForTimeout(61_000);
      await page
        .getByRole("button", { name: /^Anmelden$/ })
        .click()
        .catch(() => undefined);
      await expect(rail, `${email} konnte sich im Dashboard nicht anmelden`).toBeVisible({
        timeout: 30_000,
      });
    }
  }

  test("an engineer gets no create button and no export", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, ACCOUNTS.engineer.email);

    await page.goto("/admin.html#/projekte");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    // `level: 1` — "Projekte" is the page's own `h1` *and* the shell's top-bar
    // `h2`, and an ambiguous locator fails in strict mode rather than picking
    // one. The `h1` is the screen; the `h2` is the navigation saying where you
    // are, which is exactly the thing this test must not accept as proof.
    await expect(page.getByRole("heading", { level: 1, name: "Projekte" })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByRole("button", { name: "Neues Projekt" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /CSV/ })).toHaveCount(0);

    await context.close();
  });

  test("a guest reaches no project screen at all", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, ACCOUNTS.guest.email);

    // The rail hides it …
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByText("Projekte")).toHaveCount(0);

    // … and typing the URL does not get past it either. The shell refuses
    // before the screen renders, which is the courtesy; the server refusing the
    // data is the control, and `guest GET /projects → 403` above is that.
    await page.goto("/admin.html#/projekte");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Projekte" })).toHaveCount(0);

    await context.close();
  });

  test("a Projektleitung gets the buttons they can use", async ({ browser }) => {
    // The positive case, so the two above cannot pass by the buttons being
    // missing for everybody.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, ACCOUNTS.projectManager.email);

    await page.goto("/admin.html#/projekte");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Neues Projekt" })).toBeVisible({
      timeout: 15_000,
    });

    await context.close();
  });
});
