import type { APIRequestContext } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  TEST_PASSWORD,
  apiAs,
  expect,
  spendLogin,
  test,
} from "./fixtures";

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
  /**
   * The row the Unternehmen module needed and this matrix could not reach.
   *
   * `organisation.updateLegal` exists because changing the main telephone
   * number and changing the UID are not the same authority — and
   * `administrator` is the **only** role that holds one without the other.
   * Every other account either has both (`management`, Super Admin) or
   * neither, so the gate inside `OrganisationController.update` was
   * unobservable: the six roles above all stop at the route guard first.
   */
  administrator: { email: "adm@iem.test", label: "Administrator" },
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

    /*
      Unternehmen und Standorte.

      `organisation.read` and `office.read` are separate keys and separately
      granted, so both are listed: a guard that checked one for both routes
      would pass a single-key matrix and leak the other.

      The engineer and the guest are the floor — neither holds either key —
      and the administrator is the interesting row, because it reads and
      writes the company but may not touch its legal identity. That cell is
      below, with the writes.
    */
    { who: "superAdmin", method: "GET", path: "/organisation", expect: 200 },
    { who: "management", method: "GET", path: "/organisation", expect: 200 },
    { who: "administrator", method: "GET", path: "/organisation", expect: 200 },
    { who: "engineer", method: "GET", path: "/organisation", expect: 403 },
    { who: "guest", method: "GET", path: "/organisation", expect: 403 },

    { who: "management", method: "GET", path: "/offices", expect: 200 },
    { who: "administrator", method: "GET", path: "/offices", expect: 200 },
    { who: "engineer", method: "GET", path: "/offices", expect: 403 },
    { who: "guest", method: "GET", path: "/offices", expect: 403 },

    // The read-only operational panel. `system.health`, not `settings.read` —
    // reading the SMTP host and reading the database's latency are different
    // questions, and the engineer holds the second without the first.
    { who: "engineer", method: "GET", path: "/dashboard/system", expect: 200 },
    { who: "guest", method: "GET", path: "/dashboard/system", expect: 403 },

    /*
      Somebody else's sessions.

      **`user.readSessions` is deliberately not `user.read`**, and these cells
      are what stops the two being conflated by a later edit. Several roles
      here hold `user.read` — they can see the user list — and every one of
      them is refused, because a device, an IP address and a working pattern
      are a different disclosure from a name and a role.

      The id is **fabricated on purpose**, which is the opposite of the rule
      the writes below follow, and for a reason worth stating. There the
      concern was a 404 short-circuiting the permission check and passing
      vacuously; here the 404 *is* the assertion. `@RequirePermissions` runs
      before the handler, so a role without the key is refused at the guard
      and never learns whether the id is real, while a role with it reaches
      `existing()` and is told the user does not exist. **403 and 404 are
      therefore the two halves of one proof**: the guard fires for the first
      group and the handler for the second, and a route that answered 404 to
      everybody would look like it worked while enforcing nothing.

      It is also why `sessionsOf` calls `existing()` at all. Without it an
      unknown id answers `200 []`, which is what a real account with nobody
      signed in says — so these cells would read 200 and prove nothing.
    */
    { who: "superAdmin", method: "GET", path: "/users/cmzzzznotarealid0000/sessions", expect: 404 },
    { who: "administrator", method: "GET", path: "/users/cmzzzznotarealid0000/sessions", expect: 404 },
    { who: "management", method: "GET", path: "/users/cmzzzznotarealid0000/sessions", expect: 403 },
    { who: "hr", method: "GET", path: "/users/cmzzzznotarealid0000/sessions", expect: 403 },
    { who: "projectManager", method: "GET", path: "/users/cmzzzznotarealid0000/sessions", expect: 403 },
    { who: "engineer", method: "GET", path: "/users/cmzzzznotarealid0000/sessions", expect: 403 },
    { who: "guest", method: "GET", path: "/users/cmzzzznotarealid0000/sessions", expect: 403 },

    // And the revoking half, which is a second key. The administrator holds
    // both; nobody else holds either.
    {
      who: "administrator",
      method: "POST",
      path: "/users/cmzzzznotarealid0000/sessions/revoke-all",
      expect: 404,
    },
    {
      who: "management",
      method: "POST",
      path: "/users/cmzzzznotarealid0000/sessions/revoke-all",
      expect: 403,
    },
    {
      who: "hr",
      method: "POST",
      path: "/users/cmzzzznotarealid0000/sessions/revoke-all",
      expect: 403,
    },
    {
      who: "guest",
      method: "DELETE",
      path: "/users/cmzzzznotarealid0000/sessions/cmzzzznotarealsess00",
      expect: 403,
    },

    /*
      Somebody else's second factor.

      **403 and 400 are the two halves of one proof here**, which is the same
      trick the session cells use with 403 and 404 and works for a different
      reason. `PermissionsGuard` runs before the `ValidationPipe`, so a role
      without `user.resetMfa` is refused at the guard and the empty body is
      never examined — while a role *with* the key gets past the guard,
      reaches the validator and is told the body is missing `reauthToken`.

      So a **400 means the permission passed** and a 403 means it did not. A
      route that answered 403 to everybody would look like it worked while
      granting the key to nobody; one that answered 400 to everybody would be
      a route with no guard at all. Neither can hide behind these cells.

      `administrator` holds it deliberately — clearing a lost authenticator
      is support work, it grants no access, and putting it behind the single
      Super Admin account is how a locked-out Geschäftsleitung ends up with
      somebody editing the database. `management` is the interesting refusal:
      it holds `user.read`, so this separates "may look at the user list"
      from "may strip somebody's second factor".
    */
    { who: "superAdmin", method: "POST", path: "/users/cmzzzznotarealid0000/mfa/reset", expect: 400 },
    { who: "administrator", method: "POST", path: "/users/cmzzzznotarealid0000/mfa/reset", expect: 400 },
    { who: "management", method: "POST", path: "/users/cmzzzznotarealid0000/mfa/reset", expect: 403 },
    { who: "hr", method: "POST", path: "/users/cmzzzznotarealid0000/mfa/reset", expect: 403 },
    { who: "projectManager", method: "POST", path: "/users/cmzzzznotarealid0000/mfa/reset", expect: 403 },
    { who: "engineer", method: "POST", path: "/users/cmzzzznotarealid0000/mfa/reset", expect: 403 },
    { who: "guest", method: "POST", path: "/users/cmzzzznotarealid0000/mfa/reset", expect: 403 },

    /*
      One's **own** second factor carries no permission at all, and these two
      cells are what stops somebody "tidying up" by adding one.

      The argument is `/auth/sessions`': these are operations on the caller's
      own account, like `/auth/me`, and a key every role had to be granted
      for the dashboard to work is a key that means nothing. The guest is the
      floor of the matrix and holds two content permissions — if `GET
      /auth/mfa` answers 200 for them, it answers 200 for everybody.
    */
    { who: "guest", method: "GET", path: "/auth/mfa", expect: 200 },
    { who: "engineer", method: "GET", path: "/auth/mfa", expect: 200 },

    /*
      Benachrichtigungen, and the three levels in one block.

      **The firm's rules** are `notification.configure`. `management` is the
      interesting refusal again: it holds `system.health` and `audit.read`,
      so it can see how the installation is running — and deciding which
      events notify whom is a different authority from watching them.

      **The delivery log** is a second key, and the pair is what stops them
      being conflated by a later edit: `administrator` holds both, so the
      cells alone would not distinguish them, which is why the guest and the
      engineer rows are here for each.

      **One's own inbox carries no permission at all.** The guest is the
      floor of the matrix — two content keys and nothing else — so a 200
      there means a 200 for everybody. These two cells are what a future
      "tidying up" of the route table would break.
    */
    { who: "superAdmin", method: "GET", path: "/notifications/rules", expect: 200 },
    { who: "administrator", method: "GET", path: "/notifications/rules", expect: 200 },
    { who: "management", method: "GET", path: "/notifications/rules", expect: 403 },
    { who: "hr", method: "GET", path: "/notifications/rules", expect: 403 },
    { who: "engineer", method: "GET", path: "/notifications/rules", expect: 403 },
    { who: "guest", method: "GET", path: "/notifications/rules", expect: 403 },

    { who: "administrator", method: "GET", path: "/notifications/deliveries", expect: 200 },
    { who: "management", method: "GET", path: "/notifications/deliveries", expect: 403 },
    { who: "engineer", method: "GET", path: "/notifications/deliveries", expect: 403 },
    { who: "guest", method: "GET", path: "/notifications/deliveries", expect: 403 },

    { who: "guest", method: "GET", path: "/notifications", expect: 200 },
    { who: "guest", method: "GET", path: "/notifications/preferences", expect: 200 },

    /*
      Sicherung und Wiederherstellung (P2-5), and the pair of keys is the
      point.

      `system.backup` opens the history and the status; **`system.restore`
      opens the two operations that hand over the production data** —
      applying a backup and downloading one. `administrator` holds the first
      and not the second, which is the cell that proves the split is real
      rather than two names for one authority.

      These cells live **here** rather than in `backup.spec.ts`, and that is
      the fourth time the sign-in budget has decided where an assertion goes.
      This file already signs every role account in once per run; asserting
      the same thing from `backup.spec.ts` meant `gast@iem.test` and
      `adm@iem.test` signing in a second time, earlier in the run than any
      other spec needs them — and the failure surfaced as
      "Hauptnavigation not found" in `a11y.spec.ts` at tablet width, two
      projects away. Same misdiagnosis, fifth way in.
    */
    { who: "superAdmin", method: "GET", path: "/backups/status", expect: 200 },
    { who: "administrator", method: "GET", path: "/backups/status", expect: 200 },
    { who: "management", method: "GET", path: "/backups/status", expect: 403 },
    { who: "engineer", method: "GET", path: "/backups/status", expect: 403 },
    { who: "guest", method: "GET", path: "/backups/status", expect: 403 },

    { who: "administrator", method: "GET", path: "/backups", expect: 200 },
    { who: "guest", method: "GET", path: "/backups", expect: 403 },
    { who: "administrator", method: "GET", path: "/backups/restores", expect: 200 },
    { who: "administrator", method: "GET", path: "/backups/retention/preview", expect: 200 },
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

      /*
        The split that P2-5 exists to make real.

        `administrator` holds `system.backup` — it may take a backup, check
        it verified and configure the schedule, which is system maintenance
        and exactly what the role is for. It does **not** hold
        `system.restore`, so it may neither replace the production database
        nor download an artifact: the archive is the whole database and every
        applicant dossier, so obtaining it and applying it disclose the same
        thing, and a `backup.download` key would have been a third name for
        one authority.

        The restore body is deliberately well-formed. A cell that was refused
        for a missing field would pass whether or not the permission worked.

        There is deliberately **no `administrator POST /backups → 201` cell**.
        It was here and it was wrong twice over: creating a backup is throttled
        at six an hour and shares that budget with `backup.spec.ts`, so the
        cell passed or failed depending on what had run before it; and a matrix
        of permission checks should not spawn a `pg_dump` in the middle of
        itself. The positive case is `backup.spec.ts`'s job. What belongs here
        is the **refusals**, which cost nothing and are the thing a permission
        matrix is for.
      */
      {
        who: "administrator",
        method: "POST",
        path: "/backups/does-not-exist/restore",
        body: { mode: "DRILL", confirmation: "WIEDERHERSTELLEN", reauthToken: "x" },
        expect: 403,
      },
      {
        who: "administrator",
        method: "GET",
        path: "/backups/does-not-exist/artifacts/DATABASE_DUMP/download",
        expect: 403,
      },
      { who: "guest", method: "POST", path: "/backups", body: { type: "DATABASE" }, expect: 403 },

      /*
        The publishing split P2-3 makes real, and the administrator is again
        the row that carries the argument.

        The role's own description says it "veröffentlicht aber nicht". It
        holds `content.schedule` — *when* an approved change goes live is
        scheduling work — and it does **not** hold `content.unpublish`, which
        takes a live page down. Those two being one key would mean the role
        that may not publish could unpublish, which is the larger authority of
        the two: republishing is recoverable by pressing the button again,
        while a page that disappears is only noticed by whoever it was
        promised to.

        The ids are fabricated, so the two halves of the proof are 403 at the
        guard and 404 in the handler — the pattern the sessions rows above
        describe. The schedule bodies are well-formed for the same reason the
        restore body is: a cell refused for a missing field would pass whether
        or not the permission worked.
      */
      {
        who: "administrator",
        method: "PUT",
        path: "/content/entries/cmzzzznotarealid0000/schedule",
        body: { at: "2027-01-01T08:00:00.000Z", expectedVersion: 1 },
        expect: 404,
      },
      {
        who: "engineer",
        method: "PUT",
        path: "/content/entries/cmzzzznotarealid0000/schedule",
        body: { at: "2027-01-01T08:00:00.000Z", expectedVersion: 1 },
        expect: 403,
      },
      {
        who: "guest",
        method: "PUT",
        path: "/content/entries/cmzzzznotarealid0000/schedule",
        body: { at: "2027-01-01T08:00:00.000Z", expectedVersion: 1 },
        expect: 403,
      },
      // The cell this block exists for.
      {
        who: "administrator",
        method: "POST",
        path: "/content/entries/cmzzzznotarealid0000/unpublish",
        body: { expectedVersion: 1 },
        expect: 403,
      },
      {
        who: "management",
        method: "POST",
        path: "/content/entries/cmzzzznotarealid0000/unpublish",
        body: { expectedVersion: 1 },
        expect: 403,
      },
      {
        who: "superAdmin",
        method: "POST",
        path: "/content/entries/cmzzzznotarealid0000/unpublish",
        body: { expectedVersion: 1 },
        expect: 404,
      },
      { who: "guest", method: "DELETE", path: "/content/entries/cmzzzznotarealid0000/schedule", expect: 403 },

      /*
        Job Operations (P2-6), and the three keys F6 declared for a runner
        that had no surface.

        `job.read` opens the list, `job.retry` re-runs work that did not
        happen, `job.cancel` stops work that has not started. They are three
        rather than one because they are three authorities: reading the queue
        discloses what the system has been doing, and the other two change it.

        The ids are fabricated, so 403 is the guard and 404 is the handler —
        the two halves of the proof, the same pattern the sessions rows above
        describe. Nobody but Super Admin holds any of the three in the seeded
        roles, which makes this block mostly refusals; that is what a
        permission matrix is for, and the positive path is `system.spec.ts`.
      */
      { who: "guest", method: "GET", path: "/jobs", expect: 403 },
      { who: "engineer", method: "GET", path: "/jobs", expect: 403 },
      { who: "administrator", method: "GET", path: "/jobs", expect: 403 },
      { who: "superAdmin", method: "GET", path: "/jobs", expect: 200 },
      {
        who: "administrator",
        method: "POST",
        path: "/jobs/cmzzzznotarealid0000/retry",
        body: {},
        expect: 403,
      },
      {
        who: "superAdmin",
        method: "POST",
        path: "/jobs/cmzzzznotarealid0000/retry",
        body: {},
        expect: 404,
      },
      {
        who: "management",
        method: "POST",
        path: "/jobs/cmzzzznotarealid0000/cancel",
        body: {},
        expect: 403,
      },

      /*
        The System Control Center's read model, behind `system.health` — the
        same key `/dashboard/system` has carried since P1-1, deliberately
        reused rather than minted anew.
      */
      { who: "guest", method: "GET", path: "/dashboard/system/overview", expect: 403 },
      { who: "engineer", method: "GET", path: "/dashboard/system/overview", expect: 200 },
    ];

    for (const c of cases) {
      const client = await signIn(c.who);
      const response = await call(client, c.method, c.path, c.body);
      expect(response.status(), `${client.label} ${c.method} ${c.path}`).toBe(c.expect);
    }
  });

  /**
   * The field-level `◐` on the organisation, which no route decorator can
   * express.
   *
   * `@RequirePermissions` is AND across its arguments and cannot ask "only if
   * the body touches these fields", so the gate is inside the handler —
   * `docs/permissions.md` §4 calls this the `◐` pattern and
   * `permissions.agreement.test.ts` counts it as enforcement. What *that*
   * test cannot do is prove the gate fires, because it reads source text.
   * This does, against the live API, with the one role that distinguishes the
   * two permissions.
   *
   * The version is read first rather than assumed: the record carries an
   * optimistic lock, and a stale `expectedVersion` answers **409 before the
   * permission is ever consulted** — which would make every cell below pass
   * for the wrong reason. That is the same trap the project writes above
   * avoid by resolving a real id.
   */
  test("an administrator may write the company but not its legal identity", async () => {
    const admin = await signIn("administrator");

    const before = await admin.ctx.get(`${API}/organisation`);
    expect(before.status()).toBe(200);
    const body = (await before.json()) as {
      data: { organisation: { version: number; mainPhone: string | null }; canEditLegal: boolean };
    };

    // The server's own answer travels with the record so the form can render
    // the legal fields read-only rather than letting somebody fill them in
    // and meet a 403 on save.
    expect(body.data.canEditLegal, "administrator must not hold organisation.updateLegal").toBe(
      false,
    );

    const version = body.data.organisation.version;

    // A general field: allowed. Writing the value back unchanged would be a
    // no-op the service short-circuits, so this sends a different one and
    // restores it afterwards.
    const general = await admin.ctx.patch(`${API}/organisation`, {
      data: { expectedVersion: version, mainPhone: "+41 33 227 40 20" },
    });
    expect(general.status(), "administrator PATCH general field").toBe(200);

    const now = (
      (await (await admin.ctx.get(`${API}/organisation`)).json()) as {
        data: { organisation: { version: number } };
      }
    ).data.organisation.version;

    for (const field of ["uid", "commercialRegister", "copyright"]) {
      const refused = await admin.ctx.patch(`${API}/organisation`, {
        data: { expectedVersion: now, [field]: field === "uid" ? "CHE-107.625.851" : "x" },
      });
      expect(refused.status(), `administrator PATCH legal field ${field}`).toBe(403);
    }

    // And `office.delete`, which the same role is withheld for the same
    // reason: removing a row that employees and projects point at is the
    // Geschäftsleitung's call, not the person who maintains the system.
    const offices = (
      (await (await admin.ctx.get(`${API}/offices`)).json()) as { data: { id: string }[] }
    ).data;
    expect(offices.length, "der Seed muss Standorte angelegt haben").toBeGreaterThan(0);
    const deletion = await admin.ctx.delete(`${API}/offices/${offices[0].id}`);
    expect(deletion.status(), "administrator DELETE office").toBe(403);
  });

  /**
   * The settings store refuses a value that would destroy data.
   *
   * `applications.retentionDays` feeds `retainUntil`, which the 03:00 purge
   * deletes against — a `0` there removed every dossier received that day,
   * files included, and a non-numeric value produced `new Date(NaN)` and took
   * the public application form down with a 500. Neither was reachable
   * through a bug; both were reachable through the settings form, because
   * nothing validated the write.
   *
   * Against the live API rather than in a unit test, because that is the
   * layer the guarantee is made at: `settings.rules.ts` is tested exhaustively
   * on its own, and this proves it is actually wired into the endpoint.
   */
  test("the settings endpoint refuses a retention period that would delete dossiers", async () => {
    const admin = await signIn("superAdmin");

    for (const value of [0, -5, "bald", true]) {
      const refused = await admin.ctx.patch(`${API}/settings`, {
        data: { updates: [{ key: "applications.retentionDays", value }] },
      });
      expect(refused.status(), `retentionDays = ${JSON.stringify(value)}`).toBe(400);
    }

    // An unknown key is a 404 and not a 400: the caller's *value* is fine, the
    // key is not, and reporting one as the other sends somebody to fix the
    // wrong half.
    const unknown = await admin.ctx.patch(`${API}/settings`, {
      data: { updates: [{ key: "applications.nope", value: 1 }] },
    });
    expect(unknown.status()).toBe(404);

    /*
      All-or-nothing.

      A settings form saves several fields at once, and a partial write leaves
      the operator looking at a screen where some changes took and some did
      not, with no indication which.
    */
    const mixed = await admin.ctx.patch(`${API}/settings`, {
      data: {
        updates: [
          { key: "mail.smtpPort", value: 2525 },
          { key: "mail.from", value: "kein-empfaenger" },
        ],
      },
    });
    expect(mixed.status(), "a batch with one bad value").toBe(400);

    const after = (await (await admin.ctx.get(`${API}/settings`)).json()) as {
      data: { group: string; settings: { key: string; value: unknown }[] }[];
    };
    const port = after.data
      .flatMap((g) => g.settings)
      .find((s) => s.key === "mail.smtpPort");
    expect(port?.value, "the good half of a refused batch must not have been written").toBe(587);

    // The valid one still goes through, or the assertions above would pass on
    // an endpoint that refused everything.
    const accepted = await admin.ctx.patch(`${API}/settings`, {
      data: { updates: [{ key: "applications.retentionDays", value: 180 }] },
    });
    expect(accepted.status()).toBe(200);
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
    /*
      Reserved against the suite-wide budget before the form is touched.

      Three browser sign-ins follow seven API ones in this file alone, which
      is what used to put the run over ten a minute. Two earlier versions
      tried to *recover* from the resulting 429 and both were wrong in
      opposite directions: the first matched the server's message ("Zu
      viele …"), which the API is free to reword; the second probed for the
      rail with a short timeout and treated its absence as "throttled" — but
      six seconds is not always enough for a *successful* sign-in to render
      the shell, so it waited a minute and clicked **Anmelden** again on a
      page that no longer had one. The click hung and the test timed out at
      two and a half minutes with the rail plainly visible in the trace.

      Pacing removes the recovery path altogether: the attempt is only made
      when there is room for it, so an absent rail means a real failure and
      the message says so.
    */
    await spendLogin();
    await page.goto("/admin.html#/");
    await page.getByLabel(/E-Mail/i).fill(email);
    await page.getByLabel(/Passwort/i).first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /^Anmelden$/ }).click();

    await expect(
      page.getByRole("navigation", { name: "Hauptnavigation" }),
      `${email} konnte sich im Dashboard nicht anmelden`,
    ).toBeVisible({ timeout: 30_000 });
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
